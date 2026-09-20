import type { SupabaseClient } from "@supabase/supabase-js";
import { runAiFunction } from "@/lib/ai/gateway";
import type { AiProvider } from "@/lib/ai/provider";
import { ServiceError } from "./errors";
import {
  SCORING_MODEL_VERSION,
  finalPriorityScore,
  systemicLeverageScore,
  type ScoreInputs,
} from "./scoring";
import { runAtomicRpc } from "./transaction";

/**
 * generateRecommendations (ticket 37): AI proposes explained, ranked
 * corrections from deterministic score cards. Ranking is reproduced on the
 * server with the versioned scoring engine (ticket 28) — the model never
 * invents its own scores. risk_score >= 80 always forces human review and
 * keeps the recommendation internal (SPEC §20).
 */

export const RISK_REVIEW_THRESHOLD = 80;

export interface ScoreCard {
  ref: string;
  inputs: ScoreInputs;
}

interface TargetRef {
  ref: string;
  role: string;
  expected_effect: string;
}

interface RecommendationProposal {
  candidate_key: string;
  proposed_correction: string;
  rationale: string;
  target_refs: TargetRef[];
  score_card_ref: string | null;
  risk_notes: string;
  human_review_required: boolean;
  missing_evidence: string[];
  rank_rationale: string;
}

export interface GenerateRecommendationsInput {
  organizationId: string;
  clientId: string;
  clientRequestId: string | null;
  activeClientRequest: string;
  approvedEntities: unknown[];
  resources: unknown[];
  developmentTargets: unknown[];
  scoreCards: ScoreCard[];
  risks: unknown[];
  priorCorrections: unknown[];
  allowedInterventionMethods: unknown[];
}

/** Deterministic score derivation (ticket 28); missing inputs stay null. */
export function computeRecommendationScores(inputs: ScoreInputs): {
  finalPriorityScore: number | null;
  systemicLeverageScore: number | null;
} {
  const final = finalPriorityScore(inputs);
  const leverage =
    inputs.rootnessScore === null ||
    inputs.impactScore === null ||
    inputs.unlockScore === null ||
    inputs.riskScore === null
      ? null
      : systemicLeverageScore(
          inputs.rootnessScore,
          inputs.impactScore,
          inputs.unlockScore,
          inputs.riskScore
        );
  return { finalPriorityScore: final, systemicLeverageScore: leverage };
}

export function riskGate(inputs: ScoreInputs, aiRequiresReview: boolean): boolean {
  const highRisk = inputs.riskScore !== null && inputs.riskScore >= RISK_REVIEW_THRESHOLD;
  return highRisk || aiRequiresReview;
}

export async function generateRecommendations(
  client: SupabaseClient,
  provider: AiProvider,
  input: GenerateRecommendationsInput
): Promise<string[]> {
  const scoreByRef = new Map(input.scoreCards.map((card) => [card.ref, card.inputs]));

  const result = await runAiFunction(client, provider, {
    functionId: "ai.generate-recommendations.v1",
    organizationId: input.organizationId,
    clientId: input.clientId,
    payload: {
      active_client_request: input.activeClientRequest,
      approved_entities: input.approvedEntities,
      resources: input.resources,
      development_targets: input.developmentTargets,
      score_cards: input.scoreCards.map((card) => ({ ref: card.ref, ...card.inputs })),
      risks: input.risks,
      prior_corrections: input.priorCorrections,
      allowed_intervention_methods: input.allowedInterventionMethods,
    },
  });
  if (!result.ok) throw new ServiceError("INTERNAL_ERROR", result.error);

  const proposals = (result.result?.recommendations ?? []) as RecommendationProposal[];

  // Every proposal is persisted as an internal draft with the deterministic
  // risk gate. The whole batch, its targets and the AuditLog row commit in one
  // transaction: a failed proposal leaves no partial recommendation behind.
  const items = proposals.map((proposal) => {
    const primaryRef = proposal.score_card_ref ?? proposal.target_refs[0]?.ref ?? null;
    const inputs = primaryRef ? (scoreByRef.get(primaryRef) ?? null) : null;

    // Deterministic ranking; missing score card → insufficient data → null.
    const scores = inputs
      ? computeRecommendationScores(inputs)
      : { finalPriorityScore: null, systemicLeverageScore: null };
    const requiresReview = riskGate(inputs ?? emptyScoreInputs(), proposal.human_review_required);

    return {
      proposed_correction: proposal.proposed_correction,
      rationale: proposal.rationale,
      rootness_score: inputs?.rootnessScore ?? null,
      impact_score: inputs?.impactScore ?? null,
      activation_score: inputs?.activationScore ?? null,
      confidence_score: inputs?.confidenceScore ?? null,
      client_relevance_score: inputs?.clientRelevanceScore ?? null,
      readiness_score: inputs?.readinessScore ?? null,
      unlock_score: inputs?.unlockScore ?? null,
      risk_score: inputs?.riskScore ?? null,
      systemic_leverage_score: scores.systemicLeverageScore,
      final_priority_score: scores.finalPriorityScore,
      scoring_model_version: SCORING_MODEL_VERSION,
      risk_notes: proposal.risk_notes,
      missing_evidence: proposal.missing_evidence,
      rank_rationale: proposal.rank_rationale,
      human_review_required: requiresReview,
      targets: proposal.target_refs.map((target) => ({
        target_type: null,
        target_id: target.ref,
        role: target.role,
        expected_effect: target.expected_effect,
      })),
    };
  });

  return runAtomicRpc<string[]>(
    client,
    "create_recommendations",
    {
      p_org_id: input.organizationId,
      p_client_id: input.clientId,
      p_payload: {
        client_request_id: input.clientRequestId,
        items,
      },
    },
    {
      forbidden: "No write access to this client",
      failure: "Failed to create recommendation",
      validation: "Client request does not belong to this client",
    }
  );
}

function emptyScoreInputs(): ScoreInputs {
  return {
    rootnessScore: null,
    impactScore: null,
    activationScore: null,
    confidenceScore: null,
    clientRelevanceScore: null,
    readinessScore: null,
    unlockScore: null,
    riskScore: null,
  };
}
