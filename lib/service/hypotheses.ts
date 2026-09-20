import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { runAtomicRpc } from "./transaction";
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

/** Create a DifferentialHypothesis and its AuditLog row in one transaction. */
export async function createHypothesis(
  client: SupabaseClient,
  organizationId: string,
  rawInput: unknown
): Promise<string> {
  const input = validate(createHypothesisSchema, rawInput);

  return runAtomicRpc<string>(
    client,
    "create_hypothesis",
    {
      p_org_id: organizationId,
      p_client_id: input.clientId,
      p_title: input.title,
      p_description: input.description ?? null,
      p_confidence_score: input.confidenceScore ?? null,
    },
    {
      forbidden: "No write access to this client",
      failure: "Failed to create hypothesis",
    }
  );
}

/**
 * Record contradicting evidence and lower confidence deterministically. The
 * confidence change and its audit row commit or roll back together, so a failed
 * audit append cannot leave a silently lowered confidence.
 */
export async function addContradiction(
  client: SupabaseClient,
  organizationId: string,
  hypothesisId: string,
  evidenceRef: string
): Promise<void> {
  await runAtomicRpc<{ confidence_score: number }>(
    client,
    "add_hypothesis_contradiction",
    {
      p_org_id: organizationId,
      p_hypothesis_id: hypothesisId,
      p_evidence_ref: evidenceRef,
    },
    {
      forbidden: "No write access to this client",
      failure: "Failed to record contradiction",
    }
  );
}
