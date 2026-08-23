import { describe, expect, it } from "vitest";
import { classifySafety, guardAiOutput, toPossibleAssociation } from "@/lib/service/safety";

describe("safety classifier (ticket 59)", () => {
  it("flags sensitive cases for review", () => {
    const result = classifySafety("у клиента суицидальные мысли");
    expect(result.categories).toContain("suicide");
    expect(result.reviewRequired).toBe(true);
  });

  it("blocks forbidden medical causality (SPEC §56)", () => {
    const guard = guardAiOutput("подавленная злость вызвала повышенное давление");
    expect(guard.blocked).toBe(true);
    expect(guard.reason).toBe("medical_causality");
  });

  it("blocks medical promises", () => {
    const guard = guardAiOutput("мы вылечим ваше давление");
    expect(guard.blocked).toBe(true);
    expect(guard.reason).toBe("medical_promise_or_diagnosis");
  });

  it("keeps a possible association, not a causal claim", () => {
    expect(guardAiOutput("возможная психологическая ассоциация").blocked).toBe(false);
    const downgraded = toPossibleAssociation("подавленная злость вызвала давление");
    expect(downgraded).toContain("возможная психологическая ассоциация");
  });
});
