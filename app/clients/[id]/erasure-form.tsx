"use client";

import { useActionState } from "react";
import { executeErasureAction, setLegalHoldAction } from "@/app/actions/erasure";

export function ErasureForm({ clientId, legalHold }: { clientId: string; legalHold: boolean }) {
  const [executeState, executeAction, executePending] = useActionState(executeErasureAction, {
    error: null,
  });
  const [holdState, holdAction, holdPending] = useActionState(setLegalHoldAction, { error: null });

  return (
    <div>
      <h3>Управление удалением</h3>

      <form
        action={executeAction}
        onSubmit={(event) => {
          if (
            !confirm(
              "Полностью удалить все данные клиента? Действие необратимо и не может быть отменено."
            )
          ) {
            event.preventDefault();
          }
        }}
      >
        <input type="hidden" name="clientId" value={clientId} />
        <button type="submit" disabled={executePending || legalHold}>
          Запросить полное удаление данных
        </button>
        {executeState.status ? <p>Статус: {executeState.status}</p> : null}
        {executeState.error ? <p className="error">{executeState.error}</p> : null}
      </form>

      <form action={holdAction}>
        <input type="hidden" name="clientId" value={clientId} />
        <input type="hidden" name="hold" value={legalHold ? "off" : "on"} />
        <button type="submit" disabled={holdPending}>
          {legalHold ? "Снять юридическое удержание" : "Установить юридическое удержание"}
        </button>
        {holdState.error ? <p className="error">{holdState.error}</p> : null}
      </form>

      {legalHold ? (
        <p role="alert">
          Установлено юридическое удержание — удаление заблокировано до его снятия.
        </p>
      ) : null}
    </div>
  );
}
