/**
 * Local auth-email capture helpers (tickets 15 and 17).
 *
 * The local Supabase stack captures every auth email in Mailpit (`:54324`, the
 * Inbucket-compatible service). Both the portal sign-in link and the password
 * reset link are delivered as HTML; these helpers find the message for one
 * address and return its link. Only the address a helper is asked about is
 * inspected, so parallel tests that share Mailpit never collide.
 */

const MAILPIT_URL = process.env.MAILPIT_URL ?? "http://127.0.0.1:54324";

interface MailpitMessage {
  ID: string;
  To?: { Address?: string }[];
  Subject?: string;
}

interface MailpitMessageDetail {
  HTML?: string;
  Text?: string;
}

async function findMessageFor(email: string): Promise<MailpitMessage | null> {
  const response = await fetch(`${MAILPIT_URL}/api/v1/messages?limit=100`);
  if (!response.ok) return null;
  const body = (await response.json()) as { messages?: MailpitMessage[] };
  const wanted = email.toLowerCase();
  return (
    (body.messages ?? []).find((message) =>
      (message.To ?? []).some((to) => (to.Address ?? "").toLowerCase() === wanted)
    ) ?? null
  );
}

/** Wait for the next auth email to `email` and return its first link. */
export async function waitForAuthLink(email: string, timeoutMs = 20_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  let lastError = "message not found";

  while (Date.now() < deadline) {
    const message = await findMessageFor(email);
    if (message) {
      const detailResponse = await fetch(`${MAILPIT_URL}/api/v1/message/${message.ID}`);
      if (detailResponse.ok) {
        const detail = (await detailResponse.json()) as MailpitMessageDetail;
        const htmlMatch = /href="([^"]+)"/.exec(detail.HTML ?? "");
        const textMatch = /\((https?:\/\/[^)]+)\)/.exec(detail.Text ?? "");
        const link = htmlMatch?.[1] ?? textMatch?.[1];
        if (link) return link.replace(/&amp;/g, "&");
        lastError = "message has no link";
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error(`Auth email for ${email} not found: ${lastError}`);
}

/**
 * Normalise a captured link onto the running E2E server. Our templates point at
 * the app's `/auth/confirm` route with a `token_hash`; if an older default
 * template is in place, the link is the Supabase `/verify` URL and the token is
 * re-pointed at our own route, which is what production uses anyway.
 */
export function authConfirmUrl(baseUrl: string, link: string, defaultType = "magiclink"): string {
  const url = new URL(link);
  if (url.pathname === "/auth/confirm") {
    return `${baseUrl}${url.pathname}${url.search}`;
  }
  const tokenHash = url.searchParams.get("token_hash") ?? url.searchParams.get("token") ?? "";
  const type = url.searchParams.get("type") ?? defaultType;
  return `${baseUrl}/auth/confirm?token_hash=${encodeURIComponent(tokenHash)}&type=${encodeURIComponent(type)}`;
}
