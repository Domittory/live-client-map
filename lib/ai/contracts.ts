import { z } from "zod";
import { score, uuid } from "@/lib/service/validation";

/**
 * AI function contracts (ticket 32), implementing docs/ai-contracts.md.
 * Every function has a separate versioned strict contract: unknown fields,
 * invalid enums and scores outside 0–100 are rejected before any business
 * mutation. AI-created records stay review_status = pending downstream.
 */

export const REDACTION_VERSION = "redaction.v1";
export const MODEL_CONFIG = {
  provider: "openai-dev",
  snapshot: "gpt-5.5-2026-04-23",
  reasoningEffort: "high",
} as const;

// --- Shared primitives -------------------------------------------------------

const nullableScore = score.nullable();
const rationale = z.string().min(1).max(4000);
const candidateKey = z.string().min(1).max(100);
const refs = z.array(uuid).max(500);
const str = z.string().min(1).max(4000);
const strList = z.array(z.string().min(1).max(500)).max(100);

export const statementPolaritySchema = z.enum([
  "positive",
  "negative",
  "neutral",
  "mixed",
  "unknown",
]);

export const testResultSchema = z.enum(["stress", "no_stress", "unknown", "not_tested"]);

export const evidenceLevelSchema = z.enum([
  "L0_AI_ONLY",
  "L1_SINGLE_SIGNAL",
  "L2_MULTIPLE_SIGNALS",
  "L3_MULTI_CONTEXT",
  "L4_RETEST_CONFIRMED",
  "L5_BEHAVIOR_CONFIRMED",
  "L6_CORRECTION_RESPONSE_CONFIRMED",
  "L7_SPECIALIST_CONFIRMED_LONGITUDINAL",
]);

export const signalSourceTypeSchema = z.enum([
  "kinesiology_test",
  "client_report",
  "specialist_observation",
  "life_event",
  "questionnaire",
  "partner_report",
  "follow_up",
  "imported_note",
  "ai_hypothesis",
]);

export const inputFormatSchema = z.enum([
  "plain_text",
  "markdown",
  "chatgpt_analysis",
  "signals_csv",
  "signals_json",
]);

/** Warning codes the model may return (docs: only known codes allowed). */
export const warningCodeSchema = z.enum([
  "insufficient_data",
  "partial_input",
  "low_confidence",
  "safety_review_created",
]);

// --- Envelopes ---------------------------------------------------------------

export const aiRequestEnvelopeSchema = z
  .object({
    contract_version: z.string().min(1).max(50),
    request_id: uuid,
    organization_id: uuid,
    client_id: uuid,
    language: z
      .string()
      .regex(/^[a-z]{2}$/)
      .default("ru"),
    ontology_version: z.string().min(1).max(50),
    scoring_model_version: z.string().max(50).nullable(),
    prompt_version: z.string().min(1).max(50),
    source_snapshot_version: z.number().int().min(0).nullable(),
    payload: z.record(z.string(), z.unknown()),
  })
  .strict();

export const aiResponseEnvelopeSchema = z
  .object({
    contract_version: z.string().min(1).max(50),
    request_id: uuid,
    result: z.record(z.string(), z.unknown()),
    warnings: z.array(warningCodeSchema).max(50),
    safety: z
      .object({
        review_required: z.boolean(),
        categories: z.array(z.string().min(1).max(100)).max(20),
        rationale: z.string().max(2000),
      })
      .strict(),
  })
  .strict();

// --- Shared result fragments ---------------------------------------------------

const actionCreateUpdateNoChange = z.enum(["create", "update", "no_change"]);

const signalLinkSchema = z
  .object({
    signal_id: uuid,
    relevance_score: nullableScore,
    link_rationale: z.string().max(2000),
  })
  .strict();

// --- Per-function contracts ----------------------------------------------------

const ingestSignals = {
  payload: z
    .object({
      diagnostic_session_id: uuid,
      raw_input: z.string().min(1).max(100_000),
      source_type: signalSourceTypeSchema,
      input_format: inputFormatSchema,
      language: z.string().regex(/^[a-z]{2}$/),
      known_life_areas: strList,
    })
    .strict(),
  result: z
    .object({
      signals: z
        .array(
          z
            .object({
              candidate_key: candidateKey,
              raw_statement: str,
              statement_polarity: statementPolaritySchema,
              test_result: testResultSchema,
              normalized_meaning: str,
              inferred_opposite: z.string().max(2000).nullable(),
              confidence: nullableScore,
              life_areas: strList,
              tags: strList,
              context: z.string().max(2000),
              proposed_evidence_level: evidenceLevelSchema,
              rationale,
            })
            .strict()
        )
        .max(500),
    })
    .strict(),
};

const signalProjection = z
  .object({
    id: uuid,
    normalized_meaning: str,
    diagnostic_session_id: uuid.nullable(),
    source_type: signalSourceTypeSchema,
    life_areas: strList,
    context: z.string().max(2000),
  })
  .strict();

const clusterProjection = z
  .object({
    id: uuid,
    semantic_topic: str,
    context_key: z.string().max(500),
    signal_ids: refs,
  })
  .strict();

const clusterEvidence = {
  payload: z
    .object({
      diagnostic_session_id: uuid,
      signals: z.array(signalProjection).max(500),
      existing_clusters: z.array(clusterProjection).max(500),
    })
    .strict(),
  result: z
    .object({
      clusters: z
        .array(
          z
            .object({
              candidate_key: candidateKey,
              action: actionCreateUpdateNoChange,
              existing_cluster_id: uuid.nullable(),
              semantic_topic: str,
              signal_ids: refs,
              context_key: z.string().max(500),
              independence_assessment: z.enum([
                "same_context",
                "possibly_independent",
                "independent",
                "insufficient_data",
              ]),
              rationale,
            })
            .strict()
        )
        .max(500),
    })
    .strict(),
};

const themeProjection = z
  .object({
    id: uuid,
    name: str,
    domain: z.string().max(200).nullable(),
  })
  .strict();

const classifyThemes = {
  payload: z
    .object({
      reviewed_signals: z.array(signalProjection).max(500),
      evidence_clusters: z.array(clusterProjection).max(500),
      existing_themes: z.array(themeProjection).max(500),
      current_model_summary: z.string().max(10_000),
    })
    .strict(),
  result: z
    .object({
      theme_proposals: z
        .array(
          z
            .object({
              candidate_key: candidateKey,
              action: z.enum(["create", "link_existing", "no_change"]),
              existing_theme_id: uuid.nullable(),
              name: str,
              description: z.string().max(4000),
              domain: z.string().max(200).nullable(),
              confidence: nullableScore,
              signal_links: z.array(signalLinkSchema).max(500),
              rationale,
            })
            .strict()
        )
        .max(500),
    })
    .strict(),
};

const coreNodeProjection = z
  .object({
    id: uuid,
    title: str,
    hypothesis: z.string().max(4000),
    status: z.string().max(50),
  })
  .strict();

const updateCoreNodes = {
  payload: z
    .object({
      approved_themes: z.array(themeProjection).max(500),
      theme_links: z.array(z.record(z.string(), z.unknown())).max(500),
      existing_core_nodes: z.array(coreNodeProjection).max(500),
      contradictions: z.array(z.record(z.string(), z.unknown())).max(500),
      deterministic_score_inputs: z.record(z.string(), z.unknown()),
      current_client_request_summary: z.string().max(4000),
    })
    .strict(),
  result: z
    .object({
      core_node_proposals: z
        .array(
          z
            .object({
              candidate_key: candidateKey,
              action: actionCreateUpdateNoChange,
              existing_core_node_id: uuid.nullable(),
              title: str,
              hypothesis: z.string().max(4000),
              root_domain: z.string().max(200).nullable(),
              proposed_status: z.string().max(50),
              theme_links: z.array(uuid).max(500),
              evidence_refs: refs,
              contradictions_considered: refs,
              confidence: nullableScore,
              rationale,
            })
            .strict()
        )
        .max(500),
    })
    .strict(),
};

const generateDifferentialHypotheses = {
  payload: z
    .object({
      focal_entity_refs: refs,
      evidence_for: refs,
      evidence_against: refs,
      context_summary: z.string().max(10_000),
      existing_hypotheses: z.array(z.object({ id: uuid, title: str }).strict()).max(500),
    })
    .strict(),
  result: z
    .object({
      hypotheses: z
        .array(
          z
            .object({
              candidate_key: candidateKey,
              title: str,
              description: z.string().max(4000),
              confidence: nullableScore,
              evidence_for_refs: refs,
              evidence_against_refs: refs,
              missing_evidence: strList,
              disconfirming_questions: strList,
              rationale,
            })
            .strict()
        )
        .max(5),
    })
    .strict(),
};

const detectContradictions = {
  payload: z
    .object({
      reviewed_signals: z.array(signalProjection).max(500),
      themes: z.array(themeProjection).max(500),
      core_nodes: z.array(coreNodeProjection).max(500),
      differential_hypotheses: z.array(z.object({ id: uuid, title: str }).strict()).max(500),
      existing_contradictions: z.array(z.record(z.string(), z.unknown())).max(500),
      relevant_contexts: strList,
    })
    .strict(),
  result: z
    .object({
      contradictions: z
        .array(
          z
            .object({
              candidate_key: candidateKey,
              entity_refs_for: refs,
              entity_refs_against: refs,
              description: z.string().max(4000),
              relevance_score: nullableScore,
              context_refs: strList,
              rationale,
              suggested_follow_up: z.string().max(2000),
            })
            .strict()
        )
        .max(500),
    })
    .strict(),
};

const evaluateCorrection = {
  payload: z
    .object({
      correction_id: uuid,
      target_refs: refs,
      expected_markers: z.array(z.record(z.string(), z.unknown())).max(500),
      baselines: z.array(z.record(z.string(), z.unknown())).max(500),
      observations: z.array(z.record(z.string(), z.unknown())).max(500),
      behavioral_markers: z.array(z.record(z.string(), z.unknown())).max(500),
      follow_ups: z.array(z.record(z.string(), z.unknown())).max(500),
      affected_contexts: strList,
      current_deterministic_scores: z.record(z.string(), nullableScore),
    })
    .strict(),
  result: z
    .object({
      assessment: z
        .object({
          proposed_result_status: z.enum([
            "effective",
            "partially_effective",
            "ineffective",
            "unclear",
          ]),
          confidence: nullableScore,
          evidence_refs: refs,
          context_changes: strList,
          marker_changes: strList,
          missing_evidence: strList,
          proposed_core_node_status: z.string().max(50).nullable(),
          rationale,
          follow_up_recommendation: z.string().max(2000),
        })
        .strict(),
    })
    .strict(),
};

const resourceProjection = z
  .object({
    id: uuid,
    name: str,
    domain: z.string().max(200).nullable(),
  })
  .strict();

const updateResources = {
  payload: z
    .object({
      existing_resources: z.array(resourceProjection).max(500),
      positive_evidence: z.array(signalProjection).max(500),
      observations: z.array(z.record(z.string(), z.unknown())).max(500),
      behavioral_markers: z.array(z.record(z.string(), z.unknown())).max(500),
      core_node_changes: z.array(z.record(z.string(), z.unknown())).max(500),
      existing_links: z.array(z.record(z.string(), z.unknown())).max(500),
    })
    .strict(),
  result: z
    .object({
      resource_proposals: z
        .array(
          z
            .object({
              candidate_key: candidateKey,
              action: z.enum(["create", "update", "link_existing", "no_change"]),
              existing_resource_id: uuid.nullable(),
              name: str,
              description: z.string().max(4000),
              domain: z.string().max(200).nullable(),
              proposed_strength: nullableScore,
              proposed_confidence: nullableScore,
              proposed_trend: z.enum(["strengthening", "stable", "weakening", "unknown"]),
              evidence_refs: refs,
              rationale,
            })
            .strict()
        )
        .max(500),
    })
    .strict(),
};

const generateRecommendations = {
  payload: z
    .object({
      active_client_request: z.string().max(4000),
      approved_entities: z.array(z.record(z.string(), z.unknown())).max(500),
      resources: z.array(resourceProjection).max(500),
      development_targets: z.array(z.record(z.string(), z.unknown())).max(500),
      score_cards: z.array(z.record(z.string(), z.unknown())).max(500),
      risks: z.array(z.record(z.string(), z.unknown())).max(500),
      prior_corrections: z.array(z.record(z.string(), z.unknown())).max(500),
      allowed_intervention_methods: z.array(z.object({ id: uuid, name: str }).strict()).max(500),
    })
    .strict(),
  result: z
    .object({
      recommendations: z
        .array(
          z
            .object({
              candidate_key: candidateKey,
              proposed_correction: z.string().max(4000),
              rationale,
              target_refs: z
                .array(
                  z
                    .object({
                      ref: uuid,
                      role: z.string().max(100),
                      expected_effect: z.string().max(2000),
                    })
                    .strict()
                )
                .max(100),
              score_card_ref: uuid.nullable(),
              risk_notes: z.string().max(2000),
              human_review_required: z.boolean(),
              missing_evidence: strList,
              rank_rationale: z.string().max(2000),
            })
            .strict()
        )
        .max(100),
    })
    .strict(),
};

const generateSnapshot = {
  payload: z
    .object({
      current_state: z.record(z.string(), z.unknown()),
      prior_snapshot: z.record(z.string(), z.unknown()).nullable(),
      model_changes: z.array(z.record(z.string(), z.unknown())).max(500),
      versions: z
        .object({
          ontology_version: z.string().max(50),
          scoring_model_version: z.string().max(50).nullable(),
          prompt_version: z.string().max(50),
          model_snapshot: z.string().max(100),
        })
        .strict(),
    })
    .strict(),
  result: z
    .object({
      narrative: z
        .object({
          summary: z.string().max(8000),
          trend_summary: z.string().max(4000),
          risk_notes: z.string().max(4000),
          evidence_digest: z.string().max(8000),
        })
        .strict(),
      grouped_entity_refs: z
        .object({
          active_core_nodes: refs,
          active_themes: refs,
          resources: refs,
          development_targets: refs,
          weakened_nodes: refs,
          reactivated_nodes: refs,
          recent_triggers: refs,
          recent_corrections: refs,
          recommendations: refs,
        })
        .strict(),
    })
    .strict(),
};

const explainModelChanges = {
  payload: z
    .object({
      model_changes: z.array(z.record(z.string(), z.unknown())).max(500),
      before_snapshot: z.record(z.string(), z.unknown()),
      after_snapshot: z.record(z.string(), z.unknown()),
      supporting_evidence: z.array(z.record(z.string(), z.unknown())).max(500),
      score_diffs: z.record(z.string(), z.number().int()),
    })
    .strict(),
  result: z
    .object({
      explanations: z
        .array(
          z
            .object({
              model_change_id: uuid,
              headline: str,
              explanation: z.string().max(8000),
              evidence_refs: refs,
              score_breakdown_summary: z.string().max(4000),
              uncertainty: z.string().max(2000),
              missing_evidence: strList,
            })
            .strict()
        )
        .max(500),
    })
    .strict(),
};

// --- Registry ------------------------------------------------------------------

export interface AiFunctionContract {
  functionId: string;
  contractVersion: string;
  promptVersion: string;
  payloadSchema: z.ZodType;
  resultSchema: z.ZodType;
}

function defineContract(
  functionId: string,
  promptVersion: string,
  contract: { payload: z.ZodType; result: z.ZodType }
): AiFunctionContract {
  return {
    functionId,
    contractVersion: "1.0.0",
    promptVersion,
    payloadSchema: contract.payload,
    resultSchema: contract.result,
  };
}

export const AI_CONTRACTS: Record<string, AiFunctionContract> = Object.fromEntries(
  [
    defineContract("ai.ingest-signals.v1", "prompt.ingest-signals.v1", ingestSignals),
    defineContract("ai.cluster-evidence.v1", "prompt.cluster-evidence.v1", clusterEvidence),
    defineContract("ai.classify-themes.v1", "prompt.classify-themes.v1", classifyThemes),
    defineContract("ai.update-core-nodes.v1", "prompt.update-core-nodes.v1", updateCoreNodes),
    defineContract(
      "ai.generate-differential-hypotheses.v1",
      "prompt.generate-differential-hypotheses.v1",
      generateDifferentialHypotheses
    ),
    defineContract(
      "ai.detect-contradictions.v1",
      "prompt.detect-contradictions.v1",
      detectContradictions
    ),
    defineContract(
      "ai.evaluate-correction.v1",
      "prompt.evaluate-correction.v1",
      evaluateCorrection
    ),
    defineContract("ai.update-resources.v1", "prompt.update-resources.v1", updateResources),
    defineContract(
      "ai.generate-recommendations.v1",
      "prompt.generate-recommendations.v1",
      generateRecommendations
    ),
    defineContract("ai.generate-snapshot.v1", "prompt.generate-snapshot.v1", generateSnapshot),
    defineContract(
      "ai.explain-model-changes.v1",
      "prompt.explain-model-changes.v1",
      explainModelChanges
    ),
  ].map((contract) => [contract.functionId, contract])
);

export const AI_FUNCTION_IDS = Object.keys(AI_CONTRACTS);
