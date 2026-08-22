"use client";

import { useActionState } from "react";
import {
  inviteMemberAction,
  setMemberStatusAction,
  transferOwnershipAction,
  updateMemberRoleAction,
  updateOrgSettingsAction,
  type AdminState,
} from "@/app/actions/admin";
import { RETENTION_POLICY } from "@/lib/service/admin";

const initial: AdminState = { error: null };

export function InviteForm({ organizationId }: { organizationId: string }) {
  const [state, formAction, pending] = useActionState(inviteMemberAction, initial);
  return (
    <form action={formAction}>
      <input type="hidden" name="organizationId" value={organizationId} />
      <label>
        Email
        <input name="email" type="email" required />
      </label>
      <label>
        Роль
        <select name="role" defaultValue="specialist">
          <option value="specialist">Специалист</option>
          <option value="supervisor">Супервизор</option>
        </select>
      </label>
      <button type="submit" disabled={pending}>
        Пригласить
      </button>
      {state.error && <p className="error">{state.error}</p>}
    </form>
  );
}

export function MemberControls({
  organizationId,
  userId,
  role,
  status,
}: {
  organizationId: string;
  userId: string;
  role: string;
  status: string;
}) {
  const [roleState, roleAction, rolePending] = useActionState(updateMemberRoleAction, initial);
  const [statusState, statusAction, statusPending] = useActionState(setMemberStatusAction, initial);
  return (
    <span>
      <form action={roleAction} style={{ display: "inline" }}>
        <input type="hidden" name="organizationId" value={organizationId} />
        <input type="hidden" name="userId" value={userId} />
        <select name="role" defaultValue={role}>
          <option value="specialist">Специалист</option>
          <option value="supervisor">Супервизор</option>
        </select>
        <button type="submit" disabled={rolePending}>
          Сменить роль
        </button>
      </form>{" "}
      <form action={statusAction} style={{ display: "inline" }}>
        <input type="hidden" name="organizationId" value={organizationId} />
        <input type="hidden" name="userId" value={userId} />
        <input type="hidden" name="status" value={status === "active" ? "suspended" : "active"} />
        <button type="submit" disabled={statusPending}>
          {status === "active" ? "Деактивировать" : "Активировать"}
        </button>
      </form>
      {(roleState.error || statusState.error) && (
        <p className="error">{roleState.error ?? statusState.error}</p>
      )}
    </span>
  );
}

export function TransferOwnershipForm({
  organizationId,
  members,
}: {
  organizationId: string;
  members: { userId: string; email: string }[];
}) {
  const [state, formAction, pending] = useActionState(transferOwnershipAction, initial);
  if (members.length === 0) return null;
  return (
    <form action={formAction}>
      <input type="hidden" name="organizationId" value={organizationId} />
      <label>
        Новый владелец
        <select name="newOwnerId" required>
          {members.map((member) => (
            <option key={member.userId} value={member.userId}>
              {member.email}
            </option>
          ))}
        </select>
      </label>
      <button type="submit" disabled={pending}>
        Передать ownership
      </button>
      {state.error && <p className="error">{state.error}</p>}
    </form>
  );
}

export function SettingsForm({
  organizationId,
  name,
  clientDataYears,
  exportDays,
}: {
  organizationId: string;
  name: string;
  clientDataYears: number;
  exportDays: number;
}) {
  const [state, formAction, pending] = useActionState(updateOrgSettingsAction, initial);
  return (
    <form action={formAction}>
      <input type="hidden" name="organizationId" value={organizationId} />
      <label>
        Название организации
        <input name="name" type="text" defaultValue={name} required />
      </label>
      <label>
        Хранение данных клиента после архивации (лет, {RETENTION_POLICY.clientDataYears.min}–
        {RETENTION_POLICY.clientDataYears.max})
        <input
          name="clientDataYears"
          type="number"
          min={RETENTION_POLICY.clientDataYears.min}
          max={RETENTION_POLICY.clientDataYears.max}
          defaultValue={clientDataYears}
          required
        />
      </label>
      <label>
        Хранение export-файлов (дней, {RETENTION_POLICY.exportDays.min}–
        {RETENTION_POLICY.exportDays.max})
        <input
          name="exportDays"
          type="number"
          min={RETENTION_POLICY.exportDays.min}
          max={RETENTION_POLICY.exportDays.max}
          defaultValue={exportDays}
          required
        />
      </label>
      <button type="submit" disabled={pending}>
        Сохранить настройки
      </button>
      {state.error && <p className="error">{state.error}</p>}
    </form>
  );
}
