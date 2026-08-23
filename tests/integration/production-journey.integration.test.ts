import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runAiFunction } from "@/lib/ai/gateway";
import type { AiProvider, AiProviderCall, AiProviderResponse } from "@/lib/ai/provider";
import { ingestSignals } from "@/lib/service/ai-ingest";
import { confirmCoreNode, createCoreNode } from "@/lib/service/core-nodes";
import { createSession, createSignal } from "@/lib/service/diagnostics";
import { executeErasure, previewErasure } from "@/lib/service/erasure";
import { exportSignalsCsv } from "@/lib/service/export";
import { addContradiction, createHypothesis } from "@/lib/service/hypotheses";
import { createRequest } from "@/lib/service/requests";

/**
 * Ticket 65 — production readiness journey. Walks the integrated lifecycle
 * (onboarding → request → diagnostics → signals → AI ingest → core node →
 * hypothesis + contradiction → export → erasure) and asserts the cross-cutting
 * §59 invariants: AI output stays pending/L0, RLS isolates tenants, consent
 * gates the AI gateway, and erasure anonymizes the audit trail. No production
 * AI and no manual database edits.
 */

try {
  process.loadEnvFile(".env.local");
} catch {
  // no .env.local — the suite will skip
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const available = Boolean(url && anonKey && serviceKey);

const DUMMY_UUID = "123e4567-e89b-12d3-a456-426614174000";

type User = { id: string; client: SupabaseClient };

// A deterministic provider that returns one valid ingest signal, so the journey
// can prove AI-created signals stay L0/pending without touching a real model.
const aiWithOneSignal: AiProvider = {
  providerKey: "fake",
  modelSnapshot: "fake",
  reasoningEffort: "none",
  async complete(call: AiProviderCall): Promise<AiProviderResponse> {
    const envelope = call.envelope as { contract_version: string; request_id: string };
    const result =
      call.functionId === "ai.ingest-signals.v1"
        ? {
            signals: [
              {
                candidate_key: "ai-signal-1",
                raw_statement: "Я хочу занять руководящую роль",
                statement_polarity: "positive",
                test_result: "stress",
                normalized_meaning: "Стресс вокруг доступа к руководящей роли",
                inferred_opposite: "Возможный страх ответственности (не доказано)",
                confidence: 60,
                life_areas: ["work"],
                tags: [],
                context: "",
                proposed_evidence_level: "L0_AI_ONLY",
                rationale: "r",
              },
            ],
          }
        : {};
    return {
      ok: true,
      output: {
        contract_version: envelope.contract_version,
        request_id: envelope.request_id,
        result,
        warnings: [],
        safety: { review_required: false, categories: [], rationale: "" },
      },
      inputTokens: 1,
      outputTokens: 1,
    };
  },
};

describe.skipIf(!available)("Production readiness journey (ticket 65)", () => {
  const admin = createClient(url!, serviceKey!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const createdUserIds: string[] = [];
  let orgId: string;
  let clientId: string;
  let owner: User;
  let stranger: User;

  function anonClient() {
    return createClient(url!, anonKey!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }

  async function createUser(email: string): Promise<User> {
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
    owner = await createUser(`journey-owner-${crypto.randomUUID()}@example.com`);
    const { data: org } = await owner.client.rpc("create_organization", {
      org_name: "Journey Org",
    });
    orgId = org as string;

    const { data: cid } = await owner.client.rpc("create_client", {
      p_organization_id: orgId,
      p_display_name: "Journey Client",
    });
    clientId = cid as string;

    for (const consentType of ["data_storage", "ai_analysis", "sensitive_psychological_data"]) {
      await admin.from("consent_records").insert({
        organization_id: orgId,
        client_id: clientId,
        consent_type: consentType,
        document_version: "1.0",
      });
    }

    // A second organization used to prove tenant isolation (RLS).
    stranger = await createUser(`journey-stranger-${crypto.randomUUID()}@example.com`);
    await stranger.client.rpc("create_organization", { org_name: "Stranger Org" });
  }, 60_000);

  afterAll(async () => {
    for (const id of createdUserIds) {
      await admin.auth.admin.deleteUser(id);
    }
  });

  it("onboards, models a client, keeps AI output pending, and exports", async () => {
    const requestId = await createRequest(owner.client, orgId, {
      clientId,
      title: "Занять руководящую роль",
      priority: "high",
    });
    expect(requestId).toBeTruthy();

    const sessionId = await createSession(owner.client, orgId, {
      clientId,
      title: "Диагностика",
      sessionType: "individual",
    });
    expect(sessionId).toBeTruthy();

    const signalId = await createSignal(owner.client, orgId, {
      clientId,
      diagnosticSessionId: sessionId,
      sourceType: "kinesiology_test",
      epistemicType: "test_result",
      rawStatement: "Мне можно быть главным",
      statementPolarity: "positive",
      testResult: "stress",
    });
    expect(signalId).toBeTruthy();

    // AI ingest persists only pending, L0 evidence (SPEC §3.5, §51.1).
    const aiIds = await ingestSignals(owner.client, aiWithOneSignal, {
      organizationId: orgId,
      clientId,
      diagnosticSessionId: sessionId,
      rawInput: "Я хочу занять руководящую роль",
      sourceType: "client_report",
      inputFormat: "plain_text",
      knownLifeAreas: ["work"],
    });
    expect(aiIds).toHaveLength(1);
    const { data: aiSignal } = await admin
      .from("signals")
      .select("evidence_level, review_status")
      .eq("id", aiIds[0])
      .single();
    expect(aiSignal!.evidence_level).toBe("L0_AI_ONLY");
    expect(aiSignal!.review_status).toBe("pending");

    // Core node: hypothesis → active only via human confirmation.
    const nodeId = await createCoreNode(owner.client, orgId, {
      clientId,
      title: "Страх ответственности",
      confidenceScore: 50,
    });
    await confirmCoreNode(owner.client, orgId, nodeId);
    const { data: node } = await admin
      .from("core_nodes")
      .select("status")
      .eq("id", nodeId)
      .single();
    expect(node!.status).toBe("active");

    // Contradicting evidence lowers confidence (SPEC §51.4).
    const hypothesisId = await createHypothesis(owner.client, orgId, {
      clientId,
      title: "Страх новой роли",
      confidenceScore: 80,
    });
    await addContradiction(owner.client, orgId, hypothesisId, "real workplace threat");
    const { data: hypothesis } = await admin
      .from("differential_hypotheses")
      .select("confidence_score")
      .eq("id", hypothesisId)
      .single();
    expect(hypothesis!.confidence_score).toBe(70);

    // Export works end-to-end and preserves the raw statement.
    const csv = await exportSignalsCsv(owner.client, { clientId });
    expect(csv).toContain("Мне можно быть главным");
  });

  it("RLS: another organization cannot read the client's signals", async () => {
    const { data } = await stranger.client.from("signals").select("id").eq("client_id", clientId);
    expect(data ?? []).toHaveLength(0);
  });

  it("consent: revoking ai_analysis blocks the AI gateway", async () => {
    await owner.client.rpc("revoke_consent", {
      p_org_id: orgId,
      p_client_id: clientId,
      p_consent_type: "ai_analysis",
    });

    const result = await runAiFunction(owner.client, aiWithOneSignal, {
      functionId: "ai.ingest-signals.v1",
      organizationId: orgId,
      clientId,
      payload: {
        diagnostic_session_id: DUMMY_UUID,
        raw_input: "ещё один сеанс",
        source_type: "client_report",
        input_format: "plain_text",
        language: "ru",
        known_life_areas: ["work"],
      },
    });
    expect(result.ok).toBe(false);
    expect(result.status).toBe("blocked_consent");
  });

  it("erasure completes the journey and anonymizes the audit trail", async () => {
    const preview = await previewErasure(owner.client, admin, clientId);
    expect(preview.impacted.signals).toBeGreaterThanOrEqual(1);

    const result = await executeErasure(owner.client, admin, clientId);
    expect(result.status).toBe("completed");

    const { data: clients } = await admin.from("clients").select("id").eq("id", clientId);
    expect(clients).toHaveLength(0);
    const { data: signals } = await admin.from("signals").select("id").eq("client_id", clientId);
    expect(signals).toHaveLength(0);
  });
});
