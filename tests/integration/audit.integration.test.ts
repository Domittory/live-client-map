import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

// Integration tests run against a local Supabase (ticket 01: Supabase CLI + Docker).
// They skip when the environment is not configured, so `pnpm test` stays green
// on a clean checkout without Docker. `.env.local` (created after `supabase start`)
// is loaded when present, so `pnpm test:integration` works without inline env.
try {
  process.loadEnvFile(".env.local");
} catch {
  // no .env.local — the test will skip
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const available = Boolean(url && serviceKey && anonKey);

async function createTenant(
  admin: SupabaseClient,
  label: string,
  role: "owner" | "specialist" = "owner"
): Promise<{ userId: string; orgId: string; email: string; password: string }> {
  const email = `audit-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const password = `test-${Math.random().toString(36).slice(2)}`;

  const { data: userData, error: userError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  expect(userError).toBeNull();
  const userId = userData.user!.id;

  const { data: org, error: orgError } = await admin
    .from("organizations")
    .insert({ name: `Org ${label}`, slug: `org-${label}-${Date.now()}`, owner_user_id: userId })
    .select("id")
    .single();
  expect(orgError).toBeNull();

  const { error: memberError } = await admin.from("organization_members").insert({
    organization_id: org!.id,
    user_id: userId,
    role,
    status: "active",
  });
  expect(memberError).toBeNull();

  return { userId, orgId: org!.id, email, password };
}

async function signIn(email: string, password: string): Promise<SupabaseClient> {
  const client = createClient(url!, anonKey!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await client.auth.signInWithPassword({ email, password });
  expect(error).toBeNull();
  return client;
}

describe.skipIf(!available)("audit log (requires local Supabase)", () => {
  it("appends a successful action with actor, entity, before/after and timestamp", async () => {
    const admin = createClient(url!, serviceKey!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const tenant = await createTenant(admin, "ok");
    const client = await signIn(tenant.email, tenant.password);

    const { data: auditId, error } = await client.rpc("append_audit", {
      p_organization_id: tenant.orgId,
      p_entity_type: "diagnostic_domain",
      p_entity_id: null,
      p_action: "diagnostic_domain.create",
      p_before: null,
      p_after: { name: "Домен" },
      p_reason: "org override",
    });
    expect(error).toBeNull();

    const { data: row } = await admin.from("audit_log").select("*").eq("id", auditId).single();
    expect(row!.actor_user_id).toBe(tenant.userId);
    expect(row!.organization_id).toBe(tenant.orgId);
    expect(row!.entity_type).toBe("diagnostic_domain");
    expect(row!.action).toBe("diagnostic_domain.create");
    expect(row!.after_data).toEqual({ name: "Домен" });
    expect(row!.reason).toBe("org override");
    expect(row!.created_at).toBeTruthy();
  });

  it("rejects writes from non-members and direct table inserts", async () => {
    const admin = createClient(url!, serviceKey!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const tenantA = await createTenant(admin, "ra");
    const tenantB = await createTenant(admin, "rb");
    const clientB = await signIn(tenantB.email, tenantB.password);

    // Rejected: B is not a member of A's organization.
    const { error: rpcError } = await clientB.rpc("append_audit", {
      p_organization_id: tenantA.orgId,
      p_entity_type: "client",
      p_entity_id: null,
      p_action: "client.delete",
    });
    expect(rpcError).not.toBeNull();
    expect(rpcError!.code).toBe("42501");

    // Rejected: direct inserts bypass nothing — insert privilege is not granted.
    const { error: insertError } = await clientB.from("audit_log").insert({
      organization_id: tenantB.orgId,
      actor_user_id: tenantB.userId,
      entity_type: "client",
      action: "forged.entry",
    });
    expect(insertError).not.toBeNull();
  });

  it("is append-only: update and delete are blocked even for service_role", async () => {
    const admin = createClient(url!, serviceKey!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const tenant = await createTenant(admin, "immutable");
    const client = await signIn(tenant.email, tenant.password);

    const { data: auditId } = await client.rpc("append_audit", {
      p_organization_id: tenant.orgId,
      p_entity_type: "client",
      p_entity_id: null,
      p_action: "client.update",
    });

    const { error: updateError } = await admin
      .from("audit_log")
      .update({ action: "tampered" })
      .eq("id", auditId);
    expect(updateError).not.toBeNull();

    const { error: deleteError } = await admin.from("audit_log").delete().eq("id", auditId);
    expect(deleteError).not.toBeNull();

    const { data: row } = await admin.from("audit_log").select("action").eq("id", auditId).single();
    expect(row!.action).toBe("client.update");
  });

  it("lets only the organization owner read the log (privileged viewer)", async () => {
    const admin = createClient(url!, serviceKey!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const owner = await createTenant(admin, "owner");
    const other = await createTenant(admin, "other");
    const ownerClient = await signIn(owner.email, owner.password);
    const otherClient = await signIn(other.email, other.password);

    await ownerClient.rpc("append_audit", {
      p_organization_id: owner.orgId,
      p_entity_type: "belief_template",
      p_entity_id: null,
      p_action: "belief_template.create",
    });

    // Owner sees own org entries.
    const { data: ownRows, error: ownError } = await ownerClient
      .from("audit_log")
      .select("action")
      .eq("organization_id", owner.orgId);
    expect(ownError).toBeNull();
    expect(ownRows!.length).toBeGreaterThan(0);

    // Another org's owner does not.
    const { data: foreignRows } = await otherClient
      .from("audit_log")
      .select("id")
      .eq("organization_id", owner.orgId);
    expect(foreignRows).toEqual([]);

    // A plain (non-owner) member of the same org does not either.
    const { data: memberUser } = await admin.auth.admin.createUser({
      email: `audit-member-${Date.now()}@example.com`,
      password: "test-member-password",
      email_confirm: true,
    });
    await admin.from("organization_members").insert({
      organization_id: owner.orgId,
      user_id: memberUser.user!.id,
      role: "specialist",
      status: "active",
    });
    const memberClient = await signIn(memberUser.user!.email!, "test-member-password");
    const { data: memberRows } = await memberClient
      .from("audit_log")
      .select("id")
      .eq("organization_id", owner.orgId);
    expect(memberRows).toEqual([]);

    // Privileged service_role read (platform support) still works.
    const { data: allRows } = await admin
      .from("audit_log")
      .select("id")
      .eq("organization_id", owner.orgId);
    expect(allRows!.length).toBeGreaterThan(0);
  });
});
