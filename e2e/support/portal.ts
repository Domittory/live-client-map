import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { BrowserContext } from "@playwright/test";

/**
 * Portal browser-test helpers (ticket 15).
 *
 * The local stack captures every auth email in Mailpit (`:54324`, the
 * Inbucket-compatible capture service). These helpers find the message for one
 * portal address, extract the sign-in link and read the portal session's access
 * token so the test can query PostgREST exactly as the client's browser does.
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

/**
 * Wait for the portal sign-in email and return its link. Only the email
 * addresses this helper is asked about are inspected, so parallel tests that
 * share Mailpit never collide.
 */
export async function waitForPortalSignInLink(email: string, timeoutMs = 20_000): Promise<string> {
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

  throw new Error(`Portal sign-in email for ${email} not found: ${lastError}`);
}

/**
 * Normalise a captured link onto the running E2E server. The email template
 * points at the app's `/auth/confirm` route with a `token_hash`; if an older
 * default template is in place, the link is the Supabase `/verify` URL and the
 * token is re-pointed at our own route, which is what production uses anyway.
 */
export function portalConfirmUrl(baseUrl: string, link: string): string {
  const url = new URL(link);
  if (url.pathname === "/auth/confirm") {
    return `${baseUrl}${url.pathname}${url.search}`;
  }
  const tokenHash = url.searchParams.get("token_hash") ?? url.searchParams.get("token") ?? "";
  const type = url.searchParams.get("type") ?? "magiclink";
  return `${baseUrl}/auth/confirm?token_hash=${encodeURIComponent(tokenHash)}&type=${encodeURIComponent(type)}`;
}

function decodeSessionCookie(value: string): { access_token?: string } | null {
  const raw = value.startsWith("base64-") ? value.slice("base64-".length) : value;
  for (const candidate of [raw, value]) {
    try {
      const json = Buffer.from(candidate, "base64url").toString("utf8");
      return JSON.parse(json) as { access_token?: string };
    } catch {
      try {
        return JSON.parse(candidate) as { access_token?: string };
      } catch {
        // try the next representation
      }
    }
  }
  return null;
}

/** The access token of the Supabase session the browser holds for this context. */
export async function portalAccessToken(context: BrowserContext): Promise<string> {
  const cookies = await context.cookies();
  const chunks = cookies
    .filter((cookie) => /^sb-.*-auth-token(\.\d+)?$/.test(cookie.name))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

  const joined = chunks.map((chunk) => chunk.value).join("");
  if (!joined) throw new Error("No Supabase auth cookie found in the portal context");

  const session = decodeSessionCookie(joined);
  if (!session?.access_token) throw new Error("The Supabase session cookie has no access token");
  return session.access_token;
}

/**
 * A PostgREST client bound to the portal session's token. This is the client's
 * own credential, not a service-role bypass: whatever it can read, the portal
 * browser could read.
 */
export function restClientForToken(url: string, anonKey: string, token: string): SupabaseClient {
  return createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}
