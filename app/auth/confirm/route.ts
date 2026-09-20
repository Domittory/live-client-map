import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Portal magic-link confirmation (ticket 15).
 *
 * The invite email links here with a single-use `token_hash` instead of the
 * Supabase `/verify` endpoint. This is required because the link is requested
 * server-side by the specialist (see `invitePortalUser`) while it is opened in
 * the client's own browser: a PKCE `code` could never be exchanged without the
 * verifier held by the inviting browser, whereas `verifyOtp({ token_hash })`
 * works in the browser that opens the link.
 *
 * An expired, already-used or tampered token is rejected with a clear Russian
 * message on the portal sign-in page. The route accepts only the `magiclink`
 * type, so a signup / recovery / email-change token can never be redeemed here.
 */

const MAGIC_LINK_TYPE = "magiclink";
const PORTAL_PATH = "/portal";
const INVALID_LINK_PATH = "/portal/login?error=link_invalid";

/** Only the portal itself is a valid post-sign-in destination. */
function safePortalPath(value: string | null): string {
  if (!value) return PORTAL_PATH;
  if (value === PORTAL_PATH) return PORTAL_PATH;
  if (/^\/portal\/[0-9a-f-]{36}$/i.test(value)) return value;
  return PORTAL_PATH;
}

/**
 * The origin the browser actually used. Next's internal `request.url` can carry
 * the server's own host (`localhost`) instead of the request `Host`, and the
 * session cookie is host-only: redirecting off-host would drop it and bounce the
 * just-signed-in client back to sign-in. The target path is always inside
 * `/portal`, so only the host is taken from the request.
 */
function requestOrigin(request: Request): string {
  const url = new URL(request.url);
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (!host) return url.origin;
  const protocol = request.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "");
  return `${protocol}://${host}`;
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const tokenHash = requestUrl.searchParams.get("token_hash");
  const type = requestUrl.searchParams.get("type");
  const next = safePortalPath(requestUrl.searchParams.get("next"));

  if (tokenHash && type === MAGIC_LINK_TYPE) {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({
      type: MAGIC_LINK_TYPE,
      token_hash: tokenHash,
    });
    if (!error) {
      return NextResponse.redirect(new URL(next, requestOrigin(request)));
    }
  }

  return NextResponse.redirect(new URL(INVALID_LINK_PATH, requestOrigin(request)));
}
