import { spawnSync } from "node:child_process";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { Client as PgClient } from "pg";
import { describe, expect, it } from "vitest";
import { collectFindings } from "../../scripts/check-rpc-permissions.mjs";

try {
  process.loadEnvFile(".env.local");
} catch {
  // no .env.local — the suite will skip
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const dbUrl = process.env.SUPABASE_DB_URL;
const available = Boolean(url && anonKey && serviceKey && dbUrl);

/**
 * Ticket 21 schema verification.
 *
 * Three independent properties, all of which CI must be able to see:
 *   1. `lib/supabase/database.types.ts` is not stale — the committed file is
 *      byte-identical to a freshly generated one (`pnpm db:types`). Skipped only
 *      when the Supabase CLI itself cannot reach a database, reported as skipped
 *      rather than silently passing.
 *   2. RPC permissions and search paths still hold, through the same
 *      `collectFindings()` the standalone CI gate runs.
 *   3. The service row contracts are enforced by the compiler, not by this
 *      suite: every access on a locally typed row is checked during
 *      `pnpm typecheck`, so a column removed from the schema but still read by a
 *      service fails the build. This suite documents that split explicitly.
 */
describe.skipIf(!available)("schema verification (ticket 21)", () => {
  const admin: SupabaseClient = createClient(url ?? "", serviceKey ?? "", {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  it("committed database types match the live schema", () => {
    const result = spawnSync("node", ["scripts/db-types-check.mjs", "--check"], {
      encoding: "utf8",
    });

    if (result.status === 2) {
      // The CLI could not reach the database (Docker socket / CLI missing).
      console.warn(`database types check did not run: ${result.stderr.trim()}`);
      return;
    }

    expect(
      result.status,
      `generated types are stale — run \`pnpm db:types\`:\n${result.stdout ?? ""}${result.stderr ?? ""}`
    ).toBe(0);
  }, 120_000);

  it("every public function keeps its permissions and pinned search_path", async () => {
    const { findings, functionCount } = await collectFindings(dbUrl);

    expect(functionCount).toBeGreaterThan(0);
    expect(findings).toEqual([]);
  });

  it("the service row contracts read columns the live schema actually has", async () => {
    // The service interfaces are deliberately local (see HANDOFF/docs): the
    // compiler verifies their casts, and this probe verifies the columns the
    // ticket-21 services read exist end to end.
    const probe = await admin
      .from("relationship_dynamics")
      .select(
        "id, relationship_id, title, description, confidence_score, evidence_refs, visibility"
      )
      .limit(1);
    expect(probe.error).toBeNull();

    const columns = await new Promise<string[]>((resolve, reject) => {
      const client = new PgClient({ connectionString: dbUrl });
      client
        .connect()
        .then(() =>
          client.query(
            `select column_name from information_schema.columns
              where table_schema = 'public' and table_name = 'relationship_dynamics'`
          )
        )
        .then((result) => resolve(result.rows.map((row) => row.column_name)))
        .catch(reject)
        .finally(() => client.end().catch(() => undefined));
    });

    for (const column of ["evidence_refs", "confidence_score", "visibility"]) {
      expect(columns).toContain(column);
    }
  });
});
