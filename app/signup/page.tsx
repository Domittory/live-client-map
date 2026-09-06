"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useActionState } from "react";
import { signUp } from "@/app/actions/auth";
import { getInviteDestination, getLoginHrefForInvite } from "@/lib/auth/onboarding";

export default function SignupPage() {
  return (
    <Suspense>
      <SignupForm />
    </Suspense>
  );
}

function SignupForm() {
  const searchParams = useSearchParams();
  const rawInvite = searchParams.get("invite");
  const invite = getInviteDestination(rawInvite);
  const hasInviteParam = searchParams.has("invite");
  const loginHref = getLoginHrefForInvite(rawInvite);
  const [state, formAction, pending] = useActionState(signUp, { error: null });

  return (
    <main className="shell">
      <h1>Регистрация</h1>
      <form action={formAction}>
        <input type="hidden" name="inviteToken" value={invite?.token ?? rawInvite ?? ""} />
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
        {!hasInviteParam && (
          <label>
            Название организации
            <input name="orgName" type="text" required />
          </label>
        )}
        <button type="submit" disabled={pending}>
          {hasInviteParam ? "Присоединиться к организации" : "Создать аккаунт"}
        </button>
        {state.error && <p className="error">{state.error}</p>}
      </form>
      <p>
        Уже есть аккаунт? <Link href={loginHref}>Войти</Link>
      </p>
    </main>
  );
}
