import { describe, expect, it } from "vitest";
import {
  clampScore,
  finalPriorityScore,
  scoreBreakdown,
  systemicLeverageScore,
  SCORING_MODEL_VERSION,
} from "@/lib/service/scoring";

const full = {
  rootnessScore: 50,
  impactScore: 50,
  activationScore: 50,
  confidenceScore: 50,
  clientRelevanceScore: 50,
  readinessScore: 50,
  unlockScore: 50,
  riskScore: 50,
};

describe("finalPriorityScore", () => {
  it("is deterministic for identical inputs", () => {
    expect(finalPriorityScore(full)).toBe(finalPriorityScore(full));
  });

  it("returns null when any required input is missing", () => {
    expect(finalPriorityScore({ ...full, impactScore: null })).toBeNull();
  });

  it("stays within 0–100", () => {
    expect(
      finalPriorityScore({
        ...full,
        riskScore: 100,
        rootnessScore: 100,
        impactScore: 100,
        activationScore: 100,
        confidenceScore: 100,
        clientRelevanceScore: 100,
        readinessScore: 100,
        unlockScore: 100,
      })
    ).toBeLessThanOrEqual(100);
    expect(
      finalPriorityScore({
        rootnessScore: 0,
        impactScore: 0,
        activationScore: 0,
        confidenceScore: 0,
        clientRelevanceScore: 0,
        readinessScore: 0,
        unlockScore: 0,
        riskScore: 0,
      })
    ).toBe(0);
  });

  it("matches the SPEC §16 formula (the §34 example figure 83.2 is off by ~4; formula gives 79.2)", () => {
    const score = finalPriorityScore({
      rootnessScore: 92,
      impactScore: 88,
      activationScore: 79,
      confidenceScore: 83,
      clientRelevanceScore: 94,
      readinessScore: 70,
      unlockScore: 86,
      riskScore: 42,
    });
    expect(score).toBe(79.2);
  });
});

describe("scoreBreakdown", () => {
  it("records the model version for explainability", () => {
    expect(scoreBreakdown(full).version).toBe(SCORING_MODEL_VERSION);
  });
});

describe("systemicLeverageScore and clampScore", () => {
  it("clamps to 0–100", () => {
    expect(clampScore(150)).toBe(100);
    expect(clampScore(-10)).toBe(0);
  });

  it("computes systemic leverage deterministically", () => {
    expect(systemicLeverageScore(50, 50, 50, 0)).toBe(50);
  });
});
