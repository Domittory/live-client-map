import { describe, expect, it } from "vitest";
import {
  canonicalContextKey,
  clusterByTopicAndContext,
  evidenceLevelFromCluster,
} from "@/lib/service/clustering";

describe("canonicalContextKey", () => {
  it("is deterministic and distinguishes sessions and life areas", () => {
    const a = canonicalContextKey({ diagnosticSessionId: "s1", lifeArea: "work" });
    const b = canonicalContextKey({ diagnosticSessionId: "s1", lifeArea: "work" });
    const c = canonicalContextKey({ diagnosticSessionId: "s2", lifeArea: "work" });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});

describe("clusterByTopicAndContext (SPEC §53)", () => {
  it("collapses 20 synonymous signals from one session into one independent context", () => {
    const signals = Array.from({ length: 20 }, () => ({
      semanticTopic: "fear_of_authority",
      contextKey: canonicalContextKey({ diagnosticSessionId: "s1", lifeArea: "work" }),
    }));

    const clusters = clusterByTopicAndContext(signals);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].signalsCount).toBe(20);
    expect(clusters[0].independentContextsCount).toBe(1);
    // 20 signals, one context => L2, never 20x evidence
    expect(evidenceLevelFromCluster(20, 1)).toBe("L2_MULTIPLE_SIGNALS");
  });
});

describe("evidenceLevelFromCluster (SPEC §54)", () => {
  it("raises to L3 only for genuinely independent contexts", () => {
    const signals = [
      {
        semanticTopic: "fear_of_responsibility",
        contextKey: canonicalContextKey({ lifeArea: "parenting" }),
      },
      {
        semanticTopic: "fear_of_responsibility",
        contextKey: canonicalContextKey({ lifeArea: "work" }),
      },
      {
        semanticTopic: "fear_of_responsibility",
        contextKey: canonicalContextKey({ lifeArea: "client" }),
      },
    ];
    const clusters = clusterByTopicAndContext(signals);
    expect(clusters[0].independentContextsCount).toBe(3);
    expect(evidenceLevelFromCluster(3, 3)).toBe("L3_MULTI_CONTEXT");
  });

  it("single signal stays L1", () => {
    expect(evidenceLevelFromCluster(1, 1)).toBe("L1_SINGLE_SIGNAL");
  });
});
