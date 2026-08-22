import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

// Integration tests run against a local Supabase (ticket 01: Supabase CLI + Docker).
// They skip when the environment is not configured, so `pnpm test` stays green
// on a clean checkout without Docker. `.env.local` (created after `supabase start`)
// is loaded when present, so `pnpm test:integration` works without inline env.
try {
  process.loadEnvFile(".env.local");
} catch {
  // no .env.local — the test will skip
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const available = Boolean(url && key);

describe.skipIf(!available)("database integration (requires local Supabase)", () => {
  it("health_check function is reachable from a clean migration", async () => {
    const client = createClient(url!, key!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await client.rpc("health_check");
    expect(error).toBeNull();
    expect(data).toBe(true);
  });
});
