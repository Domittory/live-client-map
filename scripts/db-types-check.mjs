#!/usr/bin/env node
/**
 * Generated-types drift gate (ticket 21).
 *
 * `lib/supabase/database.types.ts` is generated from the local database
 * (`pnpm db:types`). Nothing stops a migration from landing without
 * regenerating it, and a stale file silently hides new columns and tables from
 * TypeScript — the exact state ticket 21 found (`clients.legal_hold`,
 * `erasure_requests`, `export_requests` and every RPC since 0037 were missing).
 *
 * This script regenerates the types and compares them with the committed file,
 * in either of two modes:
 *
 *   (default)   regenerate and overwrite lib/supabase/database.types.ts
 *   --check     regenerate and fail when the committed file differs
 *
 * Service row contracts in `lib/service/*.ts` stay local interfaces on purpose
 * (they are the service boundary, narrower than the full table row); the
 * `tests/integration/schema-verification.integration.test.ts` suite additionally
 * asserts that every column they read exists in the live schema.
 *
 * Exit codes: 0 = types are current, 1 = drift, 2 = could not run.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export const TYPES_PATH = "lib/supabase/database.types.ts";

/**
 * Generate the TypeScript database types from the local Supabase database.
 * Returns the generated text.
 *
 * The CLI writes its telemetry into `$HOME/.supabase`, which may be read-only
 * in a sandboxed runner, so it always runs with a throwaway HOME.
 */
export function generateTypes({ workdir = process.cwd() } = {}) {
  const home = mkdtempSync(join(tmpdir(), "supabase-types-home-"));
  try {
    const result = spawnSync("supabase", ["gen", "types", "typescript", "--local"], {
      cwd: workdir,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      env: { ...process.env, HOME: process.env.SUPABASE_TYPES_HOME ?? home },
    });
    if (result.error) throw result.error;
    if (result.status !== 0) {
      throw new Error(
        `supabase gen types failed (exit ${result.status}): ${(result.stderr ?? "").trim()}`
      );
    }
    if (!result.stdout.includes("export type Database")) {
      throw new Error("supabase gen types produced no Database type");
    }
    return result.stdout;
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

/** First differing line pair, for a readable failure message. */
export function firstDifference(expected, actual) {
  const expectedLines = expected.split("\n");
  const actualLines = actual.split("\n");
  const length = Math.max(expectedLines.length, actualLines.length);
  for (let index = 0; index < length; index += 1) {
    if (expectedLines[index] !== actualLines[index]) {
      return {
        line: index + 1,
        committed: expectedLines[index] ?? "(end of file)",
        generated: actualLines[index] ?? "(end of file)",
      };
    }
  }
  return null;
}

function main() {
  const check = process.argv.includes("--check");
  let generated;
  try {
    generated = generateTypes();
  } catch (error) {
    console.error(`db types gate: ${error.message}`);
    console.error(
      "db types gate: the local database must be running (`supabase start`) and the Supabase CLI installed"
    );
    process.exit(2);
  }

  const committed = readFileSync(TYPES_PATH, "utf8");
  if (!check) {
    writeFileSync(TYPES_PATH, generated);
    console.log(`db types gate: regenerated ${TYPES_PATH}`);
    return;
  }

  if (committed === generated) {
    console.log(`db types gate: ${TYPES_PATH} matches the live schema`);
    return;
  }

  const difference = firstDifference(committed, generated);
  console.error(`db types gate: ${TYPES_PATH} is stale — run \`pnpm db:types\` and commit it`);
  if (difference) {
    console.error(`  first difference at line ${difference.line}`);
    console.error(`  committed: ${difference.committed}`);
    console.error(`  generated: ${difference.generated}`);
  }
  process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
