/**
 * Russian labels, the explainable-ranking rule and the "not enough data" rule
 * for the client Recommendations screen (ticket 13, SPEC §16/§20/§36).
 *
 * Pure presentation logic: no database access and no React, so the screen and
 * its client components share one source of truth and every rule can be
 * unit-tested directly.
 *
 * Ranking is never a black box: the stored scores are rendered together with
 * the versioned weights of SPEC §16 and each component's contribution, and the
 * final priority score is recomputed with the same versioned engine the service
 * used (`lib/service/scoring.ts`). A Recommendation without a complete score card
 * has no priority at all (`null`) and is shown as «недостаточно данных».
 */

import { PRIORITY_WEIGHTS, finalPriorityScore, type ScoreInputs } from "./scoring";

export const RECOMMENDATION_STATUS_LABELS: Record<string, string> = {
  draft: "Предложение AI, ожидает ревью",
  approved: "Подтверждена человеком",
  rejected: "Отклонена человеком",
  archived: "В архиве",
};

export const RECOMMENDATION_VISIBILITY_LABELS: Record<string, string> = {
  internal: "Внутренняя: клиенту не видна",
  client_visible: "Опубликована в клиентском портале",
};

export const RECOMMENDATION_ROLE_LABELS: Record<string, string> = {
  primary: "Основная цель",
  secondary: "Дополнительная цель",
  downstream: "Следующий эффект",
  resource: "Ресурс",
  context: "Контекст",
};

export const RECOMMENDATION_TARGET_KIND_LABELS: Record<string, string> = {
  core_node: "Ключевой узел",
  theme: "Тема",
  differential_hypothesis: "Дифференциальная гипотеза",
  resource: "Ресурс",
  development_target: "Цель развития",
};

export const SCORE_COMPONENT_LABELS: Record<string, string> = {
  rootnessScore: "Корневость",
  impactScore: "Влияние",
  activationScore: "Активация",
  confidenceScore: "Уверенность",
  clientRelevanceScore: "Соответствие запросу",
  readinessScore: "Готовность",
  unlockScore: "Раскрытие направлений",
  riskScore: "Риск",
};

export const RANKING_LABEL = "Объяснение ранжирования";
export const RANKING_FORMULA_NOTE =
  "Итоговый приоритет — взвешенная сумма компонентов по версии scoring-модели; риск вычитается. Балл округляется и ограничивается диапазоном 0–100.";
export const INSUFFICIENT_RANKING_LABEL =
  "недостаточно данных: приоритет не рассчитан, потому что не заполнены все компоненты оценки.";

const WEIGHT_BY_INPUT: Record<keyof ScoreInputs, number> = {
  rootnessScore: PRIORITY_WEIGHTS.rootness,
  impactScore: PRIORITY_WEIGHTS.impact,
  activationScore: PRIORITY_WEIGHTS.activation,
  confidenceScore: PRIORITY_WEIGHTS.confidence,
  clientRelevanceScore: PRIORITY_WEIGHTS.clientRelevance,
  readinessScore: PRIORITY_WEIGHTS.readiness,
  unlockScore: PRIORITY_WEIGHTS.unlock,
  riskScore: PRIORITY_WEIGHTS.risk,
};

export interface RankingComponent {
  key: keyof ScoreInputs;
  label: string;
  score: number | null;
  weight: number;
  /** weight × score, or null when the component is missing. */
  contribution: number | null;
}

export interface RankingExplanation {
  version: string | null;
  components: RankingComponent[];
  finalPriorityScore: number | null;
  systemicLeverageScore: number | null;
  /** True when every component is present and the ranking is reproducible. */
  explainable: boolean;
  missingComponents: string[];
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * Reproduce the ranking of one Recommendation from its stored scores: every
 * component is returned with its SPEC §16 weight and its contribution, so the
 * specialist can check why a Recommendation is ranked where it is.
 */
export function rankingExplanation(
  scores: ScoreInputs,
  options: { version?: string | null; systemicLeverageScore?: number | null } = {}
): RankingExplanation {
  const components = (Object.keys(WEIGHT_BY_INPUT) as (keyof ScoreInputs)[]).map((key) => {
    const score = scores[key];
    const weight = WEIGHT_BY_INPUT[key];
    return {
      key,
      label: SCORE_COMPONENT_LABELS[key],
      score,
      weight,
      contribution: score === null ? null : round1(weight * score),
    };
  });

  const missingComponents = components
    .filter((component) => component.score === null)
    .map((component) => component.label);

  return {
    version: options.version ?? null,
    components,
    finalPriorityScore: finalPriorityScore(scores),
    systemicLeverageScore: options.systemicLeverageScore ?? null,
    explainable: missingComponents.length === 0,
    missingComponents,
  };
}

/**
 * Deterministic display order: higher final priority first, unranked
 * Recommendations (no score card) last, newest first inside the same score.
 * The order is a pure function of stored data, so the screen and the test agree.
 */
export function orderRecommendations<
  T extends { finalPriorityScore: number | null; createdAt: string },
>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    if (a.finalPriorityScore === null && b.finalPriorityScore === null) {
      return b.createdAt.localeCompare(a.createdAt);
    }
    if (a.finalPriorityScore === null) return 1;
    if (b.finalPriorityScore === null) return -1;
    if (b.finalPriorityScore !== a.finalPriorityScore) {
      return b.finalPriorityScore - a.finalPriorityScore;
    }
    return b.createdAt.localeCompare(a.createdAt);
  });
}

export interface RecommendationLimitsInput {
  status: string;
  targetCount: number;
  unresolvedTargetCount: number;
  supportingEvidenceCount: number;
  missingEvidence: string[];
  finalPriorityScore: number | null;
  riskScore: number | null;
  humanReviewRequired: boolean;
}

export interface RecommendationLimitsResult {
  /** Whether the Recommendation references at least one piece of evidence. */
  hasEvidence: boolean;
  limits: string[];
}

/**
 * The limits of the data behind one Recommendation. Empty evidence, an
 * unresolved target, a missing score card, an unreviewed AI state and high risk
 * each add an explicit limit instead of being hidden behind a confident text.
 */
export function recommendationLimits(input: RecommendationLimitsInput): RecommendationLimitsResult {
  const limits: string[] = [];

  if (input.targetCount === 0) {
    limits.push("Рекомендация не ссылается на цели: evidence не указан.");
  }
  if (input.supportingEvidenceCount === 0) {
    limits.push("Нет подтверждающих доказательств по целям рекомендации.");
  }
  if (input.unresolvedTargetCount > 0) {
    limits.push(
      `Не удалось прочитать ${input.unresolvedTargetCount} из целей: evidence не прослеживается.`
    );
  }
  if (input.finalPriorityScore === null) {
    limits.push(INSUFFICIENT_RANKING_LABEL);
  }
  for (const missing of input.missingEvidence) {
    limits.push(`AI отметил нехватку данных: ${missing}`);
  }
  if (input.status === "draft") {
    limits.push(
      "Предложение AI (L0): до явного решения человека не считается подтверждённой рекомендацией."
    );
  }
  if (input.status === "rejected") {
    limits.push("Отклонена человеком: не является подтверждённой рекомендацией.");
  }
  if (input.humanReviewRequired) {
    limits.push(
      "Высокий риск: рекомендация требует ревью человека и остаётся внутренней — публикация клиенту запрещена (SPEC §20)."
    );
  }

  return { hasEvidence: input.supportingEvidenceCount > 0, limits };
}

/** Only a still-pending draft is reviewable: a human decision is never redone. */
export function isRecommendationReviewable(status: string): boolean {
  return status === "draft";
}

export interface PublishabilityInput {
  status: string;
  humanReviewRequired: boolean;
  visibility: string;
}

/** Whether the publish control may be offered at all (the database re-checks). */
export function canPublishRecommendation(input: PublishabilityInput): boolean {
  return (
    input.status === "approved" &&
    !input.humanReviewRequired &&
    input.visibility !== "client_visible"
  );
}

/** Whether the withdraw-from-portal control may be offered. */
export function canUnpublishRecommendation(input: PublishabilityInput): boolean {
  return input.visibility === "client_visible";
}
