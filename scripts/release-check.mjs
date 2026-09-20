#!/usr/bin/env node
/**
 * Reproducible release gate (ticket 23).
 *
 * One command runs every blocking check in a fixed order and stops at the first
 * failure, so a release result cannot depend on undocumented manual sequencing:
 *
 *   static phase (no database needed)
 *     1. frozen-lockfile install verification
 *     2. production dependency audit
 *     3. ticket-21 invariant gates that do not need a database (audit:writes)
 *     4. production-AI guard (AI must stay off without an approved decision)
 *     5. release-checklist integrity (no unsigned completion claim)
 *     6. documentation integrity (rollback policy + documented commands)
 *     7. lint, typecheck, typecheck:scripts
 *     8. unit, smoke, acceptance
 *     9. production build
 *
 *   database phase (local Supabase must be running)
 *    10. Supabase preflight
 *    11. clean migration rebuild from migrations alone + history verification
 *    12. local migration dry-run (mirror of the target-environment dry-run)
 *    13. seed rebuild so the runtime suites see the full schema
 *    14. generated database types are current
 *    15. RPC permissions and search_path
 *    16. integration tests, serialized for determinism
 *    17. end-to-end browser journey
 *
 * Every run prints and writes an unsigned evidence record: the exact release
 * SHA, the lockfile hash, the timestamp and the result of each gate. The
 * generator NEVER writes a human signature — the manual gates (staging smoke,
 * restore drill, rollback drill, logging/alerts, production smoke, remote CI)
 * live in `docs/ops/release-checklist.md` and are signed by a human owner
 * (ticket 24).
 *
 * Usage:
 *   pnpm release:check                 # full gate (static + database)
 *   pnpm release:check:static          # CI quality job
 *   pnpm release:check:database        # CI integration job
 *   node scripts/release-check.mjs --list
 *
 * Exit codes: 0 = every selected gate passed, 1 = a blocking gate failed,
 * 2 = the gate could not run (bad arguments/environment).
 */
import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir, userInfo } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { Client } from "pg";
import { CHECKLIST_PATH, pendingManualGates } from "./check-release-checklist.mjs";
import { collectSources, evaluateProductionAiGate } from "./check-production-ai.mjs";

export const EVIDENCE_DIR = ".release";
export const LOCKFILE_PATH = "pnpm-lock.yaml";
export const PHASES = ["static", "database"];
const MAX_OUTPUT_CHARS = 8000;
const MIGRATIONS_DIR = "supabase/migrations";

/**
 * HOME for the Supabase CLI only.
 *
 * The CLI writes telemetry/config into `$HOME/.supabase`, which may be
 * read-only in a sandboxed runner, so the gate gives it a throwaway HOME. It
 * must NOT change HOME for the whole run: Playwright keeps its browser cache
 * under the real `$HOME/Library/Caches/ms-playwright`. Both resets are `--local`
 * and need no linked-project credentials, so a throwaway HOME is safe.
 */
let supabaseCliHome = null;

export function supabaseEnv(base = process.env) {
  if (base.SUPABASE_GATE_HOME) return { HOME: base.SUPABASE_GATE_HOME };
  if (!supabaseCliHome) supabaseCliHome = mkdtempSync(join(tmpdir(), "release-supabase-home-"));
  return { HOME: supabaseCliHome };
}

/**
 * Playwright resolves its browser cache from HOME. The Supabase CLI needs its own
 * writable HOME (see supabaseEnv), and an operator may export one for the whole
 * shell while following docs/ops/release-readiness.md. In that case the
 * already-installed Chromium would be invisible to Playwright and the gate would
 * fail with a "please install browsers" hint that is not actionable. Point
 * Playwright at the real user's cache when this happens, so the gate stays
 * reproducible instead of depending on how the shell was configured.
 */
export function playwrightBrowserEnv(env = process.env) {
  if (env.PLAYWRIGHT_BROWSERS_PATH) return {};

  let realHome;
  try {
    realHome = userInfo().homedir;
  } catch {
    return {};
  }
  if (!realHome || !env.HOME || env.HOME === realHome) return {};

  const candidate =
    process.platform === "darwin"
      ? join(realHome, "Library", "Caches", "ms-playwright")
      : join(realHome, ".cache", "ms-playwright");

  return existsSync(candidate) ? { PLAYWRIGHT_BROWSERS_PATH: candidate } : {};
}

function cleanupSupabaseEnv() {
  if (supabaseCliHome) {
    rmSync(supabaseCliHome, { recursive: true, force: true });
    supabaseCliHome = null;
  }
}

/* ------------------------------------------------------------------ helpers */

export function sha256Text(text) {
  return createHash("sha256").update(text).digest("hex");
}

export function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function git(args, cwd) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.status !== 0) return null;
  return (result.stdout ?? "").trim();
}

export function truncateOutput(text, limit = MAX_OUTPUT_CHARS) {
  if (typeof text !== "string") return "";
  const stripped = text.replace(/\u001b\[[0-9;]*m/g, "");
  if (stripped.length <= limit) return stripped;
  return `…[${stripped.length - limit} characters omitted]\n${stripped.slice(-limit)}`;
}

/** Run a command, stream its output live and capture it. */
export function runCommand(command, args, { cwd = process.cwd(), env = process.env } = {}) {
  return new Promise((resolve) => {
    const started = Date.now();
    let output = "";
    let child;
    try {
      child = spawn(command, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
    } catch (error) {
      resolve({
        status: 127,
        output: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - started,
      });
      return;
    }

    const collect = (chunk) => {
      const text = chunk.toString();
      output += text;
      process.stdout.write(text);
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);

    child.on("error", (error) => {
      output += `\n${error.message}`;
      resolve({ status: 127, output, durationMs: Date.now() - started });
    });
    child.on("close", (code) => {
      resolve({ status: code ?? 1, output, durationMs: Date.now() - started });
    });
  });
}

/** Local Supabase connection string, from SUPABASE_DB_URL or config.toml. */
export function databaseUrl(repoRoot = process.cwd()) {
  if (process.env.SUPABASE_DB_URL) return process.env.SUPABASE_DB_URL;
  try {
    const config = readFileSync(join(repoRoot, "supabase/config.toml"), "utf8");
    const match = config.match(/^\[db\][\s\S]*?^port\s*=\s*(\d+)/m);
    return `postgresql://postgres:postgres@127.0.0.1:${match ? match[1] : "54322"}/postgres`;
  } catch {
    return "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
  }
}

/* --------------------------------------------------------------- identity */

export function collectIdentity(repoRoot = process.cwd(), env = process.env) {
  const envSha = (env.RELEASE_SHA || env.GITHUB_SHA || "").trim();
  const headSha = git(["rev-parse", "HEAD"], repoRoot);
  const releaseSha = envSha || headSha || "unknown";
  const releaseShaSource = envSha ? (env.RELEASE_SHA ? "RELEASE_SHA" : "GITHUB_SHA") : "git HEAD";
  const ref = (
    env.GITHUB_REF ||
    git(["rev-parse", "--abbrev-ref", "HEAD"], repoRoot) ||
    "unknown"
  ).trim();
  const status = git(["status", "--porcelain"], repoRoot) ?? "";

  const lockfilePath = join(repoRoot, LOCKFILE_PATH);
  const packageJsonPath = join(repoRoot, "package.json");
  const lockfile = existsSync(lockfilePath)
    ? { path: LOCKFILE_PATH, sha256: sha256File(lockfilePath) }
    : { path: LOCKFILE_PATH, sha256: null, error: `${LOCKFILE_PATH} is missing` };
  const packageJson = existsSync(packageJsonPath)
    ? { path: "package.json", sha256: sha256File(packageJsonPath) }
    : { path: "package.json", sha256: null };

  return {
    releaseSha,
    releaseShaSource,
    releaseRef: ref,
    worktree: { dirty: status.length > 0, status: truncateOutput(status, 4000) },
    lockfile,
    packageJson,
    toolchain: {
      node: process.version,
      pnpm: (
        spawnSync("pnpm", ["--version"], { cwd: repoRoot, encoding: "utf8" }).stdout ?? ""
      ).trim(),
    },
  };
}

/** Where the remote CI result for this commit comes from, if known. */
export function collectRemoteCi(env = process.env, now = new Date()) {
  const observedAt = now.toISOString();
  if (env.GITHUB_ACTIONS === "true" && env.GITHUB_RUN_ID && env.GITHUB_REPOSITORY) {
    const server = env.GITHUB_SERVER_URL || "https://github.com";
    return {
      status: "observed",
      meaning:
        "This gate ran inside the remote CI run below. The run counts as green only when every " +
        "job of the workflow succeeds for this exact SHA.",
      provider: "github-actions",
      repository: env.GITHUB_REPOSITORY,
      workflow: env.GITHUB_WORKFLOW ?? null,
      job: env.GITHUB_JOB ?? null,
      event: env.GITHUB_EVENT_NAME ?? null,
      runId: env.GITHUB_RUN_ID,
      runAttempt: env.GITHUB_RUN_ATTEMPT ?? null,
      runUrl: `${server}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}`,
      sha: env.GITHUB_SHA ?? null,
      observedAt,
    };
  }
  if (env.RELEASE_CI_RUN_URL && env.RELEASE_CI_SHA) {
    return {
      status: "attested",
      meaning:
        "A human attached a remote CI run URL and SHA via RELEASE_CI_RUN_URL/RELEASE_CI_SHA.",
      provider: "github-actions",
      runUrl: env.RELEASE_CI_RUN_URL,
      sha: env.RELEASE_CI_SHA,
      observedAt,
    };
  }
  return {
    status: "not-observed",
    meaning:
      "No remote CI run for this commit is recorded. Push the release SHA and let " +
      "`.github/workflows/ci.yml` run both jobs green before a human signs the release.",
    provider: "github-actions",
    runUrl: null,
    sha: null,
    observedAt,
  };
}

/* ------------------------------------------------------------ gate results */

function result(status, startedAt, extra = {}) {
  return { status, durationMs: Date.now() - startedAt, ...extra };
}

function commandGate({ id, title, phase, command, args, postCheck, description, env }) {
  return {
    id,
    title,
    phase,
    blocking: true,
    command: `${command} ${args.join(" ")}`,
    description,
    run: async ({ repoRoot, identity }) => {
      const startedAt = Date.now();
      const extraEnv = env ? env({ repoRoot, identity }) : undefined;
      const outcome = await runCommand(command, args, {
        cwd: repoRoot,
        env: extraEnv ? { ...process.env, ...extraEnv } : process.env,
      });
      const output = truncateOutput(outcome.output);
      if (outcome.status !== 0) {
        return result("failed", startedAt, {
          output,
          summary: `${command} exited ${outcome.status}`,
        });
      }
      if (postCheck) {
        const problem = postCheck(outcome.output);
        if (problem) return result("failed", startedAt, { output, summary: problem });
      }
      return result("passed", startedAt, { output, summary: `${command} exited 0` });
    },
  };
}

/** A vitest summary such as `Tests 1 skipped | 851 passed` means a gate lied. */
export function detectSkippedTests(output) {
  const match = output.match(/\n\s*Tests\s+[^\n]*\bskipped\b[^\n]*/);
  return match ? match[0].trim() : null;
}

function pnpmGate(id, title, phase, args, options = {}) {
  return commandGate({ id, title, phase, command: "pnpm", args, ...options });
}

function supabaseGate(id, title, phase, args, options = {}) {
  return commandGate({ id, title, phase, command: "supabase", args, ...options });
}

/* ----------------------------------------------------------- custom gates */

function productionAiGate() {
  return {
    id: "production-ai-disabled",
    title: "Production AI stays off without an approved decision",
    phase: "static",
    blocking: true,
    command: null,
    description:
      "Reads lib/env.ts, lib/ai/gateway.ts, .env.example, workflows and callers; fails when AI " +
      "could be reachable in production without docs/ops/ai-production-decision.md.",
    run: async ({ repoRoot }) => {
      const startedAt = Date.now();
      const evaluation = evaluateProductionAiGate(collectSources(repoRoot));
      const lines = Object.entries(evaluation.checks).map(
        ([name, passed]) => `${passed ? "ok" : "FAIL"} ${name}`
      );
      const output = [...lines, ...evaluation.warnings.map((warning) => `warn ${warning}`)].join(
        "\n"
      );
      return result(evaluation.ok ? "passed" : "failed", startedAt, {
        output,
        summary: evaluation.summary,
        details: {
          mode: evaluation.mode,
          decision: evaluation.decision,
          warnings: evaluation.warnings,
          reasons: evaluation.reasons ?? [],
        },
      });
    },
  };
}

/** Documentation and rollback policy must stay attached to executable gates. */
export function checkDocumentation(repoRoot) {
  const requirements = [
    { path: "README.md", mustContain: ["pnpm release:check"] },
    { path: "docs/development.md", mustContain: ["pnpm release:check"] },
    {
      path: "docs/ops/release-readiness.md",
      mustContain: ["pnpm release:check", "AI_PRODUCTION_ENABLED"],
    },
    { path: "docs/ops/release-checklist.md", mustContain: ["release-checklist-machine:begin"] },
    {
      path: "docs/ops/deployment.md",
      mustContain: ["## Откат", "forward-only", "backup-restore.md"],
    },
    { path: "docs/ops/backup-restore.md", mustContain: [] },
  ];

  const problems = [];
  for (const requirement of requirements) {
    const path = join(repoRoot, requirement.path);
    if (!existsSync(path)) {
      problems.push(`${requirement.path} is missing`);
      continue;
    }
    const text = readFileSync(path, "utf8");
    for (const fragment of requirement.mustContain) {
      if (!text.includes(fragment)) {
        problems.push(`${requirement.path} no longer documents ${JSON.stringify(fragment)}`);
      }
    }
  }
  return problems;
}

function documentationGate() {
  return {
    id: "documentation-integrity",
    title: "Rollback policy and operator documentation are present",
    phase: "static",
    blocking: true,
    command: null,
    description:
      "The release command, the rollback policy and the real-client-data criteria must be " +
      "documented where operators look for them.",
    run: async ({ repoRoot }) => {
      const startedAt = Date.now();
      const problems = checkDocumentation(repoRoot);
      return result(problems.length === 0 ? "passed" : "failed", startedAt, {
        output: problems.join("\n"),
        summary:
          problems.length === 0
            ? "README, development guide, release-readiness, checklist, deployment and backup docs are present"
            : `${problems.length} documentation finding(s)`,
      });
    },
  };
}

/** Compare committed migration files with the history of the freshly built DB. */
export async function compareMigrationHistory({
  repoRoot = process.cwd(),
  connectionString = databaseUrl(repoRoot),
} = {}) {
  const expected = readdirSync(join(repoRoot, MIGRATIONS_DIR))
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .map((file) => {
      const [version, ...rest] = file.replace(/\.sql$/, "").split("_");
      return { version, name: rest.join("_"), file };
    });

  const client = new Client({ connectionString });
  await client.connect();
  let rows;
  try {
    const result = await client.query(
      "select version, name from supabase_migrations.schema_migrations order by version"
    );
    rows = result.rows;
  } finally {
    await client.end();
  }

  const applied = rows.map((row) => ({ version: String(row.version), name: row.name }));
  const expectedVersions = expected.map((entry) => entry.version);
  const appliedVersions = applied.map((entry) => entry.version);

  const missing = expected.filter((entry) => !appliedVersions.includes(entry.version));
  const extra = applied.filter((entry) => !expectedVersions.includes(entry.version));
  const renamed = expected.filter((entry) => {
    const match = applied.find((row) => row.version === entry.version);
    return match && match.name !== entry.name;
  });

  return {
    ok: missing.length === 0 && extra.length === 0 && renamed.length === 0,
    expected,
    applied,
    missing,
    extra,
    renamed,
  };
}

function migrationCleanRebuildGate() {
  return {
    id: "migration-clean-rebuild",
    title: "Clean database rebuild from migrations alone",
    phase: "database",
    blocking: true,
    command: "supabase db reset --no-seed",
    description:
      "Drops and rebuilds the local database from supabase/migrations only, then proves " +
      "supabase_migrations.schema_migrations matches the committed migration files exactly.",
    run: async ({ repoRoot }) => {
      const startedAt = Date.now();
      const reset = await runCommand("supabase", ["db", "reset", "--no-seed"], {
        cwd: repoRoot,
        env: { ...process.env, ...supabaseEnv() },
      });
      const resetOutput = truncateOutput(reset.output);
      if (reset.status !== 0) {
        return result("failed", startedAt, {
          output: resetOutput,
          summary: `supabase db reset --no-seed exited ${reset.status}`,
        });
      }

      let history;
      try {
        history = await compareMigrationHistory({ repoRoot });
      } catch (error) {
        return result("failed", startedAt, {
          output: `${resetOutput}\n\nmigration history check: ${error instanceof Error ? error.message : String(error)}`,
          summary: "could not verify the migration history after the clean rebuild",
        });
      }

      const lines = [
        `migration files: ${history.expected.length}`,
        `applied in history: ${history.applied.length}`,
      ];
      if (history.missing.length > 0) {
        lines.push(
          `missing from history: ${history.missing.map((entry) => entry.file).join(", ")}`
        );
      }
      if (history.extra.length > 0) {
        lines.push(
          `applied but not committed: ${history.extra.map((entry) => entry.version).join(", ")}`
        );
      }
      if (history.renamed.length > 0) {
        lines.push(
          `name mismatch: ${history.renamed
            .map((entry) => `${entry.version} (committed "${entry.name}")`)
            .join(", ")}`
        );
      }

      return result(history.ok ? "passed" : "failed", startedAt, {
        output: `${resetOutput}\n\n${lines.join("\n")}`,
        summary: history.ok
          ? `database rebuilt from ${history.expected.length} migrations; history matches files exactly`
          : "the rebuilt database history does not match the committed migrations",
      });
    },
  };
}

function migrationDryRunGate() {
  return {
    id: "migration-dry-run",
    title: "Local migration dry-run (mirror of the target-environment dry-run)",
    phase: "database",
    blocking: true,
    command: "supabase db push --dry-run --local",
    description:
      "The same command must be run against staging and production before a release; here it " +
      "proves the rebuilt database has no pending migration.",
    run: async ({ repoRoot }) => {
      const startedAt = Date.now();
      const outcome = await runCommand("supabase", ["db", "push", "--dry-run", "--local"], {
        cwd: repoRoot,
        env: { ...process.env, ...supabaseEnv() },
      });
      const output = truncateOutput(outcome.output);
      if (outcome.status !== 0) {
        return result("failed", startedAt, {
          output,
          summary: `supabase db push --dry-run --local exited ${outcome.status}`,
        });
      }
      if (!/up to date/i.test(outcome.output)) {
        return result("failed", startedAt, {
          output,
          summary:
            "dry-run reported pending migrations: the committed migrations and the database disagree",
        });
      }
      return result("passed", startedAt, {
        output,
        summary: "no pending migrations",
      });
    },
  };
}

function supabasePreflightGate() {
  return {
    id: "supabase-preflight",
    title: "Local Supabase is running and reachable",
    phase: "database",
    blocking: true,
    command: "supabase status",
    description:
      "Local only: export DOCKER_HOST and HOME before running, then `supabase start`. The gate " +
      "fails closed so a stopped database can never look like a green release.",
    run: async ({ repoRoot }) => {
      const startedAt = Date.now();
      const status = await runCommand("supabase", ["status"], {
        cwd: repoRoot,
        env: { ...process.env, ...supabaseEnv() },
      });
      const output = truncateOutput(status.output);
      if (status.status !== 0) {
        return result("failed", startedAt, {
          output,
          summary:
            "supabase status failed — start Docker/Supabase first (`supabase start`), then rerun",
        });
      }

      const client = new Client({ connectionString: databaseUrl(repoRoot) });
      try {
        await client.connect();
        await client.query("select 1");
      } catch (error) {
        return result("failed", startedAt, {
          output: `${output}\n\npostgres: ${error instanceof Error ? error.message : String(error)}`,
          summary: "the local Postgres is not reachable",
        });
      } finally {
        await client.end().catch(() => undefined);
      }

      return result("passed", startedAt, {
        output,
        summary: "Supabase is up and Postgres answers",
      });
    },
  };
}

/* ------------------------------------------------------------------- gates */

export function buildGates() {
  return [
    pnpmGate("lockfile-install", "Frozen-lockfile install verification", "static", [
      "install",
      "--frozen-lockfile",
    ]),
    pnpmGate("dependency-audit", "Production dependency audit", "static", ["security:audit"]),
    pnpmGate("invariant-audit-writes", "Ticket-21 invariant: no mutation-then-audit", "static", [
      "audit:writes",
    ]),
    productionAiGate(),
    {
      ...commandGate({
        id: "checklist-integrity",
        title: "Release checklist has no unsigned completion claim",
        phase: "static",
        command: "node",
        args: ["scripts/check-release-checklist.mjs"],
      }),
    },
    documentationGate(),
    pnpmGate("lint", "Lint (ESLint + Prettier)", "static", ["lint"]),
    pnpmGate("typecheck", "Typecheck (next typegen + tsc)", "static", ["typecheck"]),
    pnpmGate("typecheck-scripts", "Typecheck scripts project", "static", ["typecheck:scripts"]),
    pnpmGate("unit", "Unit tests", "static", ["test:unit"]),
    pnpmGate("smoke", "Smoke tests", "static", ["test:smoke"]),
    pnpmGate("acceptance", "Acceptance tests", "static", ["test:acceptance"]),
    pnpmGate("build", "Production build", "static", ["build"]),
    supabasePreflightGate(),
    migrationCleanRebuildGate(),
    migrationDryRunGate(),
    supabaseGate(
      "schema-seed-rebuild",
      "Seed rebuild for the runtime suites",
      "database",
      ["db", "reset"],
      { env: () => supabaseEnv() }
    ),
    pnpmGate("db-types-current", "Generated database types are current", "database", [
      "db:types:check",
    ]),
    pnpmGate("rpc-permissions", "RPC permissions and search_path", "database", [
      "audit:rpc-permissions",
    ]),
    pnpmGate(
      "integration",
      "Integration tests (serialized for determinism)",
      "database",
      ["test:integration:release"],
      {
        description:
          "Runs vitest with --no-file-parallelism so a shared local database cannot make " +
          "untouched files fail in beforeAll; skipped tests fail the gate instead of passing it.",
        postCheck: (output) => {
          const skipped = detectSkippedTests(output);
          return skipped
            ? `integration tests reported skips (${skipped}); the local environment is incomplete`
            : null;
        },
      }
    ),
    pnpmGate("e2e", "End-to-end browser journey", "database", ["test:e2e"], {
      description:
        "Runs the browser journey with RELEASE_ID pinned to the release SHA, so a readiness " +
        "payload from another build cannot pass as this artifact.",
      env: ({ identity }) => ({ RELEASE_ID: identity.releaseSha, ...playwrightBrowserEnv() }),
    }),
  ];
}

/** Every gate must belong to exactly one phase, and the phases cover them all. */
export function partitionGates(gates = buildGates()) {
  const byPhase = Object.fromEntries(PHASES.map((phase) => [phase, []]));
  const problems = [];
  const seen = new Set();
  for (const gate of gates) {
    if (!PHASES.includes(gate.phase)) {
      problems.push(`gate "${gate.id}" has an unknown phase "${gate.phase}"`);
      continue;
    }
    if (seen.has(gate.id)) problems.push(`gate id "${gate.id}" is declared twice`);
    seen.add(gate.id);
    byPhase[gate.phase].push(gate);
  }
  return { byPhase, problems };
}

/* ---------------------------------------------------------------- evidence */

/**
 * Build the unsigned evidence record.
 *
 * Signature-bearing input is deliberately ignored: this generator only ever
 * writes `signatureStatus: "unsigned"` and `pending` manual gates. A signature
 * is a human act recorded in the checklist, never a generated artifact.
 */
export function buildEvidence({ identity, gates, phase, startedAt, finishedAt, remoteCi } = {}) {
  const failed = gates.filter((gate) => gate.status === "failed");
  const notRun = gates.filter((gate) => gate.status === "not-run");
  const passed = gates.filter((gate) => gate.status === "passed");

  return {
    schemaVersion: 1,
    generator: "scripts/release-check.mjs",
    phase,
    completeRun: phase === "all",
    releaseSha: identity.releaseSha,
    releaseShaSource: identity.releaseShaSource,
    releaseRef: identity.releaseRef,
    worktree: identity.worktree,
    lockfile: identity.lockfile,
    packageJson: identity.packageJson,
    toolchain: identity.toolchain,
    startedAt,
    finishedAt,
    durationMs: Date.parse(finishedAt) - Date.parse(startedAt),
    result: failed.length === 0 && notRun.length === 0 ? "passed" : "failed",
    counts: {
      total: gates.length,
      passed: passed.length,
      failed: failed.length,
      notRun: notRun.length,
    },
    gates,
    remoteCi,
    checklist: CHECKLIST_PATH,
    manualGates: pendingManualGates(),
    humanSignature: null,
    signatureStatus: "unsigned",
  };
}

/** Hard invariant: the generator may never emit a signed record. */
export function assertUnsignedEvidence(evidence) {
  if (evidence.signatureStatus !== "unsigned" || evidence.humanSignature !== null) {
    throw new Error(
      "release-check must never write signed evidence: signatures belong in " +
        "docs/ops/release-checklist.md and are owned by a human (ticket 24)"
    );
  }
  for (const gate of evidence.manualGates) {
    if (
      gate.status !== "pending" ||
      gate.signature !== null ||
      gate.signed_by !== null ||
      gate.signed_at !== null ||
      gate.timestamp !== null ||
      gate.evidence !== null
    ) {
      throw new Error(
        `release-check must only write pending manual gates (offending gate "${gate.id}")`
      );
    }
  }
  return evidence;
}

export function writeEvidence(repoRoot, evidence) {
  assertUnsignedEvidence(evidence);
  const directory = join(repoRoot, EVIDENCE_DIR);
  mkdirSync(directory, { recursive: true });

  const stamp = evidence.finishedAt.replace(/[:.]/g, "-");
  const sha12 = String(evidence.releaseSha).slice(0, 12);
  const relativePath = join(EVIDENCE_DIR, `${sha12}-${evidence.phase}-${stamp}.json`);
  const text = `${JSON.stringify(evidence, null, 2)}\n`;

  writeFileSync(join(repoRoot, relativePath), text);
  const pointer = evidence.phase === "all" ? "latest.json" : `latest-${evidence.phase}.json`;
  writeFileSync(join(repoRoot, EVIDENCE_DIR, pointer), text);

  return { path: relativePath, sha256: sha256Text(text), pointer: join(EVIDENCE_DIR, pointer) };
}

/* -------------------------------------------------------------------- main */

function parseArgs(argv) {
  if (argv.includes("--list")) return { list: true };
  const index = argv.indexOf("--phase");
  const phase = index === -1 ? "all" : (argv[index + 1] ?? "");
  if (index !== -1 && ![...PHASES, "all"].includes(phase)) {
    return { error: `--phase must be one of: ${[...PHASES, "all"].join(", ")} (got "${phase}")` };
  }
  return { phase };
}

async function runRelease({ phase, repoRoot = process.cwd() }) {
  const gates = buildGates();
  const { byPhase, problems } = partitionGates(gates);
  if (problems.length > 0) {
    console.error(problems.join("\n"));
    process.exit(2);
  }

  const selected = phase === "all" ? gates : byPhase[phase];
  const identity = collectIdentity(repoRoot);
  const startedAt = new Date().toISOString();
  const remoteCi = collectRemoteCi();

  console.log(`\n=== Release gate (ticket 23) — phase ${phase} ===`);
  console.log(`release SHA:     ${identity.releaseSha} (${identity.releaseShaSource})`);
  console.log(`release ref:     ${identity.releaseRef}`);
  console.log(
    `worktree:        ${identity.worktree.dirty ? "DIRTY (uncommitted changes present)" : "clean"}`
  );
  console.log(`lockfile:        ${identity.lockfile.path} sha256 ${identity.lockfile.sha256}`);
  console.log(`started at:      ${startedAt}`);
  console.log(
    `remote CI:       ${remoteCi.status}${remoteCi.runUrl ? ` (${remoteCi.runUrl})` : ""}`
  );
  console.log(`gates:           ${selected.map((gate) => gate.id).join(" → ")}`);

  const results = [];
  let failed = false;

  for (const gate of selected) {
    if (failed) {
      results.push({
        id: gate.id,
        title: gate.title,
        phase: gate.phase,
        blocking: true,
        status: "not-run",
        command: gate.command,
        durationMs: 0,
        summary: "not run: an earlier blocking gate failed",
        output: "",
      });
      continue;
    }

    console.log(`\n▶ [${gate.phase}] ${gate.title}`);
    if (gate.command) console.log(`  $ ${gate.command}`);
    if (gate.description) console.log(`  ${gate.description}`);

    let outcome;
    try {
      outcome = await gate.run({ repoRoot, phase, identity });
    } catch (error) {
      outcome = {
        status: "failed",
        durationMs: 0,
        output: error instanceof Error ? (error.stack ?? error.message) : String(error),
        summary: "the gate threw before it could report a result",
      };
    }

    results.push({
      id: gate.id,
      title: gate.title,
      phase: gate.phase,
      blocking: true,
      status: outcome.status,
      command: gate.command,
      durationMs: outcome.durationMs ?? 0,
      summary: outcome.summary ?? "",
      output: truncateOutput(outcome.output ?? ""),
      ...(outcome.details ? { details: outcome.details } : {}),
    });

    const marker = outcome.status === "passed" ? "PASS" : "FAIL";
    console.log(
      `  ${marker} ${gate.id} (${Math.round((outcome.durationMs ?? 0) / 100) / 10}s) — ${outcome.summary ?? ""}`
    );
    if (outcome.status !== "passed") failed = true;
  }

  const finishedAt = new Date().toISOString();
  const evidence = buildEvidence({
    identity,
    gates: results,
    phase,
    startedAt,
    finishedAt,
    remoteCi,
  });
  const written = writeEvidence(repoRoot, evidence);

  console.log(`\n=== Release evidence ===`);
  console.log(`release SHA:     ${evidence.releaseSha}`);
  console.log(`lockfile sha256: ${evidence.lockfile.sha256}`);
  console.log(`started:         ${evidence.startedAt}`);
  console.log(
    `finished:        ${evidence.finishedAt} (${(evidence.durationMs / 1000).toFixed(1)}s)`
  );
  console.log(`result:          ${evidence.result.toUpperCase()}`);
  console.log(`gates:`);
  for (const gate of evidence.gates) {
    console.log(
      `  ${gate.status === "passed" ? "PASS" : gate.status === "failed" ? "FAIL" : "SKIP"} ` +
        `${gate.id.padEnd(26)} ${(gate.durationMs / 1000).toFixed(1)}s  ${gate.summary}`
    );
  }
  console.log(`evidence:        ${written.path} (sha256 ${written.sha256})`);
  console.log(`remote CI:       ${remoteCi.status}`);
  console.log(
    `manual gates:    ${evidence.manualGates.length} pending — signed by a human in ${CHECKLIST_PATH} (ticket 24)`
  );

  if (evidence.result !== "passed") {
    console.error(
      `\nRelease gate FAILED in phase ${phase}. Fix the failing gate and rerun; do not sign the checklist.`
    );
    process.exit(1);
  }

  if (phase !== "all") {
    console.log(
      `\nPhase ${phase} passed. A full release also needs the other phase and remote CI green for ` +
        "this SHA; run `pnpm release:check` locally or let both CI jobs finish."
    );
  } else if (remoteCi.status === "not-observed") {
    console.log(
      "\nAll local gates passed. Remote CI for this exact SHA is not observed yet — push the " +
        "release commit and let `.github/workflows/ci.yml` run green before a human signs the checklist."
    );
  }
}

function main() {
  process.on("exit", cleanupSupabaseEnv);
  const args = parseArgs(process.argv.slice(2));
  if (args.error) {
    console.error(args.error);
    process.exit(2);
  }
  if (args.list) {
    const gates = buildGates();
    for (const gate of gates) console.log(`${gate.phase.padEnd(9)} ${gate.id}`);
    return;
  }
  runRelease({ phase: args.phase }).catch((error) => {
    console.error(
      `release gate: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`
    );
    process.exit(2);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
