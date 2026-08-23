import { describe, expect, it } from "vitest";
import { coreNodePriorityScore } from "@/lib/service/overview";

describe("coreNodePriorityScore (ticket 45)", () => {
  it("computes the versioned final priority score from stored component scores", () => {
    const score = coreNodePriorityScore({
      rootness_score: 92,
      impact_score: 88,
      activation_score: 79,
      confidence_score: 83,
      client_relevance_score: 94,
      readiness_score: 70,
      unlock_score: 86,
      risk_score: 42,
    });
    expect(score).toBe(79.2);
  });

  it("returns null when any required component is missing", () => {
    const score = coreNodePriorityScore({
      rootness_score: null,
      impact_score: 88,
      activation_score: 79,
      confidence_score: 83,
      client_relevance_score: 94,
      readiness_score: 70,
      unlock_score: 86,
      risk_score: 42,
    });
    expect(score).toBeNull();
  });
});
