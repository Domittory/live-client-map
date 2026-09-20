import { NextResponse } from "next/server";
import { RECOVERY_INVALID_PATH, RESET_PASSWORD_PATH, requestOrigin } from "@/lib/auth/recovery";
import { createClient } from "@/lib/supabase/server";

/**
 * Single-use email-token confirmation for portal sign-in and password recovery
 * (tickets 15 and 17).
 *
 * The emails link here with a single-use `token_hash` instead of the Supabase
 * `/verify` endpoint. This is required because the portal link is requested
 * server-side by the specialist (see `invitePortalUser`) while it is opened in
 * the client's own browser: a PKCE `code` could never be exchanged without the
 * verifier held by the inviting browser, whereas `verifyOtp({ token_hash })`
 * works in the browser that opens the link. Recovery uses the same mechanics.
 *
 * The `type` query parameter is matched exactly and each type can only reach
 * its own area: a `magiclink` token never opens the password form, and a
 * `recovery` token never opens the portal. Expired, already-used or tampered
 * tokens are rejected with a clear Russian message. The post-verification
 * destination is fixed by the server — no `next` value from the query string is
 * ever followed — so the route cannot become an open redirect.
 */

const MAGIC_LINK_TYPE = "magiclink";
const RECOVERY_TYPE = "recovery";
const PORTAL_PATH = "/portal";
const PORTAL_INVALID_PATH = "/portal/login?error=link_invalid";

/** Only the portal itself is a valid post-sign-in destination. */
function safePortalPath(value: string | null): string {
  if (!value) return PORTAL_PATH;
  if (value === PORTAL_PATH) return PORTAL_PATH;
  if (/^\/portal\/[0-9a-f-]{36}$/i.test(value)) return value;
  return PORTAL_PATH;
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const tokenHash = requestUrl.searchParams.get("token_hash");
  const type = requestUrl.searchParams.get("type");
  const origin = requestOrigin(request.headers, request.url);

  if (type === RECOVERY_TYPE) {
    if (tokenHash) {
      const supabase = await createClient();
      const { error } = await supabase.auth.verifyOtp({
        type: RECOVERY_TYPE,
        token_hash: tokenHash,
      });
      if (!error) {
        return NextResponse.redirect(new URL(RESET_PASSWORD_PATH, origin));
      }
    }

    return NextResponse.redirect(new URL(RECOVERY_INVALID_PATH, origin));
  }

  if (tokenHash && type === MAGIC_LINK_TYPE) {
    const next = safePortalPath(requestUrl.searchParams.get("next"));
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({
      type: MAGIC_LINK_TYPE,
      token_hash: tokenHash,
    });
    if (!error) {
      return NextResponse.redirect(new URL(next, origin));
    }
  }

  return NextResponse.redirect(new URL(PORTAL_INVALID_PATH, origin));
}
