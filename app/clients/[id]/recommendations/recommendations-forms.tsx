"use client";

import { useActionState } from "react";
import {
  generateRecommendationsAction,
  reviewRecommendationAction,
  setRecommendationVisibilityAction,
  type RecommendationsActionState,
} from "@/app/actions/recommendations";

/**
 * Recommendation client components (ticket 13).
 *
 * Generation is one action for the whole client context: the existing AI
 * service persists every proposal as an internal draft, so this form can never
 * approve or publish anything. Review and visibility are separate forms bound to
 * exactly one Recommendation — a human decision is always explicit, single and
 * accompanied by its reason, and the database re-checks it.
 */

const INITIAL: RecommendationsActionState = { error: null, message: null };

export function GenerateRecommendationsForm({ clientId }: { clientId: string }) {
  const [state, action, pending] = useActionState(generateRecommendationsAction, INITIAL);

  return (
    <section>
      <h2>Сформировать рекомендации</h2>
      <p className="hint">
        AI предлагает рекомендации по уже подтверждённым данным и рассчитанным оценкам. Все
        предложения сохраняются как черновики и не публикуются до явного решения человека.
      </p>
      <form action={action} data-testid="recommendation-generate-form">
        <input type="hidden" name="clientId" value={clientId} />
        <button type="submit" disabled={pending}>
          Сформировать рекомендации
        </button>
        {state.message ? (
          <p className="hint" data-testid="recommendation-generate-message">
            {state.message}
          </p>
        ) : null}
        {state.error ? (
          <p className="error" role="alert" data-testid="recommendation-generate-error">
            {state.error}
          </p>
        ) : null}
      </form>
    </section>
  );
}

export function RecommendationReviewForm({
  clientId,
  recommendationId,
  subject,
}: {
  clientId: string;
  recommendationId: string;
  subject: string;
}) {
  const [state, action, pending] = useActionState(reviewRecommendationAction, INITIAL);

  return (
    <form className="review-form" action={action} data-testid="recommendation-review-form">
      <input type="hidden" name="clientId" value={clientId} />
      <input type="hidden" name="recommendationId" value={recommendationId} />
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
        <p className="error" role="alert" data-testid="recommendation-review-form-error">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}

export function RecommendationVisibilityForm({
  clientId,
  recommendationId,
  defaultVisibility,
  subject,
}: {
  clientId: string;
  recommendationId: string;
  defaultVisibility: "internal" | "client_visible";
  subject: string;
}) {
  const [state, action, pending] = useActionState(setRecommendationVisibilityAction, INITIAL);

  return (
    <form className="review-form" action={action} data-testid="recommendation-visibility-form">
      <input type="hidden" name="clientId" value={clientId} />
      <input type="hidden" name="recommendationId" value={recommendationId} />
      <label>
        Видимость рекомендации
        <select
          name="visibility"
          aria-label={`Видимость рекомендации: ${subject}`}
          defaultValue={defaultVisibility}
        >
          <option value="internal">Внутренняя: клиенту не видна</option>
          <option value="client_visible">Опубликовать в клиентском портале</option>
        </select>
      </label>
      <label>
        Причина изменения видимости
        <input name="reason" type="text" />
      </label>
      <button type="submit" disabled={pending}>
        Изменить видимость
      </button>
      {state.error ? (
        <p className="error" role="alert" data-testid="recommendation-visibility-form-error">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
