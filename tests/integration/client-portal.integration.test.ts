import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createPortalUser,
  getClientPortal,
  getPortalOverview,
  listPortalUsers,
  portalClientId,
  revokePortalUser,
} from "@/lib/service/client-portal";
import { revokeClientConsent } from "@/lib/service/consent";

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
 * Client Portal (ticket 51, published view ticket 15).
 *
 * The portal identity is built the same way production builds it: the
 * specialist grants the identity through `create_portal_user`, and the client's
 * browser proves the emailed single-use `token_hash` with `verifyOtp`. The
 * suite then asserts the two security properties the ticket turns on — the
 * portal identity reads only its own published client-visible projection, and
 * it can never read a base domain table directly.
 */
describe.skipIf(!available)("Client Portal (ticket 51, ticket 15)", () => {
  const admin = createClient(url!, serviceKey!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const createdUserIds: string[] = [];
  let orgId: string;
  let clientId: string;
  let otherClientId: string;
  let specialist: { id: string; client: SupabaseClient };

  const emailA = `portal-a-${crypto.randomUUID()}@example.com`;
  const emailB = `portal-b-${crypto.randomUUID()}@example.com`;
  let portalA: { id: string; client: SupabaseClient };
  let portalB: { id: string; client: SupabaseClient };

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

  /**
   * Create the auth identity the invite email creates, then redeem a
   * single-use magic-link token exactly like `/auth/confirm` does. The resulting
   * session carries the same email claim the RLS policies match on.
   */
  async function createPortalSession(
    email: string
  ): Promise<{ id: string; client: SupabaseClient }> {
    const { data: user, error } = await admin.auth.admin.createUser({
      email,
      email_confirm: true,
    });
    if (error) throw new Error(error.message);
    createdUserIds.push(user.user!.id);

    const { data: link, error: linkError } = await admin.auth.admin.generateLink({
      type: "magiclink",
      email,
    });
    if (linkError) throw new Error(linkError.message);

    const client = anonClient();
    const { error: verifyError } = await client.auth.verifyOtp({
      type: "magiclink",
      token_hash: link.properties.hashed_token,
    });
    if (verifyError) throw new Error(verifyError.message);

    return { id: user.user!.id, client };
  }

  /** Rows of a client-scoped table the given session can read (0 = denied). */
  async function visibleRows(
    client: SupabaseClient,
    table: string,
    idColumn: string,
    id: string
  ): Promise<number> {
    const { data, error } = await client.from(table).select("id").eq(idColumn, id);
    if (error) return -1;
    return data?.length ?? 0;
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

    const { data: otherCid } = await specialist.client.rpc("create_client", {
      p_organization_id: orgId,
      p_display_name: "Other Client",
    });
    otherClientId = otherCid;

    for (const id of [clientId, otherClientId]) {
      await admin.from("consent_records").insert({
        organization_id: orgId,
        client_id: id,
        consent_type: "client_portal",
        document_version: "1.0",
      });
    }

    await createPortalUser(specialist.client, { clientId, email: emailA });
    await createPortalUser(specialist.client, { clientId: otherClientId, email: emailB });
    portalA = await createPortalSession(emailA);
    portalB = await createPortalSession(emailB);
  });

  afterAll(async () => {
    for (const id of createdUserIds) {
      await admin.auth.admin.deleteUser(id);
    }
  });

  it("returns only published client-visible records to a specialist preview", async () => {
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
    await specialist.client.from("development_targets").insert({
      organization_id: orgId,
      client_id: clientId,
      name: "Архивная цель",
      status: "archived",
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
    await specialist.client.from("corrections").insert({
      organization_id: orgId,
      client_id: clientId,
      title: "Опубликованный итог",
      client_visible_summary: "Короткая сводка для клиента",
      status: "completed",
    });
    await specialist.client.from("corrections").insert({
      organization_id: orgId,
      client_id: clientId,
      title: "Внутренняя работа",
      status: "completed",
    });

    const portal = await getClientPortal(specialist.client, { clientId });

    expect(portal.notes).toBe("опубликованная заметка");
    expect(portal.agreedTargets.map((target) => target.name)).toEqual(["Цель"]);
    const recTitles = portal.clientVisibleRecommendations.map((r) => r.proposed_correction);
    expect(recTitles).toContain("видимая");
    expect(recTitles).not.toContain("внутренняя");
    expect(recTitles).not.toContain("pending");
    expect(portal.publishedSummaries.map((summary) => summary.summary)).toEqual([
      "Короткая сводка для клиента",
    ]);
  });

  it("grants and revokes portal access by email", async () => {
    const email = `client-${crypto.randomUUID()}@example.com`;
    const portalUserId = await createPortalUser(specialist.client, { clientId, email });

    expect(await portalClientId(specialist.client, email)).toBe(clientId);
    expect((await listPortalUsers(specialist.client, { clientId })).map((u) => u.email)).toContain(
      email
    );

    await revokePortalUser(specialist.client, portalUserId);

    expect(await portalClientId(specialist.client, email)).toBeNull();
  });

  it("serves a portal identity only its own published, client-visible projection", async () => {
    const overview = await getPortalOverview(portalA.client);

    expect(overview).not.toBeNull();
    expect(overview!.clientId).toBe(clientId);
    expect(overview!.notes).toBe("опубликованная заметка");
    expect(overview!.agreedTargets.map((target) => target.name)).toEqual(["Цель"]);
    const recTitles = overview!.clientVisibleRecommendations.map((r) => r.proposed_correction);
    expect(recTitles).toContain("видимая");
    expect(recTitles).not.toContain("внутренняя");
    expect(recTitles).not.toContain("pending");
    expect(overview!.publishedSummaries.map((summary) => summary.summary)).toEqual([
      "Короткая сводка для клиента",
    ]);
  });

  it("never becomes an organization member and cannot read base domain tables", async () => {
    // Non-vacuous: the service role sees the seeded tenant data, and a signal,
    // theme, core node and differential hypothesis exist for this client.
    await specialist.client.from("signals").insert({
      organization_id: orgId,
      client_id: clientId,
      source_type: "client_report",
      epistemic_type: "self_report",
      raw_statement: "внутренний сигнал",
    });
    await specialist.client
      .from("themes")
      .insert({ organization_id: orgId, client_id: clientId, name: "Внутренняя тема" });
    await specialist.client
      .from("core_nodes")
      .insert({ organization_id: orgId, client_id: clientId, title: "Внутренний узел" });
    await specialist.client
      .from("differential_hypotheses")
      .insert({ organization_id: orgId, client_id: clientId, title: "Внутренняя гипотеза" });

    const { count: signalCount } = await admin
      .from("signals")
      .select("id", { count: "exact", head: true })
      .eq("client_id", clientId);
    const { count: auditCount } = await admin
      .from("audit_log")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId);
    expect(signalCount).toBeGreaterThan(0);
    expect(auditCount).toBeGreaterThan(0);

    // Never an organization member: the portal uid has no membership row.
    const { data: membership } = await admin
      .from("organization_members")
      .select("user_id")
      .eq("user_id", portalA.id);
    expect(membership ?? []).toHaveLength(0);

    for (const table of [
      "signals",
      "themes",
      "core_nodes",
      "differential_hypotheses",
      "development_targets",
      "recommendations",
      "corrections",
    ]) {
      expect(await visibleRows(portalA.client, table, "client_id", clientId)).toBe(0);
    }
    expect(await visibleRows(portalA.client, "clients", "id", clientId)).toBe(0);

    const { data: auditRows } = await portalA.client.from("audit_log").select("id");
    expect(auditRows ?? []).toHaveLength(0);
  });

  it("denies cross-client access: a portal identity sees only its own client", async () => {
    await specialist.client
      .from("clients")
      .update({ client_visible_notes: "ЧУЖИЕ ДАННЫЕ ДРУГОГО КЛИЕНТА" })
      .eq("id", otherClientId);

    const overviewA = await getPortalOverview(portalA.client);
    const overviewB = await getPortalOverview(portalB.client);

    expect(overviewA!.clientId).toBe(clientId);
    expect(overviewA!.notes).not.toContain("ЧУЖИЕ ДАННЫЕ");
    expect(overviewB!.clientId).toBe(otherClientId);

    // The other client's published notes are unreachable directly as well.
    expect(await visibleRows(portalA.client, "clients", "id", otherClientId)).toBe(0);
  });

  it("denies the next request immediately after portal access is revoked", async () => {
    const email = `portal-live-${crypto.randomUUID()}@example.com`;
    const portalUserId = await createPortalUser(specialist.client, { clientId, email });
    const session = await createPortalSession(email);

    expect(await getPortalOverview(session.client)).not.toBeNull();

    await revokePortalUser(specialist.client, portalUserId);

    // Same session, same cookies — the very next read is denied.
    expect(await getPortalOverview(session.client)).toBeNull();
  });

  it("denies the next request immediately after the client_portal consent is revoked", async () => {
    const email = `portal-consent-${crypto.randomUUID()}@example.com`;
    await createPortalUser(specialist.client, { clientId, email });
    const session = await createPortalSession(email);

    expect(await getPortalOverview(session.client)).not.toBeNull();

    await revokeClientConsent(specialist.client, {
      organizationId: orgId,
      clientId,
      consentType: "client_portal",
    });

    expect(await getPortalOverview(session.client)).toBeNull();

    // Restore consent so the suite leaves the tenant in a consistent state.
    await admin.from("consent_records").insert({
      organization_id: orgId,
      client_id: clientId,
      consent_type: "client_portal",
      document_version: "1.0",
    });
    expect(await getPortalOverview(session.client)).not.toBeNull();
  });
});
