import Link from "next/link";
import { ForgotPasswordForm } from "./forgot-password-form";

/** Error codes the recovery callback or reset form can send back here. */
const ERROR_MESSAGES: Record<string, string> = {
  link_invalid:
    "Ссылка для сброса пароля недействительна, истекла или уже была использована. Запросите новую.",
};

export default async function ForgotPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <main className="shell">
      <h1>Восстановление пароля</h1>
      {error ? (
        <p className="error" data-testid="forgot-password-error">
          {ERROR_MESSAGES[error] ?? ERROR_MESSAGES.link_invalid}
        </p>
      ) : null}
      <ForgotPasswordForm />
      <p>
        <Link href="/login">Назад ко входу</Link>
      </p>
    </main>
  );
}
