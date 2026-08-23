import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getClientOverview } from "@/lib/service/overview";

try {
  process.loadEnvFile(".env.local");
} catch {
  // no .env.local — the suite will skip
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const available = Boolean(url && anonKey && serviceKey);

describe.skipIf(!available)("Client Overview (ticket 45)", () => {
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
    const { data } = await owner.client.rpc("create_organization", { org_name: "Overview Org" });
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
      p_display_name: "Overview Client",
    });
    clientId = cid;
  });

  afterAll(async () => {
    for (const id of createdUserIds) {
      await admin.auth.admin.deleteUser(id);
    }
  });

  it("returns empty blocks for a client with no model data", async () => {
    const overview = await getClientOverview(specialist.client, {
      organizationId: orgId,
      clientId,
    });
    expect(overview.activeRequest).toBeNull();
    expect(overview.topCoreNodes).toEqual([]);
    expect(overview.topResources).toEqual([]);
    expect(overview.pendingReviewCount).toBe(0);
  });

  it("aggregates active request, ranked core nodes and pending review count", async () => {
    await specialist.client.from("client_requests").insert({
      organization_id: orgId,
      client_id: clientId,
      title: "Запрос на рост",
    });
    await specialist.client.from("core_nodes").insert({
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
    });
    await specialist.client.from("signals").insert({
      organization_id: orgId,
      client_id: clientId,
      source_type: "client_report",
      epistemic_type: "self_report",
      raw_statement: "утверждение",
      review_status: "pending",
    });

    const overview = await getClientOverview(specialist.client, {
      organizationId: orgId,
      clientId,
    });

    expect(overview.activeRequest?.title).toBe("Запрос на рост");
    expect(overview.topCoreNodes).toHaveLength(1);
    expect(overview.topCoreNodes[0].final_priority_score).toBe(79.2);
    expect(overview.pendingReviewCount).toBe(1);
  });
});
