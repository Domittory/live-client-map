"use client";

import { useActionState } from "react";
import { generateSnapshotAction, type SnapshotState } from "@/app/actions/snapshots";

const initial: SnapshotState = { error: null, snapshotId: null };

export function GenerateSnapshotForm({ clientId }: { clientId: string }) {
  const [state, formAction, pending] = useActionState(
    (prev: SnapshotState, formData: FormData) =>
      generateSnapshotAction(prev, {
        clientId,
        reason: String(formData.get("reason") ?? ""),
      }),
    initial
  );

  return (
    <form action={formAction}>
      <label>
        Причина генерации
        <input type="text" name="reason" required maxLength={2000} />
      </label>
      <button type="submit" disabled={pending}>
        Сгенерировать snapshot
      </button>
      {state.error ? <p role="alert">{state.error}</p> : null}
      {state.snapshotId ? <p>Snapshot создан: {state.snapshotId}</p> : null}
    </form>
  );
}
