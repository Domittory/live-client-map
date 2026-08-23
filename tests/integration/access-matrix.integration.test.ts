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

type User = { id: string; client: SupabaseClient };

describe.skipIf(!available)("RLS access matrix (ticket 60)", () => {
  const admin = createClient(url!, serviceKey!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const createdUserIds: string[] = [];
  let orgA: string;
  let orgB: string;
  let clientA1: string;
  let clientB1: string;

  let owner: User;
  let primary: User;
  let secondary: User;
  let supervisor: User;
  let readOnly: User;
  let unassigned: User;
  let crossOrg: User;

  function anonClient() {
    return createClient(url!, anonKey!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }

  async function createUser(email: string): Promise<User> {
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

  async function addMember(userId: string, orgId: string, role: string): Promise<void> {
    await admin
      .from("organization_members")
      .insert({ organization_id: orgId, user_id: userId, role, status: "active" });
  }

  async function assign(userId: string, clientId: string, accessRole: string): Promise<void> {
    await admin
      .from("client_assignments")
      .insert({ client_id: clientId, user_id: userId, access_role: accessRole });
  }

  /** Count of rows `user` can read from `table`, filtered on the given id column. */
  async function visibleRows(
    user: User,
    table: string,
    idColumn: string,
    clientId: string
  ): Promise<number> {
    const { data } = await user.client.from(table).select("id").eq(idColumn, clientId);
    return data?.length ?? 0;
  }

  /** Attempt a write into development_targets; returns the number of rows that actually landed. */
  async function writeTarget(user: User, clientId: string, name: string): Promise<number> {
    const { error } = await user.client.from("development_targets").insert({
      organization_id: orgA,
      client_id: clientId,
      name,
      status: "active",
    });
    if (error) return -1; // RLS raised an error (row rejected)
    const { data } = await admin
      .from("development_targets")
      .select("id")
      .eq("client_id", clientId)
      .eq("name", name);
    return data?.length ?? 0;
  }

  beforeAll(async () => {
    owner = await createUser(`owner-${crypto.randomUUID()}@example.com`);
    const { data: a } = await owner.client.rpc("create_organization", { org_name: "Matrix Org A" });
    orgA = a;
    const { data: cA } = await owner.client.rpc("create_client", {
      p_organization_id: orgA,
      p_display_name: "Matrix Client A",
    });
    clientA1 = cA;

    const ownerB = await createUser(`owner-b-${crypto.randomUUID()}@example.com`);
    const { data: b } = await ownerB.client.rpc("create_organization", {
      org_name: "Matrix Org B",
    });
    orgB = b;
    const { data: cB } = await ownerB.client.rpc("create_client", {
      p_organization_id: orgB,
      p_display_name: "Matrix Client B",
    });
    clientB1 = cB;

    primary = await createUser(`primary-${crypto.randomUUID()}@example.com`);
    await addMember(primary.id, orgA, "specialist");
    await assign(primary.id, clientA1, "primary_specialist");

    secondary = await createUser(`secondary-${crypto.randomUUID()}@example.com`);
    await addMember(secondary.id, orgA, "specialist");
    await assign(secondary.id, clientA1, "secondary_specialist");

    supervisor = await createUser(`supervisor-${crypto.randomUUID()}@example.com`);
    await addMember(supervisor.id, orgA, "supervisor");
    await assign(supervisor.id, clientA1, "supervisor");

    readOnly = await createUser(`readonly-${crypto.randomUUID()}@example.com`);
    await addMember(readOnly.id, orgA, "specialist");
    await assign(readOnly.id, clientA1, "read_only");

    unassigned = await createUser(`unassigned-${crypto.randomUUID()}@example.com`);
    await addMember(unassigned.id, orgA, "specialist");

    crossOrg = await createUser(`crossorg-${crypto.randomUUID()}@example.com`);
    await addMember(crossOrg.id, orgB, "specialist");
    await assign(crossOrg.id, clientB1, "primary_specialist");
  });

  afterAll(async () => {
    for (const id of createdUserIds) {
      await admin.auth.admin.deleteUser(id);
    }
  });

  describe("read access", () => {
    it("owner, primary, secondary, supervisor, read_only all read their assigned client", async () => {
      for (const u of [owner, primary, secondary, supervisor, readOnly]) {
        expect(await visibleRows(u, "clients", "id", clientA1)).toBe(1);
      }
    });

    it("unassigned member cannot read any client", async () => {
      expect(await visibleRows(unassigned, "clients", "id", clientA1)).toBe(0);
    });

    it("cross-organization member cannot read another organization's client", async () => {
      expect(await visibleRows(crossOrg, "clients", "id", clientA1)).toBe(0);
      expect(await visibleRows(primary, "clients", "id", clientB1)).toBe(0);
    });
  });

  describe("write access", () => {
    it("primary specialist can create a development target", async () => {
      const landed = await writeTarget(primary, clientA1, `primary-${crypto.randomUUID()}`);
      expect(landed).toBe(1);
    });

    it("secondary specialist can create a development target", async () => {
      const landed = await writeTarget(secondary, clientA1, `secondary-${crypto.randomUUID()}`);
      expect(landed).toBe(1);
    });

    it("supervisor is read-only and cannot write", async () => {
      const landed = await writeTarget(supervisor, clientA1, `sup-${crypto.randomUUID()}`);
      expect(landed).toBeLessThan(1);
    });

    it("read_only assignment cannot write", async () => {
      const landed = await writeTarget(readOnly, clientA1, `ro-${crypto.randomUUID()}`);
      expect(landed).toBeLessThan(1);
    });

    it("unassigned member cannot write", async () => {
      const landed = await writeTarget(unassigned, clientA1, `un-${crypto.randomUUID()}`);
      expect(landed).toBeLessThan(1);
    });
  });

  describe("portal + anonymous isolation", () => {
    it("portal user cannot read base tables directly", async () => {
      const email = `portal-${crypto.randomUUID()}@example.com`;
      const { data: pu } = await admin.auth.admin.createUser({
        email,
        password: "password123",
        email_confirm: true,
      });
      createdUserIds.push(pu.user!.id);
      await admin.from("client_portal_users").insert({ client_id: clientA1, email });

      const portal = anonClient();
      await portal.auth.signInWithPassword({ email, password: "password123" });

      expect(
        await visibleRows({ id: pu.user!.id, client: portal }, "clients", "id", clientA1)
      ).toBe(0);
      expect(
        await visibleRows({ id: pu.user!.id, client: portal }, "signals", "client_id", clientA1)
      ).toBe(0);
    });

    it("anonymous user cannot read base tables", async () => {
      const { data } = await anonClient().from("clients").select("id").eq("id", clientA1);
      expect(data ?? []).toHaveLength(0);
    });

    it("anonymous user cannot call has_consent (revoked execute)", async () => {
      const { error } = await anonClient().rpc("has_consent", {
        p_client_id: clientA1,
        p_consent_type: "ai_analysis",
      });
      expect(error).not.toBeNull();
    });
  });
});
