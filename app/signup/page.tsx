"use client";

import Link from "next/link";
import { useActionState } from "react";
import { signUp } from "@/app/actions/auth";

export default function SignupPage() {
  const [state, formAction, pending] = useActionState(signUp, { error: null });

  return (
    <main className="shell">
      <h1>Регистрация</h1>
      <form action={formAction}>
        <label>
          Email
          <input name="email" type="email" required autoComplete="email" />
        </label>
        <label>
          Пароль
          <input
            name="password"
            type="password"
            required
            minLength={6}
            autoComplete="new-password"
          />
        </label>
        <label>
          Название организации
          <input name="orgName" type="text" required />
        </label>
        <button type="submit" disabled={pending}>
          Создать аккаунт
        </button>
        {state.error && <p className="error">{state.error}</p>}
      </form>
      <p>
        Уже есть аккаунт? <Link href="/login">Войти</Link>
      </p>
    </main>
  );
}
