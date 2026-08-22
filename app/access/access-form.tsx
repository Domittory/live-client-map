"use client";

import { useActionState } from "react";
import { grantAssignment, revokeAssignment } from "@/app/actions/assignments";

const ROLES = ["primary_specialist", "secondary_specialist", "supervisor", "read_only"];

export function AccessForm() {
  const [grantState, grantAction, grantPending] = useActionState(grantAssignment, {
    error: null,
  });
  const [revokeState, revokeAction, revokePending] = useActionState(revokeAssignment, {
    error: null,
  });

  return (
    <div>
      <h3>Назначить доступ</h3>
      <form action={grantAction}>
        <label>
          client_id
          <input name="clientId" type="text" required />
        </label>
        <label>
          Email пользователя
          <input name="email" type="email" required />
        </label>
        <label>
          Роль
          <select name="role" defaultValue="read_only">
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" disabled={grantPending}>
          Назначить
        </button>
        {grantState.error && <p className="error">{grantState.error}</p>}
      </form>

      <h3>Отозвать доступ</h3>
      <form action={revokeAction}>
        <label>
          client_id
          <input name="clientId" type="text" required />
        </label>
        <label>
          user_id
          <input name="userId" type="text" required />
        </label>
        <button type="submit" disabled={revokePending}>
          Отозвать
        </button>
        {revokeState.error && <p className="error">{revokeState.error}</p>}
      </form>
    </div>
  );
}
