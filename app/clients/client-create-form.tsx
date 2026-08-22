"use client";

import { useActionState } from "react";
import { createClientAction } from "@/app/actions/clients";

export function ClientCreateForm() {
  const [state, action, pending] = useActionState(createClientAction, { error: null });

  return (
    <form action={action}>
      <label>
        Отображаемое имя
        <input name="displayName" type="text" required />
      </label>
      <label>
        Имя
        <input name="firstName" type="text" />
      </label>
      <label>
        Фамилия
        <input name="lastName" type="text" />
      </label>
      <button type="submit" disabled={pending}>
        Создать
      </button>
      {state.error && <p className="error">{state.error}</p>}
    </form>
  );
}
