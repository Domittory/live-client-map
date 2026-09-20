#!/usr/bin/env node
/**
 * Production AI guard (ticket 23).
 *
 * SPEC requires production AI to stay off until a separate, human-owned
 * decision approves the provider, data region, retention, processing agreement
 * and cross-border transfer terms. `lib/ai/gateway.ts` already enforces that at
 * runtime (`NODE_ENV=production` + `AI_PRODUCTION_ENABLED === "true"`), but
 * until now no release gate failed when a committed default, workflow variable
 * or caller silently flipped the switch.
 *
 * This gate re-reads the actual sources and fails closed:
 *
 *   1. `lib/env.ts` parses `AI_PRODUCTION_ENABLED` as a strict true/false enum
 *      that defaults to "false";
 *   2. `.env.example` documents the disabled default;
 *   3. `lib/ai/gateway.ts` keeps the production block and the strict
 *      `=== "true"` comparison;
 *   4. no workflow or deployment config commits `AI_PRODUCTION_ENABLED=true`;
 *   5. no application service (outside the gateway itself) passes
 *      `productionAiEnabled` explicitly, so the environment check cannot be
 *      bypassed from a caller;
 *   6. if any of the above points the other way, the approval record
 *      `docs/ops/ai-production-decision.md` must exist and be complete.
 *
 * The exact condition that would have to change is printed on failure and
 * documented in docs/ops/release-readiness.md § Production AI.
 *
 * Exit codes: 0 = gate passed, 1 = blocking finding, 2 = could not run.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export const DECISION_PATH = "docs/ops/ai-production-decision.md";

const ENV_FILE = "lib/env.ts";
const GATEWAY_FILE = "lib/ai/gateway.ts";
const ENV_EXAMPLE = ".env.example";
const WORKFLOW_DIR = ".github/workflows";
/** Deployment configuration that could commit an enabled flag. */
const DEPLOY_CONFIG_FILES = ["vercel.json", "supabase/config.toml"];

/** Sources scanned for an explicit `productionAiEnabled` override. */
const CALLER_DIRS = ["app", "lib"];
const CALLER_EXTENSIONS = [".ts", ".tsx", ".mts"];

const ENV_DEFAULT_DISABLED =
  /AI_PRODUCTION_ENABLED\s*:\s*z\s*\.\s*enum\(\s*\[\s*"true"\s*,\s*"false"\s*\]\s*\)\s*\.\s*default\(\s*"false"\s*\)/;
const ENV_STRICT_ENUM =
  /AI_PRODUCTION_ENABLED\s*:\s*z\s*\.\s*enum\(\s*\[\s*"true"\s*,\s*"false"\s*\]\s*\)/;
const ENV_EXAMPLE_DISABLED = /^\s*AI_PRODUCTION_ENABLED\s*=\s*false\s*$/m;
const GATEWAY_PRODUCTION_BLOCK = /isProduction\s*&&\s*!productionAiEnabled/;
const GATEWAY_STRICT_TRUE = /process\.env\.AI_PRODUCTION_ENABLED\s*===\s*"true"/;
const GATEWAY_BLOCKED_STATUS = /blocked_environment/;
const CONFIG_ENABLES_AI = /AI_PRODUCTION_ENABLED\s*[:=]\s*["']?true/i;
const CALLER_OVERRIDE = /productionAiEnabled\s*:/;

/** A labelled line that must carry a non-empty value in the approval record. */
function field(label) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^\\s*\\*{0,2}${escaped}\\*{0,2}\\s*:\\s*\\S.*$`, "im");
}

/**
 * Everything the approval record must state before production AI may be
 * enabled. Each entry is a human-checkable statement, not a boolean.
 */
export const DECISION_REQUIREMENTS = [
  {
    id: "status",
    description: "Status: approved",
    pattern: /^\s*\*{0,2}status\*{0,2}\s*:\s*approved\s*$/im,
  },
  { id: "approved-by", description: "Approved by: <name>", pattern: field("Approved by") },
  {
    id: "date",
    description: "Date: <YYYY-MM-DD>",
    pattern: /^\s*\*{0,2}date\*{0,2}\s*:\s*\d{4}-\d{2}-\d{2}\s*$/im,
  },
  { id: "provider", description: "Provider: <provider>", pattern: field("Provider") },
  { id: "data-region", description: "Data region: <region>", pattern: field("Data region") },
  { id: "retention", description: "Retention: <policy>", pattern: field("Retention") },
  {
    id: "processing-agreement",
    description: "Processing agreement: <reference>",
    pattern: field("Processing agreement"),
  },
  {
    id: "cross-border-transfer",
    description: "Cross-border transfer: <terms>",
    pattern: field("Cross-border transfer"),
  },
  {
    id: "evaluation-run",
    description: "Production evaluation run (non-real data): <reference>",
    pattern: field("Production evaluation run (non-real data)"),
  },
];

function readIfExists(path) {
  return existsSync(path) ? readFileSync(path, "utf8") : null;
}

function listFiles(directory, extensions, sink = []) {
  if (!existsSync(directory)) return sink;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      listFiles(path, extensions, sink);
    } else if (extensions.some((extension) => entry.name.endsWith(extension))) {
      sink.push(path);
    }
  }
  return sink;
}

/**
 * Read every source the gate reasons about. Returns raw text so a unit test can
 * exercise `evaluateProductionAiGate` without touching the working tree.
 */
export function collectSources(repoRoot = process.cwd()) {
  const workflowFiles = existsSync(join(repoRoot, WORKFLOW_DIR))
    ? readdirSync(join(repoRoot, WORKFLOW_DIR))
        .filter((name) => name.endsWith(".yml") || name.endsWith(".yaml"))
        .map((name) => join(repoRoot, WORKFLOW_DIR, name))
    : [];

  const callerFiles = CALLER_DIRS.flatMap((directory) =>
    listFiles(join(repoRoot, directory), CALLER_EXTENSIONS)
  ).filter((path) => !path.endsWith(GATEWAY_FILE));

  return {
    envSource: readIfExists(join(repoRoot, ENV_FILE)),
    gatewaySource: readIfExists(join(repoRoot, GATEWAY_FILE)),
    envExampleSource: readIfExists(join(repoRoot, ENV_EXAMPLE)),
    decisionSource: readIfExists(join(repoRoot, DECISION_PATH)),
    configSources: [
      ...workflowFiles.map((path) => ({ path, source: readFileSync(path, "utf8") })),
      ...DEPLOY_CONFIG_FILES.filter((name) => existsSync(join(repoRoot, name))).map((name) => ({
        path: name,
        source: readFileSync(join(repoRoot, name), "utf8"),
      })),
    ],
    callerSources: callerFiles.map((path) => ({
      path,
      source: readFileSync(path, "utf8"),
    })),
  };
}

/** Which parts of the approval record are missing or unapproved. */
export function evaluateDecision(decisionSource) {
  if (decisionSource == null) {
    return {
      present: false,
      approved: false,
      missing: DECISION_REQUIREMENTS.map((requirement) => requirement.description),
    };
  }

  const missing = DECISION_REQUIREMENTS.filter(
    (requirement) => !requirement.pattern.test(decisionSource)
  ).map((requirement) => requirement.description);

  return { present: true, approved: missing.length === 0, missing };
}

/**
 * Evaluate the production-AI guard from already-collected sources.
 *
 * Fails when the code/config would allow production AI without a complete,
 * approved decision record. Passes when the code is disabled — with or without
 * an approval record on file — and when an approved record accompanies an
 * explicitly enabled configuration.
 */
export function evaluateProductionAiGate(sources) {
  const envSource = sources.envSource ?? "";
  const gatewaySource = sources.gatewaySource ?? "";
  const configSources = sources.configSources ?? [];
  const callerSources = sources.callerSources ?? [];

  const disablingConfigs = configSources.filter((entry) => CONFIG_ENABLES_AI.test(entry.source));
  const callerOverrides = callerSources.filter((entry) => CALLER_OVERRIDE.test(entry.source));

  const checks = {
    "lib/env.ts: strict true/false enum": ENV_STRICT_ENUM.test(envSource),
    "lib/env.ts: default is false": ENV_DEFAULT_DISABLED.test(envSource),
    ".env.example: AI_PRODUCTION_ENABLED=false": ENV_EXAMPLE_DISABLED.test(
      sources.envExampleSource ?? ""
    ),
    "lib/ai/gateway.ts: production block": GATEWAY_PRODUCTION_BLOCK.test(gatewaySource),
    'lib/ai/gateway.ts: strict === "true"': GATEWAY_STRICT_TRUE.test(gatewaySource),
    "lib/ai/gateway.ts: blocked_environment outcome": GATEWAY_BLOCKED_STATUS.test(gatewaySource),
    "no workflow/config sets AI_PRODUCTION_ENABLED=true": disablingConfigs.length === 0,
    "no caller passes productionAiEnabled": callerOverrides.length === 0,
  };

  const failedChecks = Object.entries(checks)
    .filter(([, passed]) => !passed)
    .map(([name]) => name);
  const disabled = failedChecks.length === 0;
  const decision = evaluateDecision(sources.decisionSource);

  const warnings = [];
  if (disabled && decision.approved) {
    warnings.push(
      `An approved decision record exists at ${DECISION_PATH}, but the code still disables ` +
        "production AI. Enabling it is a deliberate, separate change."
    );
  }
  for (const entry of disablingConfigs) {
    warnings.push(`${entry.path} would set AI_PRODUCTION_ENABLED=true`);
  }
  for (const entry of callerOverrides) {
    warnings.push(`${entry.path} passes productionAiEnabled explicitly`);
  }

  if (disabled) {
    return {
      ok: true,
      mode: decision.approved ? "disabled-with-approval-on-record" : "disabled",
      checks,
      decision,
      warnings,
      summary: "Production AI is disabled: the runtime gate and every committed default agree.",
    };
  }

  if (decision.approved) {
    return {
      ok: true,
      mode: "enabled-by-approved-decision",
      checks,
      decision,
      warnings,
      summary: `Production AI is enabled and ${DECISION_PATH} records a complete approval.`,
    };
  }

  const reasons = [
    "Production AI is not provably disabled and no approved data-processing decision exists.",
    "Failing checks:",
    ...failedChecks.map((name) => `  - ${name}`),
  ];

  if (!decision.present) {
    reasons.push(`Missing approval record: ${DECISION_PATH}`);
  } else {
    reasons.push(`Incomplete approval record (${DECISION_PATH}):`);
  }
  reasons.push(...decision.missing.map((description) => `  - ${description}`));
  reasons.push(
    "",
    "To allow production AI, a human owner must create the approval record above AND make the",
    "enabling change explicit (a committed default or deployment value of true). Until both are",
    "present this gate keeps the release blocked. See docs/ops/release-readiness.md § Production AI."
  );

  return {
    ok: false,
    mode: "unsafe-enable",
    checks,
    decision,
    warnings,
    reasons,
    summary:
      "Production AI may be reachable without an approved provider/data-processing decision.",
  };
}

function main() {
  let result;
  try {
    result = evaluateProductionAiGate(collectSources(process.cwd()));
  } catch (error) {
    console.error(`production AI gate: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(2);
  }

  console.log("Production AI gate (ticket 23)");
  for (const [name, passed] of Object.entries(result.checks)) {
    console.log(`  ${passed ? "ok" : "FAIL"} ${name}`);
  }
  for (const warning of result.warnings) {
    console.log(`  warn ${warning}`);
  }
  console.log(`\n${result.summary}`);

  if (!result.ok) {
    console.error("\n" + result.reasons.join("\n"));
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
