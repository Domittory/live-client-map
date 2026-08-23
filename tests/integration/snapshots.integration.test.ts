import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MODEL_CONFIG } from "@/lib/ai/contracts";
import { FakeAiProvider } from "@/lib/ai/provider";
import {
  completeFollowUp,
  evaluateCorrection,
  reviewFollowUpAssessment,
  scheduleFollowUp,
} from "@/lib/service/follow-ups";
import { listModelChanges } from "@/lib/service/model-changes";
import {
  evaluateCoreNodeReactivation,
  reviewCoreNodeReactivation,
} from "@/lib/service/reactivation";
import { SCORING_MODEL_VERSION } from "@/lib/service/scoring";
import {
  SNAPSHOT_CATEGORIES,
  compareWithPrevious,
  generateSnapshot,
  getSnapshot,
  listSnapshots,
} from "@/lib/service/snapshots";

try {
  process.loadEnvFile(".env.local");
} catch {
  // no .env.local — the suite will skip
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const available = Boolean(url && anonKey && serviceKey);

const DAY_MS = 24 * 60 * 60 * 1000;

describe.skipIf(!available)("ModelChange and PsychologicalSnapshot (ticket 43)", () => {
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

  async function insertCoreNode(title: string, status: string): Promise<string> {
    const { data, error } = await admin
      .from("core_nodes")
      .insert({ organization_id: orgId, client_id: clientId, title, status })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return data!.id;
  }

  /** Fresh evidence that makes a weakened node reactivation-eligible. */
  async function makeReactivatable(coreNodeId: string): Promise<{ signalId: string }> {
    const { data: theme, error: themeError } = await admin
      .from("themes")
      .insert({ organization_id: orgId, client_id: clientId, name: `Theme ${crypto.randomUUID()}` })
      .select("id")
      .single();
    if (themeError) throw new Error(themeError.message);
    await admin
      .from("theme_core_node_links")
      .insert({ theme_id: theme!.id, core_node_id: coreNodeId, relationship_type: "expresses" });

    const { data: signal, error: signalError } = await admin
      .from("signals")
      .insert({
        organization_id: orgId,
        client_id: clientId,
        source_type: "kinesiology_test",
        epistemic_type: "test_result",
        raw_statement: "Свежий сигнал",
        evidence_level: "L1_SINGLE_SIGNAL",
        review_status: "approved",
        intensity: 50,
        created_at: new Date(Date.now() - DAY_MS).toISOString(),
      })
      .select("id")
      .single();
    if (signalError) throw new Error(signalError.message);
    await admin.from("signal_theme_links").insert({ signal_id: signal!.id, theme_id: theme!.id });

    const { data: trigger, error: triggerError } = await admin
      .from("triggers")
      .insert({
        organization_id: orgId,
        client_id: clientId,
        title: `Trigger ${crypto.randomUUID()}`,
      })
      .select("id")
      .single();
    if (triggerError) throw new Error(triggerError.message);
    await admin.from("trigger_activations").insert({
      trigger_id: trigger!.id,
      core_node_id: coreNodeId,
      activation_delta: 40,
      created_at: new Date(Date.now() - DAY_MS).toISOString(),
    });
    return { signalId: signal!.id };
  }

  beforeAll(async () => {
    const owner = await createUser(`owner-${crypto.randomUUID()}@example.com`);
    const { data } = await owner.client.rpc("create_organization", {
      org_name: `Snapshots Org ${crypto.randomUUID()}`,
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

  it("generates version 1 with all SPEC §25 categories and version metadata", async () => {
    const snapshot = await generateSnapshot(specialist.client, {
      clientId,
      reason: "Первый snapshot",
    });

    expect(snapshot.version).toBe(1);
    expect(snapshot.organization_id).toBe(orgId);
    expect(snapshot.client_id).toBe(clientId);
    expect(snapshot.generated_by).toBe(specialist.id);
    expect(snapshot.reason).toBe("Первый snapshot");
    expect(snapshot.changes_since_previous).toBeNull();

    // All SPEC §25 categories are present.
    for (const category of SNAPSHOT_CATEGORIES) {
      expect(Array.isArray(snapshot[category])).toBe(true);
    }
    expect(typeof snapshot.summary).toBe("string");
    expect(typeof snapshot.trend_summary).toBe("string");
    expect(typeof snapshot.risk_notes).toBe("string");
    expect(typeof snapshot.evidence_digest).toBe("string");

    // Version metadata.
    expect(snapshot.scoring_model_version).toBe(SCORING_MODEL_VERSION);
    expect(snapshot.ontology_version.length).toBeGreaterThan(0);
    expect(snapshot.ai_model).toBe(MODEL_CONFIG.snapshot);
    expect(snapshot.prompt_version).toBe("prompt.generate-snapshot.v1");
    expect(snapshot.model_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("regeneration without changes: new version, identical model_hash, old snapshot untouched", async () => {
    const first = await generateSnapshot(specialist.client, { clientId, reason: "v" });
    const second = await generateSnapshot(specialist.client, { clientId, reason: "v again" });

    expect(second.version).toBe(first.version + 1);
    expect(second.model_hash).toBe(first.model_hash);

    // The stored first snapshot is never rewritten.
    const reread = await getSnapshot(specialist.client, first.id);
    expect(reread.model_hash).toBe(first.model_hash);
    expect(reread.reason).toBe("v");
    expect(reread.version).toBe(first.version);

    const page = await listSnapshots(specialist.client, { organizationId: orgId, clientId });
    expect(page.items[0].version).toBe(second.version); // newest first
    expect(page.items.length).toBeGreaterThanOrEqual(2);
  });

  it("a model change produces a new hash and a diff against the previous snapshot", async () => {
    const before = await generateSnapshot(specialist.client, { clientId, reason: "before change" });
    const nodeId = await insertCoreNode(`Active node ${crypto.randomUUID()}`, "active");
    const after = await generateSnapshot(specialist.client, { clientId, reason: "after change" });

    expect(after.version).toBe(before.version + 1);
    expect(after.model_hash).not.toBe(before.model_hash);
    expect(after.active_core_nodes.map((node) => node.id)).toContain(nodeId);

    // Stored at generation time…
    const stored = after.changes_since_previous!;
    expect(stored.active_core_nodes.added).toContain(nodeId);

    // …and reproducible via compareWithPrevious.
    const comparison = await compareWithPrevious(specialist.client, after.id);
    expect(comparison.previous?.id).toBe(before.id);
    expect(comparison.changes?.active_core_nodes.added).toContain(nodeId);
  });

  it("snapshots are immutable at the database level: UPDATE and DELETE are rejected", async () => {
    const snapshot = await generateSnapshot(specialist.client, { clientId, reason: "immutable" });

    const update = await specialist.client
      .from("psychological_snapshots")
      .update({ reason: "rewritten" })
      .eq("id", snapshot.id);
    expect(update.error).not.toBeNull();

    const del = await specialist.client
      .from("psychological_snapshots")
      .delete()
      .eq("id", snapshot.id);
    expect(del.error).not.toBeNull();

    const reread = await getSnapshot(specialist.client, snapshot.id);
    expect(reread.reason).toBe("immutable");
  });

  it("approving a reactivation records a ModelChange with previous/new state, reason and evidence", async () => {
    const nodeId = await insertCoreNode(`Weakened node ${crypto.randomUUID()}`, "weakened");
    await admin.from("core_nodes").update({ activation_score: 25 }).eq("id", nodeId);
    const { signalId } = await makeReactivatable(nodeId);

    const { proposal } = await evaluateCoreNodeReactivation(specialist.client, {
      coreNodeId: nodeId,
    });
    expect(proposal).not.toBeNull();
    await reviewCoreNodeReactivation(specialist.client, {
      reactivationId: proposal!.id,
      decision: "approve",
    });

    const changes = await listModelChanges(specialist.client, {
      organizationId: orgId,
      entityType: "core_node",
      entityId: nodeId,
    });
    expect(changes.items).toHaveLength(1);
    const change = changes.items[0];
    expect(change.client_id).toBe(clientId);
    expect(change.previous_state).toEqual({ status: "weakened", activation_score: 25 });
    expect(change.new_state).toEqual({ status: "reactivated", activation_score: 75 });
    expect(change.change_reason).toContain("activation_score");
    expect(change.evidence_refs).toContain(proposal!.id);
    expect(change.evidence_refs).toContain(signalId);
  });

  it("approving a follow-up assessment records a ModelChange with the final verdict", async () => {
    const { data: correction, error: correctionError } = await admin
      .from("corrections")
      .insert({
        organization_id: orgId,
        client_id: clientId,
        title: `Correction ${crypto.randomUUID()}`,
        status: "completed",
      })
      .select("id")
      .single();
    if (correctionError) throw new Error(correctionError.message);

    const scheduled = await scheduleFollowUp(specialist.client, {
      organizationId: orgId,
      clientId,
      correctionId: correction!.id,
      scheduledAt: new Date().toISOString(),
    });
    await completeFollowUp(specialist.client, {
      followUpId: scheduled.id,
      clientFeedback: { summary: "Кажется, помогло" },
    });
    // No objective evidence → deterministic guard proposes "unclear".
    const evaluated = await evaluateCorrection(
      specialist.client,
      new FakeAiProvider(),
      scheduled.id
    );
    expect(evaluated.ai_assessment?.source).toBe("deterministic_guard");

    await reviewFollowUpAssessment(specialist.client, {
      followUpId: scheduled.id,
      decision: "approve",
    });

    const changes = await listModelChanges(specialist.client, {
      organizationId: orgId,
      entityType: "follow_up",
      entityId: scheduled.id,
    });
    expect(changes.items).toHaveLength(1);
    const change = changes.items[0];
    expect(change.previous_state).toEqual({ result_status: "completed" });
    expect(change.new_state).toEqual({ result_status: "unclear" });
    expect(change.change_reason).toContain("unclear");
    expect(Array.isArray(change.evidence_refs)).toBe(true);
  });

  it("model changes are immutable too: UPDATE and DELETE are rejected", async () => {
    const nodeId = await insertCoreNode(`Immutable change node ${crypto.randomUUID()}`, "weakened");
    await admin.from("core_nodes").update({ activation_score: 25 }).eq("id", nodeId);
    await makeReactivatable(nodeId);
    const { proposal } = await evaluateCoreNodeReactivation(specialist.client, {
      coreNodeId: nodeId,
    });
    await reviewCoreNodeReactivation(specialist.client, {
      reactivationId: proposal!.id,
      decision: "approve",
    });

    const changes = await listModelChanges(specialist.client, {
      organizationId: orgId,
      entityType: "core_node",
      entityId: nodeId,
    });
    const change = changes.items[0];

    const update = await specialist.client
      .from("model_changes")
      .update({ change_reason: "rewritten" })
      .eq("id", change.id);
    expect(update.error).not.toBeNull();

    const del = await specialist.client.from("model_changes").delete().eq("id", change.id);
    expect(del.error).not.toBeNull();
  });

  it("RLS: another organization cannot read snapshots, model changes or generate", async () => {
    const snapshot = await generateSnapshot(specialist.client, { clientId, reason: "rls" });

    const outsider = await createUser(`outsider-${crypto.randomUUID()}@example.com`);
    const { data: otherOrgId } = await outsider.client.rpc("create_organization", {
      org_name: `Other Org ${crypto.randomUUID()}`,
    });

    const snapshots = await listSnapshots(outsider.client, {
      organizationId: otherOrgId,
      clientId,
    });
    expect(snapshots.items).toHaveLength(0);

    await expect(getSnapshot(outsider.client, snapshot.id)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });

    const changes = await listModelChanges(outsider.client, { organizationId: otherOrgId });
    expect(changes.items).toHaveLength(0);

    await expect(
      generateSnapshot(outsider.client, { clientId, reason: "intrusion" })
    ).rejects.toThrow();
  });
});
