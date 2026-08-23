"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useActionState } from "react";
import { signUp } from "@/app/actions/auth";

export default function SignupPage() {
  return (
    <Suspense>
      <SignupForm />
    </Suspense>
  );
}

function SignupForm() {
  const searchParams = useSearchParams();
  const invite = searchParams.get("invite");
  const isInvitation = Boolean(invite);
  const [state, formAction, pending] = useActionState(signUp, { error: null });

  return (
    <main className="shell">
      <h1>Регистрация</h1>
      <form action={formAction}>
        <input type="hidden" name="inviteToken" value={invite ?? ""} />
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
        {!isInvitation && (
          <label>
            Название организации
            <input name="orgName" type="text" required />
          </label>
        )}
        <button type="submit" disabled={pending}>
          {isInvitation ? "Присоединиться к организации" : "Создать аккаунт"}
        </button>
        {state.error && <p className="error">{state.error}</p>}
      </form>
      <p>
        Уже есть аккаунт?{" "}
        <Link href={invite ? `/login?redirectTo=/invite/${encodeURIComponent(invite)}` : "/login"}>
          Войти
        </Link>
      </p>
    </main>
  );
}
