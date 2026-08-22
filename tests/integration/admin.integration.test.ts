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

function adminClient(): SupabaseClient {
  return createClient(url!, serviceKey!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function createUser(
  admin: SupabaseClient,
  label: string
): Promise<{ userId: string; email: string; password: string }> {
  const email = `admin-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const password = `test-${Math.random().toString(36).slice(2)}`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  expect(error).toBeNull();
  return { userId: data.user!.id, email, password };
}

async function createOrg(
  admin: SupabaseClient,
  owner: { userId: string },
  label: string
): Promise<string> {
  const { data: org, error } = await admin
    .from("organizations")
    .insert({
      name: `Org ${label}`,
      slug: `org-${label}-${Date.now()}`,
      owner_user_id: owner.userId,
    })
    .select("id")
    .single();
  expect(error).toBeNull();
  const { error: memberError } = await admin.from("organization_members").insert({
    organization_id: org!.id,
    user_id: owner.userId,
    role: "owner",
    status: "active",
  });
  expect(memberError).toBeNull();
  return org!.id;
}

async function signIn(email: string, password: string): Promise<SupabaseClient> {
  const client = createClient(url!, anonKey!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await client.auth.signInWithPassword({ email, password });
  expect(error).toBeNull();
  return client;
}

async function inviteAndAccept(
  admin: SupabaseClient,
  ownerClient: SupabaseClient,
  orgId: string,
  member: { email: string; password: string },
  role: "specialist" | "supervisor"
): Promise<void> {
  const { data: invitationId, error: inviteError } = await ownerClient.rpc("invite_member", {
    p_org_id: orgId,
    p_email: member.email,
    p_role: role,
  });
  expect(inviteError).toBeNull();

  const { data: invitation } = await admin
    .from("organization_invitations")
    .select("token")
    .eq("id", invitationId)
    .single();

  const memberClient = await signIn(member.email, member.password);
  const { error: acceptError } = await memberClient.rpc("accept_invitation", {
    p_token: invitation!.token,
  });
  expect(acceptError).toBeNull();
}

describe.skipIf(!available)("organization admin (requires local Supabase)", () => {
  it("runs the invite → accept flow and writes audit records", async () => {
    const admin = adminClient();
    const owner = await createUser(admin, "inv-owner");
    const member = await createUser(admin, "inv-member");
    const orgId = await createOrg(admin, owner, "inv");
    const ownerClient = await signIn(owner.email, owner.password);

    await inviteAndAccept(admin, ownerClient, orgId, member, "specialist");

    const { data: membership } = await admin
      .from("organization_members")
      .select("role, status")
      .eq("organization_id", orgId)
      .eq("user_id", member.userId)
      .single();
    expect(membership).toEqual({ role: "specialist", status: "active" });

    const { data: audit } = await admin
      .from("audit_log")
      .select("action")
      .eq("organization_id", orgId);
    const actions = (audit ?? []).map((row) => row.action);
    expect(actions).toContain("member.invite");
    expect(actions).toContain("member.accept");
  });

  it("enforces the role matrix: only the owner performs admin mutations", async () => {
    const admin = adminClient();
    const owner = await createUser(admin, "matrix-owner");
    const member = await createUser(admin, "matrix-member");
    const orgId = await createOrg(admin, owner, "matrix");
    const ownerClient = await signIn(owner.email, owner.password);
    await inviteAndAccept(admin, ownerClient, orgId, member, "specialist");
    const memberClient = await signIn(member.email, member.password);

    const { error: inviteError } = await memberClient.rpc("invite_member", {
      p_org_id: orgId,
      p_email: "x@example.com",
      p_role: "specialist",
    });
    expect(inviteError!.code).toBe("42501");

    const { error: roleError } = await memberClient.rpc("update_member_role", {
      p_org_id: orgId,
      p_user_id: member.userId,
      p_role: "supervisor",
    });
    expect(roleError!.code).toBe("42501");

    const { error: statusError } = await memberClient.rpc("set_member_status", {
      p_org_id: orgId,
      p_user_id: member.userId,
      p_status: "suspended",
    });
    expect(statusError!.code).toBe("42501");

    const { error: transferError } = await memberClient.rpc("transfer_ownership", {
      p_org_id: orgId,
      p_new_owner_id: member.userId,
    });
    expect(transferError!.code).toBe("42501");
  });

  it("protects the last owner from demotion and suspension", async () => {
    const admin = adminClient();
    const owner = await createUser(admin, "last-owner");
    const orgId = await createOrg(admin, owner, "last");
    const ownerClient = await signIn(owner.email, owner.password);

    const { error: demoteError } = await ownerClient.rpc("update_member_role", {
      p_org_id: orgId,
      p_user_id: owner.userId,
      p_role: "specialist",
    });
    expect(demoteError!.code).toBe("42501");

    const { error: suspendError } = await ownerClient.rpc("set_member_status", {
      p_org_id: orgId,
      p_user_id: owner.userId,
      p_status: "suspended",
    });
    expect(suspendError!.code).toBe("42501");

    // Defense in depth: even a privileged direct update hits the trigger.
    const { error: directError } = await admin
      .from("organization_members")
      .update({ role: "specialist" })
      .eq("organization_id", orgId)
      .eq("user_id", owner.userId);
    expect(directError).not.toBeNull();
  });

  it("transfers ownership atomically and revokes the old owner's admin rights", async () => {
    const admin = adminClient();
    const owner = await createUser(admin, "tr-owner");
    const successor = await createUser(admin, "tr-successor");
    const orgId = await createOrg(admin, owner, "tr");
    const ownerClient = await signIn(owner.email, owner.password);
    await inviteAndAccept(admin, ownerClient, orgId, successor, "specialist");

    const { error: transferError } = await ownerClient.rpc("transfer_ownership", {
      p_org_id: orgId,
      p_new_owner_id: successor.userId,
    });
    expect(transferError).toBeNull();

    const { data: org } = await admin
      .from("organizations")
      .select("owner_user_id")
      .eq("id", orgId)
      .single();
    expect(org!.owner_user_id).toBe(successor.userId);

    const { data: roles } = await admin
      .from("organization_members")
      .select("user_id, role")
      .eq("organization_id", orgId);
    const roleOf = (userId: string) => roles!.find((row) => row.user_id === userId)!.role;
    expect(roleOf(successor.userId)).toBe("owner");
    expect(roleOf(owner.userId)).toBe("specialist");

    // The old owner lost admin rights immediately.
    const { error: inviteError } = await ownerClient.rpc("invite_member", {
      p_org_id: orgId,
      p_email: "nobody@example.com",
      p_role: "specialist",
    });
    expect(inviteError!.code).toBe("42501");

    const { data: audit } = await admin
      .from("audit_log")
      .select("action, before_data, after_data")
      .eq("organization_id", orgId)
      .eq("action", "organization.ownership_transfer")
      .single();
    expect(audit!.before_data).toEqual({ owner_user_id: owner.userId });
    expect(audit!.after_data).toEqual({ owner_user_id: successor.userId });
  });

  it("rejects duplicate membership and enforces the retention policy constraint", async () => {
    const admin = adminClient();
    const owner = await createUser(admin, "dup-owner");
    const member = await createUser(admin, "dup-member");
    const orgId = await createOrg(admin, owner, "dup");
    const ownerClient = await signIn(owner.email, owner.password);
    await inviteAndAccept(admin, ownerClient, orgId, member, "specialist");

    // Inviting an existing member conflicts.
    const { error: inviteError } = await ownerClient.rpc("invite_member", {
      p_org_id: orgId,
      p_email: member.email,
      p_role: "supervisor",
    });
    expect(inviteError!.code).toBe("23505");

    // Retention beyond the ticket 05 policy violates the DB constraint.
    const { error: retentionError } = await ownerClient
      .from("organizations")
      .update({ settings: { retention: { client_data_years: 10, export_days: 30 } } })
      .eq("id", orgId);
    expect(retentionError!.code).toBe("23514");

    const { error: okError } = await ownerClient
      .from("organizations")
      .update({ settings: { retention: { client_data_years: 5, export_days: 30 } } })
      .eq("id", orgId);
    expect(okError).toBeNull();
  });
});
