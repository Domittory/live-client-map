import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { recordAudit } from "./audit";
import { ServiceError } from "./errors";
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
 * only by an explicit specialist action. Each score change must carry evidence
 * or a human reason.
 */
export async function createResource(
  client: SupabaseClient,
  organizationId: string,
  rawInput: unknown
): Promise<string> {
  const input = validate(createResourceSchema, rawInput);
  const { data, error } = await client
    .from("resources")
    .insert({
      organization_id: organizationId,
      client_id: input.clientId,
      name: input.name,
      description: input.description ?? null,
      domain: input.domain ?? null,
      strength_score: input.strengthScore ?? null,
      confidence_score: input.confidenceScore ?? null,
      evidence_summary: input.evidenceSummary ?? null,
    })
    .select("id")
    .single();
  if (error) {
    if (error.code === "42501")
      throw new ServiceError("FORBIDDEN", "No write access to this client");
    throw new ServiceError("INTERNAL_ERROR", "Failed to create resource");
  }
  await recordAudit(client, {
    organizationId,
    entityType: "resource",
    entityId: data.id,
    action: "resource.created",
    after: { name: input.name },
  });
  return data.id;
}

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

  const { error } = await client.from("resources").update(patch).eq("id", input.id);
  if (error) {
    if (error.code === "42501")
      throw new ServiceError("FORBIDDEN", "No write access to this client");
    throw new ServiceError("INTERNAL_ERROR", "Failed to update resource");
  }
  await recordAudit(client, {
    organizationId,
    entityType: "resource",
    entityId: input.id,
    action: "resource.updated",
    after: patch,
    reason: input.evidenceSummary ?? undefined,
  });
}
