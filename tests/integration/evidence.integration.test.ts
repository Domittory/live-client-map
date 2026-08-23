import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getEvidence } from "@/lib/service/evidence";

try {
  process.loadEnvFile(".env.local");
} catch {
  // no .env.local — the suite will skip
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const available = Boolean(url && anonKey && serviceKey);

describe.skipIf(!available)("Evidence Drawer (ticket 48)", () => {
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

  beforeAll(async () => {
    const owner = await createUser(`owner-${crypto.randomUUID()}@example.com`);
    const { data } = await owner.client.rpc("create_organization", { org_name: "Evidence Org" });
    orgId = data;

    specialist = await createUser(`spec-${crypto.randomUUID()}@example.com`);
    await admin.from("organization_members").insert({
      organization_id: orgId,
      user_id: specialist.id,
      role: "specialist",
      status: "active",
    });

    const { data: cid } = await specialist.client.rpc("create_client", {
      p_organization_id: orgId,
      p_display_name: "Evidence Client",
    });
    clientId = cid;
  });

  afterAll(async () => {
    for (const id of createdUserIds) {
      await admin.auth.admin.deleteUser(id);
    }
  });

  it("traces a core node back to its raw signals and score breakdown", async () => {
    const { data: node } = await specialist.client
      .from("core_nodes")
      .insert({
        organization_id: orgId,
        client_id: clientId,
        title: "Страх авторитета",
        status: "active",
        rootness_score: 92,
        impact_score: 88,
        activation_score: 79,
        confidence_score: 83,
        client_relevance_score: 94,
        readiness_score: 70,
        unlock_score: 86,
        risk_score: 42,
      })
      .select("id")
      .single();
    const { data: theme } = await specialist.client
      .from("themes")
      .insert({ organization_id: orgId, client_id: clientId, name: "Тема" })
      .select("id")
      .single();
    const { data: signal } = await specialist.client
      .from("signals")
      .insert({
        organization_id: orgId,
        client_id: clientId,
        source_type: "client_report",
        epistemic_type: "self_report",
        raw_statement: "боюсь начальника",
        review_status: "approved",
      })
      .select("id")
      .single();

    await specialist.client.from("theme_core_node_links").insert({
      theme_id: theme!.id,
      core_node_id: node!.id,
      relationship_type: "supports",
    });
    await specialist.client.from("signal_theme_links").insert({
      theme_id: theme!.id,
      signal_id: signal!.id,
      relevance_score: 80,
    });

    const evidence = await getEvidence(specialist.client, {
      organizationId: orgId,
      clientId,
      entityType: "core_node",
      entityId: node!.id,
    });

    expect(evidence.rawSignals.map((s) => s.id)).toContain(signal!.id);
    expect(evidence.scoreBreakdown?.finalPriorityScore).toBe(79.2);
    expect(evidence.aiRationale?.isAiProposed).toBe(false);
  });

  it("marks AI-proposed nodes separately from confirmation", async () => {
    const { data: node } = await specialist.client
      .from("core_nodes")
      .insert({
        organization_id: orgId,
        client_id: clientId,
        title: "AI-гипотеза",
        status: "under_review",
      })
      .select("id")
      .single();

    const evidence = await getEvidence(specialist.client, {
      organizationId: orgId,
      clientId,
      entityType: "core_node",
      entityId: node!.id,
    });
    expect(evidence.aiRationale?.isAiProposed).toBe(true);
    expect(evidence.humanConfirmations).toBeNull();
  });

  it("exposes contradictions / evidence-against", async () => {
    const { data: a } = await specialist.client
      .from("core_nodes")
      .insert({ organization_id: orgId, client_id: clientId, title: "A", status: "active" })
      .select("id")
      .single();
    const { data: b } = await specialist.client
      .from("core_nodes")
      .insert({ organization_id: orgId, client_id: clientId, title: "B", status: "active" })
      .select("id")
      .single();
    await specialist.client.from("core_node_relations").insert({
      organization_id: orgId,
      client_id: clientId,
      from_core_node_id: a!.id,
      to_core_node_id: b!.id,
      relation_type: "contradicts",
    });

    const evidence = await getEvidence(specialist.client, {
      organizationId: orgId,
      clientId,
      entityType: "core_node",
      entityId: a!.id,
    });
    expect(evidence.contradictions.length).toBeGreaterThan(0);
  });

  it("returns evidence-against for a differential hypothesis", async () => {
    const { data: hypothesis } = await specialist.client
      .from("differential_hypotheses")
      .insert({
        organization_id: orgId,
        client_id: clientId,
        title: "Гипотеза",
        confidence_score: 60,
        evidence_against: [crypto.randomUUID()],
      })
      .select("id")
      .single();

    const evidence = await getEvidence(specialist.client, {
      organizationId: orgId,
      clientId,
      entityType: "differential_hypothesis",
      entityId: hypothesis!.id,
    });
    expect(evidence.contradictions.length).toBe(1);
    expect(evidence.aiRationale?.isAiProposed).toBe(true);
  });
});
