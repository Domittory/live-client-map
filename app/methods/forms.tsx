"use client";

import { useActionState } from "react";
import {
  archiveMethodAction,
  createMethodAction,
  updateMethodAction,
  type MethodState,
} from "@/app/actions/methods";

const initial: MethodState = { error: null };

export function CreateMethodForm({ organizationId }: { organizationId: string }) {
  const [state, formAction, pending] = useActionState(createMethodAction, initial);
  return (
    <form action={formAction}>
      <input type="hidden" name="organizationId" value={organizationId} />
      <label>
        Название
        <input name="name" type="text" required maxLength={200} />
      </label>
      <label>
        Категория
        <input name="category" type="text" maxLength={100} />
      </label>
      <label>
        Описание
        <textarea name="description" rows={3} maxLength={4000} />
      </label>
      <label>
        Противопоказания (по одному на строку)
        <textarea name="contraindications" rows={3} />
      </label>
      <label>
        Follow-up по умолчанию (дней, 1–365)
        <input name="defaultFollowUpDays" type="number" min={1} max={365} />
      </label>
      <button type="submit" disabled={pending}>
        Добавить метод
      </button>
      {state.error && <p className="error">{state.error}</p>}
    </form>
  );
}

export function EditMethodForm({
  method,
}: {
  method: {
    id: string;
    name: string;
    description: string | null;
    category: string | null;
    contraindications: string[];
    default_follow_up_days: number | null;
  };
}) {
  const [state, formAction, pending] = useActionState(updateMethodAction, initial);
  return (
    <form action={formAction}>
      <input type="hidden" name="methodId" value={method.id} />
      <label>
        Название
        <input name="name" type="text" defaultValue={method.name} required maxLength={200} />
      </label>
      <label>
        Категория
        <input name="category" type="text" defaultValue={method.category ?? ""} maxLength={100} />
      </label>
      <label>
        Описание
        <textarea
          name="description"
          rows={3}
          defaultValue={method.description ?? ""}
          maxLength={4000}
        />
      </label>
      <label>
        Противопоказания (по одному на строку)
        <textarea
          name="contraindications"
          rows={3}
          defaultValue={method.contraindications.join("\n")}
        />
      </label>
      <label>
        Follow-up по умолчанию (дней, 1–365)
        <input
          name="defaultFollowUpDays"
          type="number"
          min={1}
          max={365}
          defaultValue={method.default_follow_up_days ?? ""}
        />
      </label>
      <button type="submit" disabled={pending}>
        Сохранить
      </button>
      {state.error && <p className="error">{state.error}</p>}
    </form>
  );
}

export function ArchiveMethodButton({ methodId }: { methodId: string }) {
  const [state, formAction, pending] = useActionState(archiveMethodAction, initial);
  return (
    <form action={formAction} style={{ display: "inline" }}>
      <input type="hidden" name="methodId" value={methodId} />
      <button type="submit" disabled={pending}>
        Архивировать
      </button>
      {state.error && <p className="error">{state.error}</p>}
    </form>
  );
}
