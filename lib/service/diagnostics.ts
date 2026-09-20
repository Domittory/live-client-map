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
