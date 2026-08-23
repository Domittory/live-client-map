import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createPortalUser,
  getClientPortal,
  portalClientId,
  revokePortalUser,
} from "@/lib/service/client-portal";

try {
  process.loadEnvFile(".env.local");
} catch {
  // no .env.local — the suite will skip
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const available = Boolean(url && anonKey && serviceKey);

describe.skipIf(!available)("Client Portal (ticket 51)", () => {
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

  beforeAll(async () => {
    const owner = await createUser(`owner-${crypto.randomUUID()}@example.com`);
    const { data } = await owner.client.rpc("create_organization", { org_name: "Portal Org" });
    orgId = data;

    specialist = await createUser(`spec-${crypto.randomUUID()}@example.com`);
    await admin.from("organization_members").insert({
      organization_id: orgId,
      user_id: specialist.id,
      role: "specialist",
      status: "active",
    });

    const { data: cid } = await specialist.client.rpc("create_client", {
      p_organization_id: orgId,
      p_display_name: "Portal Client",
    });
    clientId = cid;

    await admin.from("consent_records").insert({
      organization_id: orgId,
      client_id: clientId,
      consent_type: "client_portal",
      document_version: "1.0",
    });
  });

  afterAll(async () => {
    for (const id of createdUserIds) {
      await admin.auth.admin.deleteUser(id);
    }
  });

  it("returns only published client-visible records", async () => {
    await specialist.client
      .from("clients")
      .update({ client_visible_notes: "опубликованная заметка" })
      .eq("id", clientId);
    await specialist.client.from("development_targets").insert({
      organization_id: orgId,
      client_id: clientId,
      name: "Цель",
      status: "active",
    });
    await specialist.client.from("recommendations").insert({
      organization_id: orgId,
      client_id: clientId,
      proposed_correction: "видимая",
      status: "approved",
      visibility: "client_visible",
      final_priority_score: 80,
    });
    await specialist.client.from("recommendations").insert({
      organization_id: orgId,
      client_id: clientId,
      proposed_correction: "внутренняя",
      status: "approved",
      visibility: "internal",
      final_priority_score: 90,
    });
    await specialist.client.from("recommendations").insert({
      organization_id: orgId,
      client_id: clientId,
      proposed_correction: "pending",
      status: "draft",
      visibility: "client_visible",
      final_priority_score: 70,
    });

    const portal = await getClientPortal(specialist.client, { clientId });

    expect(portal.notes).toBe("опубликованная заметка");
    expect(portal.agreedTargets).toHaveLength(1);
    const recTitles = portal.clientVisibleRecommendations.map((r) => r.proposed_correction);
    expect(recTitles).toContain("видимая");
    expect(recTitles).not.toContain("внутренняя");
    expect(recTitles).not.toContain("pending");
  });

  it("grants and revokes portal access by email", async () => {
    const email = `client-${crypto.randomUUID()}@example.com`;
    const portalUserId = await createPortalUser(specialist.client, { clientId, email });

    expect(await portalClientId(specialist.client, email)).toBe(clientId);

    await revokePortalUser(specialist.client, portalUserId);

    expect(await portalClientId(specialist.client, email)).toBeNull();
  });
});
