"use client";

import Link from "next/link";
import { useActionState } from "react";
import { resetPassword } from "@/app/actions/auth";

export default function ForgotPasswordPage() {
  const [state, formAction, pending] = useActionState(resetPassword, {
    sent: false,
    error: null,
  });

  return (
    <main className="shell">
      <h1>Восстановление пароля</h1>
      {state.sent ? (
        <p>Проверьте email — мы отправили ссылку для сброса пароля.</p>
      ) : (
        <form action={formAction}>
          <label>
            Email
            <input name="email" type="email" required autoComplete="email" />
          </label>
          <button type="submit" disabled={pending}>
            Отправить ссылку
          </button>
          {state.error && <p className="error">{state.error}</p>}
        </form>
      )}
      <p>
        <Link href="/login">Назад ко входу</Link>
      </p>
    </main>
  );
}
