import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { recordAudit } from "./audit";
import { ServiceError } from "./errors";
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

export async function createSession(
  client: SupabaseClient,
  organizationId: string,
  rawInput: unknown
): Promise<string> {
  const input = validate(createSessionSchema, rawInput);
  const {
    data: { user },
  } = await client.auth.getUser();

  const { data, error } = await client
    .from("diagnostic_sessions")
    .insert({
      organization_id: organizationId,
      client_id: input.clientId,
      title: input.title,
      session_type: input.sessionType,
      raw_input: input.rawInput ?? null,
      input_format: input.inputFormat ?? null,
      notes: input.notes ?? null,
      performed_by_user_id: user?.id ?? null,
    })
    .select("id")
    .single();
  if (error) {
    if (error.code === "42501")
      throw new ServiceError("FORBIDDEN", "No write access to this client");
    throw new ServiceError("INTERNAL_ERROR", "Failed to create diagnostic session");
  }
  await recordAudit(client, {
    organizationId,
    entityType: "diagnostic_session",
    entityId: data.id,
    action: "session.created",
    after: { title: input.title, session_type: input.sessionType },
  });
  return data.id;
}

export async function createSignal(
  client: SupabaseClient,
  organizationId: string,
  rawInput: unknown
): Promise<string> {
  const input = validate(createSignalSchema, rawInput);
  const {
    data: { user },
  } = await client.auth.getUser();

  const { data, error } = await client
    .from("signals")
    .insert({
      organization_id: organizationId,
      client_id: input.clientId,
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
      review_status: "approved",
      created_by: user?.id ?? null,
    })
    .select("id")
    .single();
  if (error) {
    if (error.code === "42501")
      throw new ServiceError("FORBIDDEN", "No write access to this client");
    throw new ServiceError("INTERNAL_ERROR", "Failed to create signal");
  }
  await recordAudit(client, {
    organizationId,
    entityType: "signal",
    entityId: data.id,
    action: "signal.created",
    after: { source_type: input.sourceType, epistemic_type: input.epistemicType },
  });
  return data.id;
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
