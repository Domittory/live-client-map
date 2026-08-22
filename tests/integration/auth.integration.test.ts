import { createClient } from "@supabase/supabase-js";
import { afterAll, describe, expect, it } from "vitest";

try {
  process.loadEnvFile(".env.local");
} catch {
  // no .env.local — the suite will skip
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const available = Boolean(url && anonKey && serviceKey);

describe.skipIf(!available)("auth + organization (ticket 11)", () => {
  const admin = createClient(url!, serviceKey!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const createdUserIds: string[] = [];

  async function createUser(email: string): Promise<void> {
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password: "password123",
      email_confirm: true,
    });
    if (error) throw new Error(error.message);
    createdUserIds.push(data.user!.id);
  }

  afterAll(async () => {
    for (const id of createdUserIds) {
      await admin.auth.admin.deleteUser(id);
    }
  });

  function anonClient() {
    return createClient(url!, anonKey!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }

  it("rejects unauthenticated organization creation", async () => {
    const { data, error } = await anonClient().rpc("create_organization", { org_name: "No Auth" });
    expect(error).not.toBeNull();
    expect(data).toBeNull();
  });

  it("unauthenticated user cannot read organizations", async () => {
    const { data } = await anonClient().from("organizations").select("id");
    expect(data).toHaveLength(0);
  });

  it("creates organization and owner membership atomically", async () => {
    const email = `owner-${crypto.randomUUID()}@example.com`;
    await createUser(email);

    const client = anonClient();
    const { data: signIn, error: signInError } = await client.auth.signInWithPassword({
      email,
      password: "password123",
    });
    expect(signInError).toBeNull();

    const { data: orgId, error: orgError } = await client.rpc("create_organization", {
      org_name: "Моя организация",
    });
    expect(orgError).toBeNull();

    const { data: orgs } = await client
      .from("organizations")
      .select("id, owner_user_id")
      .eq("id", orgId);
    expect(orgs).toHaveLength(1);
    expect(orgs![0].owner_user_id).toBe(signIn!.session!.user.id);

    const { data: members } = await client
      .from("organization_members")
      .select("role")
      .eq("organization_id", orgId);
    expect(members).toHaveLength(1);
    expect(members![0].role).toBe("owner");
  });

  it("isolates tenants: one user cannot read another organization", async () => {
    const emailA = `a-${crypto.randomUUID()}@example.com`;
    await createUser(emailA);
    const clientA = anonClient();
    await clientA.auth.signInWithPassword({ email: emailA, password: "password123" });
    const { data: orgAId } = await clientA.rpc("create_organization", { org_name: "Org A" });

    const emailB = `b-${crypto.randomUUID()}@example.com`;
    await createUser(emailB);
    const clientB = anonClient();
    await clientB.auth.signInWithPassword({ email: emailB, password: "password123" });
    const { data: orgBId } = await clientB.rpc("create_organization", { org_name: "Org B" });

    const { data: bSeesA } = await clientB.from("organizations").select("id").eq("id", orgAId);
    expect(bSeesA).toHaveLength(0);

    const { data: aSeesB } = await clientA.from("organizations").select("id").eq("id", orgBId);
    expect(aSeesB).toHaveLength(0);
  });
});
