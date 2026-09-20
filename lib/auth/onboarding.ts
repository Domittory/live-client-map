const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const PUBLIC_AUTH_PATHS = [
  "/login",
  "/signup",
  "/auth",
  "/forgot-password",
  "/invite",
  "/portal/login",
] as const;
const REDIRECT_PATHS = [
  "/",
  "/access",
  "/admin",
  "/audit",
  "/clients",
  "/consent",
  "/core-nodes",
  "/corrections",
  "/dynamics",
  "/forgot-password",
  "/invite",
  "/library",
  "/login",
  "/methods",
  "/observations",
  "/portal",
  "/signup",
  "/snapshots",
] as const;

export interface InviteDestination {
  token: string;
  path: string;
}

function pathMatchesRoute(pathname: string, route: string): boolean {
  return pathname === route || pathname.startsWith(`${route}/`);
}

export function isPublicAuthPath(pathname: string): boolean {
  return PUBLIC_AUTH_PATHS.some((route) => pathMatchesRoute(pathname, route));
}

export function getInviteDestination(value: string | null | undefined): InviteDestination | null {
  const raw = (value ?? "").trim();
  if (!raw) return null;

  if (UUID_PATTERN.test(raw)) {
    const token = raw.toLowerCase();
    return { token, path: `/invite/${token}` };
  }

  if (!raw.startsWith("/") || raw.startsWith("//")) return null;

  let pathname: string;
  try {
    pathname = new URL(raw, "https://living-client-map.local").pathname;
  } catch {
    return null;
  }

  const match = /^\/invite\/([^/]+)$/.exec(pathname);
  if (!match) return null;

  let token: string;
  try {
    token = decodeURIComponent(match[1]);
  } catch {
    return null;
  }
  if (!UUID_PATTERN.test(token)) return null;

  return { token: token.toLowerCase(), path: `/invite/${token.toLowerCase()}` };
}

export function safeAuthRedirectPath(value: string | null | undefined): string {
  const raw = (value ?? "").trim();
  if (raw === "/") return "/";

  let url: URL;
  try {
    url = new URL(raw, "https://living-client-map.local");
  } catch {
    return "/";
  }

  if (url.origin !== "https://living-client-map.local") return "/";

  const invite = getInviteDestination(url.pathname);
  if (invite) return invite.path;

  const route = REDIRECT_PATHS.find((path) => path !== "/" && pathMatchesRoute(url.pathname, path));
  return route ? `${url.pathname}${url.search}` : "/";
}

export function getSignupHrefForRedirect(redirectTo: string): string {
  const invite = getInviteDestination(redirectTo);
  return invite ? `/signup?invite=${encodeURIComponent(invite.token)}` : "/signup";
}

export function getLoginHrefForInvite(value: string | null | undefined): string {
  const invite = getInviteDestination(value);
  return invite ? `/login?redirectTo=${encodeURIComponent(invite.path)}` : "/login";
}

export function getEmailConfirmationRedirect(origin: string, invitePath: string): string | null {
  try {
    const baseUrl = new URL(origin);
    if (baseUrl.protocol !== "http:" && baseUrl.protocol !== "https:") return null;

    const callbackUrl = new URL("/auth/callback", baseUrl);
    callbackUrl.searchParams.set("next", safeAuthRedirectPath(invitePath));
    return callbackUrl.toString();
  } catch {
    return null;
  }
}
