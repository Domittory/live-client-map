import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { AiProvider } from "@/lib/ai/provider";
import {
  evidenceLevelSchema,
  signalSourceTypeSchema,
  statementPolaritySchema,
  testResultSchema,
} from "@/lib/ai/contracts";
import { extractSignals, ingestSignals } from "./ai-ingest";
import { ServiceError } from "./errors";
import { incrementCounter } from "@/lib/telemetry";
import { runAtomicRpc } from "./transaction";
import { uuid, validate } from "./validation";

/**
 * Import pipeline (tickets 53, 54, 11), implementing docs/data-exchange-contracts.md.
 *
 * Every accepted source becomes an immutable DiagnosticSession (session_type=import).
 * The two-phase workflow is:
 *
 *   Phase 1 — preview (no Signals): parse and validate exactly as before, create
 *     the session and the imports staging row with the full report (container
 *     errors, per-record errors, duplicates, warnings), but write no evidence.
 *     A valid container therefore always leaves a session and a reviewable
 *     report, even when every candidate is later rejected.
 *
 *   Phase 2 — commit selection (one transaction, `commit_import_selection`): only
 *     the explicitly selected candidates become pending Signals attached to that
 *     session. Commit is idempotent for the same selection and rejects a
 *     conflicting one; a failure at any step leaves no partial Signal set.
 *
 * The one-shot public functions (importText / importSignalsCsv / importSignalsJson)
 * keep their original contract — parse + commit every valid record — and stay on
 * their single-call code path, so existing callers and integration tests are
 * unaffected. Nothing is ever written to a confirmed entity, and retries are
 * idempotent by (org, client, contract, idempotency_key).
 */

const IMPORT_CONTRACT = "live-client-map.import-request";
const SIGNALS_CSV_CONTRACT = "live-client-map.signals-csv/1.0";
const SIGNALS_JSON_CONTRACT = "live-client-map.signals-import/1.0";
const IMPORT_REPORT_CONTRACT = "live-client-map.import-report";

const MAX_SOURCE_CODEPOINTS = 1_000_000;
const MAX_STRUCTURED_RECORDS = 50_000;

const IDEMPOTENCY_KEY = z
  .string()
  .min(16)
  .max(128)
  .regex(/^[ -~]+$/, "idempotency_key must be printable ASCII");

const TEXT_FORMATS = z.enum(["plain_text", "markdown", "chatgpt_analysis"]);

const epistemicTypeSchema = z.enum([
  "fact",
  "self_report",
  "test_result",
  "observation",
  "interpretation",
  "hypothesis",
]);

const visibilitySchema = z.enum(["internal", "sensitive", "client_visible"]);

const importRecordSchema = z
  .object({
    external_id: z.string().min(1).max(128),
    source_session_ref: z.string().max(255).nullable(),
    source_type: signalSourceTypeSchema,
    source_ref: z.string().max(255).nullable(),
    epistemic_type: epistemicTypeSchema,
    raw_statement: z.string().min(1).max(65536),
    statement_polarity: statementPolaritySchema,
    test_result: testResultSchema,
    normalized_meaning: z.string().max(65536).nullable(),
    inferred_opposite: z.string().max(65536).nullable(),
    intensity: z.number().int().min(0).max(100).nullable(),
    confidence: z.number().int().min(0).max(100).nullable(),
    life_areas: z.array(z.string().min(1).max(500)).max(100),
    tags: z.array(z.string().min(1).max(500)).max(100),
    context: z.record(z.string(), z.unknown()).nullable(),
    time_scope: z.string().max(200).nullable(),
    claimed_evidence_level: evidenceLevelSchema.nullable(),
    visibility: visibilitySchema,
    source_review_status: z.string().max(100).nullable(),
    source_created_at: z.string().max(100).nullable(),
    source_updated_at: z.string().max(100).nullable(),
  })
  .strict();

type ImportRecord = z.infer<typeof importRecordSchema>;

/** One safe record-level error or warning in the validation report. */
export interface ImportIssue {
  code: string;
  field: string | null;
  message: string;
}

/** One addressable record of an import report. */
export interface ImportReportRecord {
  index: number;
  external_id: string;
  status: string;
  errors: ImportIssue[];
  warnings: ImportIssue[];
  /** Signal created by the commit phase, or null while the record is staged. */
  signal_id: string | null;
  /** Validated source statement, shown to the reviewer before commit. */
  statement: string | null;
}

export interface ImportReport {
  contract: string;
  version: string;
  import_id: string;
  diagnostic_session_id: string;
  content_sha256: string;
  status: string;
  counts: Record<string, number>;
  records: ImportReportRecord[];
  fatal_errors: unknown[];
  /** Ids of the Signals created by the commit phase (empty before commit). */
  signal_ids: string[];
}

/** A stored candidate: the validated payload that a commit may turn into a Signal. */
interface ImportCandidate {
  external_id: string;
  /** Zero-based position of the record inside `records`. */
  record_index: number;
  payload: Record<string, unknown>;
}

interface ImportArtifacts {
  counts: Record<string, number>;
  records: Record<string, unknown>[];
  candidates: ImportCandidate[];
}

// --- text (plain / markdown / chatgpt) --------------------------------------

const textImportInputSchema = z
  .object({
    organizationId: uuid,
    clientId: uuid,
    inputFormat: TEXT_FORMATS,
    content: z.string().min(1),
    title: z.string().max(200).nullable().optional(),
    language: z
      .string()
      .regex(/^[a-z]{2}$/)
      .default("ru"),
    idempotencyKey: IDEMPOTENCY_KEY,
  })
  .strict();

const structuredImportInputSchema = z
  .object({
    organizationId: uuid,
    clientId: uuid,
    content: z.string().min(1),
    title: z.string().max(200).nullable().optional(),
    idempotencyKey: IDEMPOTENCY_KEY,
  })
  .strict();

export const commitImportSelectionInputSchema = z
  .object({
    organizationId: uuid,
    clientId: uuid,
    importId: uuid,
    selectedExternalIds: z.array(z.string().min(1).max(128)).min(1).max(MAX_STRUCTURED_RECORDS),
  })
  .strict();

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function codePoints(text: string): number {
  return [...text].length;
}

function assertTextContent(content: string): void {
  if (content.trim().length === 0) {
    throw new ServiceError("VALIDATION_ERROR", "empty_content");
  }
  if (codePoints(content) > MAX_SOURCE_CODEPOINTS) {
    incrementCounter("import_total", "Total imports by outcome", {
      outcome: "size_limit_exceeded",
    });
    throw new ServiceError("VALIDATION_ERROR", "size_limit_exceeded");
  }
}

function assertStructuredSize(content: string): void {
  if (codePoints(content) > MAX_SOURCE_CODEPOINTS) {
    incrementCounter("import_total", "Total imports by outcome", {
      outcome: "size_limit_exceeded",
    });
    throw new ServiceError("VALIDATION_ERROR", "size_limit_exceeded");
  }
}

/**
 * Preview a text / Markdown / ChatGPT source: run the guarded AI extraction,
 * stage the candidates in the import report and create NO Signals. The
 * DiagnosticSession and the immutable source exist even when the specialist
 * later rejects every candidate.
 */
export async function previewTextImport(
  client: SupabaseClient,
  provider: AiProvider,
  rawInput: unknown
): Promise<ImportReport> {
  const input = validate(textImportInputSchema, rawInput);
  assertTextContent(input.content);
  const contentSha = sha256(input.content);

  const started = await beginImport(client, {
    organizationId: input.organizationId,
    clientId: input.clientId,
    inputFormat: input.inputFormat,
    contractVersion: IMPORT_CONTRACT,
    idempotencyKey: input.idempotencyKey,
    contentSha,
    title: input.title ?? null,
    rawContent: input.content,
  });

  // A finished preview replays its stored report. Only a half-finished
  // (`parsing`) import resumes below, so a failed AI call is retryable with the
  // same idempotency key instead of being stuck forever.
  if (started.reused && started.status !== "parsing") return toRpcReport(started);

  const sessionId = started.session_id;
  if (!sessionId) throw new ServiceError("INTERNAL_ERROR", "import session missing");

  const candidates = await extractSignals(client, provider, {
    organizationId: input.organizationId,
    clientId: input.clientId,
    diagnosticSessionId: sessionId,
    rawInput: input.content,
    sourceType: "imported_note",
    inputFormat: input.inputFormat,
    knownLifeAreas: [],
  });

  const finalized = await finalizeImport(
    client,
    input.organizationId,
    started.import_id,
    buildAiArtifacts(candidates)
  );

  incrementCounter("import_total", "Total imports by outcome", { outcome: "previewed" });
  return toRpcReport(finalized, contentSha);
}

/**
 * One-shot text import (ticket 53): parse through AI and commit every valid
 * candidate immediately. Kept unchanged for existing callers.
 */
export async function importText(
  client: SupabaseClient,
  provider: AiProvider,
  rawInput: unknown
): Promise<ImportReport> {
  const input = validate(textImportInputSchema, rawInput);
  assertTextContent(input.content);

  const contentSha = sha256(input.content);
  const existing = await findImport(
    client,
    input.organizationId,
    input.clientId,
    input.idempotencyKey
  );
  if (existing) {
    if (existing.content_sha256 !== contentSha) {
      throw new ServiceError("CONFLICT", "conflicting_idempotency_key");
    }
    return toReport(existing);
  }

  // Session + import staging row are created in one transaction (ticket 05).
  const started = await beginImport(client, {
    organizationId: input.organizationId,
    clientId: input.clientId,
    inputFormat: input.inputFormat,
    contractVersion: IMPORT_CONTRACT,
    idempotencyKey: input.idempotencyKey,
    contentSha,
    title: input.title ?? null,
    rawContent: input.content,
  });

  // A concurrent request with the same operation key already staged this import.
  if (started.reused) return toRpcReport(started);

  const sessionId = started.session_id as string;

  // AI parse → pending L0 candidates (never confirmed evidence). The batch and
  // its audit row are one transaction.
  const signalIds = await ingestSignals(client, provider, {
    organizationId: input.organizationId,
    clientId: input.clientId,
    diagnosticSessionId: sessionId,
    rawInput: input.content,
    sourceType: "imported_note",
    inputFormat: input.inputFormat,
    knownLifeAreas: [],
  });

  const finalized = await finalizeImport(client, input.organizationId, started.import_id, {
    counts: {
      total: signalIds.length,
      valid: signalIds.length,
      invalid: 0,
      duplicate: 0,
      warning: 0,
      accepted: 0,
      rejected_by_reviewer: 0,
      committed: signalIds.length,
    },
    records: [],
    candidates: [],
  });

  incrementCounter("import_total", "Total imports by outcome", { outcome: "parsed" });
  return toRpcReport(finalized, contentSha);
}

// --- structured (CSV / JSON) ------------------------------------------------

/** Preview a Signals CSV upload: stage every row, create no Signals. */
export async function previewSignalsCsv(
  client: SupabaseClient,
  rawInput: unknown
): Promise<ImportReport> {
  const input = validate(structuredImportInputSchema, rawInput);
  assertStructuredSize(input.content);
  const contentSha = sha256(input.content);

  // Container validation happens before anything is persisted: a missing or
  // unexpected header rejects the whole upload without an import row.
  const parsed = parseCsv(stripBom(input.content));
  if (parsed.length < 2) {
    throw new ServiceError("VALIDATION_ERROR", "missing_header");
  }
  const rows = parseStructuredRows(parsed[0], parsed.slice(1));

  const report = await stageStructuredPreview(client, {
    organizationId: input.organizationId,
    clientId: input.clientId,
    inputFormat: "signals_csv",
    contractVersion: SIGNALS_CSV_CONTRACT,
    idempotencyKey: input.idempotencyKey,
    contentSha,
    title: input.title ?? null,
    rawContent: input.content,
    rows,
  });
  return report;
}

/** Preview a Signals JSON upload: stage every record, create no Signals. */
export async function previewSignalsJson(
  client: SupabaseClient,
  rawInput: unknown
): Promise<ImportReport> {
  const input = validate(structuredImportInputSchema, rawInput);
  assertStructuredSize(input.content);
  const contentSha = sha256(input.content);

  let parsed: unknown;
  try {
    parsed = JSON.parse(input.content);
  } catch {
    throw new ServiceError("VALIDATION_ERROR", "malformed_json");
  }
  const envelope = validate(
    z
      .object({
        contract: z.literal("live-client-map.signals-import"),
        version: z.literal("1.0"),
        language: z
          .string()
          .regex(/^[a-z]{2}$/)
          .optional(),
        records: z.array(z.record(z.string(), z.unknown())).min(1).max(MAX_STRUCTURED_RECORDS),
      })
      .strict(),
    parsed
  );

  const rows = normalizeJsonRecords(envelope.records as Record<string, unknown>[]);

  return stageStructuredPreview(client, {
    organizationId: input.organizationId,
    clientId: input.clientId,
    inputFormat: "signals_json",
    contractVersion: SIGNALS_JSON_CONTRACT,
    idempotencyKey: input.idempotencyKey,
    contentSha,
    title: input.title ?? null,
    rawContent: input.content,
    rows,
  });
}

export async function importSignalsCsv(
  client: SupabaseClient,
  rawInput: unknown
): Promise<ImportReport> {
  const input = validate(structuredImportInputSchema, rawInput);
  assertStructuredSize(input.content);

  const contentSha = sha256(input.content);
  const existing = await findImport(
    client,
    input.organizationId,
    input.clientId,
    input.idempotencyKey
  );
  if (existing) {
    if (existing.content_sha256 !== contentSha) {
      throw new ServiceError("CONFLICT", "conflicting_idempotency_key");
    }
    return toReport(existing);
  }

  const parsed = parseCsv(stripBom(input.content));
  if (parsed.length < 2) {
    throw new ServiceError("VALIDATION_ERROR", "missing_header");
  }
  const header = parsed[0];
  const rows = parseStructuredRows(header, parsed.slice(1));
  return commitStructured(client, input.organizationId, input.clientId, {
    inputFormat: "signals_csv",
    contractVersion: SIGNALS_CSV_CONTRACT,
    idempotencyKey: input.idempotencyKey,
    contentSha,
    title: input.title ?? null,
    rawContent: input.content,
    rows,
  });
}

export async function importSignalsJson(
  client: SupabaseClient,
  rawInput: unknown
): Promise<ImportReport> {
  const input = validate(structuredImportInputSchema, rawInput);
  assertStructuredSize(input.content);
  const contentSha = sha256(input.content);

  let parsed: unknown;
  try {
    parsed = JSON.parse(input.content);
  } catch {
    throw new ServiceError("VALIDATION_ERROR", "malformed_json");
  }
  const envelope = validate(
    z
      .object({
        contract: z.literal("live-client-map.signals-import"),
        version: z.literal("1.0"),
        language: z
          .string()
          .regex(/^[a-z]{2}$/)
          .optional(),
        records: z.array(z.record(z.string(), z.unknown())).min(1).max(MAX_STRUCTURED_RECORDS),
      })
      .strict(),
    parsed
  );

  const existing = await findImport(
    client,
    input.organizationId,
    input.clientId,
    input.idempotencyKey
  );
  if (existing) {
    if (existing.content_sha256 !== contentSha) {
      throw new ServiceError("CONFLICT", "conflicting_idempotency_key");
    }
    return toReport(existing);
  }

  const rows = normalizeJsonRecords(envelope.records as Record<string, unknown>[]);
  return commitStructured(client, input.organizationId, input.clientId, {
    inputFormat: "signals_json",
    contractVersion: SIGNALS_JSON_CONTRACT,
    idempotencyKey: input.idempotencyKey,
    contentSha,
    title: input.title ?? null,
    rawContent: input.content,
    rows,
  });
}

// --- commit selection (phase 2) ---------------------------------------------

/**
 * Commit an explicit subset of an import's staged candidates as pending Signals.
 *
 * One atomic RPC: the selected Signals, the import report (which records the
 * generated Signal ids and the authoritative counts) and the `import.committed`
 * audit row commit or roll back together. Replaying the same selection returns
 * the stored report without writing anything; a different selection after a
 * successful commit is rejected as a conflict. Signals are always `pending` —
 * human review remains the only way to confirm evidence.
 */
export async function commitImportSelection(
  client: SupabaseClient,
  rawInput: unknown
): Promise<ImportReport> {
  const input = validate(commitImportSelectionInputSchema, rawInput);

  const result = await runAtomicRpc<ImportRpcResult>(
    client,
    "commit_import_selection",
    {
      p_org_id: input.organizationId,
      p_client_id: input.clientId,
      p_import_id: input.importId,
      p_selected: input.selectedExternalIds,
    },
    {
      forbidden: "No write access to this client",
      failure: "Failed to commit import selection",
      validation: "Invalid import selection",
      conflict: "conflicting_commit_selection",
    }
  );

  // A replay writes nothing new, so it must not look like a fresh commit.
  if (!result.reused) {
    incrementCounter("import_total", "Total imports by outcome", { outcome: "committed" });
  }
  return toRpcReport(result);
}

// --- import history (read model for the workspace screen) -------------------

export interface ClientImportSummary {
  id: string;
  input_format: string;
  status: string;
  counts: Record<string, number>;
  diagnostic_session_id: string | null;
  created_at: string;
  records: ImportReportRecord[];
  signal_ids: string[];
}

const IMPORT_SUMMARY_LIMIT = 20;

/**
 * Recent imports of one client, read through RLS. The screen uses this to show
 * the lineage of already committed evidence (which import/session produced it).
 */
export async function listClientImports(
  client: SupabaseClient,
  input: { organizationId: string; clientId: string; limit?: number }
): Promise<ClientImportSummary[]> {
  const organizationId = validate(uuid, input.organizationId);
  const clientId = validate(uuid, input.clientId);
  const limit = Math.min(Math.max(input.limit ?? IMPORT_SUMMARY_LIMIT, 1), 100);

  const { data, error } = await client
    .from("imports")
    .select("id, input_format, status, counts, report, diagnostic_session_id, created_at")
    .eq("organization_id", organizationId)
    .eq("client_id", clientId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw new ServiceError("INTERNAL_ERROR", "Failed to read imports");

  return (data ?? []).map((row) => {
    const record = row as Record<string, unknown>;
    const report = (record.report ?? {}) as Record<string, unknown>;
    return {
      id: String(record.id),
      input_format: String(record.input_format ?? ""),
      status: String(record.status ?? ""),
      counts: (record.counts ?? {}) as Record<string, number>,
      diagnostic_session_id: (record.diagnostic_session_id as string | null) ?? null,
      created_at: String(record.created_at ?? ""),
      records: publicRecords(report),
      signal_ids: toStringArray(report.committed_signal_ids),
    };
  });
}

// --- helpers ---------------------------------------------------------------

interface ExistingImport {
  id: string;
  content_sha256: string;
  diagnostic_session_id: string | null;
  status: string;
  counts: Record<string, number>;
  report: unknown;
  fatal_errors: unknown;
  input_format: string;
}

async function findImport(
  client: SupabaseClient,
  organizationId: string,
  clientId: string,
  idempotencyKey: string
): Promise<ExistingImport | null> {
  const { data, error } = await client
    .from("imports")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("client_id", clientId)
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();
  if (error) throw new ServiceError("INTERNAL_ERROR", "Failed to check import idempotency");
  return (data ?? null) as ExistingImport | null;
}

/** Shape returned by the import RPCs (tickets 05, 11). */
interface ImportRpcResult {
  import_id: string;
  session_id: string | null;
  status: string;
  counts: Record<string, number>;
  report: Record<string, unknown> | null;
  fatal_errors: unknown[];
  signal_ids?: string[];
  content_sha256?: string;
  reused?: boolean;
}

interface BeginImportInput {
  organizationId: string;
  clientId: string;
  inputFormat: string;
  contractVersion: string;
  idempotencyKey: string;
  contentSha: string;
  title: string | null;
  rawContent: string;
}

/** Session + import staging row in one transaction (migration 0041). */
async function beginImport(
  client: SupabaseClient,
  input: BeginImportInput
): Promise<ImportRpcResult> {
  return runAtomicRpc<ImportRpcResult>(
    client,
    "begin_import",
    {
      p_org_id: input.organizationId,
      p_client_id: input.clientId,
      p_session_id: crypto.randomUUID(),
      p_input_format: input.inputFormat,
      p_contract_version: input.contractVersion,
      p_idempotency_key: input.idempotencyKey,
      p_content_sha256: input.contentSha,
      p_title: input.title,
      p_raw_content: input.rawContent,
    },
    {
      forbidden: "No write access to this client",
      failure: "Failed to create import record",
      conflict: "conflicting_idempotency_key",
      validation: "conflicting_idempotency_key",
    }
  );
}

/** Report/counts/status + `import.parsed` audit in one transaction. */
async function finalizeImport(
  client: SupabaseClient,
  organizationId: string,
  importId: string,
  artifacts: ImportArtifacts
): Promise<ImportRpcResult> {
  return runAtomicRpc<ImportRpcResult>(
    client,
    "finalize_import",
    {
      p_org_id: organizationId,
      p_import_id: importId,
      p_counts: artifacts.counts,
      p_report: { records: artifacts.records, candidates: artifacts.candidates },
      p_fatal_errors: [],
    },
    {
      forbidden: "No write access to this client",
      failure: "Failed to finalize import",
      validation: "Import not found",
    }
  );
}

/** Map an atomic import RPC result onto the public import report contract. */
function toRpcReport(result: ImportRpcResult, contentSha?: string): ImportReport {
  const report = result.report ?? {};
  return {
    contract: IMPORT_REPORT_CONTRACT,
    version: "1.0",
    import_id: result.import_id,
    diagnostic_session_id: result.session_id ?? "",
    content_sha256: result.content_sha256 ?? contentSha ?? "",
    status: result.status,
    counts: result.counts ?? {},
    records: publicRecords(report),
    fatal_errors: result.fatal_errors ?? [],
    signal_ids: result.signal_ids ?? toStringArray(report.committed_signal_ids),
  };
}

function toReport(row: ExistingImport): ImportReport {
  const report = (row.report ?? {}) as Record<string, unknown>;
  return {
    contract: IMPORT_REPORT_CONTRACT,
    version: "1.0",
    import_id: row.id,
    diagnostic_session_id: row.diagnostic_session_id ?? "",
    content_sha256: row.content_sha256,
    status: row.status,
    counts: row.counts ?? {},
    records: publicRecords(report),
    fatal_errors: (row.fatal_errors ?? []) as unknown[],
    signal_ids: toStringArray(report.committed_signal_ids),
  };
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string");
}

function toIssues(value: unknown): ImportIssue[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => {
    const issue = (entry ?? {}) as Record<string, unknown>;
    return {
      code: typeof issue.code === "string" ? issue.code : "schema_violation",
      field: typeof issue.field === "string" ? issue.field : null,
      message: typeof issue.message === "string" ? issue.message : "",
    };
  });
}

/**
 * Public view of the stored report: the internal `candidates` payloads are
 * stripped, and each record's source statement is joined back in so the
 * reviewer can see what a checkbox commits.
 */
function publicRecords(report: Record<string, unknown>): ImportReportRecord[] {
  const rawRecords = Array.isArray(report.records) ? report.records : [];
  const rawCandidates = Array.isArray(report.candidates) ? report.candidates : [];

  const statements = new Map<string, string>();
  for (const entry of rawCandidates) {
    const candidate = (entry ?? {}) as Record<string, unknown>;
    const payload = (candidate.payload ?? {}) as Record<string, unknown>;
    if (typeof candidate.external_id === "string" && typeof payload.raw_statement === "string") {
      statements.set(candidate.external_id, payload.raw_statement);
    }
  }

  return rawRecords.map((entry) => {
    const record = (entry ?? {}) as Record<string, unknown>;
    const externalId = typeof record.external_id === "string" ? record.external_id : "";
    const numericIndex = Number(record.index);
    return {
      index: Number.isFinite(numericIndex) ? numericIndex : 0,
      external_id: externalId,
      status: typeof record.status === "string" ? record.status : "invalid",
      errors: toIssues(record.errors),
      warnings: toIssues(record.warnings),
      signal_id: typeof record.signal_id === "string" ? record.signal_id : null,
      statement:
        statements.get(externalId) ??
        (typeof record.statement === "string" ? record.statement : null),
    };
  });
}

/** Turn one parsed AI candidate into an addressable, commit-ready record. */
function buildAiArtifacts(candidates: Awaited<ReturnType<typeof extractSignals>>): ImportArtifacts {
  const records: Record<string, unknown>[] = [];
  const staged: ImportCandidate[] = [];

  candidates.forEach((candidate, position) => {
    const externalId = `ai-${position + 1}`;
    records.push({
      index: position + 1,
      external_id: externalId,
      status: "valid",
      errors: [],
      warnings: [],
      signal_id: null,
    });
    staged.push({
      external_id: externalId,
      record_index: position,
      payload: {
        source_type: "ai_hypothesis",
        epistemic_type: "hypothesis",
        raw_statement: candidate.raw_statement,
        statement_polarity: candidate.statement_polarity,
        test_result: candidate.test_result,
        normalized_meaning: candidate.normalized_meaning,
        inferred_opposite: candidate.inferred_opposite,
        confidence: candidate.confidence,
        life_areas: candidate.life_areas,
        tags: candidate.tags,
        context: {},
        // AI candidates are staged as L0 evidence and stay pending until a
        // human review explicitly confirms them.
        evidence_level: "L0_AI_ONLY",
        visibility: "internal",
      },
    });
  });

  return {
    counts: {
      total: records.length,
      valid: records.length,
      invalid: 0,
      duplicate: 0,
      warning: 0,
      accepted: 0,
      rejected_by_reviewer: 0,
      committed: 0,
    },
    records,
    candidates: staged,
  };
}

interface StructuredRowResult {
  record: ImportRecord | null;
  external_id: string;
  index: number;
  status: "valid" | "invalid" | "duplicate";
  errors: ImportIssue[];
  warnings: ImportIssue[];
  signal_id: string | null;
}

/** Shape of one Signal insert built from a validated structured record. */
function buildSignalPayload(record: ImportRecord): Record<string, unknown> {
  return {
    source_type: record.source_type,
    epistemic_type: record.epistemic_type,
    raw_statement: record.raw_statement,
    statement_polarity: record.statement_polarity,
    test_result: record.test_result,
    normalized_meaning: record.normalized_meaning,
    inferred_opposite: record.inferred_opposite,
    intensity: record.intensity,
    confidence: record.confidence,
    life_areas: record.life_areas,
    tags: record.tags,
    context: record.context ?? {},
    time_scope: record.time_scope,
    visibility: record.visibility,
    // Imported candidates are staged for review, never auto-confirmed.
    review_status: "pending",
  };
}

/**
 * Report records + commit-ready candidates + authoritative counts derived from
 * one parse. Shared by the preview and the one-shot commit so both describe the
 * same import identically.
 */
function buildStructuredArtifacts(rows: StructuredRowResult[]): ImportArtifacts {
  let valid = 0;
  let invalid = 0;
  let duplicate = 0;
  let warning = 0;

  const records: Record<string, unknown>[] = [];
  const candidates: ImportCandidate[] = [];

  rows.forEach((row, position) => {
    if (row.status === "invalid") invalid += 1;
    else if (row.status === "duplicate") duplicate += 1;
    else if (row.record) valid += 1;
    if (row.warnings.length > 0) warning += 1;

    records.push({
      index: row.index,
      external_id: row.external_id,
      status: row.status,
      errors: row.errors,
      warnings: row.warnings,
      signal_id: row.signal_id,
    });

    if (row.status === "valid" && row.record) {
      candidates.push({
        external_id: row.external_id,
        record_index: position,
        payload: buildSignalPayload(row.record),
      });
    }
  });

  return {
    counts: {
      total: rows.length,
      valid,
      invalid,
      duplicate,
      warning,
      accepted: 0,
      rejected_by_reviewer: 0,
      committed: 0,
    },
    records,
    candidates,
  };
}

/** Phase-1 staging for structured input: session + report, no Signals. */
async function stageStructuredPreview(
  client: SupabaseClient,
  input: {
    organizationId: string;
    clientId: string;
    inputFormat: string;
    contractVersion: string;
    idempotencyKey: string;
    contentSha: string;
    title: string | null;
    rawContent: string;
    rows: StructuredRowResult[];
  }
): Promise<ImportReport> {
  const started = await beginImport(client, input);
  if (started.reused && started.status !== "parsing") return toRpcReport(started);

  const finalized = await finalizeImport(
    client,
    input.organizationId,
    started.import_id,
    buildStructuredArtifacts(input.rows)
  );

  incrementCounter("import_total", "Total imports by outcome", { outcome: "previewed" });
  return toRpcReport(finalized, input.contentSha);
}

/** One-shot structured commit: every valid record becomes a pending Signal. */
async function commitStructured(
  client: SupabaseClient,
  organizationId: string,
  clientId: string,
  input: {
    inputFormat: string;
    contractVersion: string;
    idempotencyKey: string;
    contentSha: string;
    title: string | null;
    rawContent: string;
    rows: StructuredRowResult[];
  }
): Promise<ImportReport> {
  // Idempotent replay: the same operation key returns the stored report without
  // writing anything. The RPC re-checks this inside its transaction as well.
  const existing = await findImport(client, organizationId, clientId, input.idempotencyKey);
  if (existing) {
    if (existing.content_sha256 !== input.contentSha) {
      throw new ServiceError("CONFLICT", "conflicting_idempotency_key");
    }
    return toReport(existing);
  }

  const artifacts = buildStructuredArtifacts(input.rows);

  // Signals are submitted with the position of the report record they belong to,
  // so the RPC can store the generated signal id inside the same transaction.
  const signals = artifacts.candidates.map((candidate) => ({
    record_position: candidate.record_index,
    ...candidate.payload,
  }));

  const result = await runAtomicRpc<ImportRpcResult>(
    client,
    "commit_import",
    {
      p_org_id: organizationId,
      p_client_id: clientId,
      p_session_id: crypto.randomUUID(),
      p_input_format: input.inputFormat,
      p_contract_version: input.contractVersion,
      p_idempotency_key: input.idempotencyKey,
      p_content_sha256: input.contentSha,
      p_title: input.title,
      p_raw_content: input.rawContent,
      p_counts: artifacts.counts,
      p_report: { records: artifacts.records, candidates: artifacts.candidates },
      p_fatal_errors: [],
      p_signals: signals,
    },
    {
      forbidden: "No write access to this client",
      failure: "Failed to commit import",
      conflict: "conflicting_idempotency_key",
      validation: "conflicting_idempotency_key",
    }
  );

  incrementCounter("import_total", "Total imports by outcome", { outcome: "parsed" });
  return toRpcReport(result, input.contentSha);
}

// --- structured parsing ------------------------------------------------------

const CSV_COLUMNS = [
  "contract_version",
  "external_id",
  "source_session_ref",
  "source_type",
  "source_ref",
  "epistemic_type",
  "raw_statement",
  "statement_polarity",
  "test_result",
  "normalized_meaning",
  "inferred_opposite",
  "intensity",
  "confidence",
  "life_areas_json",
  "tags_json",
  "context_json",
  "time_scope",
  "claimed_evidence_level",
  "visibility",
  "source_review_status",
  "source_created_at",
  "source_updated_at",
];

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (c === "\r") {
      // skip; handled with following \n
    } else {
      field += c;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function parseJsonArrayCell(value: string): string[] {
  const v = value.trim();
  if (v === "" || v === "null") return [];
  try {
    const parsed = JSON.parse(v);
    if (!Array.isArray(parsed)) throw new Error();
    return parsed.map((x) => String(x));
  } catch {
    throw new Error("invalid_nested_json");
  }
}

function parseJsonObjectCell(value: string): Record<string, unknown> | null {
  const v = value.trim();
  if (v === "" || v === "null") return null;
  try {
    const parsed = JSON.parse(v);
    if (parsed === null || Array.isArray(parsed) || typeof parsed !== "object") throw new Error();
    return parsed as Record<string, unknown>;
  } catch {
    throw new Error("invalid_nested_json");
  }
}

/** Drop repeated values from a set-like array, keeping the first occurrence. */
function dedupeValues(values: string[]): { values: string[]; removed: boolean } {
  const seen = new Set<string>();
  const kept: string[] = [];
  let removed = false;
  for (const value of values) {
    if (seen.has(value)) {
      removed = true;
      continue;
    }
    seen.add(value);
    kept.push(value);
  }
  return { values: kept, removed };
}

/**
 * Apply the documented normalization to set-like arrays: duplicate `life_areas`
 * / `tags` values are removed with a warning rather than silently dropped.
 */
function applySetArrayWarnings(record: ImportRecord, warnings: ImportIssue[]): ImportRecord {
  const lifeAreas = dedupeValues(record.life_areas);
  if (lifeAreas.removed) {
    warnings.push({
      code: "duplicate_value_removed",
      field: "life_areas",
      message: "duplicate life_areas values were removed",
    });
    record.life_areas = lifeAreas.values;
  }
  const tags = dedupeValues(record.tags);
  if (tags.removed) {
    warnings.push({
      code: "duplicate_value_removed",
      field: "tags",
      message: "duplicate tags values were removed",
    });
    record.tags = tags.values;
  }
  return record;
}

function csvRowToRecord(cells: string[]): {
  record: ImportRecord | null;
  errors: ImportIssue[];
  warnings: ImportIssue[];
} {
  const errors: ImportIssue[] = [];
  const warnings: ImportIssue[] = [];
  if (cells[0] !== SIGNALS_CSV_CONTRACT) {
    return {
      record: null,
      errors: [
        { code: "unsupported_version", field: "contract_version", message: "unsupported version" },
      ],
      warnings,
    };
  }
  const get = (i: number): string => (cells[i] ?? "").trim();

  let life_areas: string[] = [];
  try {
    life_areas = parseJsonArrayCell(cells[13] ?? "");
  } catch {
    errors.push({
      code: "invalid_nested_json",
      field: "life_areas_json",
      message: "invalid JSON array",
    });
  }
  let tags: string[] = [];
  try {
    tags = parseJsonArrayCell(cells[14] ?? "");
  } catch {
    errors.push({ code: "invalid_nested_json", field: "tags_json", message: "invalid JSON array" });
  }
  let context: Record<string, unknown> | null = null;
  try {
    context = parseJsonObjectCell(cells[15] ?? "");
  } catch {
    errors.push({
      code: "invalid_nested_json",
      field: "context_json",
      message: "invalid JSON object",
    });
  }

  const candidate = {
    external_id: get(1),
    source_session_ref: get(2) || null,
    source_type: get(3),
    source_ref: get(4) || null,
    epistemic_type: get(5),
    raw_statement: get(6),
    statement_polarity: get(7),
    test_result: get(8),
    normalized_meaning: get(9) || null,
    inferred_opposite: get(10) || null,
    intensity: cells[11] === "" || cells[11] === undefined ? null : Number(cells[11]),
    confidence: cells[12] === "" || cells[12] === undefined ? null : Number(cells[12]),
    life_areas,
    tags,
    context,
    time_scope: get(16) || null,
    claimed_evidence_level: get(17) || null,
    visibility: get(18),
    source_review_status: get(19) || null,
    source_created_at: get(20) || null,
    source_updated_at: get(21) || null,
  };

  const parsed = importRecordSchema.safeParse(candidate);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      errors.push({
        code: "schema_violation",
        field: issue.path[0]?.toString() ?? null,
        message: issue.message,
      });
    }
    return { record: null, errors, warnings };
  }
  if (errors.length > 0) return { record: null, errors, warnings };
  return { record: applySetArrayWarnings(parsed.data, warnings), errors: [], warnings };
}

function normalizeJsonRecords(rawRecords: Record<string, unknown>[]): StructuredRowResult[] {
  const results: StructuredRowResult[] = [];
  const seenExternal = new Set<string>();
  const seenHash = new Set<string>();
  for (let i = 0; i < rawRecords.length; i += 1) {
    const raw = rawRecords[i];
    const parsed = importRecordSchema.safeParse(raw);
    if (!parsed.success) {
      results.push({
        record: null,
        external_id: String(raw.external_id ?? `row-${i + 1}`),
        index: i + 1,
        status: "invalid",
        errors: parsed.error.issues.map((issue) => ({
          code: "schema_violation",
          field: issue.path[0]?.toString() ?? null,
          message: issue.message,
        })),
        warnings: [],
        signal_id: null,
      });
      continue;
    }

    const warnings: ImportIssue[] = [];
    const record = applySetArrayWarnings(parsed.data, warnings);

    let status: StructuredRowResult["status"] = "valid";
    const errors: ImportIssue[] = [];
    if (seenExternal.has(record.external_id)) {
      status = "duplicate";
      errors.push({
        code: "duplicate_external_id",
        field: "external_id",
        message: "duplicate external_id",
      });
    } else {
      const hash = sha256(JSON.stringify(record));
      if (seenHash.has(hash)) {
        status = "duplicate";
        errors.push({ code: "duplicate_content", field: null, message: "duplicate content" });
      } else {
        seenExternal.add(record.external_id);
        seenHash.add(hash);
      }
    }

    results.push({
      record,
      external_id: record.external_id,
      index: i + 1,
      status,
      errors,
      warnings,
      signal_id: null,
    });
  }
  return results;
}

/**
 * Validate the CSV container and normalize every data row. Container errors
 * (missing or unexpected header) throw before any import is staged.
 */
function parseStructuredRows(header: string[], rows: string[][]): StructuredRowResult[] {
  if (header.join(",") !== CSV_COLUMNS.join(",")) {
    throw new ServiceError("VALIDATION_ERROR", "missing_header");
  }

  const results: StructuredRowResult[] = [];
  const seenExternal = new Set<string>();
  const seenHash = new Set<string>();

  for (let i = 0; i < rows.length; i += 1) {
    const cells = rows[i];
    const { record, errors, warnings } = csvRowToRecord(cells);
    const externalId = record?.external_id ?? cells[1] ?? `row-${i + 2}`;

    let status: StructuredRowResult["status"] = errors.length > 0 ? "invalid" : "valid";
    if (record) {
      if (seenExternal.has(record.external_id)) {
        status = "duplicate";
        errors.push({
          code: "duplicate_external_id",
          field: "external_id",
          message: "duplicate external_id",
        });
      } else {
        const hash = sha256(JSON.stringify(record));
        if (seenHash.has(hash)) {
          status = "duplicate";
          errors.push({ code: "duplicate_content", field: null, message: "duplicate content" });
        } else {
          seenExternal.add(record.external_id);
          seenHash.add(hash);
        }
      }
    }
    results.push({
      record,
      external_id: externalId,
      index: i + 2,
      status,
      errors,
      warnings,
      signal_id: null,
    });
  }

  return results;
}
