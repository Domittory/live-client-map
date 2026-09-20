"use client";

import { useActionState } from "react";
import { resetPassword } from "@/app/actions/auth";

export function ForgotPasswordForm() {
  const [state, formAction, pending] = useActionState(resetPassword, {
    sent: false,
    error: null,
  });

  if (state.sent) {
    return (
      <p data-testid="forgot-password-sent">
        Если аккаунт с таким адресом существует, мы отправили ссылку для сброса пароля. Проверьте
        почту.
      </p>
    );
  }

  return (
    <form action={formAction} data-testid="forgot-password-form">
      <label>
        Email
        <input name="email" type="email" required autoComplete="email" />
      </label>
      <button type="submit" disabled={pending}>
        Отправить ссылку
      </button>
      {state.error && <p className="error">{state.error}</p>}
    </form>
  );
}
