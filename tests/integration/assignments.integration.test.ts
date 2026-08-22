import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

try {
  process.loadEnvFile(".env.local");
} catch {
  // no .env.local — the suite will skip
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const available = Boolean(url && anonKey && serviceKey);

describe.skipIf(!available)("client assignments + access (ticket 12)", () => {
  const admin = createClient(url!, serviceKey!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const createdUserIds: string[] = [];
  let orgId: string;
  let clientId: string;

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

  async function addMember(userId: string, role: string): Promise<void> {
    await admin
      .from("organization_members")
      .insert({ organization_id: orgId, user_id: userId, role, status: "active" });
  }

  async function assign(userId: string, accessRole: string): Promise<void> {
    await admin
      .from("client_assignments")
      .insert({ client_id: clientId, user_id: userId, access_role: accessRole });
  }

  async function accessible(client: SupabaseClient, requireWrite: boolean): Promise<boolean> {
    const { data, error } = await client.rpc("is_client_accessible", {
      p_org_id: orgId,
      p_client_id: clientId,
      p_require_write: requireWrite,
    });
    if (error) throw new Error(error.message);
    return data as boolean;
  }

  beforeAll(async () => {
    const owner = await createUser(`owner-${crypto.randomUUID()}@example.com`);
    const { data } = await owner.client.rpc("create_organization", { org_name: "Access Org" });
    orgId = data;
    const { data: cid } = await owner.client.rpc("create_client", {
      p_organization_id: orgId,
      p_display_name: "Access Test Client",
    });
    clientId = cid;
  });

  afterAll(async () => {
    for (const id of createdUserIds) {
      await admin.auth.admin.deleteUser(id);
    }
  });

  it("owner accesses without an assignment (owner exception)", async () => {
    const owner2 = await createUser(`owner2-${crypto.randomUUID()}@example.com`);
    const { data: org2 } = await owner2.client.rpc("create_organization", {
      org_name: "Owner2 Org",
    });
    const { data } = await owner2.client.rpc("is_client_accessible", {
      p_org_id: org2,
      p_client_id: clientId,
      p_require_write: true,
    });
    expect(data).toBe(true);
  });

  it("read_only role can read but not write", async () => {
    const u = await createUser(`ro-${crypto.randomUUID()}@example.com`);
    await addMember(u.id, "specialist");
    await assign(u.id, "read_only");
    expect(await accessible(u.client, false)).toBe(true);
    expect(await accessible(u.client, true)).toBe(false);
  });

  it("supervisor role can read but not write", async () => {
    const u = await createUser(`sup-${crypto.randomUUID()}@example.com`);
    await addMember(u.id, "supervisor");
    await assign(u.id, "supervisor");
    expect(await accessible(u.client, false)).toBe(true);
    expect(await accessible(u.client, true)).toBe(false);
  });

  it("secondary_specialist can read and write", async () => {
    const u = await createUser(`sec-${crypto.randomUUID()}@example.com`);
    await addMember(u.id, "specialist");
    await assign(u.id, "secondary_specialist");
    expect(await accessible(u.client, false)).toBe(true);
    expect(await accessible(u.client, true)).toBe(true);
  });

  it("member without assignment cannot access", async () => {
    const u = await createUser(`none-${crypto.randomUUID()}@example.com`);
    await addMember(u.id, "specialist");
    expect(await accessible(u.client, false)).toBe(false);
  });

  it("revoked assignment stops access", async () => {
    const u = await createUser(`rev-${crypto.randomUUID()}@example.com`);
    await addMember(u.id, "specialist");
    await assign(u.id, "primary_specialist");
    expect(await accessible(u.client, true)).toBe(true);

    await admin
      .from("client_assignments")
      .update({ revoked_at: new Date().toISOString() })
      .eq("user_id", u.id)
      .eq("client_id", clientId);

    expect(await accessible(u.client, false)).toBe(false);
  });

  it("a non-owner member cannot grant assignments", async () => {
    const member = await createUser(`grant-${crypto.randomUUID()}@example.com`);
    await addMember(member.id, "specialist");
    const target = await createUser(`target-${crypto.randomUUID()}@example.com`);

    const { error } = await member.client.rpc("grant_client_assignment", {
      p_org_id: orgId,
      p_client_id: clientId,
      p_user_id: target.id,
      p_access_role: "read_only",
    });
    expect(error).not.toBeNull();
  });
});
