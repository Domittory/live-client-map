/**
 * Russian labels and the "not enough data" rule for the client diagnostics
 * screen (ticket 10).
 *
 * Pure presentation logic: no database access and no React, so the diagnostics
 * page and its client components share one source of truth and the rule can be
 * unit-tested directly.
 *
 * The rule is deliberately conservative: a Signal is only rendered as an
 * interpretation when it carries a human-reviewable statement and was not
 * produced by AI alone. Everything else — an empty statement, a missing
 * normalized meaning, an L0 AI-only hypothesis, a rejected or still pending
 * Signal — is shown as «недостаточно данных» instead of a conclusion.
 */

export const SESSION_TYPE_LABELS: Record<string, string> = {
  individual: "Индивидуальная сессия",
  topic_test: "Тест темы",
  follow_up_test: "Повторный тест",
  correction_check: "Проверка коррекции",
  import: "Импорт",
  baseline: "Базовая диагностика",
};

export const SOURCE_TYPE_LABELS: Record<string, string> = {
  kinesiology_test: "Кинезиологический тест",
  client_report: "Рассказ клиента",
  specialist_observation: "Наблюдение специалиста",
  life_event: "Жизненное событие",
  questionnaire: "Опросник",
  partner_report: "Рассказ партнёра",
  follow_up: "Повторная проверка",
  imported_note: "Импортированная заметка",
  ai_hypothesis: "AI-гипотеза",
};

export const EPISTEMIC_TYPE_LABELS: Record<string, string> = {
  fact: "Факт",
  self_report: "Самонаблюдение клиента",
  test_result: "Результат теста",
  observation: "Наблюдение",
  interpretation: "Интерпретация",
  hypothesis: "Гипотеза",
};

/**
 * Ordered options for the source-type dropdown. It is kept as an explicit list
 * (not derived from the service module) so the UI has no runtime dependency on
 * the persistence layer; a unit test asserts it stays equal to the service enum.
 */
export const SIGNAL_SOURCE_TYPES_UI = [
  "kinesiology_test",
  "client_report",
  "specialist_observation",
  "life_event",
  "questionnaire",
  "partner_report",
  "follow_up",
  "imported_note",
  "ai_hypothesis",
] as const;

export const REVIEW_STATUS_LABELS: Record<string, string> = {
  pending: "Ожидает ревью",
  approved: "Подтверждено человеком",
  rejected: "Отклонено человеком",
};

export const EVIDENCE_LEVEL_LABELS: Record<string, string> = {
  L0_AI_ONLY: "L0 — только AI, без независимого подтверждения",
  L1_SINGLE_SIGNAL: "L1 — один сигнал (слабая гипотеза)",
  L2_MULTIPLE_SIGNALS: "L2 — несколько сигналов",
  L3_MULTI_CONTEXT: "L3 — несколько независимых контекстов",
  L4_RETEST_CONFIRMED: "L4 — подтверждено повторным тестом",
  L5_BEHAVIOR_CONFIRMED: "L5 — подтверждено поведением",
  L6_CORRECTION_RESPONSE_CONFIRMED: "L6 — подтверждено ответом на коррекцию",
  L7_SPECIALIST_CONFIRMED_LONGITUDINAL: "L7 — подтверждено специалистом продольно",
};

export const POLARITY_LABELS: Record<string, string> = {
  positive: "Позитивная формулировка",
  negative: "Негативная формулировка",
  neutral: "Нейтральная формулировка",
  mixed: "Смешанная формулировка",
  unknown: "Не определена",
};

export const TEST_RESULT_LABELS: Record<string, string> = {
  stress: "Стресс",
  no_stress: "Без стресса",
  unknown: "Неизвестно",
  not_tested: "Не тестировалось",
};

export const VISIBILITY_LABELS: Record<string, string> = {
  internal: "Внутренняя",
  sensitive: "Чувствительная",
  client_visible: "Видно клиенту",
};

export const AI_PROCESSING_STATUS_LABELS: Record<string, string> = {
  not_started: "AI не запускался",
  pending: "AI в очереди",
  processing: "AI обрабатывает",
  completed: "AI обработал",
  failed: "AI завершился ошибкой",
};

/** Plain-language meaning of the evidence level (SPEC §11). */
export const EVIDENCE_LEVEL_MEANINGS: Record<string, string> = {
  L0_AI_ONLY: "не считается независимым доказательством",
  L1_SINGLE_SIGNAL: "достаточно только для слабой гипотезы",
  L2_MULTIPLE_SIGNALS: "сигналы могут быть не независимыми",
  L3_MULTI_CONTEXT: "независимые контексты подтверждены",
  L4_RETEST_CONFIRMED: "подтверждено повторным тестом",
  L5_BEHAVIOR_CONFIRMED: "подтверждено поведением",
  L6_CORRECTION_RESPONSE_CONFIRMED: "подтверждено ответом на коррекцию",
  L7_SPECIALIST_CONFIRMED_LONGITUDINAL: "подтверждено специалистом продольно",
};

export const INSUFFICIENT_DATA_LABEL = "недостаточно данных";

/**
 * Review actions are explicit: the database stores the reviewer's reason in the
 * audit row, defaulting it to a generic string when none is given. Evidence
 * removal therefore requires a real reason before the action is submitted —
 * anything else would silently promote or dismiss pending evidence.
 */
export const REASON_REQUIRED_ACTIONS = ["reject", "hide"] as const;

export function reasonRequired(action: string): boolean {
  return (REASON_REQUIRED_ACTIONS as readonly string[]).includes(action);
}

export type SignalReadiness = "interpretation" | "insufficient";

export interface SignalReadinessInput {
  source_type: string;
  raw_statement: string;
  normalized_meaning: string | null;
  evidence_level: string;
  review_status: string;
}

export interface SignalReadinessResult {
  readiness: SignalReadiness;
  /** Human-readable reason, always present when `readiness` is `insufficient`. */
  reason: string | null;
  /** What to render in the interpretation slot. */
  interpretation: string;
}

/**
 * Whether a Signal may be presented as an interpretation (SPEC §3.5, §11):
 * an AI-only Signal never counts as evidence of itself and an unreviewed or
 * rejected Signal is never promoted silently; both are shown as
 * «недостаточно данных».
 */
export function signalReadiness(signal: SignalReadinessInput): SignalReadinessResult {
  const statement = signal.raw_statement?.trim() ?? "";

  if (statement.length === 0) {
    return insufficient("Нет исходного утверждения сигнала.");
  }
  if (signal.evidence_level === "L0_AI_ONLY" || signal.source_type === "ai_hypothesis") {
    return insufficient("AI-гипотеза не является доказательством самой себя (L0).");
  }
  if (signal.review_status === "pending") {
    return insufficient("Сигнал ожидает ревью специалиста.");
  }
  if (signal.review_status === "rejected") {
    return insufficient("Сигнал отклонён на ревью.");
  }

  const meaning = signal.normalized_meaning?.trim() ?? "";
  if (meaning.length === 0) {
    return insufficient("Нормализованное значение не сформировано.");
  }

  return { readiness: "interpretation", reason: null, interpretation: meaning };
}

function insufficient(reason: string): SignalReadinessResult {
  return { readiness: "insufficient", reason, interpretation: INSUFFICIENT_DATA_LABEL };
}

/**
 * Safe label lookup. An unmapped enum value is rendered as a neutral Russian
 * placeholder rather than the raw database token, so a new enum member or a
 * corrupted row can never leak internals into the UI.
 */
export function labelFor(labels: Record<string, string>, value: string | null): string {
  if (!value) return "—";
  return labels[value] ?? "Неизвестное значение";
}
