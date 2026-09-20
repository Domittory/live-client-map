import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

/**
 * Portal sign-in entry page (ticket 15).
 *
 * There is no password form here: portal access is invitation-only. The
 * specialist grants access and Supabase emails a single-use, time-limited link;
 * an expired, reused or tampered link lands back on this page with a clear
 * Russian message.
 */

const ERROR_MESSAGES: Record<string, string> = {
  link_invalid:
    "Ссылка для входа недействительна, истекла или уже была использована. Попросите специалиста отправить новую ссылку.",
};

export default async function PortalLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <main className="shell">
      <h1>Вход в портал клиента</h1>

      {error ? (
        <p className="error" data-testid="portal-login-error">
          {ERROR_MESSAGES[error] ?? ERROR_MESSAGES.link_invalid}
        </p>
      ) : null}

      <p>
        Портал клиента доступен по персональной ссылке-приглашению. Ссылку выдаёт ваш специалист;
        она действует ограниченное время и может быть использована только один раз.
      </p>
      <p className="hint">
        Если ссылка не пришла или уже не действует, попросите специалиста отправить новую.
      </p>

      {user ? (
        <p data-testid="portal-login-session">
          Вы вошли как {user.email}. <Link href="/portal">Открыть портал</Link>
        </p>
      ) : null}

      <p>
        <Link href="/login">Вход для специалистов</Link>
      </p>
    </main>
  );
}
