/**
 * Presentation rule for the snapshot-version model-change read model (ticket 14).
 *
 * Pure logic: no database access and no React, so the model-change read model
 * and the existing snapshot screen share one source of truth and the rule can be
 * unit-tested directly.
 *
 * Two guarantees are encoded here:
 *   - every model change is presented together with a link to its Evidence
 *     Trail; when the Evidence Drawer has no trail for the entity type the UI
 *     says so explicitly instead of rendering a dead or invented link;
 *   - the version-bounded interval never claims more than the stored data
 *     supports: missing hypotheses/contradictions and the fact that state older
 *     than the interval is not reconstructed are named explicitly
 *     («недостаточно данных»), never hidden.
 */

import { EVIDENCE_ENTITY_TYPES } from "./evidence";

export const INSUFFICIENT_DATA_LABEL = "Недостаточно данных";

/**
 * Evidence Trail href for an entity that has one, or null when the Evidence
 * Drawer does not support the entity type (e.g. a FollowUp or a
 * BehavioralMarker). The caller renders an explicit insufficient-data note for
 * null instead of a link that would fail validation.
 */
export function evidenceTrailHref(
  clientId: string,
  entityType: string,
  entityId: string
): string | null {
  if (!(EVIDENCE_ENTITY_TYPES as readonly string[]).includes(entityType)) return null;
  return `/clients/${clientId}/evidence/${entityType}/${entityId}`;
}

export interface IntervalDataLimitsInput {
  /** Previous snapshot boundary (exclusive); null when there is no previous version. */
  from: string | null;
  /** ModelChange rows recorded inside the interval. */
  changeCount: number;
  /** DifferentialHypotheses created inside the interval. */
  hypothesisCount: number;
  /** Contradiction relations created inside the interval. */
  contradictionCount: number;
  /** Interval hypotheses that carry contradicting-evidence entries. */
  hypothesesWithContradictingEvidence: number;
}

/**
 * Deterministic list of everything the version-bounded read model cannot show.
 * The list is never empty for a real interval: even a complete interval states
 * that state older than the previous snapshot is not reconstructed.
 */
export function intervalDataLimits(input: IntervalDataLimitsInput): string[] {
  const limits: string[] = [];

  if (input.from === null) {
    limits.push(
      `${INSUFFICIENT_DATA_LABEL}: нет предыдущей версии snapshot — интервал изменений не определён.`
    );
    return limits;
  }

  if (input.changeCount === 0 && input.hypothesisCount === 0 && input.contradictionCount === 0) {
    limits.push(
      `${INSUFFICIENT_DATA_LABEL}: между этими версиями новые изменения модели, DifferentialHypotheses и противоречия не зафиксированы.`
    );
  } else {
    if (input.hypothesisCount === 0) {
      limits.push(
        `${INSUFFICIENT_DATA_LABEL}: между этими версиями новые DifferentialHypotheses не создавались.`
      );
    }
    if (input.contradictionCount === 0) {
      limits.push(
        `${INSUFFICIENT_DATA_LABEL}: между этими версиями новые противоречия (contradicts) не создавались.`
      );
    }
    if (input.changeCount === 0) {
      limits.push(`${INSUFFICIENT_DATA_LABEL}: между этими версиями ModelChange не зафиксировано.`);
    }
  }

  limits.push(
    "Версионный read model показывает только сущности, созданные внутри интервала: состояние сущностей, созданных раньше, задним числом не восстанавливается."
  );
  if (input.hypothesesWithContradictingEvidence > 0) {
    limits.push(
      "Противоречащие доказательства внутри гипотезы не имеют собственной метки времени и не ограничены интервалом версий."
    );
  }

  return limits;
}
