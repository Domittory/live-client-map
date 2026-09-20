import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { BrowserContext } from "@playwright/test";
import { authConfirmUrl, waitForAuthLink } from "./mailpit";

/**
 * Portal browser-test helpers (ticket 15).
 *
 * The local stack captures every auth email in Mailpit (`:54324`, the
 * Inbucket-compatible capture service). These helpers find the message for one
 * portal address, extract the sign-in link and read the portal session's access
 * token so the test can query PostgREST exactly as the client's browser does.
 *
 * Message capture itself lives in `./mailpit` and is shared with the password
 * recovery suite (ticket 17).
 */

/** Wait for the portal sign-in email and return its link. */
export function waitForPortalSignInLink(email: string, timeoutMs = 20_000): Promise<string> {
  return waitForAuthLink(email, timeoutMs);
}

/** Normalise a captured portal link onto the running E2E server. */
export function portalConfirmUrl(baseUrl: string, link: string): string {
  return authConfirmUrl(baseUrl, link, "magiclink");
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
