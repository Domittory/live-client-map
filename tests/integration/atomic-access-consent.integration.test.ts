import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { updateOrgSettings } from "@/lib/service/admin";
import { archiveClient, updateClient } from "@/lib/service/clients";
import { connectFaultInjection, type FaultInjection } from "./support/fault-injection";

try {
  process.loadEnvFile(".env.local");
} catch {
  // no .env.local — the suite will skip
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const available = Boolean(url && anonKey && serviceKey);

/**
 * Ticket 04: organization, client, access and consent mutations must commit
 * their business row and their AuditLog entry together, or change nothing.
 *
 * Fault injection comes from supabase/seed.sql (local only) via a direct
 * Postgres connection; when it is unavailable the rollback cases are skipped.
 */
describe.skipIf(!available)("atomic access and consent mutations (ticket 04)", () => {
  const admin = createClient(url!, serviceKey!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const createdUserIds: string[] = [];
  let faults: FaultInjection;
  let orgId: string;
  let clientId: string;
  let owner: { id: string; client: SupabaseClient };
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

  async function addMember(
    userId: string,
    role: "specialist" | "supervisor" = "specialist"
  ): Promise<void> {
    const { error } = await admin.from("organization_members").insert({
      organization_id: orgId,
      user_id: userId,
      role,
      status: "active",
    });
    expect(error).toBeNull();
  }

  async function createClientFor(actor: SupabaseClient, displayName: string): Promise<string> {
    const { data, error } = await actor.rpc("create_client", {
      p_organization_id: orgId,
      p_display_name: displayName,
    });
    expect(error).toBeNull();
    return data as string;
  }

  async function clientRow(id: string) {
    const { data } = await admin
      .from("clients")
      .select("display_name, status, archived_at, occupation")
      .eq("id", id)
      .maybeSingle();
    return data;
  }

  async function auditRows(action: string, entityId?: string) {
    let request = admin
      .from("audit_log")
      .select("id, action, entity_id, after_data")
      .eq("action", action);
    if (entityId) request = request.eq("entity_id", entityId);
    const { data } = await request;
    return data ?? [];
  }

  async function activeAssignments(userId: string, targetClient: string) {
    const { data } = await admin
      .from("client_assignments")
      .select("access_role, revoked_at")
      .eq("client_id", targetClient)
      .eq("user_id", userId)
      .is("revoked_at", null);
    return data ?? [];
  }

  async function withFault(point: string, marker: string, run: () => PromiseLike<unknown>) {
    await faults.register(point, marker);
    try {
      await expect(Promise.resolve(run())).rejects.toThrow();
    } finally {
      await faults.clear();
    }
  }

  beforeAll(async () => {
    faults = await connectFaultInjection();

    owner = await createUser(`access-owner-${crypto.randomUUID()}@example.com`);
    const { data: org } = await owner.client.rpc("create_organization", {
      org_name: "Atomic Access Org",
    });
    orgId = org as string;

    specialist = await createUser(`access-spec-${crypto.randomUUID()}@example.com`);
    await addMember(specialist.id);

    clientId = await createClientFor(owner.client, "Access Client");
    const { error } = await owner.client.rpc("grant_client_assignment", {
      p_org_id: orgId,
      p_client_id: clientId,
      p_user_id: specialist.id,
      p_access_role: "primary_specialist",
    });
    expect(error).toBeNull();
  });

  afterAll(async () => {
    await faults?.clear();
    await faults?.close();
    for (const id of createdUserIds) {
      await admin.auth.admin.deleteUser(id);
    }
  });

  // -------------------------------------------------------------------------
  // Client update / archive
  // -------------------------------------------------------------------------

  it("commits a client update together with its audit row", async () => {
    const displayName = `Обновлённый-${crypto.randomUUID()}`;

    await updateClient(specialist.client, orgId, { id: clientId, displayName });

    expect((await clientRow(clientId))?.display_name).toBe(displayName);
    const audit = await auditRows("client.updated", clientId);
    expect(audit).toHaveLength(1);
    expect((audit[0].after_data as Record<string, unknown>).display_name).toBe(displayName);
  });

  it("rolls back a client update when the audit append fails", async (ctx) => {
    if (!faults.available) return ctx.skip();
    const marker = `Откат-${crypto.randomUUID()}`;
    const before = await clientRow(clientId);

    await withFault("audit_log", marker, () =>
      updateClient(specialist.client, orgId, { id: clientId, displayName: marker })
    );

    expect((await clientRow(clientId))?.display_name).toBe(before?.display_name);
    expect(await auditRows("client.updated", clientId)).toHaveLength(1);
  });

  it("commits a client archive together with its audit row", async () => {
    const archivable = await createClientFor(owner.client, `Архив-${crypto.randomUUID()}`);

    await archiveClient(owner.client, orgId, archivable);

    const row = await clientRow(archivable);
    expect(row?.status).toBe("archived");
    expect(row?.archived_at).not.toBeNull();
    expect(await auditRows("client.archived", archivable)).toHaveLength(1);
  });

  it("rolls back a client archive when the audit append fails", async (ctx) => {
    if (!faults.available) return ctx.skip();
    const archivable = await createClientFor(owner.client, `Архив-откат-${crypto.randomUUID()}`);

    await withFault("audit_log", archivable, () => archiveClient(owner.client, orgId, archivable));

    expect((await clientRow(archivable))?.status).toBe("active");
  });

  it("rejects a field outside the reviewed update whitelist", async () => {
    const { error } = await owner.client.rpc("update_client", {
      p_client_id: clientId,
      p_org_id: orgId,
      p_patch: { status: "archived" },
    });

    expect(error?.code).toBe("22023");
    expect((await clientRow(clientId))?.status).toBe("active");
  });

  // -------------------------------------------------------------------------
  // ClientAssignment grant / revoke
  // -------------------------------------------------------------------------

  it("grants an assignment atomically and audits it", async () => {
    const member = await createUser(`access-member-${crypto.randomUUID()}@example.com`);
    await addMember(member.id);

    const { error } = await owner.client.rpc("grant_client_assignment", {
      p_org_id: orgId,
      p_client_id: clientId,
      p_user_id: member.id,
      p_access_role: "read_only",
    });
    expect(error).toBeNull();

    expect(await activeAssignments(member.id, clientId)).toHaveLength(1);
    const audit = await auditRows("assignment.grant", clientId);
    expect(
      audit.some((row) => (row.after_data as Record<string, unknown>).user_id === member.id)
    ).toBe(true);
  });

  it("rolls back an assignment grant when the audit append fails", async (ctx) => {
    if (!faults.available) return ctx.skip();
    const member = await createUser(`access-grant-${crypto.randomUUID()}@example.com`);
    await addMember(member.id);

    await withFault("audit_log", member.id, () =>
      owner.client
        .rpc("grant_client_assignment", {
          p_org_id: orgId,
          p_client_id: clientId,
          p_user_id: member.id,
          p_access_role: "read_only",
        })
        .then(({ error }) => {
          if (error) throw new Error(error.message);
        })
    );

    expect(await activeAssignments(member.id, clientId)).toHaveLength(0);
  });

  it("rolls back an assignment revoke when the audit append fails", async (ctx) => {
    if (!faults.available) return ctx.skip();
    const member = await createUser(`access-revoke-${crypto.randomUUID()}@example.com`);
    await addMember(member.id);
    await owner.client.rpc("grant_client_assignment", {
      p_org_id: orgId,
      p_client_id: clientId,
      p_user_id: member.id,
      p_access_role: "secondary_specialist",
    });

    await withFault("audit_log", member.id, () =>
      owner.client
        .rpc("revoke_client_assignment", {
          p_org_id: orgId,
          p_client_id: clientId,
          p_user_id: member.id,
        })
        .then(({ error }) => {
          if (error) throw new Error(error.message);
        })
    );

    expect(await activeAssignments(member.id, clientId)).toHaveLength(1);
  });

  it("refuses to assign a client of another organization", async () => {
    const otherOwner = await createUser(`access-other-${crypto.randomUUID()}@example.com`);
    const { data: otherOrg } = await otherOwner.client.rpc("create_organization", {
      org_name: "Atomic Access Other",
    });
    const { data: otherClient } = await otherOwner.client.rpc("create_client", {
      p_organization_id: otherOrg,
      p_display_name: "Other tenant client",
    });

    const { error } = await owner.client.rpc("grant_client_assignment", {
      p_org_id: orgId,
      p_client_id: otherClient,
      p_user_id: specialist.id,
      p_access_role: "read_only",
    });

    expect(error?.code).toBe("22023");
    expect(await activeAssignments(specialist.id, otherClient as string)).toHaveLength(0);
  });

  it("refuses to assign a user who is not an active member", async () => {
    const outsider = await createUser(`access-outsider-${crypto.randomUUID()}@example.com`);

    const { error } = await owner.client.rpc("grant_client_assignment", {
      p_org_id: orgId,
      p_client_id: clientId,
      p_user_id: outsider.id,
      p_access_role: "read_only",
    });

    expect(error?.code).toBe("22023");
    expect(await activeAssignments(outsider.id, clientId)).toHaveLength(0);
  });

  it("keeps a supervisor scoped to explicitly assigned clients", async () => {
    const supervisor = await createUser(`access-supervisor-${crypto.randomUUID()}@example.com`);
    await addMember(supervisor.id, "supervisor");
    const assigned = await createClientFor(owner.client, `Наблюдение-${crypto.randomUUID()}`);
    const other = await createClientFor(owner.client, `Чужой-${crypto.randomUUID()}`);

    await owner.client.rpc("grant_client_assignment", {
      p_org_id: orgId,
      p_client_id: assigned,
      p_user_id: supervisor.id,
      p_access_role: "supervisor",
    });

    const { data: visible } = await supervisor.client.from("clients").select("id");
    expect(visible?.map((row) => row.id)).toEqual([assigned]);
    expect(visible?.some((row) => row.id === other)).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Consent grant / revoke
  // -------------------------------------------------------------------------

  it("grants consent atomically and audits it", async () => {
    const documentVersion = `v-${crypto.randomUUID()}`;

    const { data: recordId, error } = await specialist.client.rpc("grant_consent", {
      p_org_id: orgId,
      p_client_id: clientId,
      p_consent_type: "data_storage",
      p_scope: "full",
      p_document_version: documentVersion,
    });
    expect(error).toBeNull();

    const { data: records } = await admin
      .from("consent_records")
      .select("id")
      .eq("id", recordId)
      .is("revoked_at", null);
    expect(records).toHaveLength(1);

    const audit = await auditRows("consent.granted", recordId as string);
    expect(audit).toHaveLength(1);
  });

  it("rolls back a consent grant when the audit append fails", async (ctx) => {
    if (!faults.available) return ctx.skip();
    const documentVersion = `fault-${crypto.randomUUID()}`;

    await withFault("audit_log", documentVersion, () =>
      specialist.client
        .rpc("grant_consent", {
          p_org_id: orgId,
          p_client_id: clientId,
          p_consent_type: "ai_analysis",
          p_scope: "full",
          p_document_version: documentVersion,
        })
        .then(({ error }) => {
          if (error) throw new Error(error.message);
        })
    );

    const { data: records } = await admin
      .from("consent_records")
      .select("id")
      .eq("document_version", documentVersion);
    expect(records).toHaveLength(0);
  });

  it("rolls back a consent revoke when the audit append fails", async (ctx) => {
    if (!faults.available) return ctx.skip();
    const documentVersion = `revoke-${crypto.randomUUID()}`;

    const { data: recordId } = await specialist.client.rpc("grant_consent", {
      p_org_id: orgId,
      p_client_id: clientId,
      p_consent_type: "anonymized_analytics",
      p_scope: "full",
      p_document_version: documentVersion,
    });

    await withFault("audit_log", recordId as string, () =>
      specialist.client
        .rpc("revoke_consent", {
          p_org_id: orgId,
          p_client_id: clientId,
          p_consent_type: "anonymized_analytics",
        })
        .then(({ error }) => {
          if (error) throw new Error(error.message);
        })
    );

    const { data: records } = await admin
      .from("consent_records")
      .select("id")
      .eq("id", recordId)
      .is("revoked_at", null);
    expect(records).toHaveLength(1);
  });

  // -------------------------------------------------------------------------
  // Organization settings
  // -------------------------------------------------------------------------

  it("commits organization settings together with their audit row", async () => {
    const name = `Org-${crypto.randomUUID()}`;

    await updateOrgSettings(owner.client, {
      organizationId: orgId,
      name,
      retention: { clientDataYears: 3, exportDays: 14 },
    });

    const { data: org } = await admin
      .from("organizations")
      .select("name, settings")
      .eq("id", orgId)
      .single();
    expect(org?.name).toBe(name);
    expect((org?.settings as { retention?: unknown })?.retention).toEqual({
      client_data_years: 3,
      export_days: 14,
    });
    expect(await auditRows("organization.update_settings", orgId)).toHaveLength(1);
  });

  it("rolls back organization settings when the audit append fails", async (ctx) => {
    if (!faults.available) return ctx.skip();
    const { data: before } = await admin
      .from("organizations")
      .select("name")
      .eq("id", orgId)
      .single();
    const marker = `Rollback-${crypto.randomUUID()}`;

    await withFault("audit_log", marker, () =>
      updateOrgSettings(owner.client, { organizationId: orgId, name: marker })
    );

    const { data: after } = await admin
      .from("organizations")
      .select("name")
      .eq("id", orgId)
      .single();
    expect(after?.name).toBe(before?.name);
  });

  it("refuses organization settings from a non-owner member", async () => {
    await expect(
      updateOrgSettings(specialist.client, { organizationId: orgId, name: "Not allowed" })
    ).rejects.toThrow();
  });
});
