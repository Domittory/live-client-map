import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { changeRequestStatus } from "@/lib/service/requests";

try {
  process.loadEnvFile(".env.local");
} catch {
  // no .env.local — the suite will skip
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const available = Boolean(url && anonKey && serviceKey);

describe.skipIf(!available)("client requests + goals (ticket 18)", () => {
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
    const { data } = await owner.client.rpc("create_organization", { org_name: "Requests Org" });
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
      p_display_name: "Requests Client",
    });
    clientId = cid;
  });

  afterAll(async () => {
    for (const id of createdUserIds) {
      await admin.auth.admin.deleteUser(id);
    }
  });

  it("creates multiple requests and goals with independent history", async () => {
    await specialist.client.from("client_requests").insert({
      organization_id: orgId,
      client_id: clientId,
      title: "Запрос 1",
      success_criteria: "критерий 1",
    });
    await specialist.client
      .from("client_requests")
      .insert({ organization_id: orgId, client_id: clientId, title: "Запрос 2" });
    await specialist.client
      .from("client_goals")
      .insert({ organization_id: orgId, client_id: clientId, title: "Цель 1" });

    const { data: requests } = await specialist.client
      .from("client_requests")
      .select("id, title, success_criteria")
      .eq("client_id", clientId);
    const { data: goals } = await specialist.client
      .from("client_goals")
      .select("id")
      .eq("client_id", clientId);

    expect(requests).toHaveLength(2);
    expect(goals).toHaveLength(1);
    expect(requests!.find((r) => r.title === "Запрос 1")?.success_criteria).toBe("критерий 1");
  });

  it("enforces status transitions", async () => {
    const { data: req } = await specialist.client
      .from("client_requests")
      .insert({ organization_id: orgId, client_id: clientId, title: "Переход" })
      .select("id")
      .single();

    await changeRequestStatus(specialist.client, orgId, req!.id, "completed");
    await expect(
      changeRequestStatus(specialist.client, orgId, req!.id, "paused")
    ).rejects.toThrow();
  });

  it("denies access to users without assignment", async () => {
    const other = await createUser(`other-${crypto.randomUUID()}@example.com`);
    await admin
      .from("organization_members")
      .insert({ organization_id: orgId, user_id: other.id, role: "specialist", status: "active" });

    const { data } = await other.client
      .from("client_requests")
      .select("id")
      .eq("client_id", clientId);
    expect(data).toHaveLength(0);
  });
});
