import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir, userInfo } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  assertUnsignedEvidence,
  buildEvidence,
  buildGates,
  detectSkippedTests,
  partitionGates,
  playwrightBrowserEnv,
  writeEvidence,
} from "../../scripts/release-check.mjs";
import {
  MANUAL_GATES,
  REQUIRED_GATE_IDS,
  extractMachineBlock,
  pendingManualGates,
  validateChecklist,
} from "../../scripts/check-release-checklist.mjs";
import { collectSources, evaluateProductionAiGate } from "../../scripts/check-production-ai.mjs";

/**
 * Ticket 23: a release gate only counts when it is reproducible, keeps the
 * production AI guarded, and cannot look "completed" without timestamped
 * evidence plus a human signature. These tests exercise the pure parts of the
 * gate so the invariants are enforced by the normal test suite.
 */

const temporaryDirectories: string[] = [];

function temporaryDirectory(prefix: string): string {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

afterAll(() => {
  for (const directory of temporaryDirectories) rmSync(directory, { recursive: true, force: true });
});

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function checklistMarkdown(machine: Record<string, unknown>): string {
  return [
    "# fixture checklist",
    "",
    "<!-- release-checklist-machine:begin -->",
    "```json",
    JSON.stringify(machine, null, 2),
    "```",
    "<!-- release-checklist-machine:end -->",
    "",
  ].join("\n");
}

function pendingGateEntries() {
  return Object.fromEntries(
    REQUIRED_GATE_IDS.map((id) => [
      id,
      {
        status: "pending",
        evidence: null,
        timestamp: null,
        signed_by: null,
        signed_at: null,
        signature: null,
      },
    ])
  );
}

function validMachine(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema_version: 1,
    release_sha: "a".repeat(40),
    lockfile_sha256: "b".repeat(64),
    release_status: "draft",
    released_at: null,
    released_by: null,
    automated_evidence: null,
    manual_gates: pendingGateEntries(),
    ...overrides,
  };
}

describe("release gate registry", () => {
  it("partitions every blocking gate into exactly one phase", () => {
    const gates = buildGates();
    const { byPhase, problems } = partitionGates(gates);

    expect(problems).toEqual([]);
    expect(byPhase.static.length + byPhase.database.length).toBe(gates.length);
    expect(new Set(gates.map((gate) => gate.id)).size).toBe(gates.length);
  });

  it("covers every check the ticket requires as blocking", () => {
    const ids = buildGates().map((gate) => gate.id);

    for (const required of [
      "lockfile-install",
      "dependency-audit",
      "invariant-audit-writes",
      "lint",
      "typecheck",
      "unit",
      "smoke",
      "acceptance",
      "integration",
      "e2e",
      "build",
      "migration-clean-rebuild",
      "migration-dry-run",
      "production-ai-disabled",
      "db-types-current",
      "rpc-permissions",
    ]) {
      expect(ids, `missing blocking gate ${required}`).toContain(required);
    }
    expect(buildGates().every((gate) => gate.blocking)).toBe(true);
  });

  it("runs the integration suite serialized and rejects silently skipped tests", () => {
    const integration = buildGates().find((gate) => gate.id === "integration");
    expect(integration?.command).toContain("test:integration:release");

    expect(
      detectSkippedTests("  Test Files  110 passed (110)\n      Tests  852 passed (852)\n")
    ).toBe(null);
    expect(
      detectSkippedTests(
        "  Test Files  110 passed (110)\n      Tests  1 skipped | 851 passed (852)\n"
      )
    ).toContain("skipped");
  });
});

describe("release evidence generator", () => {
  const identity = {
    releaseSha: "c".repeat(40),
    releaseShaSource: "git HEAD",
    releaseRef: "main",
    worktree: { dirty: false, status: "" },
    lockfile: { path: "pnpm-lock.yaml", sha256: "d".repeat(64) },
    packageJson: { path: "package.json", sha256: "e".repeat(64) },
    toolchain: { node: "v24.0.0", pnpm: "9.15.4" },
  };

  function evidence(overrides: Record<string, unknown> = {}) {
    return buildEvidence({
      identity,
      phase: "all",
      startedAt: "2026-01-01T00:00:00.000Z",
      finishedAt: "2026-01-01T00:10:00.000Z",
      remoteCi: { status: "not-observed" },
      gates: [
        {
          id: "lint",
          title: "Lint",
          phase: "static",
          blocking: true,
          status: "passed",
          durationMs: 1,
          summary: "",
          output: "",
        },
      ],
      ...overrides,
    });
  }

  it("never writes a signature, even when the caller tries to", () => {
    const record = evidence({
      humanSignature: { signed_by: "someone", signature: "x" },
      signatureStatus: "signed",
      manualGates: MANUAL_GATES.map((gate) => ({
        id: gate.id,
        status: "done",
        evidence: "fake",
        timestamp: "2026-01-01T00:00:00.000Z",
        signed_by: "someone",
        signed_at: "2026-01-01T00:00:00.000Z",
        signature: "x",
      })),
    });

    expect(record.signatureStatus).toBe("unsigned");
    expect(record.humanSignature).toBeNull();
    expect(record.manualGates.map((gate) => gate.id)).toEqual(REQUIRED_GATE_IDS);
    expect(record.manualGates.every((gate) => gate.status === "pending")).toBe(true);
    expect(() => assertUnsignedEvidence(record)).not.toThrow();
  });

  it("refuses to write a tampered signed record", () => {
    const record = evidence();
    expect(() => assertUnsignedEvidence({ ...record, signatureStatus: "signed" })).toThrow(
      /never write signed evidence/
    );
    expect(() =>
      assertUnsignedEvidence({
        ...record,
        manualGates: [{ ...pendingManualGates()[0], status: "done", signature: "forged" }],
      })
    ).toThrow(/pending manual gates/);
  });

  it("writes the evidence and reports the same failure it records", () => {
    const repoRoot = temporaryDirectory("release-evidence-");
    const failed = evidence({
      gates: [
        {
          id: "lint",
          title: "Lint",
          phase: "static",
          blocking: true,
          status: "failed",
          durationMs: 1,
          summary: "eslint exited 1",
          output: "x",
        },
        {
          id: "typecheck",
          title: "Typecheck",
          phase: "static",
          blocking: true,
          status: "not-run",
          durationMs: 0,
          summary: "not run",
          output: "",
        },
      ],
    });

    expect(failed.result).toBe("failed");
    const written = writeEvidence(repoRoot, failed);
    const text = readFileSync(join(repoRoot, written.path), "utf8");
    expect(sha256(text)).toBe(written.sha256);
    expect(JSON.parse(text).result).toBe("failed");
  });
});

describe("release checklist integrity", () => {
  it("accepts the committed checklist while its manual gates are unsigned", () => {
    const markdown = readFileSync("docs/ops/release-checklist.md", "utf8");
    const result = validateChecklist({ markdown, repoRoot: process.cwd() });
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.status).not.toBe("completed");
  });

  it("rejects a done gate without timestamped evidence and a signature", () => {
    const machine = validMachine({
      manual_gates: {
        ...pendingGateEntries(),
        "staging-smoke": { ...pendingGateEntries()["staging-smoke"], status: "done" },
      },
    });
    const result = validateChecklist({ markdown: checklistMarkdown(machine) });
    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toMatch(
      /missing: evidence, timestamp, signed_by, signed_at, signature/
    );
  });

  it("rejects signature fields on a gate that is not done", () => {
    const machine = validMachine({
      manual_gates: {
        ...pendingGateEntries(),
        "restore-drill": { ...pendingGateEntries()["restore-drill"], signed_by: "someone" },
      },
    });
    const result = validateChecklist({ markdown: checklistMarkdown(machine) });
    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toMatch(/carries signature fields/);
  });

  it("rejects completed without every manual gate signed", () => {
    const machine = validMachine({ release_status: "completed" });
    const result = validateChecklist({ markdown: checklistMarkdown(machine) });
    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toMatch(/only 0\/10 manual gates are done/);
  });

  function signedMachine(repoRoot: string) {
    const evidenceRecord = {
      schemaVersion: 1,
      result: "passed",
      releaseSha: "f".repeat(40),
      lockfile: { sha256: "1".repeat(64) },
      signatureStatus: "unsigned",
      humanSignature: null,
      gates: [
        {
          id: "lint",
          blocking: true,
          status: "passed",
        },
      ],
    };
    const text = `${JSON.stringify(evidenceRecord, null, 2)}\n`;
    writeFileSync(join(repoRoot, "evidence.json"), text);

    const manualGates = Object.fromEntries(
      REQUIRED_GATE_IDS.map((id) => [
        id,
        {
          status: "done",
          evidence: `evidence for ${id}`,
          timestamp: "2026-01-02T10:00:00Z",
          signed_by: "Accountable Owner",
          signed_at: "2026-01-02T10:05:00Z",
          signature: `handwritten-${id}`,
        },
      ])
    );

    return validMachine({
      release_sha: "f".repeat(40),
      lockfile_sha256: "1".repeat(64),
      release_status: "completed",
      released_at: "2026-01-02T10:06:00Z",
      released_by: "Accountable Owner",
      automated_evidence: { path: "evidence.json", sha256: sha256(text) },
      manual_gates: manualGates,
    });
  }

  it("accepts a fully signed completed checklist backed by matching evidence", () => {
    const repoRoot = temporaryDirectory("release-checklist-");
    const result = validateChecklist({
      markdown: checklistMarkdown(signedMachine(repoRoot)),
      repoRoot,
    });
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.status).toBe("completed");
  });

  it("rejects completed when the evidence file claims a human signature", () => {
    const repoRoot = temporaryDirectory("release-checklist-signed-evidence-");
    const machine = signedMachine(repoRoot);
    const evidencePath = join(repoRoot, "evidence.json");
    const tampered = readFileSync(evidencePath, "utf8").replace(
      '"signatureStatus": "unsigned"',
      '"signatureStatus": "signed"'
    );
    writeFileSync(evidencePath, tampered);
    machine.automated_evidence = {
      path: "evidence.json",
      sha256: sha256(tampered),
    };

    const result = validateChecklist({ markdown: checklistMarkdown(machine), repoRoot });
    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toMatch(/claims a human signature/);
  });

  it("rejects completed when the evidence belongs to another lockfile", () => {
    const repoRoot = temporaryDirectory("release-checklist-lockfile-");
    const machine = signedMachine(repoRoot);
    machine.lockfile_sha256 = "2".repeat(64);

    const result = validateChecklist({ markdown: checklistMarkdown(machine), repoRoot });
    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toMatch(/lockfile hash does not match/);
  });

  it("parses the machine block and refuses a checklist without one", () => {
    expect(() => extractMachineBlock("# no machine block")).toThrow(/release-checklist-machine/);
    expect(extractMachineBlock(checklistMarkdown(validMachine()))).toMatchObject({
      schema_version: 1,
    });
  });
});

describe("production AI gate", () => {
  const repoRoot = process.cwd();

  it("passes on the real repository: AI is disabled by default", () => {
    const result = evaluateProductionAiGate(collectSources(repoRoot));
    expect(result.ok).toBe(true);
    expect(result.mode).toBe("disabled");
  });

  it("fails when a committed default would enable AI without an approved decision", () => {
    const sources = collectSources(repoRoot);
    const result = evaluateProductionAiGate({
      ...sources,
      envSource: (sources.envSource ?? "").replace('.default("false")', '.default("true")'),
    });
    expect(result.ok).toBe(false);
    expect(result.mode).toBe("unsafe-enable");
    expect((result.reasons ?? []).join("\n")).toMatch(/ai-production-decision\.md/);
  });

  it("fails when a caller could bypass the environment check", () => {
    const sources = collectSources(repoRoot);
    const result = evaluateProductionAiGate({
      ...sources,
      callerSources: [
        { path: "lib/service/example.ts", source: "runAi({ productionAiEnabled: true });" },
      ],
    });
    expect(result.ok).toBe(false);
    expect(result.checks["no caller passes productionAiEnabled"]).toBe(false);
  });

  it("fails when a workflow enables AI without an approved decision", () => {
    const sources = collectSources(repoRoot);
    const result = evaluateProductionAiGate({
      ...sources,
      configSources: [
        {
          path: ".github/workflows/deploy-production.yml",
          source: 'AI_PRODUCTION_ENABLED: "true"',
        },
      ],
    });
    expect(result.ok).toBe(false);
  });

  it("allows an explicit enable only with a complete approval record", () => {
    const sources = collectSources(repoRoot);
    const enabled = {
      ...sources,
      envSource: (sources.envSource ?? "").replace('.default("false")', '.default("true")'),
    };

    const incomplete = evaluateProductionAiGate({
      ...enabled,
      decisionSource: "Status: approved\nApproved by: Owner\n",
    });
    expect(incomplete.ok).toBe(false);
    expect(incomplete.decision.missing).toContain("Provider: <provider>");

    const complete = evaluateProductionAiGate({
      ...enabled,
      decisionSource: [
        "Status: approved",
        "Approved by: Accountable Owner",
        "Date: 2026-02-01",
        "Provider: Example AI",
        "Data region: EU",
        "Retention: 30 days, no training",
        "Processing agreement: DPA-2026-01",
        "Cross-border transfer: none",
        "Production evaluation run (non-real data): EVAL-2026-02-01",
      ].join("\n"),
    });
    expect(complete.ok).toBe(true);
    expect(complete.mode).toBe("enabled-by-approved-decision");
  });
});

describe("CI wiring", () => {
  it("runs the documented release command phases from the workflow", () => {
    const workflow = readFileSync(".github/workflows/ci.yml", "utf8");
    expect(workflow).toContain("pnpm release:check:static");
    expect(workflow).toContain("pnpm release:check:database");
    expect(workflow).toContain("pnpm install --frozen-lockfile");
    expect(workflow).toContain(".release");
  });

  it("documents the release command in every operator entry point", () => {
    for (const path of ["README.md", "docs/development.md", "docs/ops/release-readiness.md"]) {
      expect(readFileSync(path, "utf8"), `${path} must document pnpm release:check`).toContain(
        "pnpm release:check"
      );
    }
  });
});

describe("playwrightBrowserEnv", () => {
  it("leaves an explicit PLAYWRIGHT_BROWSERS_PATH untouched", () => {
    expect(
      playwrightBrowserEnv({
        ...process.env,
        HOME: "/tmp/other",
        PLAYWRIGHT_BROWSERS_PATH: "/tmp/custom",
      })
    ).toEqual({});
  });

  it("does not override when HOME is the real user home", () => {
    const realHome = userInfo().homedir;
    expect(playwrightBrowserEnv({ ...process.env, HOME: realHome })).toEqual({});
  });

  it("points Playwright at the real cache when HOME was overridden", () => {
    const realHome = userInfo().homedir;
    const result = playwrightBrowserEnv({ ...process.env, HOME: "/tmp/release-supabase-home" });
    // Either the real cache exists and is returned, or it does not and the gate
    // keeps Playwright's default (nothing to point at).
    if (Object.keys(result).length > 0) {
      expect(result.PLAYWRIGHT_BROWSERS_PATH?.startsWith(realHome)).toBe(true);
    } else {
      expect(result).toEqual({});
    }
  });
});
