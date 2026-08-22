import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AiProvider, AiProviderCall, AiProviderResponse } from "@/lib/ai/provider";
import { ingestSignals } from "@/lib/service/ai-ingest";

try {
  process.loadEnvFile(".env.local");
} catch {
  // no .env.local — the suite will skip
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const available = Boolean(url && anonKey && serviceKey);

class StubProvider implements AiProvider {
  readonly providerKey = "stub";
  readonly modelSnapshot = "stub-1";
  readonly reasoningEffort = "none";
  signals: unknown[] = [];

  async complete(call: AiProviderCall): Promise<AiProviderResponse> {
    return {
      ok: true,
      output: {
        contract_version: call.contractVersion,
        request_id: (call.envelope as { request_id: string }).request_id,
        warnings: [],
        safety: { review_required: false, categories: [], rationale: "" },
        result: { signals: this.signals },
      },
      inputTokens: 1,
      outputTokens: 1,
    };
  }
}

describe.skipIf(!available)("ingestSignals (ticket 33)", () => {
  const admin = createClient(url!, serviceKey!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const createdUserIds: string[] = [];
  let orgId: string;
  let clientId: string;
  let sessionId: string;
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
    const { data } = await owner.client.rpc("create_organization", { org_name: "AI Ingest Org" });
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
      p_display_name: "AI Ingest Client",
    });
    clientId = cid;

    const { data: sid } = await specialist.client
      .from("diagnostic_sessions")
      .insert({
        organization_id: orgId,
        client_id: clientId,
        title: "s",
        session_type: "individual",
      })
      .select("id")
      .single();
    sessionId = sid!.id;

    // ai_analysis consent is required by the gateway.
    await admin.from("consent_records").insert({
      organization_id: orgId,
      client_id: clientId,
      consent_type: "ai_analysis",
      document_version: "1.0",
    });
  });

  afterAll(async () => {
    for (const id of createdUserIds) {
      await admin.auth.admin.deleteUser(id);
    }
  });

  it("creates pending L0 signals from a positive-stress AI result", async () => {
    const provider = new StubProvider();
    provider.signals = [
      {
        candidate_key: "s1",
        raw_statement: "Я достоин занимать новую роль",
        statement_polarity: "positive",
        test_result: "stress",
        normalized_meaning: "Стресс вокруг права занимать новую роль",
        inferred_opposite: null,
        confidence: 82,
        life_areas: ["leadership"],
        tags: [],
        context: "",
        proposed_evidence_level: "L1_SINGLE_SIGNAL",
        rationale: "positive + stress",
      },
    ];

    const ids = await ingestSignals(specialist.client, provider, {
      organizationId: orgId,
      clientId,
      diagnosticSessionId: sessionId,
      rawInput: "Я достоин занимать новую роль - стресс",
      sourceType: "kinesiology_test",
      inputFormat: "plain_text",
      knownLifeAreas: ["leadership"],
    });

    expect(ids).toHaveLength(1);
    const { data: signal } = await specialist.client
      .from("signals")
      .select(
        "source_type, review_status, evidence_level, raw_statement, statement_polarity, test_result"
      )
      .eq("id", ids[0])
      .maybeSingle();

    expect(signal?.source_type).toBe("ai_hypothesis");
    expect(signal?.review_status).toBe("pending");
    expect(signal?.evidence_level).toBe("L0_AI_ONLY");
    expect(signal?.raw_statement).toBe("Я достоин занимать новую роль");
    expect(signal?.statement_polarity).toBe("positive");
    expect(signal?.test_result).toBe("stress");
  });

  it("blocks without ai_analysis consent", async () => {
    // revoke the consent
    await admin
      .from("consent_records")
      .update({ revoked_at: new Date().toISOString() })
      .eq("client_id", clientId)
      .eq("consent_type", "ai_analysis");

    const provider = new StubProvider();
    await expect(
      ingestSignals(specialist.client, provider, {
        organizationId: orgId,
        clientId,
        diagnosticSessionId: sessionId,
        rawInput: "текст",
        sourceType: "kinesiology_test",
        inputFormat: "plain_text",
        knownLifeAreas: [],
      })
    ).rejects.toThrow();
  });
});
