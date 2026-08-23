import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  evaluateCoreNodeReactivation,
  getCoreNodeReactivation,
  listCoreNodeReactivations,
  reviewCoreNodeReactivation,
} from "@/lib/service/reactivation";
import { REACTIVATION_CONFIG } from "@/lib/service/scoring";

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

describe.skipIf(!available)("CoreNode reactivation rules (ticket 42)", () => {
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

  async function insertWeakenedNode(activationScore: number, status = "weakened"): Promise<string> {
    const { data, error } = await admin
      .from("core_nodes")
      .insert({
        organization_id: orgId,
        client_id: clientId,
        title: `Node ${crypto.randomUUID()}`,
        status,
        activation_score: activationScore,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return data!.id;
  }

  async function linkFreshSignal(
    coreNodeId: string,
    options: { evidenceLevel?: string; daysAgo?: number; reviewStatus?: string } = {}
  ): Promise<string> {
    const { data: theme, error: themeError } = await admin
      .from("themes")
      .insert({ organization_id: orgId, client_id: clientId, name: `Theme ${crypto.randomUUID()}` })
      .select("id")
      .single();
    if (themeError) throw new Error(themeError.message);
    const { error: nodeLinkError } = await admin
      .from("theme_core_node_links")
      .insert({ theme_id: theme!.id, core_node_id: coreNodeId, relationship_type: "expresses" });
    if (nodeLinkError) throw new Error(nodeLinkError.message);

    const createdAt = new Date(Date.now() - (options.daysAgo ?? 1) * DAY_MS).toISOString();
    const { data: signalRow, error: signalError } = await admin
      .from("signals")
      .insert({
        organization_id: orgId,
        client_id: clientId,
        source_type: "kinesiology_test",
        epistemic_type: "test_result",
        raw_statement: "Тестовый сигнал",
        evidence_level: options.evidenceLevel ?? "L1_SINGLE_SIGNAL",
        review_status: options.reviewStatus ?? "approved",
        intensity: 50,
        created_at: createdAt,
      })
      .select("id")
      .single();
    if (signalError) throw new Error(signalError.message);
    const { error: signalLinkError } = await admin
      .from("signal_theme_links")
      .insert({ signal_id: signalRow!.id, theme_id: theme!.id });
    if (signalLinkError) throw new Error(signalLinkError.message);
    return signalRow!.id;
  }

  async function linkTriggerActivation(
    coreNodeId: string,
    delta: number,
    daysAgo = 1
  ): Promise<void> {
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
    const { error } = await admin.from("trigger_activations").insert({
      trigger_id: trigger!.id,
      core_node_id: coreNodeId,
      activation_delta: delta,
      created_at: new Date(Date.now() - daysAgo * DAY_MS).toISOString(),
    });
    if (error) throw new Error(error.message);
  }

  async function nodeStatus(coreNodeId: string): Promise<{ status: string; score: number | null }> {
    const { data, error } = await admin
      .from("core_nodes")
      .select("status, activation_score")
      .eq("id", coreNodeId)
      .single();
    if (error) throw new Error(error.message);
    return { status: data!.status, score: data!.activation_score };
  }

  beforeAll(async () => {
    const owner = await createUser(`owner-${crypto.randomUUID()}@example.com`);
    const { data } = await owner.client.rpc("create_organization", {
      org_name: `Reactivation Org ${crypto.randomUUID()}`,
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
  });

  afterAll(async () => {
    for (const id of createdUserIds) {
      await admin.auth.admin.deleteUser(id);
    }
  });

  it("full flow: fresh trigger + signals → pending proposal with config version → approve → reactivated", async () => {
    const nodeId = await insertWeakenedNode(25);
    const signalId = await linkFreshSignal(nodeId);
    await linkTriggerActivation(nodeId, 25);

    const { evaluation, proposal } = await evaluateCoreNodeReactivation(specialist.client, {
      coreNodeId: nodeId,
    });
    expect(evaluation.proposed).toBe(true);
    expect(proposal).not.toBeNull();
    expect(proposal!.status).toBe("pending");
    expect(proposal!.scoring_model_version).toBe(REACTIVATION_CONFIG.version);
    expect(proposal!.previous_activation_score).toBe(25);
    expect(proposal!.proposed_activation_score).toBe(60); // 25 + 25 trigger + 10 signal
    expect(proposal!.calculation.increase).toBe(35);
    expect(proposal!.calculation.activationThreshold).toBe(60);
    expect(proposal!.calculation.minIncrease).toBe(30);
    expect(proposal!.calculation.signals.map((s) => s.id)).toContain(signalId);
    expect(proposal!.calculation.triggerActivations).toHaveLength(1);
    expect(proposal!.reason).toContain("activation_score");

    // The evaluator never changes the node by itself.
    expect(await nodeStatus(nodeId)).toEqual({ status: "weakened", score: 25 });

    // A second evaluation while a proposal is pending is a conflict.
    await expect(
      evaluateCoreNodeReactivation(specialist.client, { coreNodeId: nodeId })
    ).rejects.toMatchObject({ code: "CONFLICT" });

    const approved = await reviewCoreNodeReactivation(specialist.client, {
      reactivationId: proposal!.id,
      decision: "approve",
    });
    expect(approved.status).toBe("approved");
    expect(approved.decided_by).toBe(specialist.id);
    expect(approved.decided_at).not.toBeNull();
    expect(await nodeStatus(nodeId)).toEqual({ status: "reactivated", score: 60 });

    // History: the decided proposal stays listed.
    const history = await listCoreNodeReactivations(specialist.client, {
      organizationId: orgId,
      coreNodeId: nodeId,
    });
    expect(history.items).toHaveLength(1);
    expect(history.items[0].status).toBe("approved");
  });

  it("reject keeps the node weakened", async () => {
    const nodeId = await insertWeakenedNode(25);
    await linkFreshSignal(nodeId);
    await linkTriggerActivation(nodeId, 25);

    const { proposal } = await evaluateCoreNodeReactivation(specialist.client, {
      coreNodeId: nodeId,
    });
    const rejected = await reviewCoreNodeReactivation(specialist.client, {
      reactivationId: proposal!.id,
      decision: "reject",
    });
    expect(rejected.status).toBe("rejected");
    expect(await nodeStatus(nodeId)).toEqual({ status: "weakened", score: 25 });

    // Reviewing a decided proposal is a conflict.
    await expect(
      reviewCoreNodeReactivation(specialist.client, {
        reactivationId: proposal!.id,
        decision: "approve",
      })
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("below-threshold evidence creates no proposal", async () => {
    const nodeId = await insertWeakenedNode(25);
    await linkFreshSignal(nodeId);
    await linkTriggerActivation(nodeId, 10); // 25 + 10 + 10 = 45 < 60

    const { evaluation, proposal } = await evaluateCoreNodeReactivation(specialist.client, {
      coreNodeId: nodeId,
    });
    expect(evaluation.proposed).toBe(false);
    expect(proposal).toBeNull();
    expect(await nodeStatus(nodeId)).toEqual({ status: "weakened", score: 25 });
  });

  it("AI-only and stale evidence never trigger reactivation on their own", async () => {
    const nodeId = await insertWeakenedNode(25);
    await linkFreshSignal(nodeId, { evidenceLevel: "L0_AI_ONLY" });
    await linkFreshSignal(nodeId, { daysAgo: 40 });
    await linkTriggerActivation(nodeId, 40, 40);

    const { evaluation, proposal } = await evaluateCoreNodeReactivation(specialist.client, {
      coreNodeId: nodeId,
    });
    expect(evaluation.proposed).toBe(false);
    expect(evaluation.calculation.excluded.aiOnlySignals).toBe(1);
    expect(evaluation.calculation.excluded.staleSignals).toBe(1);
    expect(evaluation.calculation.excluded.staleTriggerActivations).toBe(1);
    expect(proposal).toBeNull();
  });

  it("lifecycle guard: only weakened nodes can be evaluated", async () => {
    const nodeId = await insertWeakenedNode(25, "active");
    await linkFreshSignal(nodeId);
    await linkTriggerActivation(nodeId, 40);

    await expect(
      evaluateCoreNodeReactivation(specialist.client, { coreNodeId: nodeId })
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("RLS: another organization cannot see or review proposals", async () => {
    const nodeId = await insertWeakenedNode(25);
    await linkFreshSignal(nodeId);
    await linkTriggerActivation(nodeId, 25);
    const { proposal } = await evaluateCoreNodeReactivation(specialist.client, {
      coreNodeId: nodeId,
    });

    const outsider = await createUser(`outsider-${crypto.randomUUID()}@example.com`);
    const { data: otherOrgId } = await outsider.client.rpc("create_organization", {
      org_name: `Other Org ${crypto.randomUUID()}`,
    });

    const page = await listCoreNodeReactivations(outsider.client, {
      organizationId: otherOrgId,
    });
    expect(page.items).toHaveLength(0);

    await expect(getCoreNodeReactivation(outsider.client, proposal!.id)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(
      reviewCoreNodeReactivation(outsider.client, {
        reactivationId: proposal!.id,
        decision: "approve",
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
