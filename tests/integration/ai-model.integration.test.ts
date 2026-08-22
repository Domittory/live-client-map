import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AiProvider, AiProviderCall, AiProviderResponse } from "@/lib/ai/provider";
import {
  detectContradictions,
  generateDifferentialHypotheses,
  updateCoreNodes,
} from "@/lib/service/ai-model";

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

describe.skipIf(!available)("AI model layer (ticket 35)", () => {
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
    const { data } = await owner.client.rpc("create_organization", { org_name: "AI Model Org" });
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
      p_display_name: "AI Model Client",
    });
    clientId = cid;

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

  it("updateCoreNodes creates an under-review proposal without inflating counts", async () => {
    const provider = new StubProvider();
    provider.results["ai.update-core-nodes.v1"] = {
      core_node_proposals: [
        {
          candidate_key: "n1",
          action: "create",
          existing_core_node_id: null,
          title: "Страх авторитета",
          hypothesis: "страх связан с поиском признания",
          root_domain: "authority",
          proposed_status: "under_review",
          theme_links: [],
          evidence_refs: [],
          contradictions_considered: [],
          confidence: 70,
          rationale: "кластеризация",
        },
      ],
    };

    const ids = await updateCoreNodes(specialist.client, provider, {
      organizationId: orgId,
      clientId,
      approvedThemes: [],
      themeLinks: [],
      existingCoreNodes: [],
      contradictions: [],
      deterministicScoreInputs: {},
      currentClientRequestSummary: "",
    });

    expect(ids).toHaveLength(1);
    const { data: node } = await specialist.client
      .from("core_nodes")
      .select(
        "status, evidence_count, independent_evidence_count, contexts_count, confidence_score"
      )
      .eq("id", ids[0])
      .maybeSingle();
    expect(node?.status).toBe("under_review");
    // AI never inflates counts (SPEC §3.5): counts stay at their defaults.
    expect(node?.evidence_count).toBe(0);
    expect(node?.independent_evidence_count).toBe(0);
    expect(node?.contexts_count).toBe(0);
    expect(node?.confidence_score).toBe(70);
  });

  it("updateCoreNodes never overwrites a confirmed (active) CoreNode", async () => {
    // Human creates and confirms a node.
    const { data: created } = await specialist.client
      .from("core_nodes")
      .insert({
        organization_id: orgId,
        client_id: clientId,
        title: "Подтверждённый узел",
        status: "active",
      })
      .select("id")
      .single();
    const confirmedId = created!.id;

    const provider = new StubProvider();
    provider.results["ai.update-core-nodes.v1"] = {
      core_node_proposals: [
        {
          candidate_key: "n2",
          action: "update",
          existing_core_node_id: confirmedId,
          title: "AI перезаписал узел",
          hypothesis: "изменение без ревью",
          root_domain: null,
          proposed_status: "under_review",
          theme_links: [],
          evidence_refs: [],
          contradictions_considered: [],
          confidence: 90,
          rationale: "attempt",
        },
      ],
    };

    const ids = await updateCoreNodes(specialist.client, provider, {
      organizationId: orgId,
      clientId,
      approvedThemes: [],
      themeLinks: [],
      existingCoreNodes: [],
      contradictions: [],
      deterministicScoreInputs: {},
      currentClientRequestSummary: "",
    });

    // The confirmed node is untouched (no proposal id returned, title unchanged).
    expect(ids).toHaveLength(0);
    const { data: node } = await specialist.client
      .from("core_nodes")
      .select("title, status")
      .eq("id", confirmedId)
      .maybeSingle();
    expect(node?.title).toBe("Подтверждённый узел");
    expect(node?.status).toBe("active");
  });

  it("generateDifferentialHypotheses stores several competing explanations", async () => {
    const provider = new StubProvider();
    provider.results["ai.generate-differential-hypotheses.v1"] = {
      hypotheses: [
        {
          candidate_key: "h1",
          title: "authority/father dynamic",
          description: "гипотеза A",
          confidence: 80,
          evidence_for_refs: [],
          evidence_against_refs: [crypto.randomUUID(), crypto.randomUUID()],
          missing_evidence: [],
          disconfirming_questions: [],
          rationale: "a",
        },
        {
          candidate_key: "h2",
          title: "real workplace threat",
          description: "гипотеза B",
          confidence: 70,
          evidence_for_refs: [],
          evidence_against_refs: [],
          missing_evidence: [],
          disconfirming_questions: [],
          rationale: "b",
        },
        {
          candidate_key: "h3",
          title: "previous firing trauma",
          description: "гипотеза C",
          confidence: 60,
          evidence_for_refs: [],
          evidence_against_refs: [],
          missing_evidence: [],
          disconfirming_questions: [],
          rationale: "c",
        },
      ],
    };

    const ids = await generateDifferentialHypotheses(specialist.client, provider, {
      organizationId: orgId,
      clientId,
      focalEntityRefs: [],
      evidenceFor: [],
      evidenceAgainst: [],
      contextSummary: "",
      existingHypotheses: [],
    });

    expect(ids).toHaveLength(3);
    const { data: rows } = await specialist.client
      .from("differential_hypotheses")
      .select("title, status, confidence_score")
      .in("id", ids);
    const titles = (rows ?? []).map((r) => r.title);
    expect(titles).toContain("authority/father dynamic");
    expect(titles).toContain("real workplace threat");
    expect(titles).toContain("previous firing trauma");
    for (const row of rows ?? []) {
      expect(row.status).toBe("hypothesis");
    }
    // Contradicting evidence lowers confidence: 80 − 2×10 = 60 (SPEC §51.4).
    const contradicted = (rows ?? []).find((r) => r.title === "authority/father dynamic");
    expect(contradicted?.confidence_score).toBe(60);
  });

  it("detectContradictions persists only a cautious `contradicts` relation", async () => {
    const { data: a } = await specialist.client
      .from("core_nodes")
      .insert({ organization_id: orgId, client_id: clientId, title: "Желание лидерства" })
      .select("id")
      .single();
    const { data: b } = await specialist.client
      .from("core_nodes")
      .insert({ organization_id: orgId, client_id: clientId, title: "Страх ответственности" })
      .select("id")
      .single();

    const provider = new StubProvider();
    provider.results["ai.detect-contradictions.v1"] = {
      contradictions: [
        {
          candidate_key: "c1",
          entity_refs_for: [a!.id],
          entity_refs_against: [b!.id],
          description: "желание лидерства vs страх ответственности",
          relevance_score: 75,
          context_refs: ["leadership"],
          rationale: "внутренний конфликт",
          suggested_follow_up: "уточнить контекст",
        },
      ],
    };

    const ids = await detectContradictions(specialist.client, provider, {
      organizationId: orgId,
      clientId,
      reviewedSignals: [],
      themes: [],
      coreNodes: [],
      differentialHypotheses: [],
      existingContradictions: [],
      relevantContexts: [],
    });

    expect(ids).toHaveLength(1);
    const { data: relation } = await specialist.client
      .from("core_node_relations")
      .select("relation_type, from_core_node_id, to_core_node_id")
      .eq("id", ids[0])
      .maybeSingle();
    expect(relation?.relation_type).toBe("contradicts");
    expect(relation?.from_core_node_id).toBe(a!.id);
    expect(relation?.to_core_node_id).toBe(b!.id);
  });
});
