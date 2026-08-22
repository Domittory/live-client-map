import { describe, expect, it } from "vitest";
import {
  confidenceFromEvidenceLevel,
  contributesIndependentEvidence,
  interpretSignal,
} from "@/lib/service/signal-interpretation";

describe("interpretSignal (SPEC §12 matrix)", () => {
  it("positive + stress => stress around access, no resource, no opposite assertion", () => {
    const r = interpretSignal("positive", "stress");
    expect(r.isResourceHint).toBe(false);
    expect(r.normalizedMeaning).toContain("Стресс вокруг доступа");
    // SPEC §4: it must NOT assert the opposite belief as fact.
    expect(r.inferredOpposite).toContain("не доказано");
  });

  it("positive + no_stress => possible resource hint (not automatic)", () => {
    const r = interpretSignal("positive", "no_stress");
    expect(r.isResourceHint).toBe(true);
    expect(r.inferredOpposite).toBeNull();
  });

  it("negative + stress => active charge", () => {
    const r = interpretSignal("negative", "stress");
    expect(r.normalizedMeaning).toContain("Активный заряд");
  });

  it("negative + no_stress => no active stress now", () => {
    const r = interpretSignal("negative", "no_stress");
    expect(r.normalizedMeaning).toContain("Нет активного стресса");
  });

  it("neutral + stress => context investigation required", () => {
    const r = interpretSignal("neutral", "stress");
    expect(r.requiresInvestigation).toBe(true);
  });

  it("unknown polarity => insufficient data", () => {
    const r = interpretSignal("unknown", "stress");
    expect(r.requiresInvestigation).toBe(true);
    expect(r.normalizedMeaning).toContain("Недостаточно данных");
  });
});

describe("evidence levels", () => {
  it("L0 AI-only contributes no independent evidence and no confidence", () => {
    expect(contributesIndependentEvidence("L0_AI_ONLY")).toBe(false);
    expect(confidenceFromEvidenceLevel("L0_AI_ONLY")).toBe(0);
  });

  it("higher levels raise confidence deterministically", () => {
    expect(confidenceFromEvidenceLevel("L1_SINGLE_SIGNAL")).toBe(20);
    expect(confidenceFromEvidenceLevel("L3_MULTI_CONTEXT")).toBe(60);
    expect(confidenceFromEvidenceLevel("L6_CORRECTION_RESPONSE_CONFIRMED")).toBe(95);
  });

  it("L1 and above contribute independent evidence", () => {
    expect(contributesIndependentEvidence("L1_SINGLE_SIGNAL")).toBe(true);
    expect(contributesIndependentEvidence("L7_SPECIALIST_CONFIRMED_LONGITUDINAL")).toBe(true);
  });
});
