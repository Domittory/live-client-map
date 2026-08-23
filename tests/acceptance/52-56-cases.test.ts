import { describe, expect, it } from "vitest";
import { AI_CONTRACTS } from "@/lib/ai/contracts";
import {
  clusterByTopicAndContext,
  canonicalContextKey,
  evidenceLevelFromCluster,
} from "@/lib/service/clustering";
import { classifySafety, guardAiOutput, toPossibleAssociation } from "@/lib/service/safety";
import { interpretSignal } from "@/lib/service/signal-interpretation";

const ID = "123e4567-e89b-12d3-a456-426614174000";

const validIngestSignal = {
  candidate_key: "s1",
  raw_statement: "Я достоин занимать новую роль",
  statement_polarity: "positive",
  test_result: "stress",
  normalized_meaning: "Стресс вокруг доступа к позитивной возможности",
  inferred_opposite: "не доказано",
  confidence: 60,
  life_areas: ["work"],
  tags: [],
  context: "",
  proposed_evidence_level: "L1_SINGLE_SIGNAL",
  rationale: "r",
};

const validCluster = {
  candidate_key: "c1",
  action: "create",
  existing_cluster_id: null,
  semantic_topic: "fear_of_responsibility",
  signal_ids: [ID],
  context_key: "work",
  independence_assessment: "same_context",
  rationale: "r",
};

function validHypothesis(title: string) {
  return {
    candidate_key: title,
    title,
    description: "рабочая гипотеза",
    confidence: 50,
    evidence_for_refs: [ID],
    evidence_against_refs: [],
    missing_evidence: ["проверить реальную угрозу"],
    disconfirming_questions: ["что говорило бы против этой гипотезы?"],
    rationale: "r",
  };
}

describe("SPEC §52 — positive statement stress", () => {
  it("deterministic: positive + stress is stress around access, not a resource, no opposite assertion", () => {
    const r = interpretSignal("positive", "stress");
    expect(r.normalizedMeaning).toContain("Стресс вокруг доступа");
    expect(r.isResourceHint).toBe(false);
    expect(r.inferredOpposite).toContain("не доказано");
  });

  it("AI-contract: ingest-signals accepts a positive/stress signal with an evidence level", () => {
    const ingest = AI_CONTRACTS["ai.ingest-signals.v1"];
    const signal = { ...validIngestSignal, statement_polarity: "positive", test_result: "stress" };
    expect(ingest.resultSchema.safeParse({ signals: [signal] }).success).toBe(true);
  });
});

describe("SPEC §53 — evidence independence", () => {
  it("deterministic: 20 similar signals in one session collapse to one independent context (L2)", () => {
    const signals = Array.from({ length: 20 }, () => ({
      semanticTopic: "authority_fear",
      contextKey: canonicalContextKey({ diagnosticSessionId: "s1", lifeArea: "work" }),
    }));
    const clusters = clusterByTopicAndContext(signals);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].independentContextsCount).toBe(1);
    expect(evidenceLevelFromCluster(20, 1)).toBe("L2_MULTIPLE_SIGNALS");
  });

  it("AI-contract: cluster-evidence distinguishes same_context from independent", () => {
    const contract = AI_CONTRACTS["ai.cluster-evidence.v1"];
    expect(contract.resultSchema.safeParse({ clusters: [validCluster] }).success).toBe(true);
    expect(
      contract.resultSchema.safeParse({
        clusters: [{ ...validCluster, independence_assessment: "independent" }],
      }).success
    ).toBe(true);
    expect(
      contract.resultSchema.safeParse({
        clusters: [{ ...validCluster, independence_assessment: "made_up" }],
      }).success
    ).toBe(false);
  });
});

describe("SPEC §54 — multi-context", () => {
  it("deterministic: independent life areas raise to L3_MULTI_CONTEXT", () => {
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

  it("AI-contract: independence_assessment supports independent and insufficient_data", () => {
    const contract = AI_CONTRACTS["ai.cluster-evidence.v1"];
    expect(
      contract.resultSchema.safeParse({
        clusters: [{ ...validCluster, independence_assessment: "independent" }],
      }).success
    ).toBe(true);
    expect(
      contract.resultSchema.safeParse({
        clusters: [{ ...validCluster, independence_assessment: "insufficient_data" }],
      }).success
    ).toBe(true);
  });
});

describe("SPEC §55 — competing hypotheses", () => {
  it("AI-contract: multiple competing hypotheses are representable, each with evidence for/against", () => {
    const contract = AI_CONTRACTS["ai.generate-differential-hypotheses.v1"];
    const hypotheses = [
      validHypothesis("authority / father dynamic"),
      validHypothesis("real workplace threat"),
      validHypothesis("previous firing trauma"),
    ];
    expect(contract.resultSchema.safeParse({ hypotheses }).success).toBe(true);
  });

  it("AI-contract: more than 5 hypotheses is rejected", () => {
    const contract = AI_CONTRACTS["ai.generate-differential-hypotheses.v1"];
    const hypotheses = Array.from({ length: 6 }, (_, i) => validHypothesis(`h${i}`));
    expect(contract.resultSchema.safeParse({ hypotheses }).success).toBe(false);
  });

  it("AI-contract: a hypothesis must list disconfirming questions (falsifiability)", () => {
    const contract = AI_CONTRACTS["ai.generate-differential-hypotheses.v1"];
    const withoutFalsifier: Record<string, unknown> = { ...validHypothesis("h") };
    delete withoutFalsifier.disconfirming_questions;
    expect(contract.resultSchema.safeParse({ hypotheses: [withoutFalsifier] }).success).toBe(false);
  });
});

describe("SPEC §56 — medical boundary", () => {
  it("deterministic: suppressed anger must not cause hypertension", () => {
    const guard = guardAiOutput("подавленная злость вызвала повышенное давление");
    expect(guard.blocked).toBe(true);
    expect(guard.reason).toBe("medical_causality");
  });

  it("deterministic: a causal claim downgrades to a possible psychological association", () => {
    const downgraded = toPossibleAssociation("подавленная злость вызвала давление");
    expect(downgraded).toContain("возможная психологическая ассоциация");
  });

  it("deterministic: a plain possible association is allowed and not flagged", () => {
    const guard = guardAiOutput("возможная психологическая ассоциация между злостью и давлением");
    expect(guard.blocked).toBe(false);
    expect(classifySafety("возможная психологическая ассоциация").reviewRequired).toBe(false);
  });
});
