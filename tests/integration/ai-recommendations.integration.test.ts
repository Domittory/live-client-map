import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AiProvider, AiProviderCall, AiProviderResponse } from "@/lib/ai/provider";
import { generateRecommendations } from "@/lib/service/ai-recommendations";

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
  results: Record<string, unknown> = {};

  async complete(call: AiProviderCall): Promise<AiProviderResponse> {
    const result = this.results[call.functionId] ?? {};
    return {
      ok: true,
      output: {
        contract_version: call.contractVersion,
        request_id: (call.envelope as { request_id: string }).request_id,
        warnings: [],
        safety: { review_required: false, categories: [], rationale: "" },
        result,
      },
      inputTokens: 1,
      outputTokens: 1,
    };
  }
}

describe.skipIf(!available)("generateRecommendations (ticket 37)", () => {
  const admin = createClient(url!, serviceKey!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const createdUserIds: string[] = [];
  let orgId: string;
  let clientId: string;
  let requestId: string;
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
    const { data } = await owner.client.rpc("create_organization", { org_name: "AI Rec Org" });
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
      p_display_name: "AI Rec Client",
    });
    clientId = cid;

    const { data: rid } = await specialist.client
      .from("client_requests")
      .insert({ organization_id: orgId, client_id: clientId, title: "Запрос на рост" })
      .select("id")
      .single();
    requestId = rid!.id;

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

  it("persists a draft recommendation linked to the current request with deterministic score", async () => {
    const targetRef = crypto.randomUUID();
    const provider = new StubProvider();
    provider.results["ai.generate-recommendations.v1"] = {
      recommendations: [
        {
          candidate_key: "rec1",
          proposed_correction: "Работа с внутренней опорой",
          rationale: "высокий rootness и unlock",
          target_refs: [{ ref: targetRef, role: "primary", expected_effect: "усиление опоры" }],
          score_card_ref: targetRef,
          risk_notes: "низкий риск",
          human_review_required: false,
          missing_evidence: [],
          rank_rationale: "top priority",
        },
      ],
    };

    const ids = await generateRecommendations(specialist.client, provider, {
      organizationId: orgId,
      clientId,
      clientRequestId: requestId,
      activeClientRequest: "Запрос на рост",
      approvedEntities: [],
      resources: [],
      developmentTargets: [],
      scoreCards: [
        {
          ref: targetRef,
          inputs: {
            rootnessScore: 92,
            impactScore: 88,
            activationScore: 79,
            confidenceScore: 83,
            clientRelevanceScore: 94,
            readinessScore: 70,
            unlockScore: 86,
            riskScore: 42,
          },
        },
      ],
      risks: [],
      priorCorrections: [],
      allowedInterventionMethods: [],
    });

    expect(ids).toHaveLength(1);
    const { data: rec } = await specialist.client
      .from("recommendations")
      .select(
        "status, client_request_id, final_priority_score, scoring_model_version, human_review_required, visibility"
      )
      .eq("id", ids[0])
      .maybeSingle();
    expect(rec?.status).toBe("draft");
    expect(rec?.client_request_id).toBe(requestId);
    expect(rec?.final_priority_score).toBe(79.2);
    expect(rec?.scoring_model_version).toBe("1.0.0");
    expect(rec?.human_review_required).toBe(false);
    expect(rec?.visibility).toBe("internal");
  });

  it("forces human review and internal visibility when risk >= 80", async () => {
    const targetRef = crypto.randomUUID();
    const provider = new StubProvider();
    provider.results["ai.generate-recommendations.v1"] = {
      recommendations: [
        {
          candidate_key: "rec2",
          proposed_correction: "Высокорисковая коррекция",
          rationale: "риск",
          target_refs: [{ ref: targetRef, role: "primary", expected_effect: "x" }],
          score_card_ref: targetRef,
          risk_notes: "риск высокий",
          human_review_required: false,
          missing_evidence: [],
          rank_rationale: "risky",
        },
      ],
    };

    const ids = await generateRecommendations(specialist.client, provider, {
      organizationId: orgId,
      clientId,
      clientRequestId: requestId,
      activeClientRequest: "Запрос",
      approvedEntities: [],
      resources: [],
      developmentTargets: [],
      scoreCards: [
        {
          ref: targetRef,
          inputs: {
            rootnessScore: 50,
            impactScore: 50,
            activationScore: 50,
            confidenceScore: 50,
            clientRelevanceScore: 50,
            readinessScore: 50,
            unlockScore: 50,
            riskScore: 85,
          },
        },
      ],
      risks: [],
      priorCorrections: [],
      allowedInterventionMethods: [],
    });

    const { data: rec } = await specialist.client
      .from("recommendations")
      .select("human_review_required, visibility, status")
      .eq("id", ids[0])
      .maybeSingle();
    expect(rec?.human_review_required).toBe(true);
    expect(rec?.visibility).toBe("internal");
    expect(rec?.status).toBe("draft");
  });

  it("can recommend gathering more data instead of a correction", async () => {
    const provider = new StubProvider();
    provider.results["ai.generate-recommendations.v1"] = {
      recommendations: [
        {
          candidate_key: "rec3",
          proposed_correction: "Сначала собрать дополнительные данные",
          rationale: "недостаточно evidence",
          target_refs: [],
          score_card_ref: null,
          risk_notes: "",
          human_review_required: false,
          missing_evidence: ["недостаточно независимых контекстов"],
          rank_rationale: "insufficient data",
        },
      ],
    };

    const ids = await generateRecommendations(specialist.client, provider, {
      organizationId: orgId,
      clientId,
      clientRequestId: requestId,
      activeClientRequest: "Запрос",
      approvedEntities: [],
      resources: [],
      developmentTargets: [],
      scoreCards: [],
      risks: [],
      priorCorrections: [],
      allowedInterventionMethods: [],
    });

    expect(ids).toHaveLength(1);
    const { data: rec } = await specialist.client
      .from("recommendations")
      .select("final_priority_score, missing_evidence, proposed_correction")
      .eq("id", ids[0])
      .maybeSingle();
    expect(rec?.final_priority_score).toBeNull();
    expect(rec?.missing_evidence).toContain("недостаточно независимых контекстов");
    expect(rec?.proposed_correction).toBe("Сначала собрать дополнительные данные");
  });
});
