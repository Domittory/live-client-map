import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getEmailConfirmationRedirect,
  getLoginHrefForInvite,
  getInviteDestination,
  getSignupHrefForRedirect,
  isPublicAuthPath,
  safeAuthRedirectPath,
} from "@/lib/auth/onboarding";
import { signIn, signUp } from "@/app/actions/auth";
import { GET as authCallback } from "@/app/auth/callback/route";

const TOKEN = "123e4567-e89b-12d3-a456-426614174000";

const mocks = vi.hoisted(() => ({
  redirect: vi.fn((path: string): never => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  }),
  supabase: {
    auth: {
      signUp: vi.fn(),
      signInWithPassword: vi.fn(),
      exchangeCodeForSession: vi.fn(),
    },
    rpc: vi.fn(),
  },
}));

vi.mock("next/navigation", () => ({
  redirect: mocks.redirect,
}));

vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers({ origin: "https://app.example" })),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => mocks.supabase),
}));

function form(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

describe("invitation onboarding routes", () => {
  it("normalizes raw invite tokens and invite paths to the same destination", () => {
    expect(getInviteDestination(TOKEN)).toEqual({
      token: TOKEN,
      path: `/invite/${TOKEN}`,
    });
    expect(getInviteDestination(`/invite/${TOKEN}`)).toEqual({
      token: TOKEN,
      path: `/invite/${TOKEN}`,
    });
  });

  it("rejects prefix collisions as invite destinations and public auth paths", () => {
    expect(getInviteDestination("/invite-anything")).toBeNull();
    expect(getInviteDestination(`/invite/${TOKEN}/extra`)).toBeNull();
    expect(safeAuthRedirectPath("/invite-anything")).toBe("/");
    expect(safeAuthRedirectPath("/login-copy")).toBe("/");
    expect(isPublicAuthPath("/invite-anything")).toBe(false);
    expect(isPublicAuthPath("/login-copy")).toBe(false);
  });

  it("allows only supported internal auth redirects", () => {
    expect(safeAuthRedirectPath(`/invite/${TOKEN}`)).toBe(`/invite/${TOKEN}`);
    expect(safeAuthRedirectPath("/admin?tab=members")).toBe("/admin?tab=members");
    expect(safeAuthRedirectPath("/admin-copy")).toBe("/");
    expect(safeAuthRedirectPath("/api/health")).toBe("/");
    expect(safeAuthRedirectPath("https://example.com/invite/anything")).toBe("/");
    expect(safeAuthRedirectPath("//example.com/invite/anything")).toBe("/");
  });

  it("keeps invite links normalized across login, signup, and confirmation", () => {
    expect(getSignupHrefForRedirect(`/invite/${TOKEN}`)).toBe(`/signup?invite=${TOKEN}`);
    expect(getLoginHrefForInvite(TOKEN)).toBe(`/login?redirectTo=%2Finvite%2F${TOKEN}`);
    expect(getSignupHrefForRedirect("/admin")).toBe("/signup");
    expect(getLoginHrefForInvite("/invite-anything")).toBe("/login");
    expect(getEmailConfirmationRedirect("https://app.example", `/invite/${TOKEN}`)).toBe(
      `https://app.example/auth/callback?next=%2Finvite%2F${TOKEN}`
    );
    expect(getEmailConfirmationRedirect("not a url", `/invite/${TOKEN}`)).toBeNull();
  });
});

describe("signUp invitation onboarding", () => {
  beforeEach(() => {
    mocks.redirect.mockClear();
    mocks.supabase.auth.signUp.mockReset();
    mocks.supabase.auth.signInWithPassword.mockReset();
    mocks.supabase.auth.exchangeCodeForSession.mockReset();
    mocks.supabase.rpc.mockReset();
  });

  it("creates the identity then returns invited users to the invite route for authenticated acceptance", async () => {
    mocks.supabase.auth.signUp.mockResolvedValue({
      data: { session: { access_token: "session" } },
      error: null,
    });

    await expect(
      signUp(
        { error: null },
        form({
          email: "member@example.com",
          password: "password123",
          inviteToken: `/invite/${TOKEN}`,
        })
      )
    ).rejects.toThrow(`NEXT_REDIRECT:/invite/${TOKEN}`);

    expect(mocks.supabase.auth.signUp).toHaveBeenCalledWith({
      email: "member@example.com",
      password: "password123",
      options: {
        emailRedirectTo: `https://app.example/auth/callback?next=%2Finvite%2F${TOKEN}`,
      },
    });
    expect(mocks.supabase.rpc).not.toHaveBeenCalled();
    expect(mocks.redirect).toHaveBeenCalledWith(`/invite/${TOKEN}`);
  });

  it("preserves the invite destination when signup requires email confirmation", async () => {
    mocks.supabase.auth.signUp.mockResolvedValue({
      data: { session: null },
      error: null,
    });

    await expect(
      signUp(
        { error: null },
        form({
          email: "member@example.com",
          password: "password123",
          inviteToken: TOKEN,
        })
      )
    ).rejects.toThrow(`NEXT_REDIRECT:/login?redirectTo=%2Finvite%2F${TOKEN}`);

    expect(mocks.supabase.rpc).not.toHaveBeenCalled();
    expect(mocks.redirect).toHaveBeenCalledWith(`/login?redirectTo=%2Finvite%2F${TOKEN}`);
  });

  it("returns signed-in users to the safe invite or internal destination", async () => {
    mocks.supabase.auth.signInWithPassword.mockResolvedValue({ error: null });

    await expect(
      signIn(
        { error: null },
        form({
          email: "member@example.com",
          password: "password123",
          redirectTo: `/invite/${TOKEN}`,
        })
      )
    ).rejects.toThrow(`NEXT_REDIRECT:/invite/${TOKEN}`);

    await expect(
      signIn(
        { error: null },
        form({ email: "member@example.com", password: "password123", redirectTo: "/login-copy" })
      )
    ).rejects.toThrow("NEXT_REDIRECT:/");
  });

  it("rejects malformed invitation values before creating an auth identity", async () => {
    const result = await signUp(
      { error: null },
      form({
        email: "member@example.com",
        password: "password123",
        inviteToken: "/invite-anything",
      })
    );

    expect(result.error).toBe("Недействительная ссылка приглашения.");
    expect(mocks.supabase.auth.signUp).not.toHaveBeenCalled();
    expect(mocks.supabase.rpc).not.toHaveBeenCalled();
  });
});

describe("email confirmation callback", () => {
  it("exchanges the code and preserves the invite destination", async () => {
    mocks.supabase.auth.exchangeCodeForSession.mockResolvedValue({ error: null });

    const response = await authCallback(
      new Request(
        `https://app.example/auth/callback?code=confirmation-code&next=${encodeURIComponent(`/invite/${TOKEN}`)}`
      )
    );

    expect(mocks.supabase.auth.exchangeCodeForSession).toHaveBeenCalledWith("confirmation-code");
    expect(response.headers.get("location")).toBe(`https://app.example/invite/${TOKEN}`);
  });
});
