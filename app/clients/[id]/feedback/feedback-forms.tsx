"use client";

import { useActionState, useState } from "react";
import {
  createFeedbackFormAction,
  sendFeedbackFormAction,
  type FeedbackActionState,
} from "@/app/actions/feedback";
import {
  FEEDBACK_QUESTION_TYPES,
  formatFeedbackAnswers,
  type FeedbackFormRow,
  type FeedbackQuestionType,
} from "@/lib/service/feedback-forms";

/**
 * Specialist feedback forms (ticket 16).
 *
 * The client id always comes from the workspace (hidden field); the specialist
 * never types an id, and the section is only rendered for write access. Sending
 * is an explicit per-form action — a draft never becomes visible to the portal
 * on its own. Completed answers are shown read-only: the submission has already
 * produced a pending Signal, and this screen does not (and must not) confirm it
 * as evidence.
 */

const INITIAL: FeedbackActionState = { error: null, sent: false, done: false };

export const FEEDBACK_STATUS_LABELS: Record<string, string> = {
  draft: "черновик",
  sent: "отправлена клиенту",
  completed: "заполнена клиентом",
  expired: "истекла",
};

export function feedbackStatusLabel(status: string): string {
  return FEEDBACK_STATUS_LABELS[status] ?? status;
}

export const FEEDBACK_QUESTION_TYPE_LABELS: Record<FeedbackQuestionType, string> = {
  scale_1_10: "Оценка 1–10",
  text: "Свободный ответ",
  yes_no: "Да / Нет",
};

let rowCounter = 0;
function nextRowKey(): string {
  rowCounter += 1;
  return `q${rowCounter}`;
}

/**
 * A stable, ASCII answer key for a question. Non-Latin labels (this UI is
 * Russian) leave nothing behind, so the positional fallback is the normal case,
 * not the exception — the key only has to be stable and unique inside the form.
 */
function questionKey(value: string, index: number): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
  return slug.length > 0 ? slug : `q${index + 1}`;
}

interface QuestionDraft {
  rowId: string;
  label: string;
  type: FeedbackQuestionType;
  required: boolean;
}

export function FeedbackFormBuilder({ clientId }: { clientId: string }) {
  const [state, action, pending] = useActionState(createFeedbackFormAction, INITIAL);
  const [rows, setRows] = useState<QuestionDraft[]>([
    { rowId: nextRowKey(), label: "", type: "text", required: true },
  ]);

  const payload = rows
    .filter((row) => row.label.trim().length > 0)
    .map((row, index) => ({
      key: questionKey(row.label, index),
      label: row.label.trim(),
      type: row.type,
      required: row.required,
    }));

  function updateRow(rowId: string, patch: Partial<QuestionDraft>) {
    setRows((current) => current.map((row) => (row.rowId === rowId ? { ...row, ...patch } : row)));
  }

  return (
    <section>
      <h2>Новая форма обратной связи</h2>
      <p className="hint" data-testid="feedback-policy-note">
        Форма создаётся как черновик. Клиент увидит её в портале только после отправки, и только
        пока не истёк срок действия. Ответ клиента попадает в модель как сигнал «ожидает ревью»: он
        не подтверждает гипотезы автоматически и не повышает уровень доказательности.
      </p>
      <form action={action} data-testid="feedback-form">
        <input type="hidden" name="clientId" value={clientId} />
        <label>
          Название формы
          <input name="title" type="text" required data-testid="feedback-title-input" />
        </label>

        <fieldset>
          <legend>Вопросы</legend>
          <ul data-testid="feedback-question-rows">
            {rows.map((row, index) => (
              <li key={row.rowId} data-testid="feedback-question-row">
                <label>
                  Вопрос {index + 1}
                  <input
                    type="text"
                    value={row.label}
                    onChange={(event) => updateRow(row.rowId, { label: event.target.value })}
                    data-testid="feedback-question-label"
                  />
                </label>
                <label>
                  Тип ответа
                  <select
                    value={row.type}
                    aria-label={`Тип ответа ${index + 1}`}
                    onChange={(event) =>
                      updateRow(row.rowId, { type: event.target.value as FeedbackQuestionType })
                    }
                  >
                    {FEEDBACK_QUESTION_TYPES.map((type) => (
                      <option key={type} value={type}>
                        {FEEDBACK_QUESTION_TYPE_LABELS[type]}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={row.required}
                    onChange={(event) => updateRow(row.rowId, { required: event.target.checked })}
                  />
                  Обязательный
                </label>
                {rows.length > 1 ? (
                  <button
                    type="button"
                    onClick={() =>
                      setRows((current) => current.filter((entry) => entry.rowId !== row.rowId))
                    }
                  >
                    Удалить вопрос
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={() =>
              setRows((current) => [
                ...current,
                { rowId: nextRowKey(), label: "", type: "text", required: false },
              ])
            }
            data-testid="feedback-add-question"
          >
            Добавить вопрос
          </button>
        </fieldset>

        {payload.map((question) => (
          <input
            key={question.key}
            type="hidden"
            name="questions"
            value={JSON.stringify(question)}
          />
        ))}

        <button type="submit" disabled={pending} data-testid="feedback-create-submit">
          Создать форму
        </button>
        {state.error ? (
          <p className="error" role="alert" data-testid="feedback-create-error">
            {state.error}
          </p>
        ) : null}
        {state.done && !state.error ? (
          <p data-testid="feedback-create-sent">Форма создана как черновик.</p>
        ) : null}
      </form>
    </section>
  );
}

export function FeedbackFormCard({ clientId, form }: { clientId: string; form: FeedbackFormRow }) {
  const [state, action, pending] = useActionState(sendFeedbackFormAction, INITIAL);
  const answers = formatFeedbackAnswers(form.questions, form.answers);

  return (
    <li data-testid="feedback-form-row" data-form-id={form.id} data-form-status={form.status}>
      <h3 data-testid="feedback-form-title">{form.title}</h3>
      <p className="hint" data-testid="feedback-form-questions">
        Вопросов: {form.questions.length}
      </p>
      <ul className="signal-meta">
        <li data-testid="feedback-form-status">Статус: {feedbackStatusLabel(form.status)}</li>
        <li data-testid="feedback-form-expires">Действует до: {form.expiresAt ?? "—"}</li>
        {form.status === "completed" ? (
          <li data-testid="feedback-form-answered">
            Отвечено вопросов: {form.answeredCount} из {form.questions.length}
          </li>
        ) : null}
      </ul>

      {form.status === "completed" ? (
        <div data-testid="feedback-form-answers">
          <h4>Ответы клиента</h4>
          <ul>
            {answers.map((line) => (
              <li key={line} data-testid="feedback-answer">
                {line}
              </li>
            ))}
          </ul>
          <p className="hint" data-testid="feedback-evidence-note">
            Ответ поступил как сигнал «ожидает ревью» (self-report, L1). Он не подтверждает гипотезы
            автоматически и не повышает уверенность модели — решение принимает специалист в разделе
            «Ревью модели».
          </p>
        </div>
      ) : null}

      {form.status === "draft" ? (
        <form className="inline-form" action={action} data-testid="feedback-send-form">
          <input type="hidden" name="clientId" value={clientId} />
          <input type="hidden" name="formId" value={form.id} />
          <button type="submit" disabled={pending} data-testid="feedback-send-submit">
            Отправить клиенту
          </button>
          {state.error ? (
            <p className="error" role="alert" data-testid="feedback-send-error">
              {state.error}
            </p>
          ) : null}
          {state.sent ? <p data-testid="feedback-send-done">Форма отправлена клиенту.</p> : null}
        </form>
      ) : null}
    </li>
  );
}
