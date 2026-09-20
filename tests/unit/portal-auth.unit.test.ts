import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET as portalConfirm } from "@/app/auth/confirm/route";

/**
 * Portal magic-link confirmation (ticket 15) and the shared recovery branch
 * (ticket 17).
 *
 * The route is the only place a portal `token_hash` is redeemed, so its
 * rejection behaviour is pinned here: an expired, reused or tampered token must
 * never produce a session and must send the visitor back to the portal sign-in
 * page with the Russian error message. A `recovery` token is routed to the
 * password-reset flow instead of the portal.
 */

const mocks = vi.hoisted(() => ({ verifyOtp: vi.fn() }));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({ auth: { verifyOtp: mocks.verifyOtp } })),
}));

const UUID = "123e4567-e89b-12d3-a456-426614174000";

describe("portal magic-link confirmation", () => {
  beforeEach(() => {
    mocks.verifyOtp.mockReset();
  });

  it("verifies a magic-link token_hash and lands on the portal", async () => {
    mocks.verifyOtp.mockResolvedValue({ error: null });

    const response = await portalConfirm(
      new Request("https://app.example/auth/confirm?token_hash=abc123&type=magiclink")
    );

    expect(mocks.verifyOtp).toHaveBeenCalledWith({ type: "magiclink", token_hash: "abc123" });
    expect(response.headers.get("location")).toBe("https://app.example/portal");
  });

  it("honours a same-client portal deep link as the next path", async () => {
    mocks.verifyOtp.mockResolvedValue({ error: null });

    const response = await portalConfirm(
      new Request(
        `https://app.example/auth/confirm?token_hash=abc123&type=magiclink&next=${encodeURIComponent(
          `/portal/${UUID}`
        )}`
      )
    );

    expect(response.headers.get("location")).toBe(`https://app.example/portal/${UUID}`);
  });

  it("refuses to redirect anywhere outside the portal", async () => {
    mocks.verifyOtp.mockResolvedValue({ error: null });

    const response = await portalConfirm(
      new Request(
        "https://app.example/auth/confirm?token_hash=abc123&type=magiclink&next=https%3A%2F%2Fevil.example"
      )
    );

    expect(response.headers.get("location")).toBe("https://app.example/portal");
  });

  it("rejects an expired or already-used link with the Russian message", async () => {
    mocks.verifyOtp.mockResolvedValue({
      error: { message: "Email link is invalid or has expired", code: "otp_expired" },
    });

    const response = await portalConfirm(
      new Request("https://app.example/auth/confirm?token_hash=used&type=magiclink")
    );

    expect(response.headers.get("location")).toBe(
      "https://app.example/portal/login?error=link_invalid"
    );
  });

  it("routes a recovery token to the password-reset flow, never the portal", async () => {
    mocks.verifyOtp.mockResolvedValue({ error: null });

    const response = await portalConfirm(
      new Request("https://app.example/auth/confirm?token_hash=abc123&type=recovery")
    );

    expect(mocks.verifyOtp).toHaveBeenCalledWith({ type: "recovery", token_hash: "abc123" });
    expect(response.headers.get("location")).toBe("https://app.example/reset-password");
  });

  it("rejects a request without a token", async () => {
    const response = await portalConfirm(
      new Request("https://app.example/auth/confirm?type=magiclink")
    );

    expect(mocks.verifyOtp).not.toHaveBeenCalled();
    expect(response.headers.get("location")).toBe(
      "https://app.example/portal/login?error=link_invalid"
    );
  });
});
