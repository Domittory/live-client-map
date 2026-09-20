"use client";

import { useActionState } from "react";
import {
  createDiagnosticSessionAction,
  createSignalAction,
  reviewSignalAction,
  type DiagnosticsActionState,
} from "@/app/actions/diagnostics";
import {
  EPISTEMIC_TYPE_LABELS,
  EVIDENCE_LEVEL_LABELS,
  INSUFFICIENT_DATA_LABEL,
  POLARITY_LABELS,
  REVIEW_STATUS_LABELS,
  SESSION_TYPE_LABELS,
  SIGNAL_SOURCE_TYPES_UI,
  SOURCE_TYPE_LABELS,
  TEST_RESULT_LABELS,
  VISIBILITY_LABELS,
  labelFor,
} from "@/lib/service/diagnostics-presentation";

/**
 * Diagnostics client components (ticket 10).
 *
 * Every mutation is a form post to a Server Action; the action resolves the
 * client through RLS and the atomic RPC rechecks write access, so the browser
 * only ever supplies business fields. Review controls are rendered for each
 * Signal individually, so a review decision is always an explicit action on one
 * Signal — never a bulk promotion of pending evidence.
 */

const INITIAL: DiagnosticsActionState = { error: null };

export interface SessionOption {
  id: string;
  title: string;
  sessionType: string;
}

export interface SignalView {
  id: string;
  sourceType: string;
  epistemicType: string;
  reviewStatus: string;
  evidenceLevel: string;
  visibility: string;
  rawStatement: string;
  polarity: string | null;
  testResult: string | null;
  normalizedMeaning: string | null;
  intensity: number | null;
  confidence: number | null;
  lifeAreas: string[];
  tags: string[];
  createdAt: string;
  lineage: { id: string; title: string; sessionType: string } | null;
  interpretation: string;
  insufficientReason: string | null;
}

export function DiagnosticSessionForm({
  clientId,
  defaultSessionType,
}: {
  clientId: string;
  defaultSessionType: string;
}) {
  const [state, action, pending] = useActionState(createDiagnosticSessionAction, INITIAL);

  return (
    <section>
      <h2>Новая диагностическая сессия</h2>
      <p className="hint">
        Сессия создаётся по этому клиенту; идентификатор клиента вводить не нужно.
      </p>
      <form action={action} data-testid="diagnostic-session-form">
        <input type="hidden" name="clientId" value={clientId} />
        <label>
          Название сессии
          <input name="title" type="text" required placeholder="Например: Сессия 1" />
        </label>
        <label>
          Тип сессии
          <select name="sessionType" aria-label="Тип сессии" defaultValue={defaultSessionType}>
            {Object.entries(SESSION_TYPE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Исходные данные
          <textarea name="rawInput" rows={4} placeholder="Сырой протокол или заметки сессии" />
        </label>
        <label>
          Заметки
          <textarea name="notes" rows={2} />
        </label>
        <button type="submit" disabled={pending}>
          Создать сессию
        </button>
        {state.error ? (
          <p className="error" role="alert" data-testid="diagnostic-session-error">
            {state.error}
          </p>
        ) : null}
      </form>
    </section>
  );
}

export function SignalForm({
  clientId,
  sessions,
}: {
  clientId: string;
  sessions: SessionOption[];
}) {
  const [state, action, pending] = useActionState(createSignalAction, INITIAL);

  return (
    <section>
      <h2>Новый сигнал</h2>
      <p className="hint">
        Сигнал, добавленный специалистом через интерфейс, считается подтверждённым человеком.
        AI-импорт создаёт сигналы только со статусом «ожидает ревью».
      </p>
      <form action={action} data-testid="signal-form">
        <input type="hidden" name="clientId" value={clientId} />
        <label>
          Сессия (lineage)
          <select name="diagnosticSessionId" aria-label="Сессия" defaultValue="">
            <option value="">Без сессии</option>
            {sessions.map((session) => (
              <option key={session.id} value={session.id}>
                {session.title}
              </option>
            ))}
          </select>
        </label>
        <label>
          Источник
          <select name="sourceType" aria-label="Источник" defaultValue="kinesiology_test">
            {SIGNAL_SOURCE_TYPES_UI.map((value) => (
              <option key={value} value={value}>
                {labelFor(SOURCE_TYPE_LABELS, value)}
              </option>
            ))}
          </select>
        </label>
        <label>
          Эпистемический тип
          <select name="epistemicType" aria-label="Эпистемический тип" defaultValue="test_result">
            {Object.entries(EPISTEMIC_TYPE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Исходное утверждение
          <textarea name="rawStatement" rows={2} required />
        </label>
        <label>
          Формулировка
          <select name="statementPolarity" aria-label="Формулировка" defaultValue="">
            <option value="">Не указана</option>
            {Object.entries(POLARITY_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Результат теста
          <select name="testResult" aria-label="Результат теста" defaultValue="">
            <option value="">Не указан</option>
            {Object.entries(TEST_RESULT_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Нормализованное значение
          <textarea
            name="normalizedMeaning"
            rows={2}
            placeholder="Клинический смысл сигнала (без выводов, которые не подтверждены)"
          />
        </label>
        <label>
          Интенсивность (0–100)
          <input name="intensity" type="number" min={0} max={100} step={1} />
        </label>
        <label>
          Уверенность (0–100)
          <input name="confidence" type="number" min={0} max={100} step={1} />
        </label>
        <label>
          Сферы жизни (через запятую)
          <input name="lifeAreas" type="text" placeholder="работа, отношения" />
        </label>
        <label>
          Теги (через запятую)
          <input name="tags" type="text" />
        </label>
        <label>
          Видимость
          <select name="visibility" aria-label="Видимость" defaultValue="internal">
            {Object.entries(VISIBILITY_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" disabled={pending}>
          Добавить сигнал
        </button>
        {state.error ? (
          <p className="error" role="alert" data-testid="signal-form-error">
            {state.error}
          </p>
        ) : null}
      </form>
    </section>
  );
}

export function SignalCard({
  clientId,
  signal,
  canWrite,
}: {
  clientId: string;
  signal: SignalView;
  canWrite: boolean;
}) {
  const [state, action, pending] = useActionState(reviewSignalAction, INITIAL);

  return (
    <li data-testid="signal-row" data-signal-id={signal.id}>
      <p data-testid="signal-statement">{signal.rawStatement}</p>
      <ul className="signal-meta" data-testid="signal-meta">
        <li data-testid="signal-source">
          Источник: {labelFor(SOURCE_TYPE_LABELS, signal.sourceType)}
        </li>
        <li data-testid="signal-epistemic">
          Эпистемический тип: {labelFor(EPISTEMIC_TYPE_LABELS, signal.epistemicType)}
        </li>
        <li data-testid="signal-review-status">
          Статус ревью: {labelFor(REVIEW_STATUS_LABELS, signal.reviewStatus)}
        </li>
        <li data-testid="signal-evidence-level">
          Уровень доказательности: {labelFor(EVIDENCE_LEVEL_LABELS, signal.evidenceLevel)}
        </li>
        <li data-testid="signal-visibility">
          Видимость: {labelFor(VISIBILITY_LABELS, signal.visibility)}
        </li>
        <li data-testid="signal-lineage">
          Lineage:{" "}
          {signal.lineage
            ? `сессия «${signal.lineage.title}» (${labelFor(
                SESSION_TYPE_LABELS,
                signal.lineage.sessionType
              )})`
            : "без сессии"}
        </li>
        <li data-testid="signal-created-at">
          Зафиксирован: <time dateTime={signal.createdAt}>{signal.createdAt}</time>
        </li>
      </ul>

      <dl className="signal-fields" data-testid="signal-fields">
        <dt>Формулировка</dt>
        <dd data-testid="signal-polarity">{labelFor(POLARITY_LABELS, signal.polarity)}</dd>
        <dt>Результат теста</dt>
        <dd data-testid="signal-test-result">{labelFor(TEST_RESULT_LABELS, signal.testResult)}</dd>
        <dt>Интенсивность</dt>
        <dd data-testid="signal-intensity">
          {signal.intensity === null ? "—" : String(signal.intensity)}
        </dd>
        <dt>Уверенность</dt>
        <dd data-testid="signal-confidence">
          {signal.confidence === null ? "—" : String(signal.confidence)}
        </dd>
        <dt>Сферы жизни</dt>
        <dd data-testid="signal-life-areas">
          {signal.lifeAreas.length > 0 ? signal.lifeAreas.join(", ") : "—"}
        </dd>
        <dt>Теги</dt>
        <dd data-testid="signal-tags">{signal.tags.length > 0 ? signal.tags.join(", ") : "—"}</dd>
      </dl>

      <p className="signal-interpretation" data-testid={`signal-interpretation-${signal.id}`}>
        Значение: {signal.interpretation}
      </p>
      {signal.insufficientReason ? (
        <p className="hint" data-testid={`signal-insufficient-${signal.id}`}>
          {INSUFFICIENT_DATA_LABEL}: {signal.insufficientReason}
        </p>
      ) : null}

      <form className="review-form" action={action} data-testid="signal-review-form">
        {canWrite ? (
          <>
            <input type="hidden" name="clientId" value={clientId} />
            <input type="hidden" name="signalId" value={signal.id} />
            <label>
              Действие ревью
              <select name="action" aria-label="Действие ревью" defaultValue="approve">
                <option value="approve">Подтвердить</option>
                <option value="reject">Отклонить</option>
                <option value="mark_sensitive">Пометить как чувствительный</option>
                <option value="hide">Скрыть</option>
              </select>
            </label>
            <label>
              Причина (обязательна для отклонения и скрытия)
              <input name="reason" type="text" />
            </label>
            <button type="submit" disabled={pending}>
              Применить ревью
            </button>
            {state.error ? (
              <p className="error" role="alert" data-testid="signal-review-error">
                {state.error}
              </p>
            ) : null}
          </>
        ) : (
          <p className="hint" data-testid="signal-review-read-only">
            Ревью доступно специалистам с правом записи.
          </p>
        )}
      </form>
    </li>
  );
}
