import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { ServiceError } from "./errors";
import { runAtomicRpc } from "./transaction";
import { uuid, validate } from "./validation";

export const createResourceSchema = z
  .object({
    clientId: uuid,
    name: z.string().trim().min(1).max(200),
    description: z.string().max(5000).nullable().optional(),
    domain: z.string().max(200).nullable().optional(),
    strengthScore: z.number().int().min(0).max(100).nullable().optional(),
    confidenceScore: z.number().int().min(0).max(100).nullable().optional(),
    evidenceSummary: z.string().max(2000).nullable().optional(),
  })
  .strict();

export const updateResourceSchema = z
  .object({
    id: uuid,
    strengthScore: z.number().int().min(0).max(100).nullable().optional(),
    confidenceScore: z.number().int().min(0).max(100).nullable().optional(),
    evidenceSummary: z.string().max(2000).nullable().optional(),
  })
  .strict();

/**
 * Resources are independent of problem reduction (SPEC §8.18): they are created
 * only by an explicit specialist action. The resource and its audit row commit
 * in one transaction.
 */
export async function createResource(
  client: SupabaseClient,
  organizationId: string,
  rawInput: unknown
): Promise<string> {
  const input = validate(createResourceSchema, rawInput);

  return runAtomicRpc<string>(
    client,
    "create_resource",
    {
      p_org_id: organizationId,
      p_client_id: input.clientId,
      p_name: input.name,
      p_description: input.description ?? null,
      p_domain: input.domain ?? null,
      p_strength_score: input.strengthScore ?? null,
      p_confidence_score: input.confidenceScore ?? null,
      p_evidence_summary: input.evidenceSummary ?? null,
    },
    {
      forbidden: "No write access to this client",
      failure: "Failed to create resource",
    }
  );
}

/** Each score change must carry evidence or a human reason (checked in SQL too). */
export async function updateResource(
  client: SupabaseClient,
  organizationId: string,
  rawInput: unknown
): Promise<void> {
  const input = validate(updateResourceSchema, rawInput);

  if (
    (input.strengthScore !== undefined || input.confidenceScore !== undefined) &&
    !input.evidenceSummary
  ) {
    throw new ServiceError(
      "VALIDATION_ERROR",
      "Resource score change requires evidence summary or human reason"
    );
  }

  const patch: Record<string, unknown> = {};
  if (input.strengthScore !== undefined) patch.strength_score = input.strengthScore;
  if (input.confidenceScore !== undefined) patch.confidence_score = input.confidenceScore;
  if (input.evidenceSummary !== undefined) patch.evidence_summary = input.evidenceSummary;

  await runAtomicRpc<void>(
    client,
    "update_resource",
    {
      p_resource_id: input.id,
      p_patch: patch,
      p_reason: input.evidenceSummary ?? null,
    },
    {
      forbidden: "No write access to this client",
      failure: "Failed to update resource",
      validation: "Resource score change requires evidence summary or human reason",
    }
  );
}
