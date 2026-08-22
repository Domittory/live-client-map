"use client";

import { useActionState } from "react";
import { createGoalAction, createRequestAction } from "@/app/actions/requests";

export function RequestsForms({ clientId }: { clientId: string }) {
  const [reqState, reqAction, reqPending] = useActionState(createRequestAction, {
    error: null,
  });
  const [goalState, goalAction, goalPending] = useActionState(createGoalAction, {
    error: null,
  });

  return (
    <div>
      <h2>Новый запрос</h2>
      <form action={reqAction}>
        <input type="hidden" name="clientId" value={clientId} />
        <label>
          Заголовок
          <input name="title" type="text" required />
        </label>
        <label>
          Описание
          <textarea name="description" />
        </label>
        <label>
          Критерии успеха
          <textarea name="successCriteria" />
        </label>
        <button type="submit" disabled={reqPending}>
          Создать запрос
        </button>
        {reqState.error && <p className="error">{reqState.error}</p>}
      </form>

      <h2>Новая цель</h2>
      <form action={goalAction}>
        <input type="hidden" name="clientId" value={clientId} />
        <label>
          Заголовок
          <input name="title" type="text" required />
        </label>
        <label>
          Целевое состояние
          <textarea name="targetState" />
        </label>
        <button type="submit" disabled={goalPending}>
          Создать цель
        </button>
        {goalState.error && <p className="error">{goalState.error}</p>}
      </form>
    </div>
  );
}
