/**
 * Russian labels and the "not enough data" rule for the client Resources and
 * DevelopmentTargets screens (ticket 13).
 *
 * Pure presentation logic: no database access and no React, so the screen and
 * its client components share one source of truth and the rules can be
 * unit-tested directly.
 *
 * Resources and DevelopmentTargets form the positive/development part of the
 * model (SPEC §8.18/§8.19). A Resource is never derived from problem reduction,
 * and neither a Resource nor a target is rendered as a conclusion without its
 * evidence and the limits of that evidence.
 */

export const RESOURCE_STATUS_LABELS: Record<string, string> = {
  active: "Активен",
  archived: "В архиве",
};

export const RESOURCE_REVIEW_STATUS_LABELS: Record<string, string> = {
  pending: "Предложение AI, ожидает ревью",
  approved: "Подтверждён человеком",
  rejected: "Отклонён человеком",
};

export const RESOURCE_TREND_LABELS: Record<string, string> = {
  strengthening: "Усиливается",
  stable: "Стабилен",
  weakening: "Ослабевает",
  unknown: "Не определён",
};

export const RESOURCE_VISIBILITY_LABELS: Record<string, string> = {
  internal: "Внутренняя",
  sensitive: "Чувствительная",
  client_visible: "Видно клиенту",
};

export const DEVELOPMENT_TARGET_IMPORTANCE_LABELS: Record<string, string> = {
  low: "Низкая",
  normal: "Обычная",
  high: "Высокая",
};

export const DEVELOPMENT_TARGET_STATUS_LABELS: Record<string, string> = {
  active: "Активна",
  achieved: "Достигнута",
  archived: "В архиве",
};

export const RESOURCE_EVIDENCE_LABEL = "Доказательства ресурса";
export const DEVELOPMENT_TARGET_LIMITS_LABEL = "Ограничения данных цели развития";

export interface ResourceEvidenceInput {
  reviewStatus: string;
  strengthScore: number | null;
  confidenceScore: number | null;
  evidenceSummary: string | null;
  evidenceRefs: string[];
}

export interface ResourceEvidenceResult {
  /** Whether the Resource carries any traceable evidence at all. */
  hasEvidence: boolean;
  /** What to render in the evidence slot. */
  summary: string | null;
  limits: string[];
}

/**
 * Whether a Resource may be presented as a confirmed strength. An empty evidence
 * description, an unreviewed or rejected AI proposal and a missing score each
 * add an explicit limit, so the screen never shows a bare "resource".
 */
export function resourceEvidence(input: ResourceEvidenceInput): ResourceEvidenceResult {
  const summary = input.evidenceSummary?.trim() ?? "";
  const hasEvidence = summary.length > 0 || input.evidenceRefs.length > 0;
  const limits: string[] = [];

  if (!hasEvidence) {
    limits.push("Нет описания доказательств: ресурс не подтверждён данными.");
  }
  if (input.reviewStatus === "pending") {
    limits.push("Предложение AI (L0): до решения человека не считается подтверждённым ресурсом.");
  }
  if (input.reviewStatus === "rejected") {
    limits.push("Отклонён человеком: не является подтверждённым ресурсом.");
  }
  if (input.strengthScore === null) {
    limits.push("Сила ресурса не оценена.");
  }
  if (input.confidenceScore === null) {
    limits.push("Уверенность в ресурсе не оценена.");
  }

  return { hasEvidence, summary: summary.length > 0 ? summary : null, limits };
}

export interface DevelopmentTargetLimitsInput {
  status: string;
  currentLevel: number | null;
  targetLevel: number | null;
  successMarkers: string[];
  linkedResources: string[];
  linkedCoreNodes: string[];
}

export interface DevelopmentTargetLimitsResult {
  hasEvidence: boolean;
  limits: string[];
}

/**
 * Whether a DevelopmentTarget is measurable and traceable to the model. A target
 * without levels, without success markers or without any link to a Resource or a
 * CoreNode is shown together with its limits instead of as an achieved outcome.
 */
export function developmentTargetLimits(
  input: DevelopmentTargetLimitsInput
): DevelopmentTargetLimitsResult {
  const limits: string[] = [];
  const hasLinks = input.linkedResources.length > 0 || input.linkedCoreNodes.length > 0;
  const hasLevels = input.currentLevel !== null && input.targetLevel !== null;

  if (!hasLevels) {
    limits.push("Уровни не заполнены: прогресс нельзя измерить.");
  }
  if (input.successMarkers.length === 0) {
    limits.push("Маркеры успеха не заданы: достижение цели не проверяемо.");
  }
  if (!hasLinks) {
    limits.push("Нет связей с ресурсами или ключевыми узлами: цель не прослеживается в модели.");
  }
  if (input.status === "achieved" && !hasLevels) {
    limits.push("Цель отмечена достигнутой без измеренных уровней.");
  }

  return { hasEvidence: input.successMarkers.length > 0 || hasLinks, limits };
}
