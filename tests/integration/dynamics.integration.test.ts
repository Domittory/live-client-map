import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FakeAiProvider } from "@/lib/ai/provider";
import { createSession } from "@/lib/service/diagnostics";
import { compareSnapshotVersions, getClientTimeline } from "@/lib/service/dynamics";
import {
  explainModelChanges,
  listModelExplanations,
  reviewModelExplanation,
} from "@/lib/service/explanations";
import { scheduleFollowUp } from "@/lib/service/follow-ups";
import { recordModelChange } from "@/lib/service/model-changes";
import { SCORING_MODEL_VERSION } from "@/lib/service/scoring";
import { generateSnapshot, getSnapshot } from "@/lib/service/snapshots";

try {
  process.loadEnvFile(".env.local");
} catch {
  // no .env.local — the suite will skip
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const available = Boolean(url && anonKey && serviceKey);

describe.skipIf(!available)("Dynamics and History read model (ticket 49)", () => {
  const admin = createClient(url!, serviceKey!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const createdUserIds: string[] = [];
  let orgId: string;
  let clientId: string;
  let specialist: { id: string; client: SupabaseClient };

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

  async function grantConsent(type: string) {
    const { error } = await specialist.client.rpc("grant_consent", {
      p_org_id: orgId,
      p_client_id: clientId,
      p_consent_type: type,
      p_scope: "client",
      p_document_version: "1.0",
    });
    if (error) throw new Error(`grant_consent ${type}: ${error.message}`);
  }

  beforeAll(async () => {
    const owner = await createUser(`owner-${crypto.randomUUID()}@example.com`);
    const { data } = await owner.client.rpc("create_organization", {
      org_name: `Dynamics Org ${crypto.randomUUID()}`,
    });
    orgId = data;

    specialist = await createUser(`spec-${crypto.randomUUID()}@example.com`);
    await admin.from("organization_members").insert({
      organization_id: orgId,
      user_id: specialist.id,
      role: "specialist",
      status: "active",
    });

    const { data: clientData, error: clientError } = await specialist.client.rpc("create_client", {
      p_organization_id: orgId,
      p_display_name: `Client ${crypto.randomUUID()}`,
    });
    if (clientError) throw new Error(clientError.message);
    clientId = clientData;

    await grantConsent("data_storage");
    await grantConsent("sensitive_psychological_data");
    await grantConsent("ai_analysis");
  });

  afterAll(async () => {
    for (const id of createdUserIds) {
      await admin.auth.admin.deleteUser(id);
    }
  });

  it("returns an empty timeline for a client without history (no synthesized conclusions)", async () => {
    const events = await getClientTimeline(specialist.client, {
      organizationId: orgId,
      clientId,
    });
    expect(events).toEqual([]);
  });

  it("merges session + correction + follow-up + model change + snapshot in chronological order", async () => {
    const correctionTitle = `Correction ${crypto.randomUUID()}`;
    const { data: correction, error: correctionError } = await specialist.client
      .from("corrections")
      .insert({
        organization_id: orgId,
        client_id: clientId,
        title: correctionTitle,
        status: "in_progress",
      })
      .select("id")
      .single();
    if (correctionError) throw new Error(correctionError.message);

    // Scheduled in the past: event time is scheduled_at for a pending follow-up.
    const followUp = await scheduleFollowUp(specialist.client, {
      organizationId: orgId,
      clientId,
      correctionId: correction!.id,
      scheduledAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    });

    const sessionId = await createSession(specialist.client, orgId, {
      clientId,
      title: `Session ${crypto.randomUUID()}`,
      sessionType: "individual",
    });

    const modelChange = await recordModelChange(specialist.client, {
      organizationId: orgId,
      clientId,
      entityType: "core_node",
      entityId: crypto.randomUUID(),
      previousState: { status: "weakened" },
      newState: { status: "reactivated" },
      changeReason: "test transition",
      evidenceRefs: [],
    });

    const snapshot = await generateSnapshot(specialist.client, {
      clientId,
      reason: "timeline test",
    });

    const events = await getClientTimeline(specialist.client, {
      organizationId: orgId,
      clientId,
    });

    expect(events.map((event) => event.type)).toEqual([
      "follow_up",
      "correction",
      "diagnostic_session",
      "model_change",
      "snapshot",
    ]);

    const byType = new Map(events.map((event) => [event.type, event]));
    expect(byType.get("follow_up")!.sourceId).toBe(followUp.id);
    expect(byType.get("follow_up")!.sourceRoute).toBe(`/corrections/${correction!.id}`);
    expect(byType.get("correction")!.sourceRoute).toBe(`/corrections/${correction!.id}`);
    expect(byType.get("diagnostic_session")!.sourceId).toBe(sessionId);
    expect(byType.get("model_change")!.sourceId).toBe(modelChange.id);
    expect(byType.get("model_change")!.evidenceRoute).toContain("/evidence/core_node/");
    expect(byType.get("snapshot")!.sourceId).toBe(snapshot.id);
  });

  it("before/after comparison matches the stored immutable snapshots", async () => {
    const from = await generateSnapshot(specialist.client, { clientId, reason: "before" });

    const { data: node, error: nodeError } = await admin
      .from("core_nodes")
      .insert({
        organization_id: orgId,
        client_id: clientId,
        title: `Node ${crypto.randomUUID()}`,
        status: "active",
        confidence_score: 88,
      })
      .select("id")
      .single();
    if (nodeError) throw new Error(nodeError.message);

    const to = await generateSnapshot(specialist.client, { clientId, reason: "after" });

    const comparison = await compareSnapshotVersions(specialist.client, {
      fromSnapshotId: from.id,
      toSnapshotId: to.id,
    });

    // Before/after come from the stored rows, not from a recomputation.
    const storedFrom = await getSnapshot(specialist.client, from.id);
    const storedTo = await getSnapshot(specialist.client, to.id);
    expect(comparison.from.model_hash).toBe(storedFrom.model_hash);
    expect(comparison.to.model_hash).toBe(storedTo.model_hash);
    expect(comparison.from.active_core_nodes).toEqual(storedFrom.active_core_nodes);
    expect(comparison.to.active_core_nodes).toEqual(storedTo.active_core_nodes);

    // The diff equals the diff stored at generation time.
    expect(comparison.changes).toEqual(storedTo.changes_since_previous);
    expect(comparison.changes.active_core_nodes.added).toContain(node!.id);
  });

  it("rejects nonsensical comparisons", async () => {
    const page = await listSnapshotsForValidation();
    const [newest, older] = page;
    await expect(
      compareSnapshotVersions(specialist.client, {
        fromSnapshotId: newest.id,
        toSnapshotId: older.id,
      })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });

    async function listSnapshotsForValidation() {
      const { data, error } = await specialist.client
        .from("psychological_snapshots")
        .select("id, version")
        .eq("client_id", clientId)
        .order("version", { ascending: false })
        .limit(2);
      if (error) throw new Error(error.message);
      return data!;
    }
  });

  it("an approved explanation keeps the versions it was generated with", async () => {
    const explanation = await explainModelChanges(specialist.client, new FakeAiProvider(), {
      clientId,
    });
    expect(explanation.status).toBe("pending");

    const approved = await reviewModelExplanation(specialist.client, {
      explanationId: explanation.id,
      decision: "approve",
    });
    expect(approved.status).toBe("approved");

    const approvedPage = await listModelExplanations(specialist.client, {
      organizationId: orgId,
      clientId,
      status: "approved",
    });
    const stored = approvedPage.items.find((item) => item.id === explanation.id)!;

    expect(stored.versions.scoring_model_version).toBe(SCORING_MODEL_VERSION);
    expect(stored.versions.ontology_version).toBe(explanation.versions.ontology_version);
    expect(stored.versions.ai_model).toBe(explanation.versions.ai_model);
    expect(stored.versions.prompt_version).toBe(explanation.versions.prompt_version);
    expect(stored.before_snapshot_id).toBe(explanation.before_snapshot_id);
    expect(stored.after_snapshot_id).toBe(explanation.after_snapshot_id);
  });

  it("RLS: another organization sees no timeline and cannot compare snapshots", async () => {
    const outsider = await createUser(`outsider-${crypto.randomUUID()}@example.com`);
    const { data: otherOrgId } = await outsider.client.rpc("create_organization", {
      org_name: `Other Org ${crypto.randomUUID()}`,
    });

    const events = await getClientTimeline(outsider.client, {
      organizationId: otherOrgId,
      clientId,
    });
    expect(events).toEqual([]);

    const { data: snapshots } = await specialist.client
      .from("psychological_snapshots")
      .select("id")
      .eq("client_id", clientId)
      .order("version", { ascending: true })
      .limit(2);
    await expect(
      compareSnapshotVersions(outsider.client, {
        fromSnapshotId: snapshots![0].id,
        toSnapshotId: snapshots![1].id,
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
