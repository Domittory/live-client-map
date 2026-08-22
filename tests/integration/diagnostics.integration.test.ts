import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSession, createSignal } from "@/lib/service/diagnostics";

try {
  process.loadEnvFile(".env.local");
} catch {
  // no .env.local — the suite will skip
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const available = Boolean(url && anonKey && serviceKey);

describe.skipIf(!available)("diagnostic session + manual signals (ticket 20)", () => {
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
    const { data } = await owner.client.rpc("create_organization", { org_name: "Diag Org" });
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
      p_display_name: "Diag Client",
    });
    clientId = cid;
  });

  afterAll(async () => {
    for (const id of createdUserIds) {
      await admin.auth.admin.deleteUser(id);
    }
  });

  it("saves raw input unchanged next to the session", async () => {
    const rawInput = "Мне безопасно быть главным - стресс\nЯ боюсь ответственности - стресс";
    const sessionId = await createSession(specialist.client, orgId, {
      clientId,
      title: "Сессия 1",
      sessionType: "individual",
      rawInput,
    });

    const { data: session } = await specialist.client
      .from("diagnostic_sessions")
      .select("raw_input")
      .eq("id", sessionId)
      .maybeSingle();
    expect(session?.raw_input).toBe(rawInput);
  });

  it("creates one atomic signal with valid types", async () => {
    const signalId = await createSignal(specialist.client, orgId, {
      clientId,
      sourceType: "kinesiology_test",
      epistemicType: "test_result",
      rawStatement: "Мне безопасно быть главным",
      statementPolarity: "positive",
      testResult: "stress",
    });

    const { data: signal } = await specialist.client
      .from("signals")
      .select("raw_statement, source_type, epistemic_type, evidence_level")
      .eq("id", signalId)
      .maybeSingle();
    expect(signal?.raw_statement).toBe("Мне безопасно быть главным");
    expect(signal?.source_type).toBe("kinesiology_test");
    expect(signal?.epistemic_type).toBe("test_result");
    expect(signal?.evidence_level).toBe("L1_SINGLE_SIGNAL");
  });

  it("rejects invalid source_type and epistemic_type", async () => {
    await expect(
      createSignal(specialist.client, orgId, {
        clientId,
        sourceType: "invalid_source",
        epistemicType: "test_result",
        rawStatement: "x",
      })
    ).rejects.toThrow();
    await expect(
      createSignal(specialist.client, orgId, {
        clientId,
        sourceType: "client_report",
        epistemicType: "invalid_epistemic",
        rawStatement: "x",
      })
    ).rejects.toThrow();
  });
});
