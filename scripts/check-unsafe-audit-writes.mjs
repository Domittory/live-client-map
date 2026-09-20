#!/usr/bin/env node
/**
 * Unsafe audit-write guard (ticket 21).
 *
 * The atomic business mutation contract (migration 0039, SPEC §44) says a
 * compound mutation must commit its domain rows, its child rows and its
 * AuditLog append inside ONE PostgreSQL transaction (`runAtomicRpc`), because a
 * failure between two PostgREST calls leaves committed business state with no
 * audit row. This script makes that rule mechanically enforceable in CI.
 *
 * It parses the service layer (`lib/service/*.ts`) and reports every function
 * that calls `recordAudit(` / `withAudit(` and is not covered by the explicit
 * allowlist below. Two kinds of finding are reported:
 *
 *   mutation-then-audit  the function writes a domain row (or calls an RPC)
 *                        *before* appending the audit row — the unsafe pattern
 *                        ticket 21 removed. Never allowlistable without a
 *                        written justification in an actual ticket.
 *   undocumented-audit   a read-only path that appends an audit row. These are
 *                        allowed (nothing is committed before the audit call,
 *                        so a failure leaves no unaudited state) but must be
 *                        named here with their proof.
 *
 * `withAudit()` is intentionally retired: any call site is a failure even if a
 * reviewer would allow the function, because the wrapper exists only to pair a
 * mutation with a later audit append.
 *
 * Test seam (used by tests/unit/audit-write-guard.unit.test.ts, never in CI
 * runs): AUDIT_GUARD_SERVICE_DIR points the scan at another directory, so the
 * guard's own detection can be regression-tested against a deliberately unsafe
 * fixture.
 *
 * Exit codes: 0 = policy holds, 1 = violation, 2 = the guard could not run.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";

const SERVICE_DIR = process.env.AUDIT_GUARD_SERVICE_DIR ?? "lib/service";

/**
 * Audited, provably side-effect-free paths.
 *
 * Each entry must state why the audit call cannot leave unaudited committed
 * state. "It only reads" is not enough on its own — the proof has to name the
 * absence of a preceding domain write. Adding an entry is the deliberate act of
 * documenting an exception, which is exactly what the guard is meant to force.
 */
const ALLOWED_READ_ONLY_AUDITS = new Map([
  [
    "export.ts#exportSignalsCsv",
    "read-only export: requireExportAccess + signals SELECT, then one audit append; no domain row is written",
  ],
  [
    "export.ts#exportClientArchive",
    "read-only export: assembleClientArchive reads tables, then one audit append; no domain row is written",
  ],
  [
    "supervision-export.ts#exportSupervision",
    "read-only export: loadSupervisionSource reads tables, then one audit append; no domain row is written",
  ],
  [
    "report.ts#auditReport",
    "read-only report path: a snapshot version is rendered, then one audit append; no domain row is written",
  ],
]);

/** A client call that mutates domain state (or invokes a mutating RPC). */
const WRITE_METHODS = new Set(["insert", "update", "upsert", "delete"]);

function fail(message) {
  console.error(`audit-write guard: ${message}`);
  process.exit(2);
}

/** Qualified name of a call expression, e.g. `recordAudit` or `client.rpc`. */
function callName(node) {
  if (!ts.isCallExpression(node)) return null;
  const expression = node.expression;
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression)) {
    const target = ts.isIdentifier(expression.expression) ? expression.expression.text : null;
    return target ? `${target}.${expression.name.text}` : expression.name.text;
  }
  return null;
}

/**
 * True for `recordAudit(...)` / `withAudit(...)` — the audit entry points this
 * policy is about.
 */
function isAuditCall(node) {
  const name = callName(node);
  return name === "recordAudit" || name === "withAudit";
}

/** True for a PostgREST domain write, e.g. `client.from("x").insert({...})`. */
function isWriteCall(node) {
  if (!ts.isCallExpression(node)) return false;
  const expression = node.expression;
  if (!ts.isPropertyAccessExpression(expression)) return false;
  const method = expression.name.text;
  if (WRITE_METHODS.has(method)) {
    // `client.from(...).insert(...)` — a real table write.
    return true;
  }
  if (method === "rpc") {
    // An RPC is a write unless the called function is a known read guard.
    const [first] = node.arguments;
    if (first && ts.isStringLiteralLike(first)) {
      return !["is_client_accessible", "has_consent", "is_org_member", "is_org_owner"].includes(
        first.text
      );
    }
    return true;
  }
  return false;
}

function functionName(node) {
  if ((ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node)) && node.name) {
    return node.name.text;
  }
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) return node.name.text;
  if (ts.isMethodDeclaration(node) && ts.isIdentifier(node.name)) return node.name.text;
  if (ts.isPropertyAssignment(node) && ts.isIdentifier(node.name)) return node.name.text;
  return null;
}

/**
 * Walk the AST and collect, per named function body, the position of every
 * audit call and every write call. Nested functions are treated as their own
 * scopes so a read helper called by a mutation does not hide its audit call.
 */
function analyze(sourceFile) {
  const scopes = [];

  function visit(node) {
    const name = functionName(node);
    const body =
      ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node)
        ? node.body
        : ts.isVariableDeclaration(node) ||
            ts.isPropertyAssignment(node) ||
            ts.isMethodDeclaration(node)
          ? node.initializer
          : undefined;

    if (name && body) {
      const scope = { name, audits: [], writes: [] };
      scopes.push(scope);
      ts.forEachChild(body, function walk(current) {
        if (isAuditCall(current)) {
          const auditName = callName(current);
          scope.audits.push({
            name: auditName,
            nameNode: current.expression,
            pos: current.getStart(sourceFile),
            withAudit: auditName === "withAudit",
          });
        }
        if (isWriteCall(current)) {
          scope.writes.push({ pos: current.getStart(sourceFile) });
        }
        ts.forEachChild(current, walk);
      });
      return;
    }
    ts.forEachChild(node, visit);
  }

  ts.forEachChild(sourceFile, visit);
  return scopes;
}

function main() {
  const files = readdirSync(SERVICE_DIR)
    .filter((entry) => entry.endsWith(".ts"))
    .sort();

  if (files.length === 0) fail(`no service files found under ${SERVICE_DIR}`);

  const violations = [];
  let auditedFunctions = 0;

  for (const file of files) {
    const path = join(SERVICE_DIR, file);
    const source = readFileSync(path, "utf8");
    const sourceFile = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);

    for (const scope of analyze(sourceFile)) {
      if (scope.audits.length === 0) continue;
      auditedFunctions += 1;

      const key = `${file}#${scope.name}`;
      const allowed = ALLOWED_READ_ONLY_AUDITS.has(key);
      const firstAudit = Math.min(...scope.audits.map((audit) => audit.pos));
      const priorWrites = scope.writes.filter((write) => write.pos < firstAudit);

      // `withAudit` is the retired mutation-then-audit wrapper: always a finding.
      const withAuditCalls = scope.audits.filter((audit) => audit.withAudit);
      for (const call of withAuditCalls) {
        violations.push({
          file,
          key,
          kind: "withAudit",
          line: sourceFile.getLineAndCharacterOfPosition(call.pos).line + 1,
          message:
            "withAudit() is retired (ticket 21): migrate to an atomic RPC or use recordAudit() with a documented allowlist entry",
        });
      }

      if (priorWrites.length > 0) {
        const line = sourceFile.getLineAndCharacterOfPosition(priorWrites[0].pos).line + 1;
        violations.push({
          file,
          key,
          kind: "mutation-then-audit",
          line,
          message: `writes domain state at line ${line} before appending the audit row — move the write and the append into one atomic RPC`,
        });
        continue;
      }

      if (!allowed) {
        const line = sourceFile.getLineAndCharacterOfPosition(firstAudit).line + 1;
        violations.push({
          file,
          key,
          kind: "undocumented-audit",
          line,
          message:
            "appends an audit row and is not on the allowlist — add it to ALLOWED_READ_ONLY_AUDITS with the proof that nothing is committed before it, or migrate the path to an atomic RPC",
        });
      }
    }
  }

  const stale = [...ALLOWED_READ_ONLY_AUDITS.keys()].filter(
    (key) => ![...files].some((file) => key.startsWith(`${file}#`))
  );
  for (const key of stale) {
    violations.push({
      file: key.split("#")[0],
      key,
      kind: "stale-allowlist-entry",
      line: 0,
      message: "allowlist entry no longer matches a call site — remove it",
    });
  }

  if (violations.length > 0) {
    console.error(`audit-write guard: ${violations.length} violation(s)`);
    for (const violation of violations) {
      const where = violation.line > 0 ? `${violation.file}:${violation.line}` : violation.file;
      console.error(`  [${violation.kind}] ${violation.key} (${where})`);
      console.error(`    ${violation.message}`);
    }
    process.exit(1);
  }

  console.log(
    `audit-write guard: ${auditedFunctions} audited function(s) checked, ` +
      `${ALLOWED_READ_ONLY_AUDITS.size} read-only exception(s) allowlisted, 0 violations`
  );
}

main();
