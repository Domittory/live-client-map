"use client";

import { useActionState } from "react";
import {
  reviewCoreNodeAction,
  reviewHypothesisAction,
  reviewThemeAction,
  type ReviewActionState,
} from "@/app/actions/review";

/**
 * Model review client components (ticket 12).
 *
 * Every decision is a form post to a Server Action; the action resolves the
 * client through RLS and the atomic RPC rechecks write access, so the browser
 * only ever supplies the entity id and the decision. One form reviews exactly
 * one entity, so a pending AI proposal is never promoted in bulk and a
 * confirmed entity is never re-decided implicitly.
 */

const INITIAL: ReviewActionState = { error: null };

interface ReviewDecisionFormProps {
  action: (state: ReviewActionState, formData: FormData) => Promise<ReviewActionState>;
  hidden: Record<string, string>;
  testId: string;
  subject: string;
}

function ReviewDecisionForm({ action, hidden, testId, subject }: ReviewDecisionFormProps) {
  const [state, formAction, pending] = useActionState(action, INITIAL);

  return (
    <form className="review-form" action={formAction} data-testid={testId}>
      {Object.entries(hidden).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <label>
        Действие ревью
        <select name="decision" aria-label={`Действие ревью: ${subject}`} defaultValue="approve">
          <option value="approve">Подтвердить</option>
          <option value="reject">Отклонить</option>
        </select>
      </label>
      <label>
        Причина (обязательна для отклонения)
        <input name="reason" type="text" />
      </label>
      <button type="submit" disabled={pending}>
        Применить решение
      </button>
      {state.error ? (
        <p className="error" role="alert" data-testid={`${testId}-error`}>
          {state.error}
        </p>
      ) : null}
    </form>
  );
}

export function ThemeReviewForm({ clientId, themeId }: { clientId: string; themeId: string }) {
  return (
    <ReviewDecisionForm
      action={reviewThemeAction}
      hidden={{ clientId, themeId }}
      testId="theme-review-form"
      subject="тема"
    />
  );
}

export function CoreNodeReviewForm({
  clientId,
  coreNodeId,
}: {
  clientId: string;
  coreNodeId: string;
}) {
  return (
    <ReviewDecisionForm
      action={reviewCoreNodeAction}
      hidden={{ clientId, coreNodeId }}
      testId="core-node-review-form"
      subject="ключевой узел"
    />
  );
}

export function HypothesisReviewForm({
  clientId,
  hypothesisId,
}: {
  clientId: string;
  hypothesisId: string;
}) {
  return (
    <ReviewDecisionForm
      action={reviewHypothesisAction}
      hidden={{ clientId, hypothesisId }}
      testId="hypothesis-review-form"
      subject="гипотеза"
    />
  );
}
