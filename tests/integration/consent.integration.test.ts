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

describe.skipIf(!available)("consent gates (ticket 13)", () => {
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

  async function hasConsent(client: SupabaseClient, type: string): Promise<boolean> {
    const { data, error } = await client.rpc("has_consent", {
      p_client_id: clientId,
      p_consent_type: type,
    });
    if (error) throw new Error(error.message);
    return data as boolean;
  }

  beforeAll(async () => {
    const owner = await createUser(`owner-${crypto.randomUUID()}@example.com`);
    const { data } = await owner.client.rpc("create_organization", { org_name: "Consent Org" });
    orgId = data;
    const { data: cid } = await owner.client.rpc("create_client", {
      p_organization_id: orgId,
      p_display_name: "Consent Test Client",
    });
    clientId = cid;

    specialist = await createUser(`spec-${crypto.randomUUID()}@example.com`);
    await addMember(specialist.id, "specialist");
    await assign(specialist.id, "primary_specialist");
  });

  afterAll(async () => {
    for (const id of createdUserIds) {
      await admin.auth.admin.deleteUser(id);
    }
  });

  it("missing consent returns false", async () => {
    expect(await hasConsent(specialist.client, "ai_analysis")).toBe(false);
  });

  it("grant then check returns true", async () => {
    const { error } = await specialist.client.rpc("grant_consent", {
      p_org_id: orgId,
      p_client_id: clientId,
      p_consent_type: "ai_analysis",
      p_scope: "",
      p_document_version: "1.0",
    });
    expect(error).toBeNull();
    expect(await hasConsent(specialist.client, "ai_analysis")).toBe(true);
  });

  it("revoke blocks the operation", async () => {
    await specialist.client.rpc("grant_consent", {
      p_org_id: orgId,
      p_client_id: clientId,
      p_consent_type: "data_storage",
      p_scope: "",
      p_document_version: "1.0",
    });
    expect(await hasConsent(specialist.client, "data_storage")).toBe(true);

    const { error } = await specialist.client.rpc("revoke_consent", {
      p_org_id: orgId,
      p_client_id: clientId,
      p_consent_type: "data_storage",
    });
    expect(error).toBeNull();
    expect(await hasConsent(specialist.client, "data_storage")).toBe(false);
  });

  it("new document version preserves history", async () => {
    for (const v of ["1.0", "2.0"]) {
      const { error } = await specialist.client.rpc("grant_consent", {
        p_org_id: orgId,
        p_client_id: clientId,
        p_consent_type: "supervisor_access",
        p_scope: "",
        p_document_version: v,
      });
      expect(error).toBeNull();
    }

    expect(await hasConsent(specialist.client, "supervisor_access")).toBe(true);

    const { data } = await admin
      .from("consent_records")
      .select("document_version")
      .eq("client_id", clientId)
      .eq("consent_type", "supervisor_access");
    expect(data).toHaveLength(2);
    expect(data!.map((r) => r.document_version).sort()).toEqual(["1.0", "2.0"]);
  });

  it("user without write assignment cannot grant consent", async () => {
    const other = await createUser(`other-${crypto.randomUUID()}@example.com`);
    await addMember(other.id, "specialist");
    // no client assignment for `other`

    const { error } = await other.client.rpc("grant_consent", {
      p_org_id: orgId,
      p_client_id: clientId,
      p_consent_type: "ai_analysis",
      p_scope: "",
      p_document_version: "1.0",
    });
    expect(error).not.toBeNull();
  });
});
