"use client";

import Link from "next/link";
import { useActionState } from "react";
import { signIn } from "@/app/actions/auth";

export default function LoginPage() {
  const [state, formAction, pending] = useActionState(signIn, { error: null });

  return (
    <main className="shell">
      <h1>Вход</h1>
      <form action={formAction}>
        <label>
          Email
          <input name="email" type="email" required autoComplete="email" />
        </label>
        <label>
          Пароль
          <input name="password" type="password" required autoComplete="current-password" />
        </label>
        <button type="submit" disabled={pending}>
          Войти
        </button>
        {state.error && <p className="error">{state.error}</p>}
      </form>
      <p>
        Нет аккаунта? <Link href="/signup">Зарегистрироваться</Link>
      </p>
      <p>
        <Link href="/forgot-password">Забыли пароль?</Link>
      </p>
    </main>
  );
}
