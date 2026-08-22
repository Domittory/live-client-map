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
import { ingestSignals } from "./ai-ingest";
import { recordAudit } from "./audit";
import { ServiceError } from "./errors";
import { uuid, validate } from "./validation";

/**
 * Import pipeline (tickets 53, 54), implementing docs/data-exchange-contracts.md.
 * Every accepted source becomes an immutable DiagnosticSession (session_type=import)
 * and — for unstructured input — is parsed through ai.ingest-signals.v1 into
 * pending L0 candidates; structured CSV/JSON rows are schema-validated and
 * normalized into pending Signals. Nothing is ever written to a confirmed
 * entity, and retries are idempotent by (org, client, contract, idempotency_key).
 */

const IMPORT_CONTRACT = "live-client-map.import-request";
const SIGNALS_CSV_CONTRACT = "live-client-map.signals-csv/1.0";
const SIGNALS_JSON_CONTRACT = "live-client-map.signals-import/1.0";

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

interface ImportReport {
  contract: string;
  version: string;
  import_id: string;
  diagnostic_session_id: string;
  content_sha256: string;
  status: string;
  counts: Record<string, number>;
  records: unknown[];
  fatal_errors: unknown[];
}

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function codePoints(text: string): number {
  return [...text].length;
}

export async function importText(
  client: SupabaseClient,
  provider: AiProvider,
  rawInput: unknown
): Promise<ImportReport> {
  const input = validate(
    z
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
      .strict(),
    rawInput
  );

  if (input.content.trim().length === 0) {
    throw new ServiceError("VALIDATION_ERROR", "empty_content");
  }
  if (codePoints(input.content) > MAX_SOURCE_CODEPOINTS) {
    throw new ServiceError("VALIDATION_ERROR", "size_limit_exceeded");
  }

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

  const sessionId = await createSession(client, input.organizationId, input.clientId, {
    inputFormat: input.inputFormat,
    title: input.title ?? null,
    rawInput: input.content,
  });
  const importId = await insertImport(client, {
    organizationId: input.organizationId,
    clientId: input.clientId,
    sessionId,
    inputFormat: input.inputFormat,
    contractVersion: IMPORT_CONTRACT,
    idempotencyKey: input.idempotencyKey,
    contentSha,
    status: "parsing",
  });

  // AI parse → pending L0 candidates (never confirmed evidence).
  const signalIds = await ingestSignals(client, provider, {
    organizationId: input.organizationId,
    clientId: input.clientId,
    diagnosticSessionId: sessionId,
    rawInput: input.content,
    sourceType: "imported_note",
    inputFormat: input.inputFormat,
    knownLifeAreas: [],
  });

  const report = await finalizeImport(
    client,
    input.organizationId,
    importId,
    sessionId,
    input.inputFormat,
    contentSha,
    {
      total: signalIds.length,
      valid: signalIds.length,
      accepted: 0,
      committed: 0,
    }
  );
  return report;
}

export async function importSignalsCsv(
  client: SupabaseClient,
  rawInput: unknown
): Promise<ImportReport> {
  const input = validate(
    z
      .object({
        organizationId: uuid,
        clientId: uuid,
        content: z.string().min(1),
        title: z.string().max(200).nullable().optional(),
        idempotencyKey: IDEMPOTENCY_KEY,
      })
      .strict(),
    rawInput
  );

  if (codePoints(input.content) > MAX_SOURCE_CODEPOINTS) {
    throw new ServiceError("VALIDATION_ERROR", "size_limit_exceeded");
  }
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
  const records = await parseStructuredRecords(client, input.organizationId, input.clientId, {
    header,
    rows: parsed.slice(1),
    inputFormat: "signals_csv",
    idempotencyKey: input.idempotencyKey,
    contentSha,
    title: input.title ?? null,
    rawContent: input.content,
  });
  return records;
}

export async function importSignalsJson(
  client: SupabaseClient,
  rawInput: unknown
): Promise<ImportReport> {
  const input = validate(
    z
      .object({
        organizationId: uuid,
        clientId: uuid,
        content: z.string().min(1),
        title: z.string().max(200).nullable().optional(),
        idempotencyKey: IDEMPOTENCY_KEY,
      })
      .strict(),
    rawInput
  );

  if (codePoints(input.content) > MAX_SOURCE_CODEPOINTS) {
    throw new ServiceError("VALIDATION_ERROR", "size_limit_exceeded");
  }
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

  const records = await normalizeJsonRecords(envelope.records as Record<string, unknown>[]);
  return commitStructured(client, input.organizationId, input.clientId, {
    inputFormat: "signals_json",
    idempotencyKey: input.idempotencyKey,
    contentSha,
    title: input.title ?? null,
    rawContent: input.content,
    records,
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

function toReport(row: ExistingImport): ImportReport {
  const report = (row.report ?? {}) as Record<string, unknown>;
  return {
    contract: "live-client-map.import-report",
    version: "1.0",
    import_id: row.id,
    diagnostic_session_id: row.diagnostic_session_id ?? "",
    content_sha256: row.content_sha256,
    status: row.status,
    counts: row.counts ?? {},
    records: (report.records ?? []) as unknown[],
    fatal_errors: (row.fatal_errors ?? []) as unknown[],
  };
}

async function createSession(
  client: SupabaseClient,
  organizationId: string,
  clientId: string,
  input: { inputFormat: string; title: string | null; rawInput: string }
): Promise<string> {
  const { data, error } = await client
    .from("diagnostic_sessions")
    .insert({
      organization_id: organizationId,
      client_id: clientId,
      title: input.title ?? "Import",
      session_type: "import",
      source_type: "imported_note",
      raw_input: input.rawInput,
      input_format: input.inputFormat,
    })
    .select("id")
    .single();
  if (error) throw new ServiceError("INTERNAL_ERROR", "Failed to create import session");
  return data.id;
}

async function insertImport(
  client: SupabaseClient,
  input: {
    organizationId: string;
    clientId: string;
    sessionId: string;
    inputFormat: string;
    contractVersion: string;
    idempotencyKey: string;
    contentSha: string;
    status: string;
  }
): Promise<string> {
  const { data, error } = await client
    .from("imports")
    .insert({
      organization_id: input.organizationId,
      client_id: input.clientId,
      diagnostic_session_id: input.sessionId,
      input_format: input.inputFormat,
      contract_version: input.contractVersion,
      idempotency_key: input.idempotencyKey,
      content_sha256: input.contentSha,
      status: input.status,
    })
    .select("id")
    .single();
  if (error) {
    if (error.code === "23505") throw new ServiceError("CONFLICT", "conflicting_idempotency_key");
    throw new ServiceError("INTERNAL_ERROR", "Failed to create import record");
  }
  return data.id;
}

async function finalizeImport(
  client: SupabaseClient,
  organizationId: string,
  importId: string,
  sessionId: string,
  inputFormat: string,
  contentSha: string,
  counts: Record<string, number>
): Promise<ImportReport> {
  const fullCounts = {
    total: counts.total ?? 0,
    valid: counts.valid ?? 0,
    invalid: 0,
    duplicate: 0,
    warning: 0,
    accepted: counts.accepted ?? 0,
    rejected_by_reviewer: 0,
    committed: counts.committed ?? 0,
  };
  await client
    .from("imports")
    .update({ status: "awaiting_review", counts: fullCounts })
    .eq("id", importId);
  await recordAudit(client, {
    organizationId,
    entityType: "import",
    entityId: importId,
    action: "import.parsed",
    after: { input_format: inputFormat },
  });
  return {
    contract: "live-client-map.import-report",
    version: "1.0",
    import_id: importId,
    diagnostic_session_id: sessionId,
    content_sha256: contentSha,
    status: "awaiting_review",
    counts: fullCounts,
    records: [],
    fatal_errors: [],
  };
}

// --- structured (CSV/JSON) ---------------------------------------------------

interface StructuredRowResult {
  record: ImportRecord | null;
  external_id: string;
  index: number;
  status: "valid" | "invalid" | "duplicate";
  errors: { code: string; field: string | null; message: string }[];
  signal_id: string | null;
}

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

function csvRowToRecord(cells: string[]): {
  record: ImportRecord | null;
  errors: { code: string; field: string | null; message: string }[];
} {
  const errors: { code: string; field: string | null; message: string }[] = [];
  if (cells[0] !== SIGNALS_CSV_CONTRACT) {
    return {
      record: null,
      errors: [
        { code: "unsupported_version", field: "contract_version", message: "unsupported version" },
      ],
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
    return { record: null, errors };
  }
  if (errors.length > 0) return { record: null, errors };
  return { record: parsed.data, errors: [] };
}

async function normalizeJsonRecords(
  rawRecords: Record<string, unknown>[]
): Promise<StructuredRowResult[]> {
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
        signal_id: null,
      });
      continue;
    }

    let status: StructuredRowResult["status"] = "valid";
    const errors: { code: string; field: string | null; message: string }[] = [];
    if (seenExternal.has(parsed.data.external_id)) {
      status = "duplicate";
      errors.push({
        code: "duplicate_external_id",
        field: "external_id",
        message: "duplicate external_id",
      });
    } else {
      const hash = sha256(JSON.stringify(parsed.data));
      if (seenHash.has(hash)) {
        status = "duplicate";
        errors.push({ code: "duplicate_content", field: null, message: "duplicate content" });
      } else {
        seenExternal.add(parsed.data.external_id);
        seenHash.add(hash);
      }
    }

    results.push({
      record: parsed.data,
      external_id: parsed.data.external_id,
      index: i + 1,
      status,
      errors,
      signal_id: null,
    });
  }
  return results;
}

async function parseStructuredRecords(
  client: SupabaseClient,
  organizationId: string,
  clientId: string,
  input: {
    header: string[];
    rows: string[][];
    inputFormat: string;
    idempotencyKey: string;
    contentSha: string;
    title: string | null;
    rawContent: string;
  }
): Promise<ImportReport> {
  if (input.header.join(",") !== CSV_COLUMNS.join(",")) {
    throw new ServiceError("VALIDATION_ERROR", "missing_header");
  }

  const results: StructuredRowResult[] = [];
  const seenExternal = new Set<string>();
  const seenHash = new Set<string>();

  for (let i = 0; i < input.rows.length; i += 1) {
    const cells = input.rows[i];
    const { record, errors } = csvRowToRecord(cells);
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
      signal_id: null,
    });
  }

  return commitStructured(client, organizationId, clientId, {
    inputFormat: input.inputFormat,
    idempotencyKey: input.idempotencyKey,
    contentSha: input.contentSha,
    title: input.title,
    rawContent: input.rawContent,
    records: results,
  });
}

async function commitStructured(
  client: SupabaseClient,
  organizationId: string,
  clientId: string,
  input: {
    inputFormat: string;
    idempotencyKey: string;
    contentSha: string;
    title: string | null;
    rawContent: string;
    records: StructuredRowResult[];
  }
): Promise<ImportReport> {
  const sessionId = await createSession(client, organizationId, clientId, {
    inputFormat: input.inputFormat,
    title: input.title,
    rawInput: input.rawContent,
  });
  const importId = await insertImport(client, {
    organizationId,
    clientId,
    sessionId,
    inputFormat: input.inputFormat,
    contractVersion:
      input.inputFormat === "signals_csv" ? SIGNALS_CSV_CONTRACT : SIGNALS_JSON_CONTRACT,
    idempotencyKey: input.idempotencyKey,
    contentSha: input.contentSha,
    status: "parsing",
  });

  const {
    data: { user },
  } = await client.auth.getUser();

  let valid = 0;
  let invalid = 0;
  let duplicate = 0;
  let committed = 0;

  for (const row of input.records) {
    if (row.status === "invalid") invalid += 1;
    else if (row.status === "duplicate") duplicate += 1;
    else if (row.record) {
      valid += 1;
      const { data, error } = await client
        .from("signals")
        .insert({
          organization_id: organizationId,
          client_id: clientId,
          diagnostic_session_id: sessionId,
          source_type: row.record.source_type,
          epistemic_type: row.record.epistemic_type,
          raw_statement: row.record.raw_statement,
          statement_polarity: row.record.statement_polarity,
          test_result: row.record.test_result,
          normalized_meaning: row.record.normalized_meaning,
          inferred_opposite: row.record.inferred_opposite,
          intensity: row.record.intensity,
          confidence: row.record.confidence,
          life_areas: row.record.life_areas,
          tags: row.record.tags,
          context: row.record.context ?? undefined,
          time_scope: row.record.time_scope,
          visibility: row.record.visibility,
          review_status: "pending",
          created_by: user?.id ?? null,
        })
        .select("id")
        .single();
      if (error) {
        row.status = "invalid";
        row.errors.push({ code: "commit_failed", field: null, message: "failed to persist" });
        invalid += 1;
        valid -= 1;
      } else {
        row.signal_id = data.id;
        committed += 1;
      }
    }
  }

  const counts = {
    total: input.records.length,
    valid,
    invalid,
    duplicate,
    warning: 0,
    accepted: 0,
    rejected_by_reviewer: 0,
    committed,
  };
  const reportRecords = input.records.map((r) => ({
    index: r.index,
    external_id: r.external_id,
    status: r.status,
    signal_id: r.signal_id,
    errors: r.errors,
  }));

  await client
    .from("imports")
    .update({ status: "awaiting_review", counts, report: { records: reportRecords } })
    .eq("id", importId);

  await recordAudit(client, {
    organizationId,
    entityType: "import",
    entityId: importId,
    action: "import.parsed",
    after: { input_format: input.inputFormat, committed },
  });

  return {
    contract: "live-client-map.import-report",
    version: "1.0",
    import_id: importId,
    diagnostic_session_id: sessionId,
    content_sha256: input.contentSha,
    status: "awaiting_review",
    counts,
    records: reportRecords,
    fatal_errors: [],
  };
}
