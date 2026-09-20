#!/usr/bin/env node
/**
 * Production dependency security gate (ticket 03).
 *
 * Runs `pnpm audit --prod` against the release lockfile and fails when the
 * production dependency tree contains a critical or high advisory. The audit is
 * prod-scoped on purpose: a vulnerability that only affects dev tooling must not
 * block a release, and a production one must never hide behind dev noise.
 *
 * Time-bounded exceptions live in `.security-audit-exceptions.json`. Each entry
 * must name an owner, a reason and an expiry date; an expired entry no longer
 * suppresses anything and is reported as an error. This is deliberate: an
 * accepted risk must be re-approved, never silently inherited.
 *
 * Test seams (used by tests/unit/security-gate.unit.test.ts, never in CI runs):
 *   SECURITY_AUDIT_REPORT     read this audit JSON instead of invoking pnpm
 *   SECURITY_AUDIT_EXCEPTIONS read exceptions from this path
 *
 * Exit codes: 0 = gate passed, 1 = blocking finding, 2 = the gate could not run.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const BLOCKING_SEVERITIES = new Set(["critical", "high"]);
const DEFAULT_EXCEPTIONS_PATH = ".security-audit-exceptions.json";

function fail(message) {
  console.error(`security gate: ${message}`);
  process.exit(2);
}

function loadExceptions(path) {
  if (!existsSync(path)) return [];

  let parsed;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    fail(`${path} is not valid JSON: ${error.message}`);
  }

  const exceptions = parsed.exceptions;
  if (!Array.isArray(exceptions)) {
    fail(`${path} must contain an "exceptions" array`);
  }

  const now = Date.now();
  return exceptions.map((entry, index) => {
    const label = `${path}[${index}]`;
    for (const field of ["id", "reason", "owner", "expiresAt"]) {
      if (typeof entry?.[field] !== "string" || entry[field].trim() === "") {
        fail(
          `${label} is missing a non-empty "${field}" (id, reason, owner and expiresAt are required)`
        );
      }
    }
    const expiresAt = new Date(entry.expiresAt);
    if (Number.isNaN(expiresAt.getTime())) {
      fail(`${label} has an invalid expiresAt: ${JSON.stringify(entry.expiresAt)}`);
    }
    return { ...entry, expired: expiresAt.getTime() < now };
  });
}

function loadReport() {
  const injected = process.env.SECURITY_AUDIT_REPORT;
  if (injected) {
    try {
      return JSON.parse(readFileSync(injected, "utf8"));
    } catch (error) {
      fail(`could not read SECURITY_AUDIT_REPORT ${injected}: ${error.message}`);
    }
  }

  const result = spawnSync("pnpm", ["audit", "--prod", "--json"], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  const raw = (result.stdout ?? "").trim();
  if (!raw) {
    fail(`pnpm audit produced no report (exit ${result.status}): ${(result.stderr ?? "").trim()}`);
  }
  try {
    return JSON.parse(raw);
  } catch (error) {
    fail(`pnpm audit did not return JSON: ${error.message}`);
  }
}

const exceptionsPath = process.env.SECURITY_AUDIT_EXCEPTIONS ?? DEFAULT_EXCEPTIONS_PATH;
const report = loadReport();
const advisories = Object.values(report.advisories ?? {});
const exceptions = loadExceptions(exceptionsPath);

const counts = { critical: 0, high: 0, moderate: 0, low: 0, info: 0 };
const blocking = [];
const accepted = [];

for (const advisory of advisories) {
  const severity = advisory.severity;
  counts[severity] = (counts[severity] ?? 0) + 1;
  if (!BLOCKING_SEVERITIES.has(severity)) continue;

  const identifiers = [
    advisory.github_advisory_id,
    advisory.npm_advisory_id,
    String(advisory.id),
    advisory.module_name,
  ].filter(Boolean);

  const exception = exceptions.find((entry) => identifiers.includes(entry.id));
  if (exception && !exception.expired) {
    accepted.push({ advisory, exception });
  } else {
    blocking.push({
      advisory,
      identifiers,
      expiredException: exception?.expired ? exception : null,
    });
  }
}

console.log("Production dependency security gate (ticket 03)");
console.log(
  `Advisories: ${counts.critical} critical, ${counts.high} high, ` +
    `${counts.moderate} moderate, ${counts.low} low`
);

if (accepted.length > 0) {
  console.log("\nAccepted exceptions:");
  for (const { advisory, exception } of accepted) {
    console.log(
      `  - ${advisory.module_name} ${advisory.severity}: ${exception.id} ` +
        `(owner ${exception.owner}, expires ${exception.expiresAt})`
    );
  }
}

const expired = exceptions.filter((entry) => entry.expired);
if (expired.length > 0) {
  console.error("\nExpired exceptions (re-approval required):");
  for (const entry of expired) {
    console.error(`  - ${entry.id} expired on ${entry.expiresAt} (owner ${entry.owner})`);
  }
}

if (blocking.length > 0) {
  console.error("\nBlocking vulnerabilities in production dependencies:");
  for (const { advisory, identifiers, expiredException } of blocking) {
    const note = expiredException ? " [exception expired]" : "";
    console.error(
      `  - ${advisory.module_name} ${advisory.severity}${note}: ${advisory.title} ` +
        `(${advisory.github_advisory_id ?? identifiers[0]}, patched: ${advisory.patched_versions})`
    );
  }
  console.error(
    "\nFix by upgrading the affected package, or record a time-bounded exception with an owner, " +
      `reason and expiry in ${exceptionsPath}.`
  );
  process.exit(1);
}

console.log("\nNo critical or high vulnerabilities in production dependencies.");
