import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AiProvider, AiProviderCall, AiProviderResponse } from "@/lib/ai/provider";
import {
  generateClientRecommendations,
  getClientRecommendations,
  reviewRecommendation,
  setRecommendationVisibility,
} from "@/lib/service/recommendations";
import { getClientPortal } from "@/lib/service/client-portal";

try {
  process.loadEnvFile(".env.local");
} catch {
  // no .env.local — the suite will skip
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const available = Boolean(url && anonKey && serviceKey);

const SIGNAL_STATEMENT = "Клиент избегает конфликта с руководителем";
const THEME_NAME = "Избегание конфликта";
const NODE_TITLE = "Страх авторитета";

/** Deterministic AI proposal stub (same shape as the existing AI tests). */
class StubProvider implements AiProvider {
  readonly providerKey = "stub";
  readonly modelSnapshot = "stub-1";
  readonly reasoningEffort = "none";
  results: Record<string, unknown> = {};

  async complete(call: AiProviderCall): Promise<AiProviderResponse> {
    return {
      ok: true,
      output: {
        contract_version: call.contractVersion,
        request_id: (call.envelope as { request_id: string }).request_id,
        warnings: [],
        safety: { review_required: false, categories: [], rationale: "" },
        result: this.results[call.functionId] ?? {},
      },
      inputTokens: 1,
      outputTokens: 1,
    };
  }
}

function proposal(nodeId: string, riskScore: number): Record<string, unknown> {
  return {
    recommendations: [
      {
        candidate_key: "ticket13-candidate",
        proposed_correction: "Работа с внутренней опорой рядом с авторитетной фигурой",
        rationale: "высокий rootness и unlock",
        target_refs: [{ ref: nodeId, role: "primary", expected_effect: "усиление опоры" }],
        score_card_ref: nodeId,
        risk_notes: riskScore >= 80 ? "высокий риск" : "низкий риск",
        human_review_required: false,
        missing_evidence: [],
        rank_rationale: "наибольший системный эффект для текущего запроса",
      },
    ],
  };
}

describe.skipIf(!available)("recommendation review + visibility (ticket 13)", () => {
  const admin = createClient(url!, serviceKey!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const createdUserIds: string[] = [];
  let orgId: string;
  let clientId: string;
  let specialist: { id: string; client: SupabaseClient };
  let readOnly: { id: string; client: SupabaseClient };
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

  /** Evidence → Theme → CoreNode, all created through the real product RPCs. */
  async function seedNodeWithEvidence(suffix: string): Promise<string> {
    const { data: signalId, error: signalError } = await specialist.client.rpc("create_signal", {
      p_org_id: orgId,
      p_client_id: clientId,
      p_signal: {
        source_type: "client_report",
        epistemic_type: "self_report",
        raw_statement: `${SIGNAL_STATEMENT} (${suffix})`,
        evidence_level: "L1_SINGLE_SIGNAL",
      },
    });
    if (signalError) throw new Error(`create_signal failed: ${signalError.message}`);

    const { data: themeIds, error: themeError } = await specialist.client.rpc(
      "apply_ai_theme_proposals",
      {
        p_org_id: orgId,
        p_client_id: clientId,
        p_proposals: [
          {
            action: "create",
            name: `${THEME_NAME} ${suffix}`,
            description: "AI-предложение темы",
            domain: "работа",
            confidence: 60,
            signal_links: [
              {
                signal_id: signalId as string,
                relevance_score: 70,
                link_rationale: "Связь предложена AI",
              },
            ],
          },
        ],
      }
    );
    if (themeError) throw new Error(`apply_ai_theme_proposals failed: ${themeError.message}`);
    const themeId = (themeIds as string[])[0];

    const { data: nodeId, error: nodeError } = await specialist.client.rpc("create_core_node", {
      p_org_id: orgId,
      p_client_id: clientId,
      p_title: `${NODE_TITLE} ${suffix}`,
      p_hypothesis: "рабочая гипотеза узла",
      p_root_domain: "работа",
      p_confidence_score: 55,
    });
    if (nodeError) throw new Error(`create_core_node failed: ${nodeError.message}`);

    const { error: linkError } = await specialist.client.rpc("link_theme_core_node", {
      p_org_id: orgId,
      p_core_node_id: nodeId as string,
      p_theme_id: themeId,
      p_relationship_type: "supports",
      p_confidence: 60,
      p_link_rationale: "Связь подтверждена специалистом",
    });
    if (linkError) throw new Error(`link_theme_core_node failed: ${linkError.message}`);

    // A human-confirmed node with a complete score card (the deterministic
    // ranking input of SPEC §16). Seeded with the service role: the review screen
    // is not the subject of this test, the score card is its input.
    const { error: scoreError } = await admin
      .from("core_nodes")
      .update({
        status: "active",
        rootness_score: 92,
        impact_score: 88,
        activation_score: 79,
        confidence_score: 83,
        client_relevance_score: 94,
        readiness_score: 70,
        unlock_score: 86,
        risk_score: 42,
      })
      .eq("id", nodeId as string);
    if (scoreError) throw new Error(`core node score seed failed: ${scoreError.message}`);

    return nodeId as string;
  }

  beforeAll(async () => {
    const owner = await createUser(`owner-${crypto.randomUUID()}@example.com`);
    const { data } = await owner.client.rpc("create_organization", { org_name: "Ticket 13 Org" });
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
      p_display_name: "Ticket 13 Client",
    });
    clientId = cid;

    await specialist.client.from("client_assignments").insert({
      client_id: clientId,
      user_id: specialist.id,
      access_role: "primary_specialist",
    });

    const { error: requestError } = await specialist.client.from("client_requests").insert({
      organization_id: orgId,
      client_id: clientId,
      title: "Запрос на устойчивость",
      status: "active",
    });
    if (requestError) throw new Error(requestError.message);

    await admin.from("consent_records").insert([
      {
        organization_id: orgId,
        client_id: clientId,
        consent_type: "ai_analysis",
        document_version: "1.0",
      },
      {
        organization_id: orgId,
        client_id: clientId,
        consent_type: "client_portal",
        document_version: "1.0",
      },
    ]);

    readOnly = await createUser(`readonly-${crypto.randomUUID()}@example.com`);
    await admin.from("organization_members").insert({
      organization_id: orgId,
      user_id: readOnly.id,
      role: "supervisor",
      status: "active",
    });
    await admin.from("client_assignments").insert({
      client_id: clientId,
      user_id: readOnly.id,
      access_role: "read_only",
    });

    unassigned = await createUser(`unassigned-${crypto.randomUUID()}@example.com`);
    await admin.from("organization_members").insert({
      organization_id: orgId,
      user_id: unassigned.id,
      role: "specialist",
      status: "active",
    });
  });

  afterAll(async () => {
    for (const id of createdUserIds) {
      await admin.auth.admin.deleteUser(id);
    }
  });

  it("generates drafts through the existing AI service and reviews them explicitly", async () => {
    const nodeId = await seedNodeWithEvidence("A");
    const provider = new StubProvider();
    provider.results["ai.generate-recommendations.v1"] = proposal(nodeId, 5);

    const ids = await generateClientRecommendations(specialist.client, provider, {
      organizationId: orgId,
      clientId,
    });
    expect(ids).toHaveLength(1);

    const views = await getClientRecommendations(specialist.client, {
      organizationId: orgId,
      clientId,
    });
    const view = views.find((item) => item.id === ids[0]);
    expect(view).toBeDefined();
    // AI output is a draft and stays internal until a human decides.
    expect(view?.status).toBe("draft");
    expect(view?.visibility).toBe("internal");
    expect(view?.humanReviewRequired).toBe(false);
    expect(view?.finalPriorityScore).toBe(79.2);
    expect(view?.systemicLeverageScore).toBe(80.6);

    // The recommendation references the allowed evidence of its target.
    expect(view?.targets).toHaveLength(1);
    const target = view?.targets[0];
    expect(target?.kind).toBe("core_node");
    expect(target?.label).toContain(NODE_TITLE);
    expect(target?.evidence?.supporting.map((item) => item.label).join(" ")).toContain(
      SIGNAL_STATEMENT
    );
    // The limits of the referenced data are always attached, never hidden.
    expect(Array.isArray(target?.evidence?.limits)).toBe(true);
    expect(target?.evidence?.hasSupportingEvidence).toBe(true);

    // A draft can never be published, even by the specialist who wrote it.
    await expect(
      setRecommendationVisibility(specialist.client, orgId, {
        id: view!.id,
        visibility: "client_visible",
      })
    ).rejects.toThrow();

    // Rejecting without a reason is refused before the database is touched.
    await expect(
      reviewRecommendation(specialist.client, orgId, { id: view!.id, decision: "reject" })
    ).rejects.toThrow();

    await reviewRecommendation(specialist.client, orgId, {
      id: view!.id,
      decision: "approve",
      reason: "Проверено на сессии",
    });

    const reviewed = (
      await getClientRecommendations(specialist.client, { organizationId: orgId, clientId })
    ).find((item) => item.id === view!.id);
    expect(reviewed?.status).toBe("approved");
    expect(reviewed?.reviewedBy).toBe(specialist.id);
    expect(reviewed?.reviewedAt).toBeTruthy();

    // A reviewed recommendation is never re-decided silently.
    await expect(
      reviewRecommendation(specialist.client, orgId, {
        id: view!.id,
        decision: "reject",
        reason: "x",
      })
    ).rejects.toThrow();

    const { data: audit } = await admin
      .from("audit_log")
      .select("action, actor_user_id, reason")
      .eq("entity_id", view!.id)
      .eq("action", "recommendation.approve")
      .single();
    expect(audit?.actor_user_id).toBe(specialist.id);
    expect(audit?.reason).toBe("Проверено на сессии");
  });

  it("publishes only after review and keeps private reasoning out of the portal projection", async () => {
    const nodeId = await seedNodeWithEvidence("B");
    const provider = new StubProvider();
    provider.results["ai.generate-recommendations.v1"] = proposal(nodeId, 5);

    const [recommendationId] = await generateClientRecommendations(specialist.client, provider, {
      organizationId: orgId,
      clientId,
    });

    await reviewRecommendation(specialist.client, orgId, {
      id: recommendationId,
      decision: "approve",
      reason: "Одобрено к публикации",
    });
    await setRecommendationVisibility(specialist.client, orgId, {
      id: recommendationId,
      visibility: "client_visible",
      reason: "Согласовано с клиентом",
    });

    const views = await getClientRecommendations(specialist.client, {
      organizationId: orgId,
      clientId,
    });
    const view = views.find((item) => item.id === recommendationId);
    expect(view?.visibility).toBe("client_visible");

    const { data: audit } = await admin
      .from("audit_log")
      .select("action, reason")
      .eq("entity_id", recommendationId)
      .eq("action", "recommendation.published")
      .single();
    expect(audit?.reason).toBe("Согласовано с клиентом");

    // The published projection carries no private specialist reasoning.
    const portal = await getClientPortal(specialist.client, { clientId });
    const published = portal.clientVisibleRecommendations.find(
      (item) => item.id === recommendationId
    );
    expect(published?.proposed_correction).toContain("внутренней опорой");
    expect(published?.final_priority_score).toBe(79.2);
    expect(Object.keys(published ?? {}).sort()).toEqual([
      "final_priority_score",
      "id",
      "proposed_correction",
    ]);

    // Withdrawing the publication removes it again.
    await setRecommendationVisibility(specialist.client, orgId, {
      id: recommendationId,
      visibility: "internal",
      reason: "Клиент попросил паузу",
    });
    const afterWithdraw = await getClientPortal(specialist.client, { clientId });
    expect(
      afterWithdraw.clientVisibleRecommendations.find((item) => item.id === recommendationId)
    ).toBeUndefined();
  });

  it("keeps a high-risk recommendation internal even after human approval", async () => {
    const nodeId = await seedNodeWithEvidence("C");
    const provider = new StubProvider();
    provider.results["ai.generate-recommendations.v1"] = proposal(nodeId, 5);

    // A high-risk score card forces human_review_required inside the RPC.
    const { error: riskError } = await admin
      .from("core_nodes")
      .update({ risk_score: 90 })
      .eq("id", nodeId);
    if (riskError) throw new Error(riskError.message);

    const [recommendationId] = await generateClientRecommendations(specialist.client, provider, {
      organizationId: orgId,
      clientId,
    });

    const view = (
      await getClientRecommendations(specialist.client, { organizationId: orgId, clientId })
    ).find((item) => item.id === recommendationId);
    expect(view?.humanReviewRequired).toBe(true);

    await reviewRecommendation(specialist.client, orgId, {
      id: recommendationId,
      decision: "approve",
      reason: "Одобрено с оговорками",
    });

    await expect(
      setRecommendationVisibility(specialist.client, orgId, {
        id: recommendationId,
        visibility: "client_visible",
        reason: "попытка публикации",
      })
    ).rejects.toThrow();
  });

  it("denies review and visibility to read-only and unassigned members in the database", async () => {
    const nodeId = await seedNodeWithEvidence("D");
    const provider = new StubProvider();
    provider.results["ai.generate-recommendations.v1"] = proposal(nodeId, 5);

    const [recommendationId] = await generateClientRecommendations(specialist.client, provider, {
      organizationId: orgId,
      clientId,
    });

    const readOnlyReview = await readOnly.client.rpc("review_recommendation", {
      p_org_id: orgId,
      p_recommendation_id: recommendationId,
      p_decision: "approve",
      p_reason: null,
    });
    expect(readOnlyReview.error?.code).toBe("42501");

    const unassignedReview = await unassigned.client.rpc("review_recommendation", {
      p_org_id: orgId,
      p_recommendation_id: recommendationId,
      p_decision: "approve",
      p_reason: null,
    });
    expect(unassignedReview.error?.code).toBe("42501");

    // A read-only member has assigned read access but can never write: the
    // recommendation stays a draft after the refused calls above.
    const { data: readable, error: readError } = await readOnly.client
      .from("recommendations")
      .select("id, status")
      .eq("client_id", clientId);
    expect(readError).toBeNull();
    expect((readable ?? []).length).toBeGreaterThan(0);
    expect((readable ?? []).find((row) => row.id === recommendationId)?.status).toBe("draft");

    const { data: unchanged } = await admin
      .from("recommendations")
      .select("status, visibility")
      .eq("id", recommendationId)
      .single();
    expect(unchanged?.status).toBe("draft");
    expect(unchanged?.visibility).toBe("internal");
  });

  it("keeps an insufficient-data proposal unranked instead of inventing a conclusion", async () => {
    const provider = new StubProvider();
    provider.results["ai.generate-recommendations.v1"] = {
      recommendations: [
        {
          candidate_key: "ticket13-insufficient",
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

    // A resource changes the AI context, so this call is not an idempotent
    // repeat of the previous test's run (the gateway caches identical inputs).
    const { error: resourceError } = await specialist.client.rpc("create_resource", {
      p_org_id: orgId,
      p_client_id: clientId,
      p_name: "Ресурс без evidence",
      p_description: null,
      p_domain: null,
      p_strength_score: null,
      p_confidence_score: null,
      p_evidence_summary: null,
    });
    if (resourceError) throw new Error(`create_resource failed: ${resourceError.message}`);

    const [recommendationId] = await generateClientRecommendations(specialist.client, provider, {
      organizationId: orgId,
      clientId,
    });

    const view = (
      await getClientRecommendations(specialist.client, { organizationId: orgId, clientId })
    ).find((item) => item.id === recommendationId);

    expect(view?.finalPriorityScore).toBeNull();
    expect(view?.systemicLeverageScore).toBeNull();
    expect(view?.targets).toEqual([]);
    expect(view?.missingEvidence).toContain("недостаточно независимых контекстов");
    expect(view?.status).toBe("draft");
  });

  it("never exposes recommendations to a Client Portal identity", async () => {
    const nodeId = await seedNodeWithEvidence("E");
    const provider = new StubProvider();
    provider.results["ai.generate-recommendations.v1"] = proposal(nodeId, 5);

    const [recommendationId] = await generateClientRecommendations(specialist.client, provider, {
      organizationId: orgId,
      clientId,
    });
    await reviewRecommendation(specialist.client, orgId, {
      id: recommendationId,
      decision: "approve",
      reason: "Одобрено",
    });
    await setRecommendationVisibility(specialist.client, orgId, {
      id: recommendationId,
      visibility: "client_visible",
    });

    // A portal identity is not an organization member: the base table stays
    // unreadable for it, so private reasoning can never leak through RLS.
    const email = `portal-${crypto.randomUUID()}@example.com`;
    const portal = await createUser(email);
    const { error: grantError } = await specialist.client.rpc("create_portal_user", {
      p_client_id: clientId,
      p_email: email,
    });
    if (grantError) throw new Error(`create_portal_user failed: ${grantError.message}`);

    const { data: portalRows, error: portalError } = await portal.client
      .from("recommendations")
      .select("id, rationale, risk_notes, rank_rationale")
      .eq("client_id", clientId);
    expect(portalError).toBeNull();
    expect(portalRows ?? []).toEqual([]);
  });
});
