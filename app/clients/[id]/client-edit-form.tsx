"use client";

import { useActionState } from "react";
import { archiveClientAction, updateClientAction } from "@/app/actions/clients";

export function ClientEditForm({
  clientId,
  displayName,
  occupation,
}: {
  clientId: string;
  displayName: string;
  occupation: string;
}) {
  const [updateState, updateAction, updatePending] = useActionState(updateClientAction, {
    error: null,
  });
  const [archiveState, archiveAction, archivePending] = useActionState(archiveClientAction, {
    error: null,
  });

  return (
    <div>
      <h2>Редактировать</h2>
      <form action={updateAction}>
        <input type="hidden" name="id" value={clientId} />
        <label>
          Отображаемое имя
          <input name="displayName" type="text" defaultValue={displayName} />
        </label>
        <label>
          Профессия
          <input name="occupation" type="text" defaultValue={occupation} />
        </label>
        <label>
          Приватная заметка
          <textarea name="specialistNotesPrivate" />
        </label>
        <label>
          Заметка клиенту
          <textarea name="clientVisibleNotes" />
        </label>
        <button type="submit" disabled={updatePending}>
          Сохранить
        </button>
        {updateState.error && <p className="error">{updateState.error}</p>}
      </form>

      <h2>Архив</h2>
      <form action={archiveAction}>
        <input type="hidden" name="id" value={clientId} />
        <button type="submit" disabled={archivePending}>
          Архивировать
        </button>
        {archiveState.error && <p className="error">{archiveState.error}</p>}
      </form>
    </div>
  );
}
