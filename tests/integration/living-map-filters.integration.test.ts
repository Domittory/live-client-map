import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getLivingMap } from "@/lib/service/living-map";

try {
  process.loadEnvFile(".env.local");
} catch {
  // no .env.local — the suite will skip
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const available = Boolean(url && anonKey && serviceKey);

describe.skipIf(!available)("Living Map filters + timeline (ticket 47)", () => {
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
    const { data } = await owner.client.rpc("create_organization", { org_name: "Map Filters Org" });
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
      p_display_name: "Map Filters Client",
    });
    clientId = cid;
  });

  afterAll(async () => {
    for (const id of createdUserIds) {
      await admin.auth.admin.deleteUser(id);
    }
  });

  it("hideAiOnly removes unconfirmed hypotheses and their links", async () => {
    const { data: active } = await specialist.client
      .from("core_nodes")
      .insert({ organization_id: orgId, client_id: clientId, title: "Активный", status: "active" })
      .select("id")
      .single();
    const { data: pending } = await specialist.client
      .from("core_nodes")
      .insert({ organization_id: orgId, client_id: clientId, title: "AI", status: "under_review" })
      .select("id")
      .single();

    await specialist.client.from("core_node_relations").insert({
      organization_id: orgId,
      client_id: clientId,
      from_core_node_id: active!.id,
      to_core_node_id: pending!.id,
      relation_type: "associated_with",
    });

    const map = await getLivingMap(specialist.client, {
      organizationId: orgId,
      clientId,
      hideAiOnly: true,
    });

    const ids = map.nodes.map((n) => n.id);
    expect(ids).toContain(active!.id);
    expect(ids).not.toContain(pending!.id);
    expect(map.edges).toEqual([]);
  });

  it("filters by life area (triggers)", async () => {
    const { data: work } = await specialist.client
      .from("triggers")
      .insert({
        organization_id: orgId,
        client_id: clientId,
        title: "Рабочий триггер",
        life_areas: ["work"],
      })
      .select("id")
      .single();
    const { data: family } = await specialist.client
      .from("triggers")
      .insert({
        organization_id: orgId,
        client_id: clientId,
        title: "Семейный триггер",
        life_areas: ["family"],
      })
      .select("id")
      .single();

    const map = await getLivingMap(specialist.client, {
      organizationId: orgId,
      clientId,
      lifeArea: "work",
    });

    const triggerIds = map.nodes.filter((n) => n.type === "trigger").map((n) => n.id);
    expect(triggerIds).toContain(work!.id);
    expect(triggerIds).not.toContain(family!.id);
  });

  it("filters core nodes by minimum evidence strength", async () => {
    const { data: strong } = await specialist.client
      .from("core_nodes")
      .insert({
        organization_id: orgId,
        client_id: clientId,
        title: "Сильный узел",
        status: "active",
        evidence_count: 5,
      })
      .select("id")
      .single();
    const { data: weak } = await specialist.client
      .from("core_nodes")
      .insert({
        organization_id: orgId,
        client_id: clientId,
        title: "Слабый узел",
        status: "active",
        evidence_count: 1,
      })
      .select("id")
      .single();

    const map = await getLivingMap(specialist.client, {
      organizationId: orgId,
      clientId,
      minEvidenceStrength: 3,
    });

    const coreIds = map.nodes.filter((n) => n.type === "core_node").map((n) => n.id);
    expect(coreIds).toContain(strong!.id);
    expect(coreIds).not.toContain(weak!.id);
  });

  it("builds a historical map only from a selected snapshot", async () => {
    const nodeId = crypto.randomUUID();
    await admin.from("psychological_snapshots").insert({
      organization_id: orgId,
      client_id: clientId,
      version: 1,
      reason: "test",
      summary: "test",
      active_core_nodes: [{ id: nodeId, title: "Исторический узел", status: "active" }],
      active_themes: [],
      resource_state: [],
      development_targets: [],
      weakened_nodes: [],
      reactivated_nodes: [],
      recent_triggers: [],
      recent_corrections: [],
      current_requests: [],
      recommendations: [],
      model_hash: "hash",
      scoring_model_version: "1.0.0",
      ontology_version: "1.0.0",
      ai_model: "stub",
      prompt_version: "prompt.v1",
    });

    const historical = await getLivingMap(specialist.client, {
      organizationId: orgId,
      clientId,
      snapshotVersion: 1,
    });
    expect(historical.historical).toBe(true);
    expect(historical.snapshotVersion).toBe(1);
    expect(historical.edges).toEqual([]);
    expect(historical.nodes.map((n) => n.id)).toContain(nodeId);

    const current = await getLivingMap(specialist.client, { organizationId: orgId, clientId });
    expect(current.historical).toBe(false);
    expect(current.snapshotVersion).toBeNull();
    expect(current.nodes.map((n) => n.id)).not.toContain(nodeId);
  });
});
