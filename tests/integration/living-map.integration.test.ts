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

describe.skipIf(!available)("Living Map (ticket 46)", () => {
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
    const { data } = await owner.client.rpc("create_organization", { org_name: "Living Map Org" });
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
      p_display_name: "Living Map Client",
    });
    clientId = cid;
  });

  afterAll(async () => {
    for (const id of createdUserIds) {
      await admin.auth.admin.deleteUser(id);
    }
  });

  it("returns an empty map for a client with no model data", async () => {
    const map = await getLivingMap(specialist.client, { organizationId: orgId, clientId });
    expect(map.nodes).toEqual([]);
    expect(map.edges).toEqual([]);
  });

  it("maps nodes and edges from saved relations and links", async () => {
    const { data: node } = await specialist.client
      .from("core_nodes")
      .insert({
        organization_id: orgId,
        client_id: clientId,
        title: "Страх авторитета",
        status: "active",
      })
      .select("id")
      .single();
    const { data: theme } = await specialist.client
      .from("themes")
      .insert({ organization_id: orgId, client_id: clientId, name: "Тема власти" })
      .select("id")
      .single();
    const { data: correction } = await specialist.client
      .from("corrections")
      .insert({ organization_id: orgId, client_id: clientId, title: "Коррекция" })
      .select("id")
      .single();

    await specialist.client.from("theme_core_node_links").insert({
      theme_id: theme!.id,
      core_node_id: node!.id,
      relationship_type: "supports",
    });
    await specialist.client.from("correction_targets").insert({
      correction_id: correction!.id,
      target_type: "core_node",
      target_id: node!.id,
      role: "primary",
    });

    const map = await getLivingMap(specialist.client, { organizationId: orgId, clientId });

    const nodeIds = map.nodes.map((n) => n.id);
    expect(nodeIds).toContain(node!.id);
    expect(nodeIds).toContain(theme!.id);
    expect(nodeIds).toContain(correction!.id);

    const edgeTypes = map.edges.map((e) => e.type);
    expect(edgeTypes).toContain("supports");
    expect(edgeTypes).toContain("primary");
  });

  it("flags AI-only pending nodes", async () => {
    const { data: pending } = await specialist.client
      .from("core_nodes")
      .insert({
        organization_id: orgId,
        client_id: clientId,
        title: "AI-гипотеза",
        status: "under_review",
      })
      .select("id")
      .single();

    const map = await getLivingMap(specialist.client, { organizationId: orgId, clientId });
    const pendingNode = map.nodes.find((n) => n.id === pending!.id);
    expect(pendingNode?.isAiOnly).toBe(true);
  });
});
