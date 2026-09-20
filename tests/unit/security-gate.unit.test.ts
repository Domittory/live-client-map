import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

/**
 * Ticket 03: the production dependency gate must block critical/high advisories,
 * honour documented time-bounded exceptions, and stop honouring them once they
 * expire. The gate reads an injected audit report so the test needs no network.
 */
const scriptPath = path.resolve("scripts/security-audit.mjs");
const workDir = mkdtempSync(path.join(tmpdir(), "security-gate-"));

afterAll(() => {
  rmSync(workDir, { recursive: true, force: true });
});

let counter = 0;

function writeJson(value: unknown, prefix: string): string {
  counter += 1;
  const file = path.join(workDir, `${prefix}-${counter}.json`);
  writeFileSync(file, JSON.stringify(value));
  return file;
}

function advisory(severity: string, moduleName = "example-pkg"): Record<string, unknown> {
  return {
    id: 1000,
    github_advisory_id: "GHSA-test-0001",
    npm_advisory_id: 42,
    module_name: moduleName,
    severity,
    title: `Example ${severity} advisory`,
    patched_versions: ">=2.0.0",
    vulnerable_versions: "<2.0.0",
  };
}

function runGate(
  advisories: Array<Record<string, unknown>>,
  exceptions?: unknown
): { status: number; stdout: string; stderr: string } {
  const reportPath = writeJson(
    { advisories: Object.fromEntries(advisories.map((entry, index) => [String(index), entry])) },
    "report"
  );

  const env = {
    ...process.env,
    SECURITY_AUDIT_REPORT: reportPath,
    SECURITY_AUDIT_EXCEPTIONS: writeJson(exceptions ?? { exceptions: [] }, "exceptions"),
  };

  const result = spawnSync(process.execPath, [scriptPath], { encoding: "utf8", env });
  return { status: result.status ?? -1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

describe("production dependency security gate", () => {
  it("passes when production dependencies have no critical or high advisories", () => {
    const result = runGate([advisory("moderate"), advisory("low")]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("No critical or high vulnerabilities");
  });

  it("blocks a critical advisory", () => {
    const result = runGate([advisory("critical")]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Blocking vulnerabilities in production dependencies");
    expect(result.stderr).toContain("GHSA-test-0001");
  });

  it("blocks a high advisory", () => {
    expect(runGate([advisory("high")]).status).toBe(1);
  });

  it("honours a documented, unexpired exception", () => {
    const result = runGate([advisory("high")], {
      exceptions: [
        {
          id: "GHSA-test-0001",
          reason: "Fix requires a framework upgrade tracked in ticket 99",
          owner: "project owner",
          expiresAt: "2999-01-01T00:00:00.000Z",
        },
      ],
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Accepted exceptions");
  });

  it("stops honouring an expired exception", () => {
    const result = runGate([advisory("high")], {
      exceptions: [
        {
          id: "GHSA-test-0001",
          reason: "Temporary acceptance",
          owner: "project owner",
          expiresAt: "2000-01-01T00:00:00.000Z",
        },
      ],
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Expired exceptions");
    expect(result.stderr).toContain("exception expired");
  });

  it("rejects an exception without an owner, reason or expiry", () => {
    const result = runGate([advisory("high")], {
      exceptions: [{ id: "GHSA-test-0001", reason: "no owner and no expiry" }],
    });

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('missing a non-empty "owner"');
  });

  it("does not block an exception recorded for a different advisory", () => {
    const result = runGate([advisory("high")], {
      exceptions: [
        {
          id: "GHSA-somewhere-else",
          reason: "Unrelated advisory",
          owner: "project owner",
          expiresAt: "2999-01-01T00:00:00.000Z",
        },
      ],
    });

    expect(result.status).toBe(1);
  });
});
