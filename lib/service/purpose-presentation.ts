/**
 * Russian labels and the "not enough data" rule for the client Purpose screen
 * (ticket 13, SPEC §8.20/§8.21).
 *
 * Pure presentation logic: no database access and no React, so the screen and
 * its client components share one source of truth and the rules can be
 * unit-tested directly.
 *
 * There is no automatic purpose-detection algorithm in this product: a
 * PurposeProfile is entered by a human from a named source system and a
 * PurposeSynthesis is a manual synthesis across those profiles. Jyotish and
 * Human Design are interpretive systems and sources of hypotheses, not objective
 * psychological facts (SPEC §8.20), so every profile and every synthesis carries
 * that limit explicitly. A synthesis without any source profile is shown as
 * «недостаточно данных», never as a conclusion.
 */

export const PURPOSE_SOURCE_SYSTEM_LABELS: Record<string, string> = {
  jyotish: "Джйотиш",
  human_design: "Дизайн человека",
  specialist_assessment: "Оценка специалиста",
  client_self_report: "Самоописание клиента",
  other: "Другой источник",
};

export const PURPOSE_VISIBILITY_LABELS: Record<string, string> = {
  internal: "Внутренняя",
  sensitive: "Чувствительная",
  client_visible: "Видно клиенту",
};

/** Source systems that are interpretive by nature (SPEC §8.20). */
export const INTERPRETIVE_SOURCE_SYSTEMS: readonly string[] = ["jyotish", "human_design", "other"];

export const INTERPRETIVE_SYSTEM_LIMIT =
  "Интерпретационная система: источник гипотез, а не объективный психологический факт.";

export const PURPOSE_PROFILE_LIMITS_LABEL = "Ограничения данных профиля";
export const PURPOSE_SYNTHESIS_LIMITS_LABEL = "Ограничения данных синтеза";
export const PURPOSE_SYNTHESIS_SOURCES_LABEL = "Профили, на которые опирается синтез";

export interface PurposeProfileLimitsInput {
  sourceSystem: string;
  interpretation: string | null;
  confidence: number | null;
  strengths: string[];
  developmentDirections: string[];
}

export interface PurposeProfileLimitsResult {
  /** Whether the profile carries a human interpretation at all. */
  hasConclusion: boolean;
  limits: string[];
}

/**
 * Whether a PurposeProfile may be presented as an interpretation. The
 * interpretive-system limit is always present for jyotish/human_design/other; a
 * missing interpretation or missing confidence is added instead of being hidden.
 */
export function purposeProfileLimits(input: PurposeProfileLimitsInput): PurposeProfileLimitsResult {
  const interpretation = input.interpretation?.trim() ?? "";
  const limits: string[] = [];

  if (INTERPRETIVE_SOURCE_SYSTEMS.includes(input.sourceSystem)) {
    limits.push(INTERPRETIVE_SYSTEM_LIMIT);
  }
  if (interpretation.length === 0) {
    limits.push("Интерпретация не заполнена: профиль не содержит вывода.");
  }
  if (input.confidence === null) {
    limits.push("Уверенность в источнике не указана.");
  }
  if (input.strengths.length === 0 && input.developmentDirections.length === 0) {
    limits.push("Сильные стороны и направления развития не заполнены.");
  }

  return { hasConclusion: interpretation.length > 0, limits };
}

export interface PurposeSynthesisLimitsInput {
  /** How many stored PurposeProfiles the synthesis is based on. */
  sourceProfileCount: number;
  summary: string | null;
  crossSystemMatches: string[];
  potentialConflicts: string[];
  recommendedDevelopmentVectors: string[];
}

export interface PurposeSynthesisLimitsResult {
  hasEvidence: boolean;
  limits: string[];
}

/**
 * Whether a PurposeSynthesis may be presented as a conclusion. Without any
 * source profile there is no evidence to synthesise, so the screen shows
 * «недостаточно данных»; a synthesis that hides its conflicts is never rendered.
 */
export function purposeSynthesisLimits(
  input: PurposeSynthesisLimitsInput
): PurposeSynthesisLimitsResult {
  const summary = input.summary?.trim() ?? "";
  const limits: string[] = [];

  if (input.sourceProfileCount === 0) {
    limits.push("Нет профилей предназначения: синтезу не на что опираться.");
  }
  if (summary.length === 0) {
    limits.push("Резюме синтеза не заполнено.");
  }
  if (input.crossSystemMatches.length === 0 && input.potentialConflicts.length === 0) {
    limits.push("Совпадения и конфликты между системами не зафиксированы.");
  }
  if (input.sourceProfileCount < 2) {
    limits.push("Синтез опирается менее чем на два источника: межсистемных совпадений нет.");
  }
  limits.push(INTERPRETIVE_SYSTEM_LIMIT);

  return { hasEvidence: input.sourceProfileCount > 0, limits };
}
