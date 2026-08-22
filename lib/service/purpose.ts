import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { recordAudit } from "./audit";
import { ServiceError } from "./errors";
import { uuid, validate } from "./validation";

export const PURPOSE_SOURCE_SYSTEMS = [
  "jyotish",
  "human_design",
  "specialist_assessment",
  "client_self_report",
  "other",
] as const;

export const createPurposeProfileSchema = z
  .object({
    clientId: uuid,
    sourceSystem: z.enum(PURPOSE_SOURCE_SYSTEMS),
    rawData: z.record(z.string(), z.unknown()).optional(),
    interpretation: z.string().max(5000).nullable().optional(),
    strengths: z.array(z.string().max(200)).max(100).optional(),
    potentialRoles: z.array(z.string().max(200)).max(100).optional(),
    developmentDirections: z.array(z.string().max(200)).max(100).optional(),
    confidence: z.number().int().min(0).max(100).nullable().optional(),
    visibility: z.enum(["internal", "sensitive", "client_visible"]).optional(),
  })
  .strict();

export const createSynthesisSchema = z
  .object({
    clientId: uuid,
    summary: z.string().max(10000).nullable().optional(),
    crossSystemMatches: z.array(z.string().max(200)).max(100).optional(),
    potentialConflicts: z.array(z.string().max(200)).max(100).optional(),
    recommendedDevelopmentVectors: z.array(z.string().max(200)).max(100).optional(),
  })
  .strict();

export async function createPurposeProfile(
  client: SupabaseClient,
  organizationId: string,
  rawInput: unknown
): Promise<string> {
  const input = validate(createPurposeProfileSchema, rawInput);
  const { data, error } = await client
    .from("purpose_profiles")
    .insert({
      organization_id: organizationId,
      client_id: input.clientId,
      source_system: input.sourceSystem,
      raw_data: (input.rawData ?? {}) as Record<string, unknown>,
      interpretation: input.interpretation ?? null,
      strengths: input.strengths ?? [],
      potential_roles: input.potentialRoles ?? [],
      development_directions: input.developmentDirections ?? [],
      confidence: input.confidence ?? null,
      visibility: input.visibility ?? "internal",
    })
    .select("id")
    .single();
  if (error) {
    if (error.code === "42501")
      throw new ServiceError("FORBIDDEN", "No write access to this client");
    throw new ServiceError("INTERNAL_ERROR", "Failed to create purpose profile");
  }
  await recordAudit(client, {
    organizationId,
    entityType: "purpose_profile",
    entityId: data.id,
    action: "purpose_profile.created",
    after: { source_system: input.sourceSystem },
  });
  return data.id;
}

export async function createPurposeSynthesis(
  client: SupabaseClient,
  organizationId: string,
  rawInput: unknown
): Promise<string> {
  const input = validate(createSynthesisSchema, rawInput);
  const { data, error } = await client
    .from("purpose_syntheses")
    .insert({
      organization_id: organizationId,
      client_id: input.clientId,
      summary: input.summary ?? null,
      cross_system_matches: input.crossSystemMatches ?? [],
      potential_conflicts: input.potentialConflicts ?? [],
      recommended_development_vectors: input.recommendedDevelopmentVectors ?? [],
    })
    .select("id")
    .single();
  if (error) {
    if (error.code === "42501")
      throw new ServiceError("FORBIDDEN", "No write access to this client");
    throw new ServiceError("INTERNAL_ERROR", "Failed to create purpose synthesis");
  }
  await recordAudit(client, {
    organizationId,
    entityType: "purpose_synthesis",
    entityId: data.id,
    action: "purpose_synthesis.created",
  });
  return data.id;
}
