import { describe, expect, it } from "vitest";
import { AI_CONTRACTS, warningCodeSchema } from "@/lib/ai/contracts";
import {
  clusterByTopicAndContext,
  canonicalContextKey,
  evidenceLevelFromCluster,
} from "@/lib/service/clustering";
import {
  canBeEffective,
  collectMissingEvidence,
  hasSufficientEvidence,
} from "@/lib/service/follow-ups";
import { confidenceWithContradictions } from "@/lib/service/hypotheses";
import { RELATION_TYPES } from "@/lib/service/relations";
import { guardAiOutput } from "@/lib/service/safety";
import { finalPriorityScore } from "@/lib/service/scoring";
import {
  EVIDENCE_LEVELS,
  confidenceFromEvidenceLevel,
  contributesIndependentEvidence,
  interpretSignal,
} from "@/lib/service/signal-interpretation";

const ID = "123e4567-e89b-12d3-a456-426614174000";

const EMPTY_SCORE = {
  rootnessScore: null,
  impactScore: null,
  activationScore: null,
  confidenceScore: null,
  clientRelevanceScore: null,
  readinessScore: null,
  unlockScore: null,
  riskScore: null,
};

describe("SPEC §51 — intellectual correctness criteria (51.1–51.9)", () => {
  it("51.1 — AI-гипотеза не считается evidence", () => {
    expect(contributesIndependentEvidence("L0_AI_ONLY")).toBe(false);
    expect(confidenceFromEvidenceLevel("L0_AI_ONLY")).toBe(0);
    // The contract may label an AI-proposed level as L0, but L0 never raises confidence.
    expect(EVIDENCE_LEVELS).toContain("L0_AI_ONLY");
    expect(confidenceFromEvidenceLevel("L0_AI_ONLY")).toBeLessThan(
      confidenceFromEvidenceLevel("L1_SINGLE_SIGNAL")
    );
  });

  it("51.2 — 20 синонимичных Signals не считаются 20 независимыми подтверждениями", () => {
    const signals = Array.from({ length: 20 }, () => ({
      semanticTopic: "authority_fear",
      contextKey: canonicalContextKey({ diagnosticSessionId: "s1", lifeArea: "work" }),
    }));
    const clusters = clusterByTopicAndContext(signals);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].signalsCount).toBe(20);
    expect(clusters[0].independentContextsCount).toBe(1);
    expect(evidenceLevelFromCluster(20, 1)).toBe("L2_MULTIPLE_SIGNALS");
  });

  it("51.3 — не создаётся медицинская причинность", () => {
    const guard = guardAiOutput("подавленная злость вызвала повышенное давление");
    expect(guard.blocked).toBe(true);
    expect(guard.reason).toBe("medical_causality");
    // The relationship vocabulary forbids causal claims; only a human can confirm one.
    expect(RELATION_TYPES).not.toContain("causes");
    expect(RELATION_TYPES).not.toContain("causes_confirmed");
  });

  it("51.4 — противоречащие данные понижают confidence", () => {
    expect(confidenceWithContradictions(80, 0)).toBe(80);
    expect(confidenceWithContradictions(80, 2)).toBe(60);
    expect(confidenceWithContradictions(5, 2)).toBe(0); // floor at 0
  });

  it("51.5 — система говорит «данных недостаточно»", () => {
    const r = interpretSignal("unknown", "stress");
    expect(r.normalizedMeaning).toContain("Недостаточно данных");
    // Missing data must never force a ranking.
    expect(finalPriorityScore(EMPTY_SCORE)).toBeNull();
  });

  it("51.6 — система может менять старую гипотезу, а не только создавать новую", () => {
    const contract = AI_CONTRACTS["ai.update-core-nodes.v1"];
    const proposal = {
      candidate_key: "n1",
      action: "update",
      existing_core_node_id: ID,
      title: "Страх ответственности",
      hypothesis: "обновлённая формулировка на новых данных",
      root_domain: "work",
      proposed_status: "active",
      theme_links: [],
      evidence_refs: [],
      contradictions_considered: [],
      confidence: 55,
      rationale: "обновление старой гипотезы",
    };
    expect(contract.resultSchema.safeParse({ core_node_proposals: [proposal] }).success).toBe(true);
  });

  it("51.7 — предлагается собрать дополнительные данные вместо обязательной коррекции", () => {
    // The model can flag insufficient_data rather than force a correction.
    expect(warningCodeSchema.safeParse("insufficient_data").success).toBe(true);
    expect(finalPriorityScore(EMPTY_SCORE)).toBeNull();

    // The recommendation contract carries missing_evidence as a required field.
    const contract = AI_CONTRACTS["ai.generate-recommendations.v1"];
    const recommendation = {
      candidate_key: "r1",
      proposed_correction: "Сначала собрать данные в нескольких контекстах",
      rationale: "мало evidence для коррекции",
      target_refs: [{ ref: ID, role: "core_node", expected_effect: "проверить гипотезу" }],
      score_card_ref: null,
      risk_notes: "",
      human_review_required: false,
      missing_evidence: ["retest_result", "observations"],
      rank_rationale: "недостаточно данных для ранжирования",
    };
    expect(contract.resultSchema.safeParse({ recommendations: [recommendation] }).success).toBe(
      true
    );
  });

  it("51.8 — различаются problem reduction и resource development", () => {
    // Problem reduction: positive + stress is a charged problem, not a resource.
    expect(interpretSignal("positive", "stress").isResourceHint).toBe(false);
    // Resource development: positive + no_stress is a possible resource hint.
    expect(interpretSignal("positive", "no_stress").isResourceHint).toBe(true);
    // Resource development is a separate AI function from core-node (problem) updates.
    expect(AI_CONTRACTS["ai.update-resources.v1"]).toBeDefined();
    expect(AI_CONTRACTS["ai.update-core-nodes.v1"]).toBeDefined();
  });

  it("51.9 — CoreNode не считается integrated без follow-up evidence", () => {
    const noEvidence = {
      hasRetest: false,
      hasBehavioralResult: false,
      observationCount: 0,
      measuredMarkerCount: 0,
    };
    expect(hasSufficientEvidence(noEvidence)).toBe(false);
    expect(canBeEffective(noEvidence)).toBe(false);
    expect(collectMissingEvidence(noEvidence)).toContain("retest_result");

    const withRetest = { ...noEvidence, hasRetest: true };
    expect(canBeEffective(withRetest)).toBe(true);
  });
});
