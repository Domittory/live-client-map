import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Ticket 21: the mutation-then-audit pattern may not come back.
 *
 * The guard script (`scripts/check-unsafe-audit-writes.mjs`) parses the service
 * layer and fails when a `recordAudit()` / `withAudit()` call site is not on its
 * documented allowlist, or when a path writes domain state before appending its
 * audit row. Running it as a test means the normal test suite enforces it, so CI
 * cannot merge a regression unnoticed.
 *
 * The second case proves the guard actually detects the unsafe shape instead of
 * merely returning zero on the current tree.
 *
 * See docs/development.md § «Аудит и атомарность мутаций» for the policy.
 */
function runGuard(serviceDir?: string) {
  return spawnSync("node", ["scripts/check-unsafe-audit-writes.mjs"], {
    encoding: "utf8",
    env: serviceDir ? { ...process.env, AUDIT_GUARD_SERVICE_DIR: serviceDir } : process.env,
  });
}

describe("unsafe audit-write guard (ticket 21)", () => {
  it("service layer has no undocumented or mutation-then-audit call site", () => {
    const result = runGuard();

    expect(result.error).toBeUndefined();
    expect(result.status, `guard failed:\n${result.stdout ?? ""}${result.stderr ?? ""}`).toBe(0);
  });

  it("fails a mutation-then-audit call site and an undocumented audit call", () => {
    const directory = mkdtempSync(join(tmpdir(), "audit-guard-fixture-"));
    try {
      writeFileSync(
        join(directory, "unsafe.ts"),
        [
          'import { recordAudit } from "./audit";',
          "export async function unsafeCreate(client: any, organizationId: string) {",
          '  await client.from("life_events").insert({ title: "x" });',
          '  await recordAudit(client, { organizationId, entityType: "life_event", action: "x" });',
          "}",
          "export async function undocumentedReadAudit(client: any, organizationId: string) {",
          '  await recordAudit(client, { organizationId, entityType: "client", action: "export.x" });',
          "}",
          "",
        ].join("\n")
      );

      const result = runGuard(directory);

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("mutation-then-audit");
      expect(result.stderr).toContain("undocumented-audit");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
