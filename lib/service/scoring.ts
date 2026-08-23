export const SCORING_MODEL_VERSION = "1.0.0";

export interface ScoreInputs {
  rootnessScore: number | null;
  impactScore: number | null;
  activationScore: number | null;
  confidenceScore: number | null;
  clientRelevanceScore: number | null;
  readinessScore: number | null;
  unlockScore: number | null;
  riskScore: number | null;
}

export interface ScoreBreakdown {
  version: string;
  finalPriorityScore: number | null;
  components: Record<string, number | null>;
}

// Weights are exactly the SPEC §16 formula; they sum to 1.0 in absolute value.
export const PRIORITY_WEIGHTS = {
  rootness: 0.18,
  impact: 0.17,
  activation: 0.17,
  confidence: 0.13,
  clientRelevance: 0.13,
  readiness: 0.08,
  unlock: 0.09,
  risk: -0.05,
} as const;

export function clampScore(value: number): number {
  return Math.min(100, Math.max(0, value));
}

/**
 * Versioned reactivation configuration (SPEC §24, ticket 06 resolution,
 * ticket 42). A weakened CoreNode is proposed for reactivation when the
 * recomputed activation_score reaches `activationThreshold` AND the increase
 * over the weakened score is at least `minIncrease` (ticket 06 fixes the
 * default at ≥ 30; SPEC §24 leaves the threshold configurable).
 *
 * Only evidence created within the last `freshEvidenceWindowDays` days counts
 * ("свежие Signals", ticket 06 uses the same 30-day activity window as trend);
 * older evidence is stale and ignored. AI-only evidence (L0_AI_ONLY) never
 * counts (SPEC §3.5). Each fresh eligible Signal contributes `signalPoints`;
 * each fresh TriggerActivation contributes its `activation_delta`.
 *
 * Changing any value requires bumping `version`; every reactivation proposal
 * stores the version and full calculation it was produced with.
 */
export interface ReactivationConfig {
  version: string;
  activationThreshold: number;
  minIncrease: number;
  freshEvidenceWindowDays: number;
  signalPoints: number;
}

export const REACTIVATION_CONFIG: ReactivationConfig = {
  version: SCORING_MODEL_VERSION,
  activationThreshold: 60,
  minIncrease: 30,
  freshEvidenceWindowDays: 30,
  signalPoints: 10,
};

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * Final priority score (SPEC §16). Deterministic for the same inputs and model
 * version. Returns null when any required input is null (missing data is null,
 * not zero — ticket 03).
 */
export function finalPriorityScore(inputs: ScoreInputs): number | null {
  const required = [
    inputs.rootnessScore,
    inputs.impactScore,
    inputs.activationScore,
    inputs.confidenceScore,
    inputs.clientRelevanceScore,
    inputs.readinessScore,
    inputs.unlockScore,
    inputs.riskScore,
  ];
  if (required.some((v) => v === null)) return null;

  const weighted =
    inputs.rootnessScore! * PRIORITY_WEIGHTS.rootness +
    inputs.impactScore! * PRIORITY_WEIGHTS.impact +
    inputs.activationScore! * PRIORITY_WEIGHTS.activation +
    inputs.confidenceScore! * PRIORITY_WEIGHTS.confidence +
    inputs.clientRelevanceScore! * PRIORITY_WEIGHTS.clientRelevance +
    inputs.readinessScore! * PRIORITY_WEIGHTS.readiness +
    inputs.unlockScore! * PRIORITY_WEIGHTS.unlock +
    inputs.riskScore! * PRIORITY_WEIGHTS.risk;

  return round1(clampScore(weighted));
}

/**
 * Systemic leverage is computed separately (SPEC §16): expected systemic effect
 * of one correction relative to cost, risk and downstream-theme count. Formula
 * is configurable; this is the v1 default.
 */
export function systemicLeverageScore(
  rootnessScore: number,
  impactScore: number,
  unlockScore: number,
  riskScore: number
): number {
  const raw = 0.4 * rootnessScore + 0.3 * impactScore + 0.3 * unlockScore - 0.2 * riskScore;
  return round1(clampScore(raw));
}

export function scoreBreakdown(inputs: ScoreInputs): ScoreBreakdown {
  return {
    version: SCORING_MODEL_VERSION,
    finalPriorityScore: finalPriorityScore(inputs),
    components: {
      rootness: inputs.rootnessScore,
      impact: inputs.impactScore,
      activation: inputs.activationScore,
      confidence: inputs.confidenceScore,
      clientRelevance: inputs.clientRelevanceScore,
      readiness: inputs.readinessScore,
      unlock: inputs.unlockScore,
      risk: inputs.riskScore,
    },
  };
}
