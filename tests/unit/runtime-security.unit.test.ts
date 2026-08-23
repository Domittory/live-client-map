import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, describe, expect, it } from "vitest";
import { createInMemoryRateLimiter } from "@/lib/ai/limiter";
import { FakeAiProvider } from "@/lib/ai/provider";
import { getClientEnv } from "@/lib/env";
import { toErrorResponse } from "@/lib/service/errors";
import { importSignalsCsv, importText } from "@/lib/service/import";

const UUID = "123e4567-e89b-12d3-a456-426614174000";

/**
 * Ticket 61 (runtime security) — the "Checks" that are not already covered by
 * tickets 32/53/54/59: burst, cross-tenant, upload abuse and secret leakage.
 * Cross-tenant RLS isolation is separately proven by the ticket-60 access-matrix
 * suite; these tests focus on the application-level rate limiter and secrets.
 */

describe("rate limiter: burst + cross-tenant", () => {
  it("rejects a burst above the per-minute cap (safe 429 path)", () => {
    const limiter = createInMemoryRateLimiter({ maxConcurrent: 100, maxPerMinute: 3 });
    expect(limiter.acquire("org")).toBe(true);
    expect(limiter.acquire("org")).toBe(true);
    expect(limiter.acquire("org")).toBe(true);
    // The fourth call in the window is blocked, and so are subsequent ones.
    expect(limiter.acquire("org")).toBe(false);
    expect(limiter.acquire("org")).toBe(false);
  });

  it("rejects a burst above the concurrent cap", () => {
    const limiter = createInMemoryRateLimiter({ maxConcurrent: 2, maxPerMinute: 100 });
    expect(limiter.acquire("org")).toBe(true);
    expect(limiter.acquire("org")).toBe(true);
    expect(limiter.acquire("org")).toBe(false);
    limiter.release("org");
    expect(limiter.acquire("org")).toBe(true);
  });

  it("one tenant's burst never starves another tenant (cross-tenant isolation)", () => {
    const limiter = createInMemoryRateLimiter({ maxConcurrent: 2, maxPerMinute: 2 });
    expect(limiter.acquire("org-a")).toBe(true);
    expect(limiter.acquire("org-a")).toBe(true);
    expect(limiter.acquire("org-a")).toBe(false); // org-a saturated

    expect(limiter.acquire("org-b")).toBe(true); // org-b unaffected
    expect(limiter.acquire("org-b")).toBe(true);
    expect(limiter.acquire("org-b")).toBe(false); // org-b now saturated
  });
});

describe("upload abuse", () => {
  it("rejects oversized text upload before any database access", async () => {
    // A stub that would throw if the import pipeline ever touched the DB —
    // proving the size guard fires first, before any persistence.
    const client = {} as unknown as SupabaseClient;
    const provider = new FakeAiProvider();

    await expect(
      importText(client, provider, {
        organizationId: UUID,
        clientId: UUID,
        inputFormat: "plain_text",
        content: "x".repeat(1_000_001),
        idempotencyKey: "abcdefghijklmnop",
      })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR", message: "size_limit_exceeded" });
  });

  it("rejects oversized structured CSV upload before any database access", async () => {
    const client = {} as unknown as SupabaseClient;

    await expect(
      importSignalsCsv(client, {
        organizationId: UUID,
        clientId: UUID,
        content: "x".repeat(1_000_001),
        idempotencyKey: "abcdefghijklmnop",
      })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR", message: "size_limit_exceeded" });
  });
});

describe("secret leakage", () => {
  const originalEnv = process.env;

  afterEach(() => {
    process.env = originalEnv;
  });

  it("getClientEnv returns only NEXT_PUBLIC_* keys and never server secrets", () => {
    process.env = { ...originalEnv };
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "public-anon-key";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "super-secret-service-role";
    process.env.OPENAI_API_KEY = "sk-super-secret-openai";

    const env = getClientEnv();
    expect(Object.keys(env).sort()).toEqual([
      "NEXT_PUBLIC_SUPABASE_ANON_KEY",
      "NEXT_PUBLIC_SUPABASE_URL",
    ]);
    const serialized = JSON.stringify(env);
    expect(serialized).not.toContain("super-secret-service-role");
    expect(serialized).not.toContain("sk-super-secret-openai");
  });

  it("toErrorResponse never leaks SQL, relation names or prompts", async () => {
    const err = new Error(
      'relation "public.clients" does not exist; prompt: "system: you are a therapist"'
    );
    const res = toErrorResponse(err);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error.code).toBe("INTERNAL_ERROR");
    expect(body.error.message).toBe("Internal server error");
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain("public.clients");
    expect(serialized).not.toContain("system:");
    expect(serialized).not.toContain("therapist");
  });
});
