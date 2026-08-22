import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTheme, linkSignal, unlinkSignal } from "@/lib/service/themes";

try {
  process.loadEnvFile(".env.local");
} catch {
  // no .env.local — the suite will skip
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const available = Boolean(url && anonKey && serviceKey);

describe.skipIf(!available)("themes + signal links (ticket 24)", () => {
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

  async function insertSignal(
    specialistClient: SupabaseClient,
    opts: { reviewStatus: string; sourceType: string; sessionId?: string }
  ): Promise<string> {
    const { data } = await specialistClient
      .from("signals")
      .insert({
        organization_id: orgId,
        client_id: clientId,
        source_type: opts.sourceType,
        epistemic_type: "self_report",
        raw_statement: "утверждение",
        review_status: opts.reviewStatus,
        diagnostic_session_id: opts.sessionId ?? null,
      })
      .select("id")
      .single();
    return data!.id;
  }

  beforeAll(async () => {
    const owner = await createUser(`owner-${crypto.randomUUID()}@example.com`);
    const { data } = await owner.client.rpc("create_organization", { org_name: "Themes Org" });
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
      p_display_name: "Themes Client",
    });
    clientId = cid;
  });

  afterAll(async () => {
    for (const id of createdUserIds) {
      await admin.auth.admin.deleteUser(id);
    }
  });

  it("counts only confirmed, non-AI signals as evidence", async () => {
    const themeId = await createTheme(specialist.client, orgId, {
      clientId,
      name: "Страх авторитета",
    });

    const confirmed = await insertSignal(specialist.client, {
      reviewStatus: "approved",
      sourceType: "client_report",
    });
    const rejected = await insertSignal(specialist.client, {
      reviewStatus: "rejected",
      sourceType: "client_report",
    });
    const aiOnly = await insertSignal(specialist.client, {
      reviewStatus: "approved",
      sourceType: "ai_hypothesis",
    });

    await linkSignal(specialist.client, orgId, {
      themeId,
      signalId: confirmed,
      relevanceScore: 90,
      linkRationale: "прямое подтверждение",
    });
    await linkSignal(specialist.client, orgId, { themeId, signalId: rejected });
    await linkSignal(specialist.client, orgId, { themeId, signalId: aiOnly });

    const { data: theme } = await specialist.client
      .from("themes")
      .select("evidence_count, independent_evidence_count")
      .eq("id", themeId)
      .maybeSingle();
    // Only the confirmed, non-AI signal counts.
    expect(theme?.evidence_count).toBe(1);
    expect(theme?.independent_evidence_count).toBe(1);
  });

  it("counts distinct sessions as independent contexts", async () => {
    const themeId = await createTheme(specialist.client, orgId, {
      clientId,
      name: "Ответственность",
    });

    const { data: session1 } = await specialist.client
      .from("diagnostic_sessions")
      .insert({
        organization_id: orgId,
        client_id: clientId,
        title: "s1",
        session_type: "individual",
      })
      .select("id")
      .single();
    const { data: session2 } = await specialist.client
      .from("diagnostic_sessions")
      .insert({
        organization_id: orgId,
        client_id: clientId,
        title: "s2",
        session_type: "individual",
      })
      .select("id")
      .single();

    const s1 = await insertSignal(specialist.client, {
      reviewStatus: "approved",
      sourceType: "client_report",
      sessionId: session1!.id,
    });
    const s2 = await insertSignal(specialist.client, {
      reviewStatus: "approved",
      sourceType: "client_report",
      sessionId: session2!.id,
    });

    await linkSignal(specialist.client, orgId, { themeId, signalId: s1 });
    await linkSignal(specialist.client, orgId, { themeId, signalId: s2 });

    const { data: theme } = await specialist.client
      .from("themes")
      .select("evidence_count, contexts_count")
      .eq("id", themeId)
      .maybeSingle();
    expect(theme?.evidence_count).toBe(2);
    expect(theme?.contexts_count).toBe(2);
  });

  it("unlink decreases the aggregate", async () => {
    const themeId = await createTheme(specialist.client, orgId, {
      clientId,
      name: "Границы",
    });
    const s1 = await insertSignal(specialist.client, {
      reviewStatus: "approved",
      sourceType: "client_report",
    });
    await linkSignal(specialist.client, orgId, { themeId, signalId: s1 });

    await unlinkSignal(specialist.client, orgId, themeId, s1);

    const { data: theme } = await specialist.client
      .from("themes")
      .select("evidence_count")
      .eq("id", themeId)
      .maybeSingle();
    expect(theme?.evidence_count).toBe(0);
  });
});
