import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  executeErasure,
  opaqueClientRef,
  previewErasure,
  revokeDataStorage,
  setLegalHold,
} from "@/lib/service/erasure";
import { connectFaultInjection, type FaultInjection } from "./support/fault-injection";

/**
 * Ticket 08 — privileged erasure flows are atomic.
 *
 * The whole erasure runs inside one SECURITY DEFINER RPC, so a fault at any
 * transactionally significant stage (the request record, the consent
 * revocation, the irreversible audit anonymization, the ai_runs purge, the hard
 * client delete and the final finalize + completion audit) must roll the entire
 * transaction back: no partial client data deletion, no AI runs purged without
 * the delete, no anonymized audit without the client being gone, and no
 * unrelated client or organization touched.
 *
 * Faults are injected through the local-only `test_support` schema created by
 * supabase/seed.sql (never present in a deployed database, never exposed
 * through PostgREST). Every marker here is unique to the row it targets, so the
 * suite stays safe while integration files run in parallel. When that support
 * is missing the fault cases are skipped.
 */

try {
  process.loadEnvFile(".env.local");
} catch {
  // no .env.local — the suite will skip
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const available = Boolean(url && anonKey && serviceKey);

const CONSENT_TYPES = [
  "data_storage",
  "ai_analysis",
  "sensitive_psychological_data",
  "health_related_data",
  "supervisor_access",
  "client_portal",
] as const;

interface Subject {
  clientId: string;
  coreNodeId: string;
  /** Unique audit action preserved by anonymization — used as a fault marker. */
  auditAction: string;
}

describe.skipIf(!available)("atomic privileged erasure flows (ticket 08)", () => {
  const admin = createClient(url!, serviceKey!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const createdUserIds: string[] = [];
  let faults: FaultInjection;
  let orgId: string;
  let owner: { id: string; client: SupabaseClient };
  let secondary: { id: string; client: SupabaseClient };
  let otherOrgId: string;
  let unrelatedSameOrg: string;
  let unrelatedOtherOrg: string;

  function anonClient() {
    return createClient(url!, anonKey!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }

  async function createUser(email: string): Promise<{ id: string; client: SupabaseClient }> {
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password: "password123",
      email_confirm: true,
    });
    if (error) throw new Error(error.message);
    createdUserIds.push(data.user!.id);
    const client = anonClient();
    await client.auth.signInWithPassword({ email, password: "password123" });
    return { id: data.user!.id, client };
  }

  async function createClientFor(
    user: { id: string; client: SupabaseClient },
    organizationId: string,
    displayName: string
  ): Promise<string> {
    const { data, error } = await user.client.rpc("create_client", {
      p_organization_id: organizationId,
      p_display_name: displayName,
    });
    if (error) throw new Error(error.message);
    return data as string;
  }

  /** Seed every data class the erasure must treat atomically. */
  async function seedSubject(
    displayName: string,
    options: { withAiRuns?: boolean } = {}
  ): Promise<Subject> {
    const withAiRuns = options.withAiRuns ?? true;
    const clientId = await createClientFor(owner, orgId, displayName);

    for (const consentType of CONSENT_TYPES) {
      const { error } = await admin.from("consent_records").insert({
        organization_id: orgId,
        client_id: clientId,
        consent_type: consentType,
        document_version: "1.0",
      });
      if (error) throw new Error(`consent ${consentType}: ${error.message}`);
    }

    const { data: node, error: nodeError } = await admin
      .from("core_nodes")
      .insert({
        organization_id: orgId,
        client_id: clientId,
        title: `${displayName} node`,
        status: "active",
        visibility: "internal",
        confidence_score: 50,
      })
      .select("id")
      .single();
    if (nodeError || !node) throw new Error("failed to seed core node");

    await admin.from("themes").insert({
      organization_id: orgId,
      client_id: clientId,
      name: `${displayName} theme`,
      status: "active",
      visibility: "internal",
    });
    await admin.from("signals").insert({
      organization_id: orgId,
      client_id: clientId,
      source_type: "client_report",
      epistemic_type: "self_report",
      raw_statement: `${displayName} personal statement`,
      statement_polarity: "negative",
      test_result: "not_tested",
      review_status: "approved",
    });

    if (withAiRuns) {
      const { error } = await admin.from("ai_runs").insert({
        organization_id: orgId,
        client_id: clientId,
        actor_user_id: owner.id,
        request_id: crypto.randomUUID(),
        idempotency_key: crypto.randomUUID(),
        function: "ai.test",
        contract_version: "1.0",
        prompt_version: "1.0",
        ontology_version: "1.0",
        provider: "fake",
        model_snapshot: "fake",
        reasoning_effort: "low",
        input_hash: "hash",
        redaction_version: "1",
        status: "succeeded",
      });
      if (error) throw new Error(`ai run: ${error.message}`);
    }

    // One audit row on the client and one on its child node. The client row
    // carries a unique action that survives anonymization, so a fault can target
    // the anonymization UPDATE itself without a non-unique marker.
    const auditAction = `erasure.anonymize.${crypto.randomUUID()}`;
    const { error: auditError } = await admin.from("audit_log").insert({
      organization_id: orgId,
      actor_user_id: owner.id,
      entity_type: "client",
      entity_id: clientId,
      action: auditAction,
      before_data: { personal: `${displayName} private` },
      after_data: null,
    });
    if (auditError) throw new Error(`audit: ${auditError.message}`);

    await admin.from("audit_log").insert({
      organization_id: orgId,
      actor_user_id: owner.id,
      entity_type: "core_node",
      entity_id: node.id,
      action: `erasure.child.${crypto.randomUUID()}`,
      before_data: { personal: "child" },
      after_data: null,
    });

    return { clientId, coreNodeId: node.id, auditAction };
  }

  async function countsFor(clientId: string) {
    const [nodes, themes, signals, aiRuns, consents, client, request] = await Promise.all([
      admin.from("core_nodes").select("id").eq("client_id", clientId),
      admin.from("themes").select("id").eq("client_id", clientId),
      admin.from("signals").select("id").eq("client_id", clientId),
      admin.from("ai_runs").select("id").eq("client_id", clientId),
      admin.from("consent_records").select("id").eq("client_id", clientId).is("revoked_at", null),
      admin.from("clients").select("id").eq("id", clientId),
      admin.from("erasure_requests").select("*").eq("client_ref", opaqueClientRef(clientId)),
    ]);
    return {
      clients: (client.data ?? []).length,
      coreNodes: (nodes.data ?? []).length,
      themes: (themes.data ?? []).length,
      signals: (signals.data ?? []).length,
      aiRuns: (aiRuns.data ?? []).length,
      activeConsents: (consents.data ?? []).length,
      request: (request.data ?? [])[0] ?? null,
    };
  }

  async function auditRow(action: string) {
    const { data } = await admin.from("audit_log").select("*").eq("action", action).maybeSingle();
    return data;
  }

  /** Everything an erasure must leave consistent after a rollback. */
  async function expectUntouched(
    subject: Subject,
    expectedActiveConsents: number = CONSENT_TYPES.length
  ): Promise<void> {
    const counts = await countsFor(subject.clientId);
    expect(counts.clients, "client must survive a failed erasure").toBe(1);
    expect(counts.coreNodes).toBe(1);
    expect(counts.themes).toBe(1);
    expect(counts.signals).toBe(1);
    expect(counts.aiRuns).toBe(1);
    expect(counts.activeConsents).toBe(expectedActiveConsents);

    const audit = await auditRow(subject.auditAction);
    expect(audit, "audit row must survive").toBeTruthy();
    expect(audit!.entity_id, "audit must not be anonymized").toBe(subject.clientId);
    expect(audit!.before_data).toEqual({ personal: expect.any(String) });
  }

  async function expectUnrelatedIntact(): Promise<void> {
    const [sameNodes, otherNodes, sameClients, otherClients] = await Promise.all([
      admin.from("core_nodes").select("id").eq("client_id", unrelatedSameOrg),
      admin.from("core_nodes").select("id").eq("client_id", unrelatedOtherOrg),
      admin.from("clients").select("id").eq("id", unrelatedSameOrg),
      admin.from("clients").select("id").eq("id", unrelatedOtherOrg),
    ]);
    expect((sameClients.data ?? []).length, "same-org client untouched").toBe(1);
    expect((otherClients.data ?? []).length, "other-org client untouched").toBe(1);
    expect((sameNodes.data ?? []).length, "same-org data untouched").toBe(1);
    expect((otherNodes.data ?? []).length, "other-org data untouched").toBe(1);
  }

  beforeAll(async () => {
    faults = await connectFaultInjection();

    owner = await createUser(`erasure-owner-${crypto.randomUUID()}@example.com`);
    const { data: org } = await owner.client.rpc("create_organization", {
      org_name: "Atomic Erasure Org",
    });
    orgId = org as string;

    secondary = await createUser(`erasure-secondary-${crypto.randomUUID()}@example.com`);
    await admin.from("organization_members").insert({
      organization_id: orgId,
      user_id: secondary.id,
      role: "specialist",
      status: "active",
    });

    const otherOwner = await createUser(`erasure-other-${crypto.randomUUID()}@example.com`);
    const { data: otherOrg } = await otherOwner.client.rpc("create_organization", {
      org_name: "Atomic Erasure Other Org",
    });
    otherOrgId = otherOrg as string;

    unrelatedSameOrg = await createClientFor(owner, orgId, "Unrelated same org");
    await admin.from("core_nodes").insert({
      organization_id: orgId,
      client_id: unrelatedSameOrg,
      title: "Unrelated same-org node",
      status: "active",
      visibility: "internal",
      confidence_score: 50,
    });

    unrelatedOtherOrg = await createClientFor(otherOwner, otherOrgId, "Unrelated other org");
    await admin.from("core_nodes").insert({
      organization_id: otherOrgId,
      client_id: unrelatedOtherOrg,
      title: "Unrelated other-org node",
      status: "active",
      visibility: "internal",
      confidence_score: 50,
    });
  }, 60_000);

  afterAll(async () => {
    await faults?.clear();
    await faults?.close();
    for (const id of createdUserIds) {
      await admin.auth.admin.deleteUser(id);
    }
  });

  it("rejects a non-owner before touching any data", async () => {
    const subject = await seedSubject("Non-owner target");

    await expect(executeErasure(secondary.client, admin, subject.clientId)).rejects.toThrow();

    await expectUntouched(subject);
    await expectUnrelatedIntact();
  });

  it("reports NOT_FOUND for an unknown client", async () => {
    await expect(executeErasure(owner.client, admin, crypto.randomUUID())).rejects.toThrow();
  });

  it("derives the same impact in the preview and inside the erasure transaction", async () => {
    const subject = await seedSubject("Preview parity");

    const preview = await previewErasure(owner.client, admin, subject.clientId);
    const result = await executeErasure(owner.client, admin, subject.clientId);

    expect(result.status).toBe("completed");
    expect(Object.keys(result.impacted).sort()).toEqual(Object.keys(preview.impacted).sort());
    for (const key of Object.keys(preview.impacted)) {
      expect(result.impacted[key], `impact for ${key}`).toBe(preview.impacted[key]);
    }
    expect(preview.entityIds).toContain(subject.clientId);
    expect(preview.entityIds).toContain(subject.coreNodeId);
    await expectUnrelatedIntact();
  });

  it("blocks the irreversible part while legal_hold is set, then completes after clearing", async () => {
    const subject = await seedSubject("Legally held");
    await setLegalHold(owner.client, admin, subject.clientId, true);

    const blocked = await executeErasure(owner.client, admin, subject.clientId);
    expect(blocked.status).toBe("blocked");

    // Nothing was touched: not even the consents were revoked.
    await expectUntouched(subject);
    const counts = await countsFor(subject.clientId);
    expect(counts.request?.status).toBe("blocked");
    expect(counts.request?.blocked_reason).toBe("legal_hold");
    await expectUnrelatedIntact();

    await setLegalHold(owner.client, admin, subject.clientId, false);
    const completed = await executeErasure(owner.client, admin, subject.clientId);
    expect(completed.status).toBe("completed");
    const after = await countsFor(subject.clientId);
    expect(after.clients).toBe(0);
    await expectUnrelatedIntact();
  });

  it("rolls back when the erasure request record cannot be written", async (ctx) => {
    if (!faults.available) return ctx.skip();
    const subject = await seedSubject("Fault at request");

    await faults.register("erasure_requests", subject.clientId);
    try {
      await expect(executeErasure(owner.client, admin, subject.clientId)).rejects.toThrow();
    } finally {
      await faults.clear();
    }

    await expectUntouched(subject);
    await expectUnrelatedIntact();
  });

  it("rolls back when the consent revocation fails", async (ctx) => {
    if (!faults.available) return ctx.skip();
    const subject = await seedSubject("Fault at consent");

    await faults.register("consent_records", subject.clientId);
    try {
      await expect(executeErasure(owner.client, admin, subject.clientId)).rejects.toThrow();
    } finally {
      await faults.clear();
    }

    await expectUntouched(subject);
    await expectUnrelatedIntact();
  });

  it("rolls back the irreversible audit anonymization when it fails", async (ctx) => {
    if (!faults.available) return ctx.skip();
    const subject = await seedSubject("Fault at anonymize");

    // The marker is the unique audit action, which anonymization preserves but
    // never changes — so the fault fires exactly on the anonymize UPDATE.
    await faults.register("audit_log", subject.auditAction);
    try {
      await expect(executeErasure(owner.client, admin, subject.clientId)).rejects.toThrow();
    } finally {
      await faults.clear();
    }

    await expectUntouched(subject);
    await expectUnrelatedIntact();
  });

  it("rolls back the AI-run purge together with everything before it", async (ctx) => {
    if (!faults.available) return ctx.skip();
    const subject = await seedSubject("Fault at ai_runs");

    await faults.register("ai_runs", subject.clientId);
    try {
      await expect(executeErasure(owner.client, admin, subject.clientId)).rejects.toThrow();
    } finally {
      await faults.clear();
    }

    // The anonymization already ran (and failed later), so this proves the
    // irreversible steps are one transaction.
    await expectUntouched(subject);
    await expectUnrelatedIntact();
  });

  it("rolls back when the hard delete itself fails", async (ctx) => {
    if (!faults.available) return ctx.skip();
    const subject = await seedSubject("Fault at delete");

    await faults.register("clients", subject.clientId);
    try {
      await expect(executeErasure(owner.client, admin, subject.clientId)).rejects.toThrow();
    } finally {
      await faults.clear();
    }

    await expectUntouched(subject);
    await expectUnrelatedIntact();
  });

  it("rolls back the delete when the final completion audit fails, then completes on retry", async (ctx) => {
    if (!faults.available) return ctx.skip();
    const subject = await seedSubject("Fault at finalize");

    // A pre-existing request lets the test target the very last statement: the
    // completion audit carries the request id, a value written nowhere else.
    const requestId = await revokeDataStorage(owner.client, admin, subject.clientId);

    await faults.register("audit_log", requestId);
    try {
      await expect(executeErasure(owner.client, admin, subject.clientId)).rejects.toThrow();
    } finally {
      await faults.clear();
    }

    // The delete, the finalize and the audit all rolled back together. One
    // consent (data_storage) stays revoked from the separate request step.
    await expectUntouched(subject, CONSENT_TYPES.length - 1);
    const rolledBack = await countsFor(subject.clientId);
    expect(rolledBack.request?.status).toBe("requested");
    expect(rolledBack.request?.completed_at).toBeNull();
    await expectUnrelatedIntact();

    // A retry after the failure is defined and recoverable: it completes.
    const retry = await executeErasure(owner.client, admin, subject.clientId);
    expect(retry.status).toBe("completed");
    const after = await countsFor(subject.clientId);
    expect(after.clients).toBe(0);
    expect(after.coreNodes).toBe(0);
    expect(after.aiRuns).toBe(0);
    expect(after.request?.status).toBe("completed");
    expect(after.request?.backup_marker?.tombstone_required).toBe(true);

    // The completion audit survived the retry; the anonymized row kept its
    // action but lost its personal reference.
    const { data: completion } = await admin
      .from("audit_log")
      .select("*")
      .eq("entity_type", "erasure_request")
      .eq("entity_id", requestId)
      .maybeSingle();
    expect(completion).toBeTruthy();
    const anonymized = await auditRow(subject.auditAction);
    expect(anonymized!.entity_id).toBeNull();
    expect(anonymized!.before_data).toEqual({ erased: true });
    await expectUnrelatedIntact();
  });

  it("finalizes a request whose client is already gone instead of failing", async () => {
    // No ai_runs: they are append-only and can only be purged inside the
    // erasure transaction, so this recovery fixture is built without them.
    const subject = await seedSubject("Recovery", { withAiRuns: false });

    const requestId = await revokeDataStorage(owner.client, admin, subject.clientId);

    // Simulate a legacy/out-of-band partial failure: the irreversible delete
    // committed, the bookkeeping did not.
    const { error: deleteError } = await admin.from("clients").delete().eq("id", subject.clientId);
    if (deleteError) throw new Error(deleteError.message);

    const result = await executeErasure(owner.client, admin, subject.clientId);
    expect(result.status).toBe("already_completed");
    expect(result.erasureRequestId).toBe(requestId);

    const { data: request } = await admin
      .from("erasure_requests")
      .select("*")
      .eq("id", requestId)
      .single();
    expect(request.status).toBe("completed");
    expect(request.client_id).toBeNull();
    expect(request.backup_marker.tombstone_required).toBe(true);

    const { data: completion } = await admin
      .from("audit_log")
      .select("id")
      .eq("action", "client.erasure_completed")
      .eq("entity_id", requestId);
    expect(completion).toHaveLength(1);
    await expectUnrelatedIntact();
  });

  it("keeps the destructive erasure helpers internal (least privilege)", async () => {
    const probe = crypto.randomUUID();

    const authenticatedAnonymize = await owner.client.rpc("anonymize_client_audit", {
      p_client_id: probe,
      p_entity_ids: [],
    });
    expect(authenticatedAnonymize.error).not.toBeNull();

    const serviceAnonymize = await admin.rpc("anonymize_client_audit", {
      p_client_id: probe,
      p_entity_ids: [],
    });
    expect(serviceAnonymize.error).not.toBeNull();

    const authenticatedPurge = await owner.client.rpc("purge_client_ai_runs", {
      p_client_id: probe,
    });
    expect(authenticatedPurge.error).not.toBeNull();

    const authenticatedRef = await owner.client.rpc("opaque_client_ref", { p_client_id: probe });
    expect(authenticatedRef.error).not.toBeNull();
  });

  it("keeps the public erasure RPC unavailable to anonymous callers", async () => {
    const anon = anonClient();
    const { error } = await anon.rpc("execute_client_erasure", {
      p_client_id: crypto.randomUUID(),
    });
    expect(error).not.toBeNull();
  });
});
