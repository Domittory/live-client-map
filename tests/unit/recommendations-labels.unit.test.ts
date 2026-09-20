import { describe, expect, it } from "vitest";
import {
  RECOMMENDATION_STATUSES,
  RECOMMENDATION_VISIBILITIES,
} from "@/lib/service/recommendations";
import {
  INSUFFICIENT_RANKING_LABEL,
  RECOMMENDATION_ROLE_LABELS,
  RECOMMENDATION_STATUS_LABELS,
  RECOMMENDATION_TARGET_KIND_LABELS,
  RECOMMENDATION_VISIBILITY_LABELS,
  SCORE_COMPONENT_LABELS,
  canPublishRecommendation,
  canUnpublishRecommendation,
  isRecommendationReviewable,
  orderRecommendations,
  rankingExplanation,
  recommendationLimits,
} from "@/lib/service/recommendations-presentation";
import { PRIORITY_WEIGHTS, type ScoreInputs } from "@/lib/service/scoring";

/**
 * Ticket 13: label coverage, the explainable-ranking rule and the limits rule
 * for the Recommendations screen.
 *
 * The ranking must be reproducible from stored scores (SPEC §16), an incomplete
 * score card must never produce a priority, and a Recommendation without
 * evidence must never be rendered as a conclusion. The publishability rules pin
 * SPEC §20/§36: only a human-approved, non-high-risk Recommendation can reach the
 * Client Portal.
 */

// SPEC §34 example; the §16 formula gives 79.2 and leverage 80.6 (ticket 28).
const EXAMPLE: ScoreInputs = {
  rootnessScore: 92,
  impactScore: 88,
  activationScore: 79,
  confidenceScore: 83,
  clientRelevanceScore: 94,
  readinessScore: 70,
  unlockScore: 86,
  riskScore: 42,
};

const EMPTY: ScoreInputs = {
  rootnessScore: null,
  impactScore: null,
  activationScore: null,
  confidenceScore: null,
  clientRelevanceScore: null,
  readinessScore: null,
  unlockScore: null,
  riskScore: null,
};

const ROLES = ["primary", "secondary", "downstream", "resource", "context"];
const TARGET_KINDS = [
  "core_node",
  "theme",
  "differential_hypothesis",
  "resource",
  "development_target",
];

describe("rankingExplanation", () => {
  it("reproduces the final priority from the SPEC §16 weights", () => {
    const explanation = rankingExplanation(EXAMPLE, {
      version: "1.0.0",
      systemicLeverageScore: 80.6,
    });
    expect(explanation.finalPriorityScore).toBe(79.2);
    expect(explanation.systemicLeverageScore).toBe(80.6);
    expect(explanation.version).toBe("1.0.0");
    expect(explanation.explainable).toBe(true);
    expect(explanation.missingComponents).toEqual([]);
    expect(explanation.components).toHaveLength(8);
  });

  it("exposes each component with its weight and contribution", () => {
    const explanation = rankingExplanation(EXAMPLE);
    const rootness = explanation.components.find((c) => c.key === "rootnessScore");
    expect(rootness?.label).toBe(SCORE_COMPONENT_LABELS.rootnessScore);
    expect(rootness?.score).toBe(92);
    expect(rootness?.weight).toBe(PRIORITY_WEIGHTS.rootness);
    expect(rootness?.contribution).toBe(16.6);

    // Risk is subtracted, exactly like the SPEC formula.
    const risk = explanation.components.find((c) => c.key === "riskScore");
    expect(risk?.weight).toBeLessThan(0);
    expect(risk?.contribution).toBe(-2.1);
  });

  it("refuses to rank an incomplete score card and names the missing components", () => {
    const explanation = rankingExplanation(EMPTY, { version: "1.0.0" });
    expect(explanation.finalPriorityScore).toBeNull();
    expect(explanation.explainable).toBe(false);
    expect(explanation.missingComponents).toHaveLength(8);
    expect(explanation.components.every((component) => component.contribution === null)).toBe(true);
  });
});

describe("orderRecommendations", () => {
  it("orders by priority, keeps unranked last and is deterministic", () => {
    const ordered = orderRecommendations([
      { id: "unranked", finalPriorityScore: null, createdAt: "2026-01-03T00:00:00Z" },
      { id: "low", finalPriorityScore: 40, createdAt: "2026-01-02T00:00:00Z" },
      { id: "high", finalPriorityScore: 90, createdAt: "2026-01-01T00:00:00Z" },
      { id: "high-newer", finalPriorityScore: 90, createdAt: "2026-01-04T00:00:00Z" },
    ]);
    expect(ordered.map((item) => item.id)).toEqual(["high-newer", "high", "low", "unranked"]);
  });
});

describe("recommendationLimits", () => {
  it("reports no evidence when the recommendation has no target", () => {
    const result = recommendationLimits({
      status: "approved",
      targetCount: 0,
      unresolvedTargetCount: 0,
      supportingEvidenceCount: 0,
      missingEvidence: [],
      finalPriorityScore: 50,
      riskScore: 10,
      humanReviewRequired: false,
    });
    expect(result.hasEvidence).toBe(false);
    expect(result.limits.join(" ")).toContain("не ссылается на цели");
    expect(result.limits.join(" ")).toContain("Нет подтверждающих доказательств");
  });

  it("flags an unreviewed AI draft and an unranked recommendation", () => {
    const result = recommendationLimits({
      status: "draft",
      targetCount: 1,
      unresolvedTargetCount: 0,
      supportingEvidenceCount: 1,
      missingEvidence: [],
      finalPriorityScore: null,
      riskScore: null,
      humanReviewRequired: false,
    });
    expect(result.hasEvidence).toBe(true);
    expect(result.limits.join(" ")).toContain("Предложение AI (L0)");
    expect(result.limits).toContain(INSUFFICIENT_RANKING_LABEL);
  });

  it("surfaces the AI's own missing evidence and unresolved targets", () => {
    const result = recommendationLimits({
      status: "approved",
      targetCount: 2,
      unresolvedTargetCount: 1,
      supportingEvidenceCount: 3,
      missingEvidence: ["нет независимых контекстов"],
      finalPriorityScore: 70,
      riskScore: 20,
      humanReviewRequired: false,
    });
    expect(result.limits.join(" ")).toContain("нет независимых контекстов");
    expect(result.limits.join(" ")).toContain("Не удалось прочитать 1 из целей");
  });

  it("keeps a high-risk recommendation internal and flagged", () => {
    const result = recommendationLimits({
      status: "draft",
      targetCount: 1,
      unresolvedTargetCount: 0,
      supportingEvidenceCount: 1,
      missingEvidence: [],
      finalPriorityScore: 55,
      riskScore: 90,
      humanReviewRequired: true,
    });
    expect(result.limits.join(" ")).toContain("Высокий риск");
    expect(result.limits.join(" ")).toContain("публикация клиенту запрещена");
  });

  it("flags a rejected recommendation as not confirmed", () => {
    const result = recommendationLimits({
      status: "rejected",
      targetCount: 1,
      unresolvedTargetCount: 0,
      supportingEvidenceCount: 2,
      missingEvidence: [],
      finalPriorityScore: 60,
      riskScore: 10,
      humanReviewRequired: false,
    });
    expect(result.limits.join(" ")).toContain("Отклонена человеком");
  });
});

describe("human-in-the-loop rules", () => {
  it("only reviews a still-draft recommendation", () => {
    expect(isRecommendationReviewable("draft")).toBe(true);
    expect(isRecommendationReviewable("approved")).toBe(false);
    expect(isRecommendationReviewable("rejected")).toBe(false);
  });

  it("only publishes an approved, non-high-risk recommendation", () => {
    expect(
      canPublishRecommendation({
        status: "approved",
        humanReviewRequired: false,
        visibility: "internal",
      })
    ).toBe(true);
    expect(
      canPublishRecommendation({
        status: "draft",
        humanReviewRequired: false,
        visibility: "internal",
      })
    ).toBe(false);
    expect(
      canPublishRecommendation({
        status: "approved",
        humanReviewRequired: true,
        visibility: "internal",
      })
    ).toBe(false);
    expect(
      canPublishRecommendation({
        status: "approved",
        humanReviewRequired: false,
        visibility: "client_visible",
      })
    ).toBe(false);
  });

  it("offers a withdraw control only for a published recommendation", () => {
    expect(
      canUnpublishRecommendation({
        status: "approved",
        humanReviewRequired: false,
        visibility: "client_visible",
      })
    ).toBe(true);
    expect(
      canUnpublishRecommendation({
        status: "approved",
        humanReviewRequired: false,
        visibility: "internal",
      })
    ).toBe(false);
  });
});

describe("label coverage", () => {
  it("labels every recommendation state, visibility, role and target kind", () => {
    for (const value of RECOMMENDATION_STATUSES) {
      expect(RECOMMENDATION_STATUS_LABELS[value]).toBeTruthy();
    }
    for (const value of RECOMMENDATION_VISIBILITIES) {
      expect(RECOMMENDATION_VISIBILITY_LABELS[value]).toBeTruthy();
    }
    for (const value of ROLES) {
      expect(RECOMMENDATION_ROLE_LABELS[value]).toBeTruthy();
    }
    for (const value of TARGET_KINDS) {
      expect(RECOMMENDATION_TARGET_KIND_LABELS[value]).toBeTruthy();
    }
    for (const value of Object.keys(SCORE_COMPONENT_LABELS)) {
      expect(SCORE_COMPONENT_LABELS[value]).toBeTruthy();
    }
  });
});
