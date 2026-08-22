import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { recordAudit } from "./audit";
import { ServiceError } from "./errors";
import { uuid, validate } from "./validation";

export const createHypothesisSchema = z
  .object({
    clientId: uuid,
    title: z.string().trim().min(1).max(200),
    description: z.string().max(5000).nullable().optional(),
    confidenceScore: z.number().int().min(0).max(100).nullable().optional(),
  })
  .strict();

/** Contradicting evidence lowers confidence by −10 each, floor 0 (SPEC §51.4). */
export function confidenceWithContradictions(baseConfidence: number, againstCount: number): number {
  return Math.max(0, baseConfidence - againstCount * 10);
}

export async function createHypothesis(
  client: SupabaseClient,
  organizationId: string,
  rawInput: unknown
): Promise<string> {
  const input = validate(createHypothesisSchema, rawInput);
  const {
    data: { user },
  } = await client.auth.getUser();

  const { data, error } = await client
    .from("differential_hypotheses")
    .insert({
      organization_id: organizationId,
      client_id: input.clientId,
      title: input.title,
      description: input.description ?? null,
      confidence_score: input.confidenceScore ?? null,
      created_by: user?.id ?? null,
    })
    .select("id")
    .single();
  if (error) {
    if (error.code === "42501")
      throw new ServiceError("FORBIDDEN", "No write access to this client");
    throw new ServiceError("INTERNAL_ERROR", "Failed to create hypothesis");
  }
  await recordAudit(client, {
    organizationId,
    entityType: "differential_hypothesis",
    entityId: data.id,
    action: "hypothesis.created",
    after: { title: input.title },
  });
  return data.id;
}

/** Record contradicting evidence and lower confidence deterministically. */
export async function addContradiction(
  client: SupabaseClient,
  organizationId: string,
  hypothesisId: string,
  evidenceRef: string
): Promise<void> {
  const { data: current } = await client
    .from("differential_hypotheses")
    .select("confidence_score, evidence_against")
    .eq("id", hypothesisId)
    .maybeSingle();
  if (!current) throw new ServiceError("NOT_FOUND", "Hypothesis not found");

  const against = [...(current.evidence_against ?? []), evidenceRef];
  // Incremental: each new contradiction lowers confidence by 10 (floor 0).
  const newConfidence = Math.max(0, (current.confidence_score ?? 0) - 10);

  const { error } = await client
    .from("differential_hypotheses")
    .update({ evidence_against: against, confidence_score: newConfidence })
    .eq("id", hypothesisId);
  if (error) throw new ServiceError("INTERNAL_ERROR", "Failed to record contradiction");

  await recordAudit(client, {
    organizationId,
    entityType: "differential_hypothesis",
    entityId: hypothesisId,
    action: "hypothesis.contradiction_added",
    after: { evidence_ref: evidenceRef, confidence_score: newConfidence },
  });
}
