import { describe, expect, it } from "vitest";
import {
  clusterByTopicAndContext,
  canonicalContextKey,
  evidenceLevelFromCluster,
} from "@/lib/service/clustering";
import {
  interpretSignal,
  type StatementPolarity,
  type TestResult,
} from "@/lib/service/signal-interpretation";

interface SeedSignal {
  semanticTopic: string;
  polarity: StatementPolarity;
  testResult: TestResult;
  lifeArea: string;
  sessionId: string;
}

interface Seed {
  label: string;
  signals: SeedSignal[];
}

// SPEC §57 — three universal seed profiles. They share no topics; the same
// deterministic rules must behave identically across all three (no overfit to
// a single pre-learned theory of the psyche).
const SEEDS: Seed[] = [
  {
    label: "Client A — leadership / authority / money / responsibility",
    signals: [
      {
        semanticTopic: "leadership_authority",
        polarity: "positive",
        testResult: "stress",
        lifeArea: "work",
        sessionId: "a1",
      },
      {
        semanticTopic: "responsibility",
        polarity: "negative",
        testResult: "stress",
        lifeArea: "work",
        sessionId: "a1",
      },
      {
        semanticTopic: "money",
        polarity: "positive",
        testResult: "no_stress",
        lifeArea: "finance",
        sessionId: "a2",
      },
    ],
  },
  {
    label: "Client B — relationships / attachment / jealousy / boundaries",
    signals: [
      {
        semanticTopic: "attachment",
        polarity: "positive",
        testResult: "stress",
        lifeArea: "partner",
        sessionId: "b1",
      },
      {
        semanticTopic: "jealousy",
        polarity: "negative",
        testResult: "stress",
        lifeArea: "partner",
        sessionId: "b1",
      },
      {
        semanticTopic: "boundaries",
        polarity: "positive",
        testResult: "no_stress",
        lifeArea: "family",
        sessionId: "b2",
      },
    ],
  },
  {
    label: "Client C — workaholism / pleasure / money / perfectionism",
    signals: [
      {
        semanticTopic: "workaholism",
        polarity: "positive",
        testResult: "stress",
        lifeArea: "work",
        sessionId: "c1",
      },
      {
        semanticTopic: "perfectionism",
        polarity: "negative",
        testResult: "stress",
        lifeArea: "work",
        sessionId: "c1",
      },
      {
        semanticTopic: "pleasure",
        polarity: "positive",
        testResult: "no_stress",
        lifeArea: "leisure",
        sessionId: "c2",
      },
    ],
  },
];

describe("SPEC §57 — universal seed profiles", () => {
  it("covers leadership (A), relationships (B) and workaholism (C) as distinct profiles", () => {
    const topics = SEEDS.map((seed) => new Set(seed.signals.map((s) => s.semanticTopic)));
    expect(SEEDS).toHaveLength(3);
    expect(topics[0]).not.toEqual(topics[1]);
    expect(topics[1]).not.toEqual(topics[2]);
    expect(topics[0]).not.toEqual(topics[2]);
  });

  it("applies the same interpretation rules across all three profiles (no overfit)", () => {
    for (const seed of SEEDS) {
      for (const signal of seed.signals) {
        const r = interpretSignal(signal.polarity, signal.testResult);
        if (signal.polarity === "positive" && signal.testResult === "stress") {
          expect(r.normalizedMeaning).toContain("Стресс вокруг доступа");
          expect(r.isResourceHint).toBe(false);
        }
        if (signal.polarity === "positive" && signal.testResult === "no_stress") {
          expect(r.isResourceHint).toBe(true);
        }
        if (signal.polarity === "negative" && signal.testResult === "stress") {
          expect(r.normalizedMeaning).toContain("Активный заряд");
        }
      }
    }
  });

  it("collapses synonymous single-context signals for every profile (no independence inflation)", () => {
    for (const seed of SEEDS) {
      const first = seed.signals[0];
      const many = Array.from({ length: 15 }, () => ({
        semanticTopic: first.semanticTopic,
        contextKey: canonicalContextKey({
          diagnosticSessionId: first.sessionId,
          lifeArea: first.lifeArea,
        }),
      }));
      const clusters = clusterByTopicAndContext(many);
      expect(clusters).toHaveLength(1);
      expect(clusters[0].independentContextsCount).toBe(1);
      expect(evidenceLevelFromCluster(15, 1)).toBe("L2_MULTIPLE_SIGNALS");
    }
  });
});
