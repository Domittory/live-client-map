import { describe, expect, it } from "vitest";
import {
  RISK_REVIEW_THRESHOLD,
  computeRecommendationScores,
  riskGate,
} from "@/lib/service/ai-recommendations";
import type { ScoreInputs } from "@/lib/service/scoring";

// SPEC §34 example inputs; formula §16 gives final 79.2 (see ticket 28 note).
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

describe("recommendation ranking (ticket 37)", () => {
  it("reproduces the deterministic final priority and systemic leverage", () => {
    const scores = computeRecommendationScores(EXAMPLE);
    expect(scores.finalPriorityScore).toBe(79.2);
    expect(scores.systemicLeverageScore).toBe(80.6);
  });

  it("returns null scores when any required input is missing", () => {
    const scores = computeRecommendationScores(EMPTY);
    expect(scores.finalPriorityScore).toBeNull();
    expect(scores.systemicLeverageScore).toBeNull();
  });

  it("forces human review at the risk threshold (>= 80)", () => {
    expect(RISK_REVIEW_THRESHOLD).toBe(80);
    expect(riskGate({ ...EXAMPLE, riskScore: 80 }, false)).toBe(true);
    expect(riskGate({ ...EXAMPLE, riskScore: 79 }, false)).toBe(false);
  });

  it("honours an explicit AI human-review flag even below the threshold", () => {
    expect(riskGate({ ...EXAMPLE, riskScore: 10 }, true)).toBe(true);
    expect(riskGate({ ...EXAMPLE, riskScore: 10 }, false)).toBe(false);
  });
});
