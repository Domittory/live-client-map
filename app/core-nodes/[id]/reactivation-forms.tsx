"use client";

import { useActionState } from "react";
import {
  evaluateReactivationAction,
  reviewReactivationAction,
  type ReactivationState,
} from "@/app/actions/reactivation";

const initial: ReactivationState = { error: null };

export function EvaluateReactivationButton({ coreNodeId }: { coreNodeId: string }) {
  const [state, dispatch, pending] = useActionState(evaluateReactivationAction, initial);
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        dispatch({ coreNodeId });
      }}
      style={{ display: "inline" }}
    >
      <button type="submit" disabled={pending}>
        Проверить reactivation
      </button>
      {state.error && <p className="error">{state.error}</p>}
    </form>
  );
}

export function ReviewReactivationButtons({
  reactivationId,
  coreNodeId,
}: {
  reactivationId: string;
  coreNodeId: string;
}) {
  const [state, dispatch, pending] = useActionState(reviewReactivationAction, initial);
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
        const decision = submitter?.value === "reject" ? "reject" : "approve";
        dispatch({ reactivationId, coreNodeId, decision });
      }}
      style={{ display: "inline" }}
    >
      <button type="submit" name="decision" value="approve" disabled={pending}>
        Подтвердить reactivation
      </button>
      <button type="submit" name="decision" value="reject" disabled={pending}>
        Отклонить
      </button>
      {state.error && <p className="error">{state.error}</p>}
    </form>
  );
}
