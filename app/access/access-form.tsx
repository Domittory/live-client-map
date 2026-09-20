"use client";

import { useActionState } from "react";
import { grantAssignment, revokeAssignment } from "@/app/actions/assignments";
import type { AdminMember } from "@/lib/service/admin";
import type { ClientAssignment } from "@/lib/service/client-access";
import { ACCESS_ROLE_LABELS } from "./labels";

/**
 * Client-context assignment management (ticket 09).
 *
 * The client id always comes from the workspace (hidden field); the user never
 * types an id. The component is rendered only on the Owner-only access page,
 * and every mutation is re-authorized by the database RPC.
 */

export type AssignableMember = Pick<AdminMember, "userId" | "email">;

export function AccessForm({
  clientId,
  members,
  assignments,
  ownerUserId,
}: {
  clientId: string;
  members: AssignableMember[];
  assignments: ClientAssignment[];
  ownerUserId?: string | null;
}) {
  const [grantState, grantAction, grantPending] = useActionState(grantAssignment, {
    error: null,
  });
  const [revokeState, revokeAction, revokePending] = useActionState(revokeAssignment, {
    error: null,
  });

  return (
    <div>
      <h2>Текущий доступ</h2>
      {assignments.length === 0 ? (
        <p data-testid="client-assignments-empty">Назначений нет.</p>
      ) : (
        <ul data-testid="client-assignments">
          {assignments.map((assignment) => (
            <li key={assignment.userId} data-testid="client-assignment-row">
              <span data-testid="client-assignment-email">
                {assignment.email ?? assignment.userId}
              </span>{" "}
              — {ACCESS_ROLE_LABELS[assignment.accessRole] ?? assignment.accessRole}
              {assignment.userId === ownerUserId ? (
                <> (владелец организации)</>
              ) : (
                <form className="inline-form" action={revokeAction}>
                  <input type="hidden" name="clientId" value={clientId} />
                  <input type="hidden" name="userId" value={assignment.userId} />
                  <button type="submit" disabled={revokePending}>
                    Отозвать
                  </button>
                </form>
              )}
            </li>
          ))}
        </ul>
      )}
      {revokeState.error && <p className="error">{revokeState.error}</p>}

      <h2>Назначить доступ</h2>
      {members.length === 0 ? (
        <p className="hint">
          В организации нет активных участников. Сначала добавьте участника в разделе
          администрирования.
        </p>
      ) : (
        <form action={grantAction}>
          <input type="hidden" name="clientId" value={clientId} />
          <label>
            Участник
            <select name="email" required defaultValue="">
              <option value="" disabled>
                Выберите участника
              </option>
              {members.map((member) => (
                <option key={member.userId} value={member.email}>
                  {member.email}
                </option>
              ))}
            </select>
          </label>
          <label>
            Роль доступа
            <select name="accessRole" defaultValue="read_only">
              {Object.entries(ACCESS_ROLE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" disabled={grantPending}>
            Назначить
          </button>
          {grantState.error && <p className="error">{grantState.error}</p>}
        </form>
      )}
    </div>
  );
}
