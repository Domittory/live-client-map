"use client";

import { useActionState, useState } from "react";
import {
  submitPortalFeedbackFormAction,
  type PortalFeedbackActionState,
} from "@/app/actions/feedback";
import { type FeedbackQuestion, type PortalFeedbackForm } from "@/lib/service/feedback-forms";

/**
 * Portal feedback forms (ticket 16).
 *
 * Only fields of the privacy-filtered portal projection are rendered: title,
 * questions and the expiry date. The submission posts to a Server Action that
 * carries just the form id and the answers — the client id is never part of the
 * request, because the atomic RPC derives it from the signed-in identity.
 *
 * The answers are assembled client-side into one JSON field so a fully dynamic
 * question list (scale / text / yes-no) needs no per-type server parsing.
 */

const INITIAL: PortalFeedbackActionState = { error: null, done: false };

export const PORTAL_QUESTION_TYPE_HINTS: Record<FeedbackQuestion["type"], string> = {
  scale_1_10: "Оцените от 1 до 10",
  text: "Свободный ответ",
  yes_no: "Да или нет",
};

function AnswerField({ question }: { question: FeedbackQuestion }) {
  const required = question.required ?? false;
  const testId = `portal-feedback-answer-${question.key}`;

  if (question.type === "scale_1_10") {
    return (
      <label>
        {question.label}
        {required ? " *" : ""}
        <select
          name={`answer-${question.key}`}
          defaultValue=""
          required={required}
          data-testid={testId}
        >
          <option value="">Не выбрано</option>
          {Array.from({ length: 10 }, (_, index) => index + 1).map((value) => (
            <option key={value} value={String(value)}>
              {value}
            </option>
          ))}
        </select>
      </label>
    );
  }

  if (question.type === "yes_no") {
    return (
      <label>
        {question.label}
        {required ? " *" : ""}
        <select
          name={`answer-${question.key}`}
          defaultValue=""
          required={required}
          data-testid={testId}
        >
          <option value="">Не выбрано</option>
          <option value="yes">Да</option>
          <option value="no">Нет</option>
        </select>
      </label>
    );
  }

  return (
    <label>
      {question.label}
      {required ? " *" : ""}
      <textarea name={`answer-${question.key}`} rows={3} required={required} data-testid={testId} />
    </label>
  );
}

function PortalFeedbackFormCard({ form }: { form: PortalFeedbackForm }) {
  const [state, action, pending] = useActionState(submitPortalFeedbackFormAction, INITIAL);
  const [answersJson, setAnswersJson] = useState("{}");

  /** Collect every answer field into the single JSON payload the action reads. */
  function collectAnswers(formElement: HTMLFormElement) {
    const answers: Record<string, string> = {};
    for (const question of form.questions) {
      const field = formElement.elements.namedItem(`answer-${question.key}`);
      if (field && "value" in field) {
        const value = String((field as { value: unknown }).value).trim();
        if (value.length > 0) answers[question.key] = value;
      }
    }
    setAnswersJson(JSON.stringify(answers));
  }

  return (
    <li data-testid="portal-feedback-form" data-form-id={form.id}>
      <h3 data-testid="portal-feedback-title">{form.title}</h3>
      <p className="hint" data-testid="portal-feedback-expires">
        Действует до: {form.expiresAt ?? "без ограничения срока"}
      </p>

      <form
        action={action}
        data-testid="portal-feedback-submit-form"
        onChange={(event) => collectAnswers(event.currentTarget)}
      >
        <input type="hidden" name="formId" value={form.id} />
        <input type="hidden" name="answersJson" value={answersJson} />
        {form.questions.map((question) => (
          <AnswerField key={question.key} question={question} />
        ))}
        <button type="submit" disabled={pending} data-testid="portal-feedback-submit">
          Отправить ответы
        </button>
        {state.error ? (
          <p className="error" role="alert" data-testid="portal-feedback-error">
            {state.error}
          </p>
        ) : null}
        {state.done ? (
          <p data-testid="portal-feedback-done" role="status">
            Спасибо! Ответы отправлены специалисту. Форма больше не отображается.
          </p>
        ) : null}
      </form>
    </li>
  );
}

export function PortalFeedbackSection({ forms }: { forms: PortalFeedbackForm[] }) {
  return (
    <section data-testid="portal-feedback">
      <h2>Формы обратной связи</h2>
      {forms.length === 0 ? (
        <p className="hint" data-testid="portal-feedback-empty">
          Сейчас нет форм, которые нужно заполнить.
        </p>
      ) : (
        <ul data-testid="portal-feedback-forms">
          {forms.map((form) => (
            <PortalFeedbackFormCard key={form.id} form={form} />
          ))}
        </ul>
      )}
      <p className="hint" data-testid="portal-feedback-note">
        Ответы видит только ваш специалист. Отправленный ответ становится материалом для работы и не
        является автоматическим выводом о вас.
      </p>
    </section>
  );
}
