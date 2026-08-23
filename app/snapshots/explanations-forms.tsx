"use client";

import { useActionState } from "react";
import {
  explainModelChangesAction,
  reviewModelExplanationAction,
  type ExplanationState,
} from "@/app/actions/explanations";

const initial: ExplanationState = { error: null, explanationId: null };

export function ExplainModelChangesButton({ clientId }: { clientId: string }) {
  const [state, dispatch, pending] = useActionState(explainModelChangesAction, initial);

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        dispatch({ clientId });
      }}
      style={{ display: "inline" }}
    >
      <button type="submit" disabled={pending}>
        Объяснить изменения (AI)
      </button>
      {state.error && <p role="alert">{state.error}</p>}
      {state.explanationId && <p>Объяснение создано и ждёт проверки специалистом.</p>}
    </form>
  );
}

export function ReviewExplanationButtons({ explanationId }: { explanationId: string }) {
  const [state, dispatch, pending] = useActionState(reviewModelExplanationAction, initial);

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
        dispatch({
          explanationId,
          decision: submitter?.value === "reject" ? "reject" : "approve",
        });
      }}
      style={{ display: "inline" }}
    >
      <button type="submit" name="decision" value="approve" disabled={pending}>
        Подтвердить объяснение
      </button>
      <button type="submit" name="decision" value="reject" disabled={pending}>
        Отклонить объяснение
      </button>
      {state.error && <p role="alert">{state.error}</p>}
    </form>
  );
}
