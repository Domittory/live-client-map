#!/usr/bin/env node
import { parseArgs } from "node:util";
import { reapExpiredExports } from "../lib/service/export-retention.ts";

/**
 * 30-day export retention CLI (ticket 20, docs/data-exchange-contracts.md §10).
 *
 * Deletes the private artifacts of every ExportRequest whose 30 days are over,
 * moves those requests to `expired`, closes ticket 19's hung `generating`
 * requests as `failed` / `generation_timeout`, and appends the audit rows through
 * the same RPC the service uses.
 *
 * Exact command (repeatable; safe to run on a schedule, e.g. hourly):
 *
 *   node --experimental-strip-types \
 *     --disable-warning=MODULE_TYPELESS_PACKAGE_JSON \
 *     --import ./scripts/support/register-alias.mjs \
 *     scripts/reap-exports.ts
 *
 * Optional:
 *   --limit <n>   rows closed by this run (default 100, max 1000)
 *   --dry-run     list what would be closed and exit without deleting anything
 *
 * Exit codes: 0 = sweep completed (including "nothing due"), 1 = the sweep failed.
 * Re-running is idempotent: a row that is already expired is no longer a
 * candidate, so the second run reports zeros and writes no second audit row.
 *
 * Logging: the run prints only ids, kinds and counts. It never prints an artifact
 * filename, a storage path, a signed URL or any export content.
 */

/** Load `.env.local` when present, without overriding real environment values. */
function loadLocalEnv(): void {
  try {
    process.loadEnvFile(".env.local");
  } catch {
    // No .env.local: rely on the process environment (CI, deployment, shell).
  }
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`reap-exports: ${name} is not configured`);
    process.exit(1);
  }
  return value;
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      limit: { type: "string" },
      "dry-run": { type: "boolean", default: false },
    },
    allowPositionals: false,
  });

  const limit = values.limit === undefined ? undefined : Number(values.limit);
  if (limit !== undefined && (!Number.isInteger(limit) || limit <= 0 || limit > 1000)) {
    console.error("reap-exports: --limit must be an integer between 1 and 1000");
    process.exit(1);
  }

  loadLocalEnv();
  requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  requireEnv("SUPABASE_SERVICE_ROLE_KEY");

  if (values["dry-run"]) {
    // Dry run shares the service's candidate rule and changes nothing.
    const { listDueExportRequests } = await import("../lib/service/export-retention.ts");
    const due = await listDueExportRequests(limit ?? 100);
    console.log(`reap-exports: dry run, ${due.length} request(s) due`);
    for (const row of due) {
      // Ids, kind, status and the expiry deadline only: no path, no filename.
      console.log(`  ${row.exportId} ${row.kind} status=${row.status} expires_at=${row.expiresAt}`);
    }
    return;
  }

  const result = await reapExpiredExports(limit === undefined ? {} : { limit });
  console.log(
    [
      "reap-exports: sweep completed",
      `scanned=${result.scanned}`,
      `expired=${result.expired}`,
      `failed=${result.failed}`,
      `storage_errors=${result.storageErrors}`,
    ].join(" ")
  );

  if (result.storageErrors > 0) {
    // The rows whose object could not be deleted stay `available` and remain
    // candidates, so a later run retries exactly those rows.
    console.error(
      `reap-exports: ${result.storageErrors} artifact(s) could not be deleted; the rows stay available for the next run`
    );
    process.exit(1);
  }
}

try {
  await main();
} catch (error) {
  // Never print the raw error: a storage error may quote an object path.
  console.error(
    `reap-exports: sweep failed (${error instanceof Error ? error.name : "unknown error"})`
  );
  process.exit(1);
}
