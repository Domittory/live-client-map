#!/usr/bin/env node
/**
 * Release-checklist integrity gate (ticket 23).
 *
 * The checklist is the human-owned half of the release gate: automated checks
 * prove the code and the clean database are sound, but staging smoke, restore,
 * rollback, logging/alert verification and production smoke can only be
 * performed and signed by an accountable person. Ticket 24 owns that sign-off.
 *
 * A checklist that merely *looks* finished is a release risk, so this gate reads
 * the machine block embedded in `docs/ops/release-checklist.md` and refuses:
 *
 *   - a gate marked `done` without evidence, a timestamp, a signer and a
 *     signature reference;
 *   - a `pending` gate that already carries signature fields;
 *   - `release_status: completed` unless every manual gate is done and signed,
 *     the automated evidence file exists, its hash matches the recorded one and
 *     it belongs to the same release SHA and lockfile;
 *   - an automated evidence file that claims a human signature: the generator
 *     (`scripts/release-check.mjs`) may only write unsigned evidence, so a
 *     "signed" evidence file is fabricated.
 *
 * Exit codes: 0 = checklist is internally consistent, 1 = blocking finding,
 * 2 = the checklist could not be read or parsed.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export const CHECKLIST_PATH = "docs/ops/release-checklist.md";

const MACHINE_BLOCK =
  /<!--\s*release-checklist-machine:begin\s*-->([\s\S]*?)<!--\s*release-checklist-machine:end\s*-->/;
const JSON_FENCE = /```json\s*([\s\S]*?)```/;
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const SHA1 = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const ALLOWED_STATUS = new Set(["pending", "done", "failed"]);
const ALLOWED_RELEASE_STATUS = new Set(["draft", "candidate", "completed"]);

/**
 * Gates a human must perform and sign. `owner` is who is accountable, and
 * `requiredEvidence` states exactly what has to be attached — never a bare
 * checkbox. Ticket 23 builds this structure; ticket 24 fills it in.
 */
export const MANUAL_GATES = [
  {
    id: "remote-ci",
    title: "Remote CI зелёный для release SHA",
    owner: "release owner",
    requiredEvidence:
      "URL GitHub Actions run + SHA коммита: оба job'а (quality, integration) success на этом же SHA.",
  },
  {
    id: "staging-release",
    title: "Staging deployment из точного release artifact",
    owner: "release owner",
    requiredEvidence:
      "URL staging-деплоя + RELEASE_ID (равен release SHA) из /api/health, плюс ссылка на Vercel deployment того же коммита.",
  },
  {
    id: "staging-smoke",
    title: "Staging service-identity smoke",
    owner: "release owner",
    requiredEvidence:
      "Вывод ./scripts/post-deploy-smoke.sh <STAGING_URL> с service/version/build/database=ok и timestamp.",
  },
  {
    id: "target-migration-dry-run",
    title: "Target-environment migration dry-run",
    owner: "database owner",
    requiredEvidence:
      "Лог `supabase db push --dry-run --project-ref <ref>` для staging и production: список миграций совпадает с ожидаемым, ничего не применено.",
  },
  {
    id: "target-integration",
    title: "Integration tests против target environment",
    owner: "release owner",
    requiredEvidence:
      "Лог прогона integration-suite против staging-базы (не local) с итоговым числом passed/failed и timestamp.",
  },
  {
    id: "restore-drill",
    title: "Restore drill",
    owner: "database owner",
    requiredEvidence:
      "Timestamp начала/конца drill, точка восстановления, фактический RTO и подтверждение, что приложение читает восстановленные данные.",
  },
  {
    id: "rollback-drill",
    title: "Rollback drill",
    owner: "release owner",
    requiredEvidence:
      "Timestamp drill, предыдущий deployment, фактическое recovery window и подтверждение, что старая схема/код работают.",
  },
  {
    id: "logging-alerts",
    title: "Logging, redaction, metrics и alerts",
    owner: "operations owner",
    requiredEvidence:
      "Timestamp synthetic failure, сработавший alert, подтверждение отсутствия client PII в логах и ссылка на alert rule.",
  },
  {
    id: "production-smoke",
    title: "Production smoke (no real PII)",
    owner: "release owner",
    requiredEvidence:
      "Вывод ./scripts/post-deploy-smoke.sh <PRODUCTION_URL>, RELEASE_ID равен release SHA, database=ok, synthetic data only.",
  },
  {
    id: "release-decision",
    title: "Итоговое решение о допуске real client data",
    owner: "accountable owner",
    requiredEvidence:
      "Явное письменное решение: real client data разрешены; перечислены оставшиеся ограничения (в т.ч. production AI off).",
  },
];

export const REQUIRED_GATE_IDS = MANUAL_GATES.map((gate) => gate.id);

export const EMPTY_SIGNATURE_FIELDS = {
  evidence: null,
  timestamp: null,
  signed_by: null,
  signed_at: null,
  signature: null,
};

/** A pending, unsigned entry for every manual gate — what the generator writes. */
export function pendingManualGates() {
  return MANUAL_GATES.map((gate) => ({
    id: gate.id,
    title: gate.title,
    owner: gate.owner,
    required_evidence: gate.requiredEvidence,
    status: "pending",
    ...EMPTY_SIGNATURE_FIELDS,
  }));
}

export function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

/** Parse the machine block out of the checklist markdown. */
export function extractMachineBlock(markdown) {
  const block = markdown.match(MACHINE_BLOCK);
  if (!block) {
    throw new Error(
      `${CHECKLIST_PATH} is missing the release-checklist-machine block (begin/end markers)`
    );
  }
  const fence = block[1].match(JSON_FENCE);
  if (!fence) {
    throw new Error(`${CHECKLIST_PATH} machine block must contain a fenced \`\`\`json object`);
  }
  try {
    return JSON.parse(fence[1]);
  } catch (error) {
    throw new Error(
      `${CHECKLIST_PATH} machine block is not valid JSON: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function validateSignatureFields(gateId, entry) {
  const errors = [];
  const missing = ["evidence", "timestamp", "signed_by", "signed_at", "signature"].filter(
    (field) => !isNonEmptyString(entry[field])
  );
  if (missing.length > 0) {
    errors.push(
      `manual gate "${gateId}" is marked done but is missing: ${missing.join(", ")} ` +
        "(evidence, timestamp, signed_by, signed_at, signature are all required)"
    );
  }
  for (const field of ["timestamp", "signed_at"]) {
    if (isNonEmptyString(entry[field]) && !ISO_TIMESTAMP.test(entry[field].trim())) {
      errors.push(
        `manual gate "${gateId}" has an invalid ${field}: ${JSON.stringify(entry[field])} ` +
          "(expected an ISO-8601 timestamp with timezone, e.g. 2026-01-31T12:00:00Z)"
      );
    }
  }
  return errors;
}

/** Validate evidence produced by scripts/release-check.mjs. */
function validateAutomatedEvidence({ record, repoRoot }) {
  const errors = [];
  if (record == null || typeof record !== "object") {
    errors.push("automated_evidence must be an object { path, sha256 }");
    return { errors };
  }
  if (!isNonEmptyString(record.path)) {
    errors.push("automated_evidence.path is required");
    return { errors };
  }
  if (!isNonEmptyString(record.sha256) || !SHA256.test(record.sha256.trim())) {
    errors.push("automated_evidence.sha256 must be a lowercase sha256 hex digest");
    return { errors };
  }

  const absolute = join(repoRoot, record.path);
  if (!existsSync(absolute)) {
    errors.push(
      `automated evidence file ${record.path} does not exist — run \`pnpm release:check\` on the release commit`
    );
    return { errors };
  }

  const actual = sha256File(absolute);
  if (actual !== record.sha256.trim()) {
    errors.push(
      `automated evidence ${record.path} does not match the recorded sha256 ` +
        `(recorded ${record.sha256.trim()}, actual ${actual})`
    );
  }

  let evidence;
  try {
    evidence = JSON.parse(readFileSync(absolute, "utf8"));
  } catch (error) {
    errors.push(
      `${record.path} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`
    );
    return { errors };
  }

  if (evidence.signatureStatus !== "unsigned" || evidence.humanSignature != null) {
    errors.push(
      `${record.path} claims a human signature. The evidence generator only writes unsigned ` +
        "records; a signature belongs in this checklist, never in generated evidence."
    );
  }
  return { errors, evidence };
}

/**
 * Validate the checklist. Returns `{ ok, errors, warnings, status }`.
 *
 * `now` is injectable so tests can reason about timestamps deterministically.
 */
export function validateChecklist({ markdown, repoRoot = process.cwd(), now = Date.now() }) {
  const errors = [];
  const warnings = [];

  let checklist;
  try {
    checklist = extractMachineBlock(markdown);
  } catch (error) {
    return {
      ok: false,
      errors: [error instanceof Error ? error.message : String(error)],
      warnings,
      status: null,
    };
  }

  if (checklist.schema_version !== 1) {
    errors.push(`schema_version must be 1, got ${JSON.stringify(checklist.schema_version)}`);
  }
  if (!isNonEmptyString(checklist.release_sha) || !SHA1.test(checklist.release_sha.trim())) {
    errors.push("release_sha must be a 40-character lowercase git SHA");
  }
  if (
    !isNonEmptyString(checklist.lockfile_sha256) ||
    !SHA256.test(checklist.lockfile_sha256.trim())
  ) {
    errors.push("lockfile_sha256 must be a lowercase sha256 hex digest of pnpm-lock.yaml");
  }
  if (!ALLOWED_RELEASE_STATUS.has(checklist.release_status)) {
    errors.push(
      `release_status must be one of ${[...ALLOWED_RELEASE_STATUS].join(", ")}, ` +
        `got ${JSON.stringify(checklist.release_status)}`
    );
  }

  const gates = checklist.manual_gates;
  if (gates == null || typeof gates !== "object" || Array.isArray(gates)) {
    errors.push("manual_gates must be an object keyed by gate id");
    return { ok: false, errors, warnings, status: checklist.release_status ?? null };
  }

  const unknownGates = Object.keys(gates).filter((id) => !REQUIRED_GATE_IDS.includes(id));
  for (const id of unknownGates) warnings.push(`manual_gates contains an unknown gate "${id}"`);
  for (const id of REQUIRED_GATE_IDS) {
    if (!(id in gates)) errors.push(`manual_gates is missing the required gate "${id}"`);
  }

  let doneCount = 0;
  for (const [id, entry] of Object.entries(gates)) {
    if (entry == null || typeof entry !== "object") {
      errors.push(`manual gate "${id}" must be an object`);
      continue;
    }
    if (!ALLOWED_STATUS.has(entry.status)) {
      errors.push(`manual gate "${id}" has an unknown status ${JSON.stringify(entry.status)}`);
      continue;
    }

    if (entry.status === "done") {
      doneCount += 1;
      errors.push(...validateSignatureFields(id, entry));
      continue;
    }

    const stray = ["evidence", "timestamp", "signed_by", "signed_at", "signature"].filter((field) =>
      isNonEmptyString(entry[field])
    );
    if (stray.length > 0) {
      errors.push(
        `manual gate "${id}" is "${entry.status}" but carries signature fields: ${stray.join(", ")} ` +
          "— clear them until the gate is actually done"
      );
    }
  }

  let automated;
  if (checklist.release_status === "completed") {
    const result = validateAutomatedEvidence({
      record: checklist.automated_evidence,
      repoRoot,
    });
    errors.push(...result.errors);
    automated = result.evidence;

    if (result.evidence) {
      if (result.evidence.result !== "passed") {
        errors.push(
          `automated evidence result is ${JSON.stringify(result.evidence.result)}, expected "passed"`
        );
      }
      if (
        isNonEmptyString(checklist.release_sha) &&
        result.evidence.releaseSha !== checklist.release_sha.trim()
      ) {
        errors.push(
          `automated evidence belongs to ${result.evidence.releaseSha}, ` +
            `checklist records ${checklist.release_sha.trim()}`
        );
      }
      if (
        isNonEmptyString(checklist.lockfile_sha256) &&
        result.evidence.lockfile?.sha256 !== checklist.lockfile_sha256.trim()
      ) {
        errors.push(
          "automated evidence lockfile hash does not match checklist lockfile_sha256 — " +
            "the evidence was produced from a different dependency lockfile"
        );
      }
    }

    if (doneCount !== REQUIRED_GATE_IDS.length) {
      errors.push(
        `release_status is "completed" but only ${doneCount}/${REQUIRED_GATE_IDS.length} manual ` +
          `gates are done (${REQUIRED_GATE_IDS.filter((id) => gates[id]?.status !== "done").join(", ")})`
      );
    }
    const failed = Object.entries(gates)
      .filter(([, entry]) => entry?.status === "failed")
      .map(([id]) => id);
    if (failed.length > 0) {
      errors.push(`release_status is "completed" but gates failed: ${failed.join(", ")}`);
    }
    if (
      !isNonEmptyString(checklist.released_at) ||
      !ISO_TIMESTAMP.test(checklist.released_at.trim())
    ) {
      errors.push('release_status "completed" requires released_at as an ISO-8601 timestamp');
    }
    if (!isNonEmptyString(checklist.released_by)) {
      errors.push('release_status "completed" requires released_by naming the accountable owner');
    }
  } else if (checklist.automated_evidence != null) {
    const result = validateAutomatedEvidence({ record: checklist.automated_evidence, repoRoot });
    errors.push(...result.errors);
    automated = result.evidence;
  }

  if (automated && Array.isArray(automated.gates)) {
    const failed = automated.gates.filter(
      (gate) => gate.blocking && gate.status !== "passed" && gate.status !== "skipped"
    );
    if (failed.length > 0) {
      errors.push(
        `automated evidence contains failing blocking gates: ${failed.map((gate) => gate.id).join(", ")}`
      );
    }
  }

  for (const [id, entry] of Object.entries(gates)) {
    if (entry?.status === "done" && isNonEmptyString(entry.timestamp)) {
      const timestamp = Date.parse(entry.timestamp);
      if (Number.isFinite(timestamp) && timestamp > now + 60 * 60 * 1000) {
        warnings.push(`manual gate "${id}" has a timestamp in the future (${entry.timestamp})`);
      }
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    status: checklist.release_status ?? null,
    doneCount,
    totalGates: REQUIRED_GATE_IDS.length,
  };
}

function main() {
  const requireComplete = process.argv.includes("--require-complete");
  const checklistPath = process.env.RELEASE_CHECKLIST_PATH ?? CHECKLIST_PATH;

  if (!existsSync(checklistPath)) {
    console.error(`release checklist gate: ${checklistPath} not found`);
    process.exit(2);
  }

  const markdown = readFileSync(checklistPath, "utf8");
  const result = validateChecklist({ markdown, repoRoot: process.cwd() });

  console.log(`Release checklist gate (ticket 23) — ${checklistPath}`);
  console.log(
    `release_status: ${result.status ?? "unknown"}; manual gates done: ` +
      `${result.doneCount ?? 0}/${result.totalGates ?? REQUIRED_GATE_IDS.length}`
  );
  for (const warning of result.warnings) console.log(`  warn ${warning}`);

  if (!result.ok) {
    console.error("\nBlocking findings:");
    for (const error of result.errors) console.error(`  - ${error}`);
    process.exit(1);
  }

  if (requireComplete && result.status !== "completed") {
    console.error(
      `\nrelease checklist is "${result.status}", not "completed": operational gates are still ` +
        "unsigned. Ticket 24 owns the human sign-off."
    );
    process.exit(1);
  }

  console.log("\nChecklist is internally consistent and contains no unsigned completion claim.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
