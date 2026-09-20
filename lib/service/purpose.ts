import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { ServiceError } from "./errors";
import { runAtomicRpc } from "./transaction";
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

  return runAtomicRpc<string>(
    client,
    "create_purpose_profile",
    {
      p_org_id: organizationId,
      p_client_id: input.clientId,
      p_payload: {
        source_system: input.sourceSystem,
        raw_data: (input.rawData ?? {}) as Record<string, unknown>,
        interpretation: input.interpretation ?? null,
        strengths: input.strengths ?? [],
        potential_roles: input.potentialRoles ?? [],
        development_directions: input.developmentDirections ?? [],
        confidence: input.confidence ?? null,
        visibility: input.visibility ?? "internal",
      },
    },
    {
      forbidden: "No write access to this client",
      failure: "Failed to create purpose profile",
    }
  );
}

export async function createPurposeSynthesis(
  client: SupabaseClient,
  organizationId: string,
  rawInput: unknown
): Promise<string> {
  const input = validate(createSynthesisSchema, rawInput);

  return runAtomicRpc<string>(
    client,
    "create_purpose_synthesis",
    {
      p_org_id: organizationId,
      p_client_id: input.clientId,
      p_payload: {
        summary: input.summary ?? null,
        cross_system_matches: input.crossSystemMatches ?? [],
        potential_conflicts: input.potentialConflicts ?? [],
        recommended_development_vectors: input.recommendedDevelopmentVectors ?? [],
      },
    },
    {
      forbidden: "No write access to this client",
      failure: "Failed to create purpose synthesis",
    }
  );
}

/** One stored PurposeProfile row (ticket 13 read model). */
export interface PurposeProfileRecord {
  id: string;
  source_system: string;
  raw_data: Record<string, unknown>;
  interpretation: string | null;
  strengths: string[];
  potential_roles: string[];
  development_directions: string[];
  confidence: number | null;
  visibility: string;
  created_at: string;
  updated_at: string;
}

/** One stored PurposeSynthesis row (ticket 13 read model). */
export interface PurposeSynthesisRecord {
  id: string;
  summary: string | null;
  cross_system_matches: string[];
  potential_conflicts: string[];
  recommended_development_vectors: string[];
  created_at: string;
  updated_at: string;
}

export const clientPurposeQuerySchema = z
  .object({
    organizationId: uuid,
    clientId: uuid,
  })
  .strict();

export interface ClientPurpose {
  profiles: PurposeProfileRecord[];
  syntheses: PurposeSynthesisRecord[];
}

/**
 * Client-scoped Purpose read model (ticket 13, SPEC §8.20/§8.21).
 *
 * The purpose layer has no automatic detection algorithm: this read model only
 * returns the profiles and syntheses a specialist stored manually, so the screen
 * can never present derived meaning as if it had been computed. Reads are
 * RLS-scoped; an unassigned caller sees no rows.
 */
export async function getClientPurpose(
  client: SupabaseClient,
  rawQuery: unknown
): Promise<ClientPurpose> {
  const query = validate(clientPurposeQuerySchema, rawQuery ?? {});

  const [profiles, syntheses] = await Promise.all([
    client
      .from("purpose_profiles")
      .select(
        "id, source_system, raw_data, interpretation, strengths, potential_roles, development_directions, confidence, visibility, created_at, updated_at"
      )
      .eq("organization_id", query.organizationId)
      .eq("client_id", query.clientId)
      .order("created_at", { ascending: false }),
    client
      .from("purpose_syntheses")
      .select(
        "id, summary, cross_system_matches, potential_conflicts, recommended_development_vectors, created_at, updated_at"
      )
      .eq("organization_id", query.organizationId)
      .eq("client_id", query.clientId)
      .order("created_at", { ascending: false }),
  ]);

  if (profiles.error || syntheses.error) {
    throw new ServiceError("INTERNAL_ERROR", "Failed to read the purpose layer");
  }

  return {
    profiles: (profiles.data ?? []) as PurposeProfileRecord[],
    syntheses: (syntheses.data ?? []) as PurposeSynthesisRecord[],
  };
}
