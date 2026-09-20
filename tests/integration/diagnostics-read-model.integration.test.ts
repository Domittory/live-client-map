import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSession, createSignal, getDiagnosticsReadModel } from "@/lib/service/diagnostics";

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
 * Ticket 10: diagnostics read model used by the client workspace screen.
 *
 * The read model is load-bearing for the UI (lineage, session grouping, the
 * "not enough data" rule), so it is asserted against the real database: an
 * assigned specialist sees the persisted rows with their lineage, while an
 * unassigned member receives empty collections from RLS — never another
 * client's evidence and never a permission error the UI could misread.
 */
describe.skipIf(!available)("client diagnostics read model (ticket 10)", () => {
  const admin = createClient(url!, serviceKey!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const createdUserIds: string[] = [];
  let orgId: string;
  let clientId: string;
  let foreignClientId: string;
  let specialist: { id: string; client: SupabaseClient };
  let unassigned: { id: string; client: SupabaseClient };

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
    const { data } = await owner.client.rpc("create_organization", { org_name: "Diag Read Org" });
    orgId = data;

    specialist = await createUser(`spec-${crypto.randomUUID()}@example.com`);
    await admin.from("organization_members").insert({
      organization_id: orgId,
      user_id: specialist.id,
      role: "specialist",
      status: "active",
    });

    unassigned = await createUser(`unassigned-${crypto.randomUUID()}@example.com`);
    await admin.from("organization_members").insert({
      organization_id: orgId,
      user_id: unassigned.id,
      role: "specialist",
      status: "active",
    });

    const { data: cid } = await specialist.client.rpc("create_client", {
      p_organization_id: orgId,
      p_display_name: "Diag Read Client",
    });
    clientId = cid;

    const { data: other } = await specialist.client.rpc("create_client", {
      p_organization_id: orgId,
      p_display_name: "Foreign Diag Client",
    });
    foreignClientId = other;
  });

  afterAll(async () => {
    await admin.from("organizations").delete().eq("id", orgId);
    for (const id of createdUserIds) {
      await admin.auth.admin.deleteUser(id);
    }
  });

  it("groups signals under their session and resolves lineage", async () => {
    const sessionId = await createSession(specialist.client, orgId, {
      clientId,
      title: "Сессия с lineage",
      sessionType: "individual",
      rawInput: "Сырой протокол",
      notes: "Заметка",
    });

    const insideSession = await createSignal(specialist.client, orgId, {
      clientId,
      diagnosticSessionId: sessionId,
      sourceType: "kinesiology_test",
      epistemicType: "test_result",
      rawStatement: "Мне безопасно быть главным",
      statementPolarity: "positive",
      testResult: "stress",
      normalizedMeaning: "Стресс вокруг доступа к позитивной возможности.",
    });

    const sessionless = await createSignal(specialist.client, orgId, {
      clientId,
      sourceType: "client_report",
      epistemicType: "self_report",
      rawStatement: "Я боюсь ответственности",
    });

    const model = await getDiagnosticsReadModel(specialist.client, {
      organizationId: orgId,
      clientId,
    });

    const session = model.sessions.find((entry) => entry.id === sessionId);
    expect(session).toBeDefined();
    expect(session?.raw_input).toBe("Сырой протокол");
    expect(session?.signals.map((signal) => signal.id)).toContain(insideSession);

    expect(model.sessionlessSignals.map((signal) => signal.id)).toContain(sessionless);

    expect(model.lineage.get(insideSession)).toEqual({
      id: sessionId,
      title: "Сессия с lineage",
      sessionType: "individual",
    });
    expect(model.lineage.get(sessionless)).toBeNull();
  });

  it("returns an empty read model — not an error — for an unassigned member", async () => {
    const model = await getDiagnosticsReadModel(unassigned.client, {
      organizationId: orgId,
      clientId,
    });
    expect(model.sessions).toEqual([]);
    expect(model.sessionlessSignals).toEqual([]);
    expect(model.lineage.size).toBe(0);
  });

  it("never mixes two clients of the same organization", async () => {
    const foreignSession = await createSession(specialist.client, orgId, {
      clientId: foreignClientId,
      title: "Чужая сессия",
      sessionType: "baseline",
    });

    const model = await getDiagnosticsReadModel(specialist.client, {
      organizationId: orgId,
      clientId,
    });
    expect(model.sessions.map((session) => session.id)).not.toContain(foreignSession);
  });

  it("rejects a malformed client id instead of querying the database", async () => {
    await expect(
      getDiagnosticsReadModel(specialist.client, {
        organizationId: orgId,
        clientId: "not-a-uuid",
      })
    ).rejects.toThrow();
  });
});
