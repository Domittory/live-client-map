/**
 * Password-recovery redirect safety (ticket 17).
 *
 * The recovery email must point back at *our* callback route. The target origin
 * is taken from the incoming request and then checked against an explicit
 * allowlist before it is handed to Supabase. A forged `Origin`/`Host` header can
 * therefore never turn the reset link into a redirect to an attacker's domain,
 * and a `next`/`redirectTo` value from the query string is never trusted.
 *
 * The callback path itself is fixed in the email template
 * (`supabase/templates/recovery.html`), so only an origin is ever passed to
 * Supabase; this also keeps the link correct when Supabase rewrites a
 * non-allowlisted origin to its configured `site_url`.
 */

const LOOPBACK_HOSTNAMES = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

/**
 * The only environment inputs the allowlist reads. Kept structural (rather than
 * `NodeJS.ProcessEnv`) so tests can pass a literal object.
 */
export interface AuthOriginEnv {
  NODE_ENV?: string;
  APP_ORIGIN?: string;
  NEXT_PUBLIC_APP_ORIGIN?: string;
}

export const RECOVERY_CALLBACK_PATH = "/auth/confirm";
export const RESET_PASSWORD_PATH = "/reset-password";
export const RECOVERY_INVALID_PATH = "/forgot-password?error=link_invalid";

/**
 * Normalise an origin: absolute `http(s)` URL with no credentials, path, query
 * or fragment. Anything else (a bare host, a path, `javascript:`, a
 * protocol-relative value) is rejected.
 */
export function normalizeOrigin(value: string | null | undefined): string | null {
  const raw = (value ?? "").trim();
  if (!raw) return null;

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.username || url.password) return null;
  if (url.pathname !== "/" || url.search || url.hash) return null;

  return url.origin;
}

/** Canonical origins configured for this deployment. */
function configuredOrigins(env: AuthOriginEnv): Set<string> {
  const origins = new Set<string>();
  for (const value of [env.APP_ORIGIN, env.NEXT_PUBLIC_APP_ORIGIN]) {
    const origin = normalizeOrigin(value);
    if (origin) origins.add(origin);
  }
  return origins;
}

/**
 * True when `origin` may be used as a recovery callback target. The canonical
 * deployment origin is always trusted; loopback origins on any port are trusted
 * outside production so `pnpm dev` and the isolated E2E server keep working.
 * Production never trusts the request's own claim beyond that allowlist.
 */
export function isAllowlistedAuthOrigin(
  origin: string | null | undefined,
  env: AuthOriginEnv = process.env
): boolean {
  const normalized = normalizeOrigin(origin);
  if (!normalized) return false;
  if (configuredOrigins(env).has(normalized)) return true;
  if (env.NODE_ENV === "production") return false;

  return LOOPBACK_HOSTNAMES.has(new URL(normalized).hostname);
}

/**
 * The absolute redirect target for a recovery email, or `null` when the request
 * origin is not allowlisted. `null` makes Supabase fall back to its own
 * configured `site_url`, which is safe: an untrusted origin is simply dropped.
 */
export function recoveryRedirectTarget(
  origin: string | null | undefined,
  env: AuthOriginEnv = process.env
): string | null {
  return isAllowlistedAuthOrigin(origin, env) ? normalizeOrigin(origin) : null;
}

/**
 * The origin the browser actually used, derived from proxy headers. Next's
 * internal request URL can carry the server's own host (`localhost`) instead of
 * the request `Host`, and the session cookie is host-only: redirecting off-host
 * would drop it. Mirrors the portal confirmation route.
 */
export function requestOrigin(headers: Headers, requestUrl: string): string {
  const url = new URL(requestUrl);
  const host = headers.get("x-forwarded-host") ?? headers.get("host");
  if (!host) return url.origin;

  const protocol = headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "");
  return `${protocol}://${host}`;
}

/**
 * Origin of a browser-initiated Server Action. The `Origin` header is set by
 * the browser on POST; it is still untrusted input and must pass the allowlist.
 */
export function browserOrigin(headers: Headers): string | null {
  const origin = normalizeOrigin(headers.get("origin"));
  if (origin) return origin;

  const host = headers.get("x-forwarded-host") ?? headers.get("host");
  if (!host) return null;

  const protocol = headers.get("x-forwarded-proto") ?? "http";
  return normalizeOrigin(`${protocol}://${host}`);
}
