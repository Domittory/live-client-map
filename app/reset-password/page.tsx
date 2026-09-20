import Link from "next/link";
import { safeAuthRedirectPath } from "@/lib/auth/onboarding";
import { createClient } from "@/lib/supabase/server";
import { ResetPasswordForm } from "./reset-password-form";

/**
 * Password-update form (ticket 17).
 *
 * The form is rendered only when the request carries a session. The only way to
 * get one from a recovery email is `/auth/confirm`, which redeems the
 * single-use token with `verifyOtp({ type: "recovery" })` — so an expired,
 * reused or malformed link can never reach this page's mutation. The `next`
 * query parameter is sanitised with the shared allowlist before it is passed to
 * the form, and the action validates it again.
 */
export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  const redirectTo = safeAuthRedirectPath(next);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <main className="shell">
      <h1>Новый пароль</h1>
      {user ? (
        <ResetPasswordForm redirectTo={redirectTo} />
      ) : (
        <>
          <p className="error" data-testid="reset-password-invalid">
            Ссылка для сброса пароля недействительна, истекла или уже была использована.
          </p>
          <p>
            <Link href="/forgot-password">Запросить новую ссылку</Link>
          </p>
        </>
      )}
      <p>
        <Link href="/login">Назад ко входу</Link>
      </p>
    </main>
  );
}
