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

export const RESOURCE_STATUSES = ["active", "archived"] as const;
export const RESOURCE_REVIEW_STATUSES = ["pending", "approved", "rejected"] as const;

/** One row of the client Resources read model (ticket 13). */
export interface ResourceRecord {
  id: string;
  name: string;
  description: string | null;
  domain: string | null;
  strength_score: number | null;
  confidence_score: number | null;
  trend: string | null;
  evidence_summary: string | null;
  evidence_refs: string[];
  review_status: string;
  status: string;
  visibility: string;
  created_at: string;
  updated_at: string;
}

export const clientResourcesQuerySchema = z
  .object({
    organizationId: uuid,
    clientId: uuid,
  })
  .strict();

/**
 * Client-scoped Resource read model for the workspace screen (ticket 13).
 * Reads are RLS-scoped: an unassigned caller sees no rows. The evidence fields
 * (`evidence_summary`, `evidence_refs`) and `review_status` are returned so the
 * screen can render every Resource together with its evidence and its limits —
 * a Resource is never presented as a bare conclusion.
 */
export async function listClientResources(
  client: SupabaseClient,
  rawQuery: unknown
): Promise<ResourceRecord[]> {
  const query = validate(clientResourcesQuerySchema, rawQuery ?? {});

  const { data, error } = await client
    .from("resources")
    .select(
      "id, name, description, domain, strength_score, confidence_score, trend, evidence_summary, evidence_refs, review_status, status, visibility, created_at, updated_at"
    )
    .eq("organization_id", query.organizationId)
    .eq("client_id", query.clientId)
    .order("created_at", { ascending: false });

  if (error) throw new ServiceError("INTERNAL_ERROR", "Failed to list resources");
  return (data ?? []) as ResourceRecord[];
}

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
