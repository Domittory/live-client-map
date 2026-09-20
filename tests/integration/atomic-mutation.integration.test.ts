import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { Client as PgClient } from "pg";
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

/** Local Supabase default; overridden by SUPABASE_DB_URL when set. */
const dbUrl =
  process.env.SUPABASE_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

/**
 * Ticket 01: the exemplary atomic business mutation (create_client) must commit
 * the client, its assignment and the AuditLog row together, and must roll all of
 * them back when any intermediate write fails.
 *
 * Faults are injected through the local-only `test_support` schema created by
 * supabase/seed.sql (never present in a deployed database, never exposed through
 * PostgREST). When that support is missing the fault cases are skipped.
 */
describe.skipIf(!available)("atomic business mutation pattern (ticket 01)", () => {
  const admin = createClient(url!, serviceKey!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const createdUserIds: string[] = [];
  let pg: PgClient | null = null;
  let faultsAvailable = false;
  let orgId: string;
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

  /** Register a fault for `point`; only rows containing `marker` are affected. */
  async function registerFault(point: string, marker: string): Promise<void> {
    await pg!.query("insert into test_support.faults (point, marker) values ($1, $2)", [
      point,
      marker,
    ]);
  }

  async function clearFaults(): Promise<void> {
    await pg?.query("delete from test_support.faults");
  }

  async function clientsNamed(displayName: string): Promise<string[]> {
    const { data } = await admin.from("clients").select("id").eq("display_name", displayName);
    return (data ?? []).map((row) => row.id);
  }

  async function auditRowsFor(displayName: string): Promise<string[]> {
    const { data } = await admin
      .from("audit_log")
      .select("id")
      .eq("after_data->>display_name", displayName);
    return (data ?? []).map((row) => row.id);
  }

  async function assignmentsFor(clientId: string): Promise<string[]> {
    const { data } = await admin
      .from("client_assignments")
      .select("access_role")
      .eq("client_id", clientId);
    return (data ?? []).map((row) => row.access_role);
  }

  beforeAll(async () => {
    try {
      pg = new PgClient({ connectionString: dbUrl });
      await pg.connect();
      await pg.query("select 1 from test_support.faults limit 1");
      faultsAvailable = true;
    } catch {
      faultsAvailable = false;
      await pg?.end().catch(() => undefined);
      pg = null;
    }

    const owner = await createUser(`atomic-owner-${crypto.randomUUID()}@example.com`);
    const { data: org } = await owner.client.rpc("create_organization", {
      org_name: "Atomic Mutations Org",
    });
    orgId = org as string;

    specialist = await createUser(`atomic-spec-${crypto.randomUUID()}@example.com`);
    await admin.from("organization_members").insert({
      organization_id: orgId,
      user_id: specialist.id,
      role: "specialist",
      status: "active",
    });
  });

  afterAll(async () => {
    await clearFaults();
    await pg?.end().catch(() => undefined);
    for (const id of createdUserIds) {
      await admin.auth.admin.deleteUser(id);
    }
  });

  it("commits client, assignment and audit row together through the service boundary", async () => {
    const displayName = `atomic-ok-${crypto.randomUUID()}`;

    const clientId = await createClientService(specialist.client, {
      organizationId: orgId,
      displayName,
    });

    expect(typeof clientId).toBe("string");
    expect(await clientsNamed(displayName)).toEqual([clientId]);
    expect(await assignmentsFor(clientId)).toEqual(["primary_specialist"]);
    expect(await auditRowsFor(displayName)).toHaveLength(1);

    const { data: audit } = await admin
      .from("audit_log")
      .select("action, entity_type, entity_id, actor_user_id")
      .eq("entity_id", clientId)
      .eq("action", "client.created");
    expect(audit).toHaveLength(1);
    expect(audit![0].entity_type).toBe("client");
    expect(audit![0].actor_user_id).toBe(specialist.id);
  });

  it("rolls back the client when the child-row insert fails", async (ctx) => {
    if (!faultsAvailable) return ctx.skip();
    const displayName = `atomic-child-${crypto.randomUUID()}`;

    // The marker is the specialist id, so only this test's assignment insert is
    // affected even while other integration files run in parallel.
    await registerFault("client_assignments", specialist.id);
    try {
      await expect(
        createClientService(specialist.client, { organizationId: orgId, displayName })
      ).rejects.toThrow();
    } finally {
      await clearFaults();
    }

    expect(await clientsNamed(displayName)).toHaveLength(0);
    expect(await auditRowsFor(displayName)).toHaveLength(0);
  });

  it("rolls back client and assignment when the audit append fails", async (ctx) => {
    if (!faultsAvailable) return ctx.skip();
    const displayName = `atomic-audit-${crypto.randomUUID()}`;

    await registerFault("audit_log", specialist.id);
    try {
      await expect(
        createClientService(specialist.client, { organizationId: orgId, displayName })
      ).rejects.toThrow();
    } finally {
      await clearFaults();
    }

    expect(await clientsNamed(displayName)).toHaveLength(0);
    expect(await auditRowsFor(displayName)).toHaveLength(0);
  });

  it("leaves the mutation working again once the fault is cleared", async (ctx) => {
    if (!faultsAvailable) return ctx.skip();
    const displayName = `atomic-after-${crypto.randomUUID()}`;

    await registerFault("audit_log", specialist.id);
    await clearFaults();

    const clientId = await createClientService(specialist.client, {
      organizationId: orgId,
      displayName,
    });
    expect(await clientsNamed(displayName)).toEqual([clientId]);
    expect(await auditRowsFor(displayName)).toHaveLength(1);
  });

  it("keeps the atomic RPC unavailable to anonymous callers", async () => {
    const anon = anonClient();
    const { error } = await anon.rpc("create_client", {
      p_organization_id: orgId,
      p_display_name: `atomic-anon-${crypto.randomUUID()}`,
    });
    expect(error).not.toBeNull();
  });
});
