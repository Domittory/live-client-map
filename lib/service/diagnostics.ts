import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { ServiceError } from "./errors";
import { runAtomicRpc } from "./transaction";
import { uuid, validate } from "./validation";

export const SESSION_TYPES = [
  "individual",
  "topic_test",
  "follow_up_test",
  "correction_check",
  "import",
  "baseline",
] as const;

export const SIGNAL_SOURCE_TYPES = [
  "kinesiology_test",
  "client_report",
  "specialist_observation",
  "life_event",
  "questionnaire",
  "partner_report",
  "follow_up",
  "imported_note",
  "ai_hypothesis",
] as const;

export const EPISTEMIC_TYPES = [
  "fact",
  "self_report",
  "test_result",
  "observation",
  "interpretation",
  "hypothesis",
] as const;

const polaritySchema = z.enum(["positive", "negative", "neutral", "mixed", "unknown"]);
const testResultSchema = z.enum(["stress", "no_stress", "unknown", "not_tested"]);
const visibilitySchema = z.enum(["internal", "sensitive", "client_visible"]);

export const createSessionSchema = z
  .object({
    clientId: uuid,
    title: z.string().trim().min(1).max(200),
    sessionType: z.enum(SESSION_TYPES),
    rawInput: z.string().max(100000).nullable().optional(),
    inputFormat: z.string().max(50).nullable().optional(),
    notes: z.string().max(5000).nullable().optional(),
  })
  .strict();

export const createSignalSchema = z
  .object({
    clientId: uuid,
    diagnosticSessionId: uuid.nullable().optional(),
    sourceType: z.enum(SIGNAL_SOURCE_TYPES),
    epistemicType: z.enum(EPISTEMIC_TYPES),
    rawStatement: z.string().trim().min(1).max(5000),
    statementPolarity: polaritySchema.nullable().optional(),
    testResult: testResultSchema.nullable().optional(),
    normalizedMeaning: z.string().max(5000).nullable().optional(),
    intensity: z.number().int().min(0).max(100).nullable().optional(),
    confidence: z.number().int().min(0).max(100).nullable().optional(),
    lifeAreas: z.array(z.string().max(100)).max(100).optional(),
    tags: z.array(z.string().max(100)).max(100).optional(),
    visibility: visibilitySchema.optional(),
  })
  .strict();

/**
 * Session creation and its audit row are one atomic RPC (ticket 05). An optional
 * batch of signals can be created in the same transaction, so a session is never
 * persisted without the evidence its caller asked for.
 */
export async function createSession(
  client: SupabaseClient,
  organizationId: string,
  rawInput: unknown
): Promise<string> {
  const input = validate(createSessionSchema, rawInput);

  const result = await runAtomicRpc<{ session_id: string }>(
    client,
    "create_diagnostic_session",
    {
      p_org_id: organizationId,
      p_client_id: input.clientId,
      p_title: input.title,
      p_session_type: input.sessionType,
      p_source_type: null,
      p_raw_input: input.rawInput ?? null,
      p_input_format: input.inputFormat ?? null,
      p_notes: input.notes ?? null,
      p_signals: [],
    },
    {
      forbidden: "No write access to this client",
      failure: "Failed to create diagnostic session",
      validation: "Invalid diagnostic session",
    }
  );

  return result.session_id;
}

/** Manual Signal and its audit row are one atomic RPC (ticket 05). */
export async function createSignal(
  client: SupabaseClient,
  organizationId: string,
  rawInput: unknown
): Promise<string> {
  const input = validate(createSignalSchema, rawInput);

  const signal = {
    diagnostic_session_id: input.diagnosticSessionId ?? null,
    source_type: input.sourceType,
    epistemic_type: input.epistemicType,
    raw_statement: input.rawStatement,
    statement_polarity: input.statementPolarity ?? null,
    test_result: input.testResult ?? null,
    normalized_meaning: input.normalizedMeaning ?? null,
    intensity: input.intensity ?? null,
    confidence: input.confidence ?? null,
    life_areas: input.lifeAreas ?? [],
    tags: input.tags ?? [],
    visibility: input.visibility ?? "internal",
  };

  return runAtomicRpc<string>(
    client,
    "create_signal",
    { p_org_id: organizationId, p_client_id: input.clientId, p_signal: signal },
    {
      forbidden: "No write access to this client",
      failure: "Failed to create signal",
      validation: "Invalid signal",
    }
  );
}

export async function listSignals(
  client: SupabaseClient,
  organizationId: string,
  clientId: string
): Promise<unknown[]> {
  const { data, error } = await client
    .from("signals")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("client_id", clientId)
    .order("created_at", { ascending: false });
  if (error) throw new ServiceError("INTERNAL_ERROR", "Failed to list signals");
  return (data ?? []) as unknown[];
}

/**
 * Client-scoped diagnostics read model (ticket 10).
 *
 * Sessions and their Signals are read through the RLS-scoped client: an
 * unassigned user receives empty collections instead of a permission error, so
 * the page can never mistake a denial for "no data" or leak another tenant's
 * client id. Lineage is resolved from the embedded session reference, never
 * from a client-side lookup table.
 */

export const DIAGNOSTICS_READ_LIMIT = 200;

export interface DiagnosticSessionRecord {
  id: string;
  title: string;
  session_type: string;
  raw_input: string | null;
  notes: string | null;
  human_review_status: string;
  ai_processing_status: string;
  performed_at: string | null;
  created_at: string;
}

export interface DiagnosticSignalRecord {
  id: string;
  diagnostic_session_id: string | null;
  source_type: string;
  epistemic_type: string;
  raw_statement: string;
  statement_polarity: string | null;
  test_result: string | null;
  normalized_meaning: string | null;
  intensity: number | null;
  confidence: number | null;
  life_areas: string[];
  tags: string[];
  evidence_level: string;
  visibility: string;
  review_status: string;
  source_ref_id: string | null;
  created_at: string;
}

/** A Signal together with the session it was recorded in (lineage). */
export interface DiagnosticSignalWithLineage extends DiagnosticSignalRecord {
  session: { id: string; title: string; sessionType: string } | null;
}

/** One DiagnosticSession with the Signals that reference it. */
export interface DiagnosticSessionWithSignals extends DiagnosticSessionRecord {
  signals: DiagnosticSignalRecord[];
}

export interface DiagnosticsReadModel {
  sessions: DiagnosticSessionWithSignals[];
  /** Signals that belong to no session; they are still client evidence. */
  sessionlessSignals: DiagnosticSignalRecord[];
  /** Lineage for every signal of the client, keyed by signal id. */
  lineage: Map<string, DiagnosticSignalWithLineage["session"]>;
}

const SESSION_COLUMNS =
  "id, title, session_type, raw_input, notes, human_review_status, ai_processing_status, performed_at, created_at";

const SIGNAL_COLUMNS =
  "id, diagnostic_session_id, source_type, epistemic_type, raw_statement, statement_polarity, " +
  "test_result, normalized_meaning, intensity, confidence, life_areas, tags, evidence_level, " +
  "visibility, review_status, source_ref_id, created_at";

/**
 * Load the whole diagnostics read model of one client. Sessions and Signals are
 * fetched through RLS-protected tables, so the read is authorized by the
 * database and the caller's organization scope.
 */
export async function getDiagnosticsReadModel(
  client: SupabaseClient,
  input: { organizationId: string; clientId: string }
): Promise<DiagnosticsReadModel> {
  const organizationId = validate(uuid, input.organizationId);
  const clientId = validate(uuid, input.clientId);

  const [sessionsResult, signalsResult] = await Promise.all([
    client
      .from("diagnostic_sessions")
      .select(SESSION_COLUMNS)
      .eq("organization_id", organizationId)
      .eq("client_id", clientId)
      .order("created_at", { ascending: false })
      .limit(DIAGNOSTICS_READ_LIMIT),
    client
      .from("signals")
      .select(SIGNAL_COLUMNS)
      .eq("organization_id", organizationId)
      .eq("client_id", clientId)
      .order("created_at", { ascending: false })
      .limit(DIAGNOSTICS_READ_LIMIT),
  ]);

  if (sessionsResult.error || signalsResult.error) {
    throw new ServiceError("INTERNAL_ERROR", "Failed to read diagnostics");
  }

  const sessions = (sessionsResult.data ?? []) as unknown as DiagnosticSessionRecord[];
  const signals = (signalsResult.data ?? []) as unknown as DiagnosticSignalRecord[];

  const lineage = new Map<string, DiagnosticSignalWithLineage["session"]>();
  const bySession = new Map<string, DiagnosticSignalRecord[]>();
  const knownSessions = new Map(sessions.map((session) => [session.id, session]));

  for (const signal of signals) {
    const session = signal.diagnostic_session_id
      ? knownSessions.get(signal.diagnostic_session_id)
      : undefined;
    lineage.set(
      signal.id,
      session ? { id: session.id, title: session.title, sessionType: session.session_type } : null
    );
    if (session) {
      const bucket = bySession.get(session.id) ?? [];
      bucket.push(signal);
      bySession.set(session.id, bucket);
    }
  }

  return {
    sessions: sessions.map((session) => ({
      ...session,
      signals: bySession.get(session.id) ?? [],
    })),
    sessionlessSignals: signals.filter((signal) => lineage.get(signal.id) === null),
    lineage,
  };
}
