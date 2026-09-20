"use client";

import { useActionState } from "react";
import { updatePassword } from "@/app/actions/auth";

export function ResetPasswordForm({ redirectTo }: { redirectTo: string }) {
  const [state, formAction, pending] = useActionState(updatePassword, { error: null });

  return (
    <form action={formAction} data-testid="reset-password-form">
      <input type="hidden" name="next" value={redirectTo} />
      <label>
        Новый пароль
        <input name="password" type="password" required minLength={8} autoComplete="new-password" />
      </label>
      <label>
        Повторите пароль
        <input
          name="passwordConfirmation"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
        />
      </label>
      <button type="submit" disabled={pending} data-testid="reset-password-submit">
        Сохранить пароль
      </button>
      {state.error && (
        <p className="error" data-testid="reset-password-error">
          {state.error}
        </p>
      )}
    </form>
  );
}
