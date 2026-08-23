"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useActionState } from "react";
import { signIn } from "@/app/actions/auth";

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const searchParams = useSearchParams();
  const redirectTo = searchParams.get("redirectTo") ?? "/";
  const [state, formAction, pending] = useActionState(signIn, { error: null });

  return (
    <main className="shell">
      <h1>Вход</h1>
      <form action={formAction}>
        <input type="hidden" name="redirectTo" value={redirectTo} />
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
        Нет аккаунта?{" "}
        <Link
          href={redirectTo !== "/" ? `/signup?invite=${encodeURIComponent(redirectTo)}` : "/signup"}
        >
          Зарегистрироваться
        </Link>
      </p>
      <p>
        <Link href="/forgot-password">Забыли пароль?</Link>
      </p>
    </main>
  );
}
