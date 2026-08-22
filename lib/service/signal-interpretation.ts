export const EVIDENCE_LEVELS = [
  "L0_AI_ONLY",
  "L1_SINGLE_SIGNAL",
  "L2_MULTIPLE_SIGNALS",
  "L3_MULTI_CONTEXT",
  "L4_RETEST_CONFIRMED",
  "L5_BEHAVIOR_CONFIRMED",
  "L6_CORRECTION_RESPONSE_CONFIRMED",
  "L7_SPECIALIST_CONFIRMED_LONGITUDINAL",
] as const;

export type EvidenceLevel = (typeof EVIDENCE_LEVELS)[number];

export type StatementPolarity = "positive" | "negative" | "neutral" | "mixed" | "unknown";
export type TestResult = "stress" | "no_stress" | "unknown" | "not_tested";

export interface SignalInterpretation {
  normalizedMeaning: string;
  inferredOpposite: string | null;
  requiresInvestigation: boolean;
  isResourceHint: boolean;
}

/**
 * Deterministic interpretation of a Signal by its polarity and test result
 * (SPEC §12). A `positive + stress` result means "stress around access to the
 * positive possibility" — it is NOT a resource and does NOT assert the opposite
 * belief (SPEC §4). `raw_statement` is always preserved separately by callers.
 */
export function interpretSignal(
  polarity: StatementPolarity,
  testResult: TestResult
): SignalInterpretation {
  if (polarity === "positive" && testResult === "stress") {
    return {
      normalizedMeaning: "Стресс вокруг доступа к позитивной возможности.",
      inferredOpposite:
        "Возможные гипотезы: риск оценки, отвержения, давления или потери безопасности (не доказано).",
      requiresInvestigation: false,
      isResourceHint: false,
    };
  }
  if (polarity === "positive" && testResult === "no_stress") {
    return {
      normalizedMeaning: "Возможный ресурс или интеграция.",
      inferredOpposite: null,
      requiresInvestigation: false,
      isResourceHint: true,
    };
  }
  if (polarity === "negative" && testResult === "stress") {
    return {
      normalizedMeaning: "Активный заряд вокруг негативного сценария.",
      inferredOpposite: null,
      requiresInvestigation: false,
      isResourceHint: false,
    };
  }
  if (polarity === "negative" && testResult === "no_stress") {
    return {
      normalizedMeaning: "Нет активного стресса в данный момент.",
      inferredOpposite: null,
      requiresInvestigation: false,
      isResourceHint: false,
    };
  }
  if (polarity === "neutral" && testResult === "stress") {
    return {
      normalizedMeaning: "Требуется исследование контекста.",
      inferredOpposite: null,
      requiresInvestigation: true,
      isResourceHint: false,
    };
  }
  return {
    normalizedMeaning: "Недостаточно данных для интерпретации.",
    inferredOpposite: null,
    requiresInvestigation: true,
    isResourceHint: false,
  };
}

/**
 * Confidence floor derived from evidence level (ticket 06). L0 (AI-only) maps
 * to 0 — an AI hypothesis never raises confidence or evidence on its own
 * (SPEC §3.5).
 */
export function confidenceFromEvidenceLevel(level: EvidenceLevel): number {
  const map: Record<EvidenceLevel, number> = {
    L0_AI_ONLY: 0,
    L1_SINGLE_SIGNAL: 20,
    L2_MULTIPLE_SIGNALS: 40,
    L3_MULTI_CONTEXT: 60,
    L4_RETEST_CONFIRMED: 75,
    L5_BEHAVIOR_CONFIRMED: 85,
    L6_CORRECTION_RESPONSE_CONFIRMED: 95,
    L7_SPECIALIST_CONFIRMED_LONGITUDINAL: 95,
  };
  return map[level];
}

/** L0 (AI-only) is not independent evidence (SPEC §3.5). */
export function contributesIndependentEvidence(level: EvidenceLevel): boolean {
  return level !== "L0_AI_ONLY";
}
