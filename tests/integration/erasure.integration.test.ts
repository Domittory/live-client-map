import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  executeErasure,
  opaqueClientRef,
  previewErasure,
  setLegalHold,
} from "@/lib/service/erasure";

/**
 * Ticket 58 — full data erasure against a real database and RLS. Verifies the
 * hard-delete cascade, audit anonymization (including child-entity rows),
 * legal_hold deferral, owner-only authorization and idempotent retry.
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
  "anonymized_analytics",
  "relationship_analysis",
] as const;

describe.skipIf(!available)("Consent revocation and erasure (ticket 58)", () => {
  const admin = createClient(url!, serviceKey!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const createdUserIds: string[] = [];
  let orgId: string;
  let owner: { id: string; client: SupabaseClient };
  let secondary: { id: string; client: SupabaseClient };

  let clientA: string; // full erasure subject
  let clientB: string; // relationship partner + post-erasure audit target
  let clientC: string; // legal-hold subject
  let clientD: string; // non-owner rejection subject
  let nodeId: string;
  let relationshipId: string;

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

  async function createClientFor(displayName: string): Promise<string> {
    const { data, error } = await owner.client.rpc("create_client", {
      p_organization_id: orgId,
      p_display_name: displayName,
    });
    if (error) throw new Error(error.message);
    return data as string;
  }

  async function seedConsents(clientId: string): Promise<void> {
    for (const consentType of CONSENT_TYPES) {
      await admin.from("consent_records").insert({
        organization_id: orgId,
        client_id: clientId,
        consent_type: consentType,
        document_version: "1.0",
      });
    }
  }

  beforeAll(async () => {
    owner = await createUser(`erasure-owner-${crypto.randomUUID()}@example.com`);
    const { data: org } = await owner.client.rpc("create_organization", {
      org_name: "Erasure Org",
    });
    orgId = org;

    secondary = await createUser(`erasure-secondary-${crypto.randomUUID()}@example.com`);
    await admin.from("organization_members").insert({
      organization_id: orgId,
      user_id: secondary.id,
      role: "specialist",
      status: "active",
    });

    clientA = await createClientFor("Клиент A");
    clientB = await createClientFor("Клиент B");
    clientC = await createClientFor("Клиент C");
    clientD = await createClientFor("Клиент D");

    for (const clientId of [clientA, clientB, clientC, clientD]) {
      await seedConsents(clientId);
    }

    await admin.from("client_assignments").insert({
      client_id: clientD,
      user_id: secondary.id,
      access_role: "secondary_specialist",
    });

    // Seed clientA with business data + a core node id we keep for audit checks.
    const { data: node, error: nodeError } = await admin
      .from("core_nodes")
      .insert({
        organization_id: orgId,
        client_id: clientA,
        title: "Узел для удаления",
        status: "active",
        visibility: "internal",
        confidence_score: 50,
      })
      .select("id")
      .single();
    if (nodeError || !node) throw new Error("failed to seed core node");
    nodeId = node.id;

    await admin.from("themes").insert({
      organization_id: orgId,
      client_id: clientA,
      name: "Тема для удаления",
      status: "active",
      visibility: "internal",
    });
    await admin.from("signals").insert({
      organization_id: orgId,
      client_id: clientA,
      source_type: "client_report",
      epistemic_type: "self_report",
      raw_statement: "Персональное высказывание",
      statement_polarity: "negative",
      test_result: "not_tested",
      review_status: "approved",
    });

    const { data: relationship, error: relationshipError } = await admin
      .from("relationships")
      .insert({
        organization_id: orgId,
        client_a_id: clientA,
        client_b_id: clientB,
        relationship_type: "family",
      })
      .select("id")
      .single();
    if (relationshipError || !relationship) throw new Error("failed to seed relationship");
    relationshipId = relationship.id;
    await admin.from("relationship_dynamics").insert({
      relationship_id: relationshipId,
      title: "Динамика для удаления",
      visibility: "internal",
    });

    await admin.from("client_portal_users").insert({
      client_id: clientA,
      email: `portal-${crypto.randomUUID()}@example.com`,
      status: "active",
    });

    await admin.from("ai_runs").insert({
      organization_id: orgId,
      client_id: clientA,
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

    // Audit rows: one for the client itself, one for the child core node.
    await owner.client.rpc("append_audit", {
      p_organization_id: orgId,
      p_entity_type: "client",
      p_entity_id: clientA,
      p_action: "client.test",
      p_before: null,
      p_after: { display_name: "Клиент A" },
      p_reason: null,
      p_ip_address: null,
      p_user_agent: null,
    });
    await admin.from("audit_log").insert({
      organization_id: orgId,
      actor_user_id: owner.id,
      entity_type: "core_node",
      entity_id: nodeId,
      action: "core_node.test",
      before_data: { raw_statement: "персональные данные" },
      after_data: null,
    });
  }, 60_000);

  afterAll(async () => {
    for (const id of createdUserIds) {
      await admin.auth.admin.deleteUser(id);
    }
  });

  it("rejects a non-owner", async () => {
    await expect(executeErasure(secondary.client, admin, clientD)).rejects.toThrow();
    const { data } = await admin.from("clients").select("id").eq("id", clientD);
    expect(data).toHaveLength(1);
  });

  it("defers erasure while legal_hold is set, then completes after clearing", async () => {
    await setLegalHold(owner.client, admin, clientC, true);

    const blocked = await executeErasure(owner.client, admin, clientC);
    expect(blocked.status).toBe("blocked");

    const { data: stillThere } = await admin.from("clients").select("id").eq("id", clientC);
    expect(stillThere).toHaveLength(1);

    await setLegalHold(owner.client, admin, clientC, false);
    const completed = await executeErasure(owner.client, admin, clientC);
    expect(completed.status).toBe("completed");

    const { data: gone } = await admin.from("clients").select("id").eq("id", clientC);
    expect(gone).toHaveLength(0);
  });

  it("hard-deletes every client-scoped table and anonymizes the audit trail", async () => {
    const preview = await previewErasure(owner.client, admin, clientA);
    expect(preview.legalHold).toBe(false);
    expect(preview.impacted.core_nodes).toBeGreaterThanOrEqual(1);
    expect(preview.entityIds).toContain(clientA);
    expect(preview.entityIds).toContain(nodeId);

    const result = await executeErasure(owner.client, admin, clientA);
    expect(result.status).toBe("completed");
    expect(result.clientRef).toBe(opaqueClientRef(clientA));

    // Client and every seeded child are gone.
    const { data: clientsLeft } = await admin.from("clients").select("id").eq("id", clientA);
    expect(clientsLeft).toHaveLength(0);
    for (const table of ["core_nodes", "themes", "signals", "consent_records"]) {
      const { data } = await admin.from(table).select("id").eq("client_id", clientA);
      expect(data, `${table} should be empty`).toHaveLength(0);
    }
    const { data: assignments } = await admin
      .from("client_assignments")
      .select("id")
      .eq("client_id", clientA);
    expect(assignments).toHaveLength(0);

    const { data: relationships } = await admin
      .from("relationships")
      .select("id")
      .or(`client_a_id.eq.${clientA},client_b_id.eq.${clientA}`);
    expect(relationships).toHaveLength(0);
    const { data: dynamics } = await admin
      .from("relationship_dynamics")
      .select("id")
      .eq("id", relationshipId);
    expect(dynamics).toHaveLength(0);

    const { data: portal } = await admin
      .from("client_portal_users")
      .select("id")
      .eq("client_id", clientA);
    expect(portal).toHaveLength(0);
    const { data: aiRuns } = await admin.from("ai_runs").select("id").eq("client_id", clientA);
    expect(aiRuns).toHaveLength(0);

    // Erasure request is terminal and survives the client delete.
    const { data: request } = await admin
      .from("erasure_requests")
      .select("*")
      .eq("client_ref", opaqueClientRef(clientA))
      .single();
    expect(request.status).toBe("completed");
    expect(request.client_id).toBeNull();
    expect(request.backup_marker.tombstone_required).toBe(true);

    // The client audit row and the child-entity audit row are both anonymized.
    const { data: clientAudit } = await admin
      .from("audit_log")
      .select("*")
      .eq("organization_id", orgId)
      .eq("action", "client.test")
      .single();
    expect(clientAudit.entity_id).toBeNull();
    expect(clientAudit.before_data).toEqual({ erased: true });
    expect(clientAudit.after_data).toEqual({ erased: true });

    const { data: childAudit } = await admin
      .from("audit_log")
      .select("*")
      .eq("organization_id", orgId)
      .eq("action", "core_node.test")
      .single();
    expect(childAudit.entity_id).toBeNull();
    expect(childAudit.before_data).toEqual({ erased: true });

    // A completion audit row references the request, never the deleted client.
    const { data: completion } = await admin
      .from("audit_log")
      .select("*")
      .eq("action", "client.erasure_completed")
      .eq("entity_id", request.id)
      .maybeSingle();
    expect(completion).toBeTruthy();
  });

  it("is idempotent — a second run reports already_completed", async () => {
    const result = await executeErasure(owner.client, admin, clientA);
    expect(result.status).toBe("already_completed");

    const { data: requests } = await admin
      .from("erasure_requests")
      .select("id")
      .eq("client_ref", opaqueClientRef(clientA));
    expect(requests).toHaveLength(1);
  });

  it("keeps append_audit working after anonymization", async () => {
    const { error } = await owner.client.rpc("append_audit", {
      p_organization_id: orgId,
      p_entity_type: "client",
      p_entity_id: clientB,
      p_action: "client.unrelated",
      p_before: null,
      p_after: { display_name: "Клиент B" },
      p_reason: null,
      p_ip_address: null,
      p_user_agent: null,
    });
    if (error) throw new Error(error.message);

    const { data } = await admin
      .from("audit_log")
      .select("*")
      .eq("organization_id", orgId)
      .eq("action", "client.unrelated")
      .single();
    expect(data).toBeTruthy();
    expect(data.entity_id).toBe(clientB);
    expect(data.after_data).toEqual({ display_name: "Клиент B" });
  });
});
