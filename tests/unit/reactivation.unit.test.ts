import { describe, expect, it } from "vitest";
import {
  evaluateReactivation,
  type ReactivationSignalEvidence,
  type ReactivationTriggerEvidence,
} from "@/lib/service/reactivation";
import { REACTIVATION_CONFIG } from "@/lib/service/scoring";
import type { EvidenceLevel } from "@/lib/service/signal-interpretation";

const NOW = new Date("2026-08-23T00:00:00.000Z");
const DAY_MS = 24 * 60 * 60 * 1000;

function iso(daysAgo: number): string {
  return new Date(NOW.getTime() - daysAgo * DAY_MS).toISOString();
}

let nextId = 0;
function fakeUuid(): string {
  nextId += 1;
  return `00000000-0000-4000-8000-${String(nextId).padStart(12, "0")}`;
}

function signal(overrides: {
  daysAgo?: number;
  evidenceLevel?: EvidenceLevel;
  reviewStatus?: string;
  intensity?: number | null;
}): ReactivationSignalEvidence {
  return {
    id: fakeUuid(),
    evidenceLevel: overrides.evidenceLevel ?? "L1_SINGLE_SIGNAL",
    intensity: overrides.intensity ?? 50,
    reviewStatus: overrides.reviewStatus ?? "approved",
    createdAt: iso(overrides.daysAgo ?? 1),
  };
}

function activation(overrides: {
  daysAgo?: number;
  delta?: number | null;
}): ReactivationTriggerEvidence {
  return {
    id: fakeUuid(),
    triggerId: fakeUuid(),
    activationDelta: overrides.delta ?? 20,
    createdAt: iso(overrides.daysAgo ?? 1),
  };
}

describe("evaluateReactivation (ticket 42, SPEC §24)", () => {
  it("proposes reactivation when new score reaches the threshold and increase is sufficient", () => {
    const result = evaluateReactivation(
      {
        status: "weakened",
        activationScore: 25,
        signals: [signal({}), signal({})],
        triggerActivations: [activation({ delta: 20 })],
      },
      REACTIVATION_CONFIG,
      NOW
    );
    // 25 + 20 (trigger) + 2*10 (signals) = 65 >= 60, increase 40 >= 30
    expect(result.eligible).toBe(true);
    expect(result.proposed).toBe(true);
    expect(result.calculation.newScore).toBe(65);
    expect(result.calculation.increase).toBe(40);
    expect(result.configVersion).toBe(REACTIVATION_CONFIG.version);
  });

  it("boundary: score exactly at the activation threshold proposes", () => {
    const result = evaluateReactivation(
      {
        status: "weakened",
        activationScore: 25,
        signals: [signal({})],
        triggerActivations: [activation({ delta: 25 })],
      },
      REACTIVATION_CONFIG,
      NOW
    );
    // 25 + 25 + 10 = 60 — exactly the threshold
    expect(result.calculation.newScore).toBe(60);
    expect(result.proposed).toBe(true);
  });

  it("boundary: score one below the activation threshold does not propose", () => {
    const result = evaluateReactivation(
      {
        status: "weakened",
        activationScore: 25,
        signals: [signal({})],
        triggerActivations: [activation({ delta: 24 })],
      },
      REACTIVATION_CONFIG,
      NOW
    );
    expect(result.calculation.newScore).toBe(59);
    expect(result.proposed).toBe(false);
    expect(result.reason).toContain("ниже порога");
  });

  it("boundary: increase exactly at the minimum proposes", () => {
    const result = evaluateReactivation(
      {
        status: "weakened",
        activationScore: 40,
        signals: [signal({})],
        triggerActivations: [activation({ delta: 20 })],
      },
      REACTIVATION_CONFIG,
      NOW
    );
    // 40 + 20 + 10 = 70 >= 60, increase exactly 30
    expect(result.calculation.increase).toBe(30);
    expect(result.proposed).toBe(true);
  });

  it("boundary: increase one below the minimum does not propose", () => {
    const result = evaluateReactivation(
      {
        status: "weakened",
        activationScore: 40,
        signals: [signal({})],
        triggerActivations: [activation({ delta: 19 })],
      },
      REACTIVATION_CONFIG,
      NOW
    );
    expect(result.calculation.increase).toBe(29);
    expect(result.proposed).toBe(false);
    expect(result.reason).toContain("ниже минимального");
  });

  it("ignores AI-only evidence: L0 signals never trigger reactivation on their own", () => {
    const result = evaluateReactivation(
      {
        status: "weakened",
        activationScore: 25,
        signals: [signal({ evidenceLevel: "L0_AI_ONLY" })],
        triggerActivations: [activation({ delta: 40 })],
      },
      REACTIVATION_CONFIG,
      NOW
    );
    // 25 + 40 = 65 >= 60 by the trigger alone, but no eligible fresh signal
    expect(result.proposed).toBe(false);
    expect(result.calculation.signals).toHaveLength(0);
    expect(result.calculation.excluded.aiOnlySignals).toBe(1);
    expect(result.reason).toContain("AI-only");
  });

  it("ignores stale evidence: signals and triggers older than the window do not count", () => {
    const result = evaluateReactivation(
      {
        status: "weakened",
        activationScore: 25,
        signals: [signal({ daysAgo: 40 })],
        triggerActivations: [activation({ daysAgo: 40, delta: 40 })],
      },
      REACTIVATION_CONFIG,
      NOW
    );
    expect(result.proposed).toBe(false);
    expect(result.calculation.excluded.staleSignals).toBe(1);
    expect(result.calculation.excluded.staleTriggerActivations).toBe(1);
    expect(result.calculation.newScore).toBe(25);
  });

  it("counts evidence exactly at the window edge as fresh", () => {
    const result = evaluateReactivation(
      {
        status: "weakened",
        activationScore: 25,
        signals: [signal({ daysAgo: REACTIVATION_CONFIG.freshEvidenceWindowDays })],
        triggerActivations: [
          activation({ daysAgo: REACTIVATION_CONFIG.freshEvidenceWindowDays, delta: 25 }),
        ],
      },
      REACTIVATION_CONFIG,
      NOW
    );
    expect(result.calculation.newScore).toBe(60);
    expect(result.proposed).toBe(true);
  });

  it("requires a fresh trigger activation: fresh signals alone are not enough", () => {
    const result = evaluateReactivation(
      {
        status: "weakened",
        activationScore: 25,
        signals: [signal({}), signal({}), signal({}), signal({})],
        triggerActivations: [],
      },
      REACTIVATION_CONFIG,
      NOW
    );
    expect(result.proposed).toBe(false);
    expect(result.reason).toContain("trigger");
  });

  it("ignores signals that are not human-approved yet", () => {
    const result = evaluateReactivation(
      {
        status: "weakened",
        activationScore: 25,
        signals: [signal({ reviewStatus: "pending" })],
        triggerActivations: [activation({ delta: 40 })],
      },
      REACTIVATION_CONFIG,
      NOW
    );
    expect(result.proposed).toBe(false);
    expect(result.calculation.excluded.notApprovedSignals).toBe(1);
  });

  it.each(["hypothesis", "active", "in_treatment", "integrated", "reactivated", "archived"])(
    "lifecycle guard: status %s can never be reactivated",
    (status) => {
      const result = evaluateReactivation(
        {
          status,
          activationScore: 25,
          signals: [signal({}), signal({})],
          triggerActivations: [activation({ delta: 50 })],
        },
        REACTIVATION_CONFIG,
        NOW
      );
      expect(result.eligible).toBe(false);
      expect(result.proposed).toBe(false);
      expect(result.reason).toContain("weakened");
    }
  );

  it("treats a missing activation_score as 0 and clamps the new score at 100", () => {
    const result = evaluateReactivation(
      {
        status: "weakened",
        activationScore: null,
        signals: [signal({})],
        triggerActivations: [activation({ delta: 100 })],
      },
      REACTIVATION_CONFIG,
      NOW
    );
    expect(result.calculation.baseScore).toBe(0);
    expect(result.calculation.newScore).toBe(100);
    expect(result.proposed).toBe(true);
  });

  it("is deterministic: same inputs and config give the same result", () => {
    const input = {
      status: "weakened",
      activationScore: 25,
      signals: [signal({})],
      triggerActivations: [activation({ delta: 30 })],
    };
    const first = evaluateReactivation(input, REACTIVATION_CONFIG, NOW);
    const second = evaluateReactivation(input, REACTIVATION_CONFIG, NOW);
    expect(first).toEqual(second);
  });
});
