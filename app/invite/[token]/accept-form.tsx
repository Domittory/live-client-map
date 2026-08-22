"use client";

import { useActionState } from "react";
import { acceptInvitationAction, type AdminState } from "@/app/actions/admin";

export function AcceptInvitationForm({ token }: { token: string }) {
  const [state, formAction, pending] = useActionState(acceptInvitationAction, {
    error: null,
  } as AdminState);
  return (
    <form action={formAction}>
      <input type="hidden" name="token" value={token} />
      <button type="submit" disabled={pending}>
        Принять приглашение
      </button>
      {state.error && <p className="error">{state.error}</p>}
    </form>
  );
}
