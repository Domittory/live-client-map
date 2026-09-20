import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  findActiveMemberByEmail,
  getClientAccessContext,
  grantClientAssignment,
  listClientAssignments,
  revokeClientAssignment,
} from "@/lib/service/client-access";
import {
  CONSENT_TYPES,
  grantClientConsent,
  listClientConsents,
  revokeClientConsent,
} from "@/lib/service/consent";

try {
  process.loadEnvFile(".env.local");
} catch {
  // no .env.local — the suite will skip
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const available = Boolean(url && anonKey && serviceKey);

type User = { id: string; email: string; client: SupabaseClient };

/**
 * Ticket 09 service layer: client access context, assignment roster and
 * client-scoped consent, all exercised against the real local Supabase so the
 * database (RLS + guarded RPCs) remains the authorization authority.
 */
describe.skipIf(!available)("client workspace access service (ticket 09)", () => {
  const admin = createClient(url!, serviceKey!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const createdUserIds: string[] = [];
  let orgId: string;
  let clientId: string;
  let owner: User;
  let specialist: User;
  let supervisor: User;
  let unassigned: User;
  let foreignOwner: User;
  let foreignOrgId: string;

  function anonClient() {
    return createClient(url!, anonKey!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }

  async function createUser(prefix: string): Promise<User> {
    const email = `${prefix}-${crypto.randomUUID()}@example.com`;
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password: "password123",
      email_confirm: true,
    });
    if (error) throw new Error(error.message);
    createdUserIds.push(data.user!.id);

    const client = anonClient();
    const { error: signInError } = await client.auth.signInWithPassword({
      email,
      password: "password123",
    });
    if (signInError) throw new Error(signInError.message);
    return { id: data.user!.id, email, client };
  }

  async function addMember(userId: string, role: "specialist" | "supervisor"): Promise<void> {
    const { error } = await admin
      .from("organization_members")
      .insert({ organization_id: orgId, user_id: userId, role, status: "active" });
    if (error) throw new Error(error.message);
  }

  beforeAll(async () => {
    owner = await createUser("owner");
    const { data: createdOrg, error: orgError } = await owner.client.rpc("create_organization", {
      org_name: `Workspace ${crypto.randomUUID().slice(0, 8)}`,
    });
    if (orgError) throw new Error(orgError.message);
    orgId = createdOrg as string;

    const { data: createdClient, error: clientError } = await owner.client.rpc("create_client", {
      p_organization_id: orgId,
      p_display_name: "Workspace Client",
    });
    if (clientError) throw new Error(clientError.message);
    clientId = createdClient as string;

    specialist = await createUser("specialist");
    supervisor = await createUser("supervisor");
    unassigned = await createUser("unassigned");
    foreignOwner = await createUser("foreign");

    await addMember(specialist.id, "specialist");
    await addMember(supervisor.id, "supervisor");
    await addMember(unassigned.id, "specialist");

    await grantClientAssignment(owner.client, {
      organizationId: orgId,
      clientId,
      email: specialist.email,
      accessRole: "primary_specialist",
    });
    await grantClientAssignment(owner.client, {
      organizationId: orgId,
      clientId,
      email: supervisor.email,
      accessRole: "supervisor",
    });

    const { data: foreignOrg, error: foreignOrgError } = await foreignOwner.client.rpc(
      "create_organization",
      { org_name: `Foreign ${crypto.randomUUID().slice(0, 8)}` }
    );
    if (foreignOrgError) throw new Error(foreignOrgError.message);
    foreignOrgId = foreignOrg as string;
  });

  afterAll(async () => {
    await admin.from("organizations").delete().in("id", [orgId, foreignOrgId]);
    for (const id of createdUserIds) {
      await admin.auth.admin.deleteUser(id);
    }
  });

  it("owner has read, write and owner rights without an assignment", async () => {
    const context = await getClientAccessContext(owner.client, orgId, clientId);
    expect(context).toMatchObject({ canRead: true, canWrite: true, isOwner: true });
  });

  it("primary specialist can read and write but is not the owner", async () => {
    const context = await getClientAccessContext(specialist.client, orgId, clientId);
    expect(context).toMatchObject({ canRead: true, canWrite: true, isOwner: false });
  });

  it("supervisor can read but never write", async () => {
    const context = await getClientAccessContext(supervisor.client, orgId, clientId);
    expect(context).toMatchObject({ canRead: true, canWrite: false, isOwner: false });
  });

  it("an organization member without an assignment has no access", async () => {
    const context = await getClientAccessContext(unassigned.client, orgId, clientId);
    expect(context).toMatchObject({ canRead: false, canWrite: false, isOwner: false });
  });

  it("lists the active roster for the owner and refuses other roles", async () => {
    const roster = await listClientAssignments(owner.client, { organizationId: orgId, clientId });
    const byEmail = new Map(roster.map((row) => [row.email, row.accessRole]));

    expect(byEmail.get(specialist.email)).toBe("primary_specialist");
    expect(byEmail.get(supervisor.email)).toBe("supervisor");

    await expect(
      listClientAssignments(specialist.client, { organizationId: orgId, clientId })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("an owner of another organization cannot read this client roster", async () => {
    await expect(
      listClientAssignments(foreignOwner.client, {
        organizationId: foreignOrgId,
        clientId,
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("resolves an active member by email inside the organization only", async () => {
    const found = await findActiveMemberByEmail(owner.client, {
      organizationId: orgId,
      email: specialist.email.toUpperCase(),
    });
    expect(found?.userId).toBe(specialist.id);

    const missing = await findActiveMemberByEmail(owner.client, {
      organizationId: orgId,
      email: `nobody-${crypto.randomUUID()}@example.com`,
    });
    expect(missing).toBeNull();
  });

  it("refuses a grant from a non-owner and from an unknown email", async () => {
    await expect(
      grantClientAssignment(specialist.client, {
        organizationId: orgId,
        clientId,
        email: unassigned.email,
        accessRole: "read_only",
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    await expect(
      grantClientAssignment(owner.client, {
        organizationId: orgId,
        clientId,
        email: `nobody-${crypto.randomUUID()}@example.com`,
        accessRole: "read_only",
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("grant gives access and revoke removes it immediately", async () => {
    await grantClientAssignment(owner.client, {
      organizationId: orgId,
      clientId,
      email: unassigned.email,
      accessRole: "read_only",
    });

    expect(await getClientAccessContext(unassigned.client, orgId, clientId)).toMatchObject({
      canRead: true,
      canWrite: false,
    });

    const rosterAfterGrant = await listClientAssignments(owner.client, {
      organizationId: orgId,
      clientId,
    });
    expect(rosterAfterGrant.map((row) => row.userId)).toContain(unassigned.id);

    await revokeClientAssignment(owner.client, {
      organizationId: orgId,
      clientId,
      userId: unassigned.id,
    });

    expect(await getClientAccessContext(unassigned.client, orgId, clientId)).toMatchObject({
      canRead: false,
    });
    const rosterAfterRevoke = await listClientAssignments(owner.client, {
      organizationId: orgId,
      clientId,
    });
    expect(rosterAfterRevoke.map((row) => row.userId)).not.toContain(unassigned.id);
  });

  it("tracks the latest consent state per type and enforces write access", async () => {
    const before = await listClientConsents(owner.client, { organizationId: orgId, clientId });
    expect(before).toHaveLength(CONSENT_TYPES.length);
    expect(before.every((entry) => !entry.isActive)).toBe(true);

    await grantClientConsent(specialist.client, {
      organizationId: orgId,
      clientId,
      consentType: "data_storage",
      scope: "workspace",
      documentVersion: "1.0",
    });

    const granted = await listClientConsents(owner.client, { organizationId: orgId, clientId });
    expect(granted.find((entry) => entry.consentType === "data_storage")).toMatchObject({
      isActive: true,
      documentVersion: "1.0",
    });

    await revokeClientConsent(specialist.client, {
      organizationId: orgId,
      clientId,
      consentType: "data_storage",
    });

    const revoked = await listClientConsents(owner.client, { organizationId: orgId, clientId });
    expect(revoked.find((entry) => entry.consentType === "data_storage")).toMatchObject({
      isActive: false,
    });
  });

  it("a supervisor (read-only access role) cannot change consent", async () => {
    await expect(
      grantClientConsent(supervisor.client, {
        organizationId: orgId,
        clientId,
        consentType: "ai_analysis",
        scope: "",
        documentVersion: "1.0",
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
