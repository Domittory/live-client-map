import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  browserOrigin,
  isAllowlistedAuthOrigin,
  normalizeOrigin,
  recoveryRedirectTarget,
  requestOrigin,
} from "@/lib/auth/recovery";
import { GET as confirm } from "@/app/auth/confirm/route";
import { resetPassword, updatePassword } from "@/app/actions/auth";

/**
 * Password recovery (ticket 17).
 *
 * Pins the security-relevant behaviour: the redirect target handed to Supabase
 * is the allowlisted request origin (never an arbitrary query value), the
 * request response is identical for known and unknown accounts, the password
 * update requires a verified session and can only navigate inside the app, and
 * the shared callback route never follows a `next` from the query string.
 */

const mocks = vi.hoisted(() => ({
  redirect: vi.fn((path: string): never => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  }),
  headers: vi.fn(async () => new Headers({ origin: "https://app.example" })),
  supabase: {
    auth: {
      resetPasswordForEmail: vi.fn(),
      updateUser: vi.fn(),
      getUser: vi.fn(),
      verifyOtp: vi.fn(),
    },
  },
}));

vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("next/headers", () => ({ headers: mocks.headers }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => mocks.supabase),
}));

function form(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

describe("recovery origin allowlist", () => {
  it("normalises only bare http(s) origins", () => {
    expect(normalizeOrigin("https://app.example")).toBe("https://app.example");
    expect(normalizeOrigin("https://app.example/")).toBe("https://app.example");
    expect(normalizeOrigin("http://127.0.0.1:3100")).toBe("http://127.0.0.1:3100");
    expect(normalizeOrigin("https://app.example/auth/confirm")).toBeNull();
    expect(normalizeOrigin("https://app.example?x=1")).toBeNull();
    expect(normalizeOrigin("javascript:alert(1)")).toBeNull();
    expect(normalizeOrigin("//evil.example")).toBeNull();
    expect(normalizeOrigin(null)).toBeNull();
  });

  it("trusts a configured canonical origin in production", () => {
    const env = { NODE_ENV: "production", APP_ORIGIN: "https://app.example" };
    expect(isAllowlistedAuthOrigin("https://app.example", env)).toBe(true);
    expect(recoveryRedirectTarget("https://app.example", env)).toBe("https://app.example");
    expect(isAllowlistedAuthOrigin("https://evil.example", env)).toBe(false);
    expect(recoveryRedirectTarget("https://evil.example", env)).toBeNull();
    // Loopback is a development convenience, never a production trust.
    expect(isAllowlistedAuthOrigin("http://127.0.0.1:3100", env)).toBe(false);
  });

  it("trusts loopback origins outside production so dev and E2E keep working", () => {
    const env = { NODE_ENV: "development" };
    expect(recoveryRedirectTarget("http://127.0.0.1:3100", env)).toBe("http://127.0.0.1:3100");
    expect(recoveryRedirectTarget("http://localhost:3000", env)).toBe("http://localhost:3000");
    expect(recoveryRedirectTarget("https://evil.example", env)).toBeNull();
  });

  it("derives the request origin from proxy headers and the browser Origin", () => {
    expect(requestOrigin(new Headers({ host: "127.0.0.1:3100" }), "http://localhost:3000/x")).toBe(
      "http://127.0.0.1:3100"
    );
    expect(
      requestOrigin(
        new Headers({ "x-forwarded-host": "app.example", "x-forwarded-proto": "https" }),
        "http://localhost/x"
      )
    ).toBe("https://app.example");
    expect(browserOrigin(new Headers({ origin: "https://app.example" }))).toBe(
      "https://app.example"
    );
    expect(browserOrigin(new Headers({ host: "127.0.0.1:3100" }))).toBe("http://127.0.0.1:3100");
    expect(browserOrigin(new Headers({ origin: "https://evil.example/auth" }))).toBeNull();
  });
});

describe("recovery request", () => {
  beforeEach(() => {
    process.env.APP_ORIGIN = "https://app.example";
    mocks.headers.mockResolvedValue(new Headers({ origin: "https://app.example" }));
    mocks.supabase.auth.resetPasswordForEmail.mockReset();
    mocks.redirect.mockClear();
  });

  afterEach(() => {
    delete process.env.APP_ORIGIN;
  });

  it("sends the reset email with the allowlisted request origin", async () => {
    mocks.supabase.auth.resetPasswordForEmail.mockResolvedValue({ error: null });

    const result = await resetPassword(
      { sent: false, error: null },
      form({ email: "user@example.com" })
    );

    expect(mocks.supabase.auth.resetPasswordForEmail).toHaveBeenCalledWith("user@example.com", {
      redirectTo: "https://app.example",
    });
    expect(result).toEqual({ sent: true, error: null });
  });

  it("never forwards an untrusted origin to Supabase", async () => {
    mocks.headers.mockResolvedValue(new Headers({ origin: "https://evil.example" }));
    mocks.supabase.auth.resetPasswordForEmail.mockResolvedValue({ error: null });

    await resetPassword({ sent: false, error: null }, form({ email: "user@example.com" }));

    expect(mocks.supabase.auth.resetPasswordForEmail).toHaveBeenCalledWith("user@example.com", {});
  });

  it("returns the same neutral result when the account does not exist", async () => {
    mocks.supabase.auth.resetPasswordForEmail.mockResolvedValue({
      error: { message: "User not found" },
    });

    const result = await resetPassword(
      { sent: false, error: null },
      form({ email: "nobody@example.com" })
    );

    expect(result).toEqual({ sent: true, error: null });
  });
});

describe("password update", () => {
  beforeEach(() => {
    mocks.redirect.mockClear();
    mocks.supabase.auth.getUser.mockReset();
    mocks.supabase.auth.updateUser.mockReset();
  });

  it("refuses without a verified recovery session", async () => {
    mocks.supabase.auth.getUser.mockResolvedValue({ data: { user: null } });

    const result = await updatePassword(
      { error: null },
      form({ password: "new-password-123", passwordConfirmation: "new-password-123" })
    );

    expect(result.error).toContain("недействительна");
    expect(mocks.supabase.auth.updateUser).not.toHaveBeenCalled();
  });

  it("rejects a short or mismatched password before touching auth", async () => {
    const short = await updatePassword(
      { error: null },
      form({ password: "short", passwordConfirmation: "short" })
    );
    expect(short.error).toContain("не короче");

    const mismatch = await updatePassword(
      { error: null },
      form({ password: "new-password-123", passwordConfirmation: "new-password-124" })
    );
    expect(mismatch.error).toContain("не совпадают");

    expect(mocks.supabase.auth.updateUser).not.toHaveBeenCalled();
  });

  it("updates through the session and follows only an internal destination", async () => {
    mocks.supabase.auth.getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    mocks.supabase.auth.updateUser.mockResolvedValue({ error: null });

    await expect(
      updatePassword(
        { error: null },
        form({
          password: "new-password-123",
          passwordConfirmation: "new-password-123",
          next: "/admin",
        })
      )
    ).rejects.toThrow("NEXT_REDIRECT:/admin");

    expect(mocks.supabase.auth.updateUser).toHaveBeenCalledWith({ password: "new-password-123" });

    await expect(
      updatePassword(
        { error: null },
        form({
          password: "new-password-123",
          passwordConfirmation: "new-password-123",
          next: "https://evil.example/pwned",
        })
      )
    ).rejects.toThrow("NEXT_REDIRECT:/");
  });

  it("reports a Supabase failure without navigating", async () => {
    mocks.supabase.auth.getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    mocks.supabase.auth.updateUser.mockResolvedValue({ error: { message: "weak password" } });

    const result = await updatePassword(
      { error: null },
      form({ password: "new-password-123", passwordConfirmation: "new-password-123" })
    );

    expect(result.error).toContain("Не удалось");
    expect(mocks.redirect).not.toHaveBeenCalled();
  });
});

describe("recovery confirmation route", () => {
  beforeEach(() => {
    mocks.supabase.auth.verifyOtp.mockReset();
  });

  it("ignores a hostile next and always lands on the reset form", async () => {
    mocks.supabase.auth.verifyOtp.mockResolvedValue({ error: null });

    const response = await confirm(
      new Request(
        "https://app.example/auth/confirm?token_hash=t&type=recovery&next=https%3A%2F%2Fevil.example"
      )
    );

    expect(response.headers.get("location")).toBe("https://app.example/reset-password");
  });

  it("sends an expired recovery token to the Russian invalid state", async () => {
    mocks.supabase.auth.verifyOtp.mockResolvedValue({ error: { message: "expired" } });

    const response = await confirm(
      new Request("https://app.example/auth/confirm?token_hash=used&type=recovery")
    );

    expect(response.headers.get("location")).toBe(
      "https://app.example/forgot-password?error=link_invalid"
    );
  });
});
