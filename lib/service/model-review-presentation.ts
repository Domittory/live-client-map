/**
 * Russian labels and the "not enough data" rule for the client model review
 * screen (ticket 12).
 *
 * Pure presentation logic: no database access and no React, so the review page
 * and its client components share one source of truth and the rule can be
 * unit-tested directly.
 *
 * The rule mirrors the diagnostics screen: a conclusion (Theme, CoreNode,
 * DifferentialHypothesis) is only presented together with its evidence trail.
 * When there is no supporting evidence, or the entity is still an unreviewed AI
 * proposal, the UI shows «недостаточно данных» instead of a bare conclusion —
 * the screen never promotes an AI proposal on its own.
 */

export const THEME_REVIEW_STATUS_LABELS: Record<string, string> = {
  pending: "Предложение AI, ожидает ревью",
  approved: "Подтверждена человеком",
  rejected: "Отклонена человеком",
};

export const CORE_NODE_STATUS_LABELS: Record<string, string> = {
  hypothesis: "Гипотеза (не подтверждена человеком)",
  active: "Подтверждён человеком",
  in_treatment: "В работе",
  treated_unverified: "Проработан без независимого подтверждения",
  weakened: "Ослаблен",
  integrated: "Интегрирован",
  reactivated: "Реактивирован",
  contradicted: "Противоречит данным",
  under_review: "Предложение AI, ожидает ревью",
  rejected: "Отклонён человеком",
  archived: "В архиве",
};

export const HYPOTHESIS_STATUS_LABELS: Record<string, string> = {
  hypothesis: "Гипотеза (не подтверждена человеком)",
  active: "Подтверждена человеком",
  rejected: "Отклонена человеком",
  archived: "В архиве",
};

/** Relationship vocabulary of Theme ↔ CoreNode links and CoreNode relations. */
export const RELATION_TYPE_LABELS: Record<string, string> = {
  supports: "Подтверждает",
  contradicts: "Противоречит",
  may_contribute_to: "Может вносить вклад",
  reinforces: "Усиливает",
  protects_from: "Защищает от",
  compensates_for: "Компенсирует",
  triggers: "Запускает",
  depends_on: "Зависит от",
  unlocks: "Открывает доступ",
  is_variant_of: "Является вариантом",
  associated_with: "Связан с",
  supports_hypothesis_of: "Поддерживает гипотезу о",
  causes_confirmed: "Причина подтверждена человеком",
};

export const SUPPORTING_EVIDENCE_LABEL = "Подтверждающие доказательства";
export const CONTRADICTING_EVIDENCE_LABEL = "Противоречащие доказательства";
export const NO_CONTRADICTING_EVIDENCE_LABEL = "Противоречащих доказательств нет.";
export const DATA_LIMITS_LABEL = "Ограничения данных";

/** Statuses that mark an entity as an unreviewed AI proposal (SPEC §36). */
export const AI_PROPOSAL_THEME_STATUS = "pending";
export const AI_PROPOSAL_CORE_NODE_STATUS = "under_review";
export const AI_PROPOSAL_HYPOTHESIS_STATUS = "hypothesis";

export type ReviewConclusionType = "theme" | "core_node" | "differential_hypothesis";

export interface ConclusionLimitsInput {
  entityType: ReviewConclusionType;
  /** review_status for a theme, status for a core node / hypothesis. */
  state: string;
  supportingCount: number;
  contradictingCount: number;
  independentEvidenceCount?: number | null;
  /** Core nodes only: whether the conclusion is traceable to a theme. */
  hasThemeLinks?: boolean;
}

export interface ConclusionLimits {
  /** Whether the conclusion has any supporting evidence at all. */
  hasSupportingEvidence: boolean;
  /** Reasons the data is incomplete; empty when the evidence is complete. */
  limits: string[];
}

/**
 * Whether a conclusion may be presented as anything more than a hypothesis.
 * The inputs are deliberately narrow so the rule stays testable: empty
 * supporting evidence, an unreviewed AI state and unproven independence each
 * add an explicit limit instead of being hidden.
 */
export function conclusionLimits(input: ConclusionLimitsInput): ConclusionLimits {
  const limits: string[] = [];

  if (input.supportingCount === 0) {
    limits.push("Нет подтверждающих доказательств: вывод не сформирован.");
  }
  if (isAiProposal(input.entityType, input.state)) {
    limits.push(
      "Предложение AI (L0): до решения человека не считается независимым доказательством."
    );
  }
  if (input.state === "rejected") {
    limits.push("Отклонено человеком: не является подтверждённым выводом.");
  }
  if (input.entityType === "theme") {
    if (input.supportingCount > 0 && (input.independentEvidenceCount ?? 0) === 0) {
      limits.push("Нет независимых контекстов: сигналы могут быть не независимыми.");
    }
  }
  if (input.entityType === "core_node" && input.hasThemeLinks === false) {
    limits.push("Нет связанных тем: происхождение вывода не прослеживается.");
  }
  if (input.contradictingCount > 0) {
    limits.push("Есть противоречащие доказательства: вывод не является единственным объяснением.");
  }

  return { hasSupportingEvidence: input.supportingCount > 0, limits };
}

/** True when the entity is still an AI proposal awaiting a human decision. */
export function isAiProposal(entityType: ReviewConclusionType, state: string): boolean {
  if (entityType === "theme") return state === AI_PROPOSAL_THEME_STATUS;
  if (entityType === "core_node") return state === AI_PROPOSAL_CORE_NODE_STATUS;
  return state === AI_PROPOSAL_HYPOTHESIS_STATUS;
}

/**
 * Whether the entity state still allows an explicit approve/reject decision.
 * A human-created CoreNode working hypothesis is reviewable too (it is not yet
 * a confirmed entity), while a confirmed one is never re-decided here.
 */
export function isReviewable(entityType: ReviewConclusionType, state: string): boolean {
  if (entityType === "core_node") {
    return state === AI_PROPOSAL_CORE_NODE_STATUS || state === AI_PROPOSAL_HYPOTHESIS_STATUS;
  }
  return isAiProposal(entityType, state);
}
