import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient as createClientService } from "@/lib/service/clients";

try {
  process.loadEnvFile(".env.local");
} catch {
  // no .env.local — the suite will skip
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const available = Boolean(url && anonKey && serviceKey);

describe.skipIf(!available)("clients (ticket 17)", () => {
  const admin = createClient(url!, serviceKey!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const createdUserIds: string[] = [];
  let orgAId: string;
  let specialistA: { id: string; client: SupabaseClient };

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
    const ownerA = await createUser(`ownerA-${crypto.randomUUID()}@example.com`);
    const { data: orgA } = await ownerA.client.rpc("create_organization", {
      org_name: "Clients Org A",
    });
    orgAId = orgA;

    specialistA = await createUser(`specA-${crypto.randomUUID()}@example.com`);
    await admin.from("organization_members").insert({
      organization_id: orgAId,
      user_id: specialistA.id,
      role: "specialist",
      status: "active",
    });
  });

  afterAll(async () => {
    for (const id of createdUserIds) {
      await admin.auth.admin.deleteUser(id);
    }
  });

  it("specialist creates a client and becomes primary_specialist", async () => {
    const { data: clientId, error } = await specialistA.client.rpc("create_client", {
      p_organization_id: orgAId,
      p_display_name: "Иван",
      p_first_name: "Иван",
      p_last_name: "Петров",
    });
    expect(error).toBeNull();

    const { data: clients } = await specialistA.client
      .from("clients")
      .select("id")
      .eq("id", clientId);
    expect(clients).toHaveLength(1);

    const { data: assignment } = await admin
      .from("client_assignments")
      .select("access_role")
      .eq("client_id", clientId)
      .eq("user_id", specialistA.id)
      .maybeSingle();
    expect(assignment?.access_role).toBe("primary_specialist");
  });

  it("archive removes from active list but keeps the record", async () => {
    const { data: clientId } = await specialistA.client.rpc("create_client", {
      p_organization_id: orgAId,
      p_display_name: "Архивный",
    });

    await specialistA.client
      .from("clients")
      .update({ status: "archived", archived_at: new Date().toISOString() })
      .eq("id", clientId);

    const { data: active } = await specialistA.client
      .from("clients")
      .select("id")
      .eq("id", clientId)
      .eq("status", "active");
    expect(active).toHaveLength(0);

    const { data: archived } = await specialistA.client
      .from("clients")
      .select("id")
      .eq("id", clientId);
    expect(archived).toHaveLength(1);
  });

  it("cross-tenant: another organization's specialist cannot read the client", async () => {
    const ownerB = await createUser(`ownerB-${crypto.randomUUID()}@example.com`);
    const { data: orgB } = await ownerB.client.rpc("create_organization", {
      org_name: "Clients Org B",
    });
    const specB = await createUser(`specB-${crypto.randomUUID()}@example.com`);
    await admin
      .from("organization_members")
      .insert({ organization_id: orgB, user_id: specB.id, role: "specialist", status: "active" });

    const { data: clientId } = await specialistA.client.rpc("create_client", {
      p_organization_id: orgAId,
      p_display_name: "Секретный",
    });

    const { data: seen } = await specB.client.from("clients").select("id").eq("id", clientId);
    expect(seen).toHaveLength(0);
  });

  it("service create leaves an audit record", async () => {
    const clientId = await createClientService(specialistA.client, {
      organizationId: orgAId,
      displayName: "Аудируемый",
    });

    const { data: audit } = await admin
      .from("audit_log")
      .select("action")
      .eq("entity_id", clientId)
      .eq("action", "client.created");
    expect(audit).toHaveLength(1);
  });
});
