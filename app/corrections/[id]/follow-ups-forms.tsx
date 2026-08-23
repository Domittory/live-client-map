"use client";

import { useActionState } from "react";
import {
  cancelFollowUpAction,
  completeFollowUpAction,
  evaluateCorrectionAction,
  reviewFollowUpAssessmentAction,
  scheduleFollowUpAction,
  type FollowUpState,
} from "@/app/actions/follow-ups";
import type { FollowUpFinalStatus } from "@/lib/service/follow-ups";

const initial: FollowUpState = { error: null };

const FINAL_STATUSES: FollowUpFinalStatus[] = [
  "effective",
  "partially_effective",
  "ineffective",
  "unclear",
];

export function ScheduleFollowUpForm({
  organizationId,
  clientId,
  correctionId,
}: {
  organizationId: string;
  clientId: string;
  correctionId: string;
}) {
  const [state, dispatch, pending] = useActionState(scheduleFollowUpAction, initial);

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        const formData = new FormData(event.currentTarget);
        const date = String(formData.get("scheduledAt") ?? "");
        dispatch({
          organizationId,
          clientId,
          correctionId,
          scheduledAt: date ? new Date(date).toISOString() : "",
        });
      }}
    >
      <label>
        Дата follow-up
        <input name="scheduledAt" type="datetime-local" required />
      </label>
      <button type="submit" disabled={pending}>
        Запланировать follow-up
      </button>
      {state.error && <p className="error">{state.error}</p>}
    </form>
  );
}

export function CompleteFollowUpForm({
  followUpId,
  correctionId,
}: {
  followUpId: string;
  correctionId: string;
}) {
  const [state, dispatch, pending] = useActionState(completeFollowUpAction, initial);

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        const formData = new FormData(event.currentTarget);
        const text = (name: string) => String(formData.get(name) ?? "").trim();
        const number = (name: string) => {
          const raw = text(name);
          return raw === "" ? undefined : Number(raw);
        };
        const contexts = text("retestContexts")
          .split(",")
          .map((value) => value.trim())
          .filter((value) => value.length > 0);
        const perceivedEffect = text("perceivedEffect");

        dispatch({
          followUpId,
          correctionId,
          ...(text("retestSummary")
            ? {
                retestResult: {
                  summary: text("retestSummary"),
                  ...(number("stressBefore") !== undefined
                    ? { stress_before: number("stressBefore") }
                    : {}),
                  ...(number("stressAfter") !== undefined
                    ? { stress_after: number("stressAfter") }
                    : {}),
                  ...(contexts.length > 0 ? { contexts } : {}),
                },
              }
            : {}),
          ...(text("behavioralSummary")
            ? { behavioralResult: { summary: text("behavioralSummary") } }
            : {}),
          ...(text("clientFeedbackSummary")
            ? {
                clientFeedback: {
                  summary: text("clientFeedbackSummary"),
                  ...(perceivedEffect
                    ? {
                        perceived_effect: perceivedEffect as "positive" | "neutral" | "negative",
                      }
                    : {}),
                },
              }
            : {}),
          ...(text("specialistAssessmentSummary")
            ? { specialistAssessment: { summary: text("specialistAssessmentSummary") } }
            : {}),
        });
      }}
    >
      <fieldset>
        <legend>Retest</legend>
        <label>
          Итог retest
          <textarea name="retestSummary" rows={2} maxLength={4000} />
        </label>
        <label>
          Stress до (0–100)
          <input name="stressBefore" type="number" min={0} max={100} />
        </label>
        <label>
          Stress после (0–100)
          <input name="stressAfter" type="number" min={0} max={100} />
        </label>
        <label>
          Контексты (через запятую)
          <input name="retestContexts" type="text" maxLength={2000} />
        </label>
      </fieldset>
      <label>
        Поведенческий результат
        <textarea name="behavioralSummary" rows={2} maxLength={4000} />
      </label>
      <fieldset>
        <legend>Обратная связь клиента</legend>
        <label>
          Отзыв клиента
          <textarea name="clientFeedbackSummary" rows={2} maxLength={4000} />
        </label>
        <label>
          Воспринимаемый эффект
          <select name="perceivedEffect" defaultValue="">
            <option value="">—</option>
            <option value="positive">positive</option>
            <option value="neutral">neutral</option>
            <option value="negative">negative</option>
          </select>
        </label>
      </fieldset>
      <label>
        Оценка специалиста
        <textarea name="specialistAssessmentSummary" rows={2} maxLength={4000} />
      </label>
      <button type="submit" disabled={pending}>
        Сохранить результаты follow-up
      </button>
      {state.error && <p className="error">{state.error}</p>}
    </form>
  );
}

export function EvaluateCorrectionButton({
  followUpId,
  correctionId,
}: {
  followUpId: string;
  correctionId: string;
}) {
  const [state, dispatch, pending] = useActionState(evaluateCorrectionAction, initial);
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        dispatch({ followUpId, correctionId });
      }}
      style={{ display: "inline" }}
    >
      <button type="submit" disabled={pending}>
        Оценить эффект (AI)
      </button>
      {state.error && <p className="error">{state.error}</p>}
    </form>
  );
}

export function ReviewAssessmentButtons({
  followUpId,
  correctionId,
  proposedStatus,
}: {
  followUpId: string;
  correctionId: string;
  proposedStatus: FollowUpFinalStatus;
}) {
  const [state, dispatch, pending] = useActionState(reviewFollowUpAssessmentAction, initial);

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        const formData = new FormData(event.currentTarget);
        const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
        const decision = submitter?.value === "reject" ? "reject" : "approve";
        const override = String(formData.get("finalStatus") ?? "");
        dispatch({
          followUpId,
          correctionId,
          decision,
          ...(decision === "approve" &&
          FINAL_STATUSES.includes(override as FollowUpFinalStatus) &&
          override !== proposedStatus
            ? { finalStatus: override as FollowUpFinalStatus }
            : {}),
        });
      }}
    >
      <label>
        Итоговый статус
        <select name="finalStatus" defaultValue={proposedStatus}>
          {FINAL_STATUSES.map((status) => (
            <option key={status} value={status}>
              {status}
            </option>
          ))}
        </select>
      </label>
      <button type="submit" name="decision" value="approve" disabled={pending}>
        Подтвердить оценку
      </button>
      <button type="submit" name="decision" value="reject" disabled={pending}>
        Отклонить оценку
      </button>
      {state.error && <p className="error">{state.error}</p>}
    </form>
  );
}

export function CancelFollowUpButton({
  followUpId,
  correctionId,
}: {
  followUpId: string;
  correctionId: string;
}) {
  const [state, dispatch, pending] = useActionState(cancelFollowUpAction, initial);
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        dispatch({ followUpId, correctionId });
      }}
      style={{ display: "inline" }}
    >
      <button type="submit" disabled={pending}>
        Отменить follow-up
      </button>
      {state.error && <p className="error">{state.error}</p>}
    </form>
  );
}
