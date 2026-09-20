import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { ServiceError } from "./errors";
import { runAtomicRpc } from "./transaction";
import { uuid, validate } from "./validation";

// Allowed relationship vocabulary (SPEC §8.16). `causes` is intentionally absent;
// `causes_confirmed` is set only via confirmCausalRelation (human confirmation).
export const RELATION_TYPES = [
  "may_contribute_to",
  "reinforces",
  "protects_from",
  "compensates_for",
  "triggers",
  "depends_on",
  "contradicts",
  "unlocks",
  "is_variant_of",
  "associated_with",
  "supports_hypothesis_of",
] as const;

export const createRelationSchema = z
  .object({
    clientId: uuid,
    fromCoreNodeId: uuid,
    toCoreNodeId: uuid,
    relationType: z.enum(RELATION_TYPES),
    strength: z.number().int().min(0).max(100).nullable().optional(),
    confidence: z.number().int().min(0).max(100).nullable().optional(),
    evidenceSummary: z.string().max(2000).nullable().optional(),
  })
  .strict();

export const createActivationSchema = z
  .object({
    triggerId: uuid,
    themeId: uuid.nullable().optional(),
    coreNodeId: uuid.nullable().optional(),
    activationDelta: z.number().int().min(-100).max(100).nullable().optional(),
    confidence: z.number().int().min(0).max(100).nullable().optional(),
    rationale: z.string().max(2000).nullable().optional(),
  })
  .strict();

/**
 * Create a CoreNode relation and its AuditLog row in one transaction. The
 * service path can never produce `causes_confirmed`; that type is reachable only
 * through the explicit human confirmation below.
 */
export async function createRelation(
  client: SupabaseClient,
  organizationId: string,
  rawInput: unknown
): Promise<string> {
  const input = validate(createRelationSchema, rawInput);

  return runAtomicRpc<string>(
    client,
    "create_relation",
    {
      p_org_id: organizationId,
      p_client_id: input.clientId,
      p_from_core_node_id: input.fromCoreNodeId,
      p_to_core_node_id: input.toCoreNodeId,
      p_relation_type: input.relationType,
      p_strength: input.strength ?? null,
      p_confidence: input.confidence ?? null,
      p_evidence_summary: input.evidenceSummary ?? null,
    },
    {
      forbidden: "No write access to this client",
      failure: "Failed to create relation",
      validation: "Relation endpoints must belong to this client",
    }
  );
}

/**
 * Human-confirmed strong causal relation. Requires an explicit reason (SPEC
 * §8.16) — the AI path can never reach causes_confirmed. The type change and its
 * audit row (carrying the reason) commit or roll back together.
 */
export async function confirmCausalRelation(
  client: SupabaseClient,
  organizationId: string,
  relationId: string,
  reason: string
): Promise<void> {
  if (!reason.trim()) {
    throw new ServiceError("VALIDATION_ERROR", "causes_confirmed requires an audit reason");
  }

  await runAtomicRpc<void>(
    client,
    "confirm_causal_relation",
    {
      p_org_id: organizationId,
      p_relation_id: relationId,
      p_reason: reason,
    },
    {
      forbidden: "No write access to this client",
      failure: "Failed to confirm causal relation",
      validation: "causes_confirmed requires an audit reason",
    }
  );
}

export async function createTriggerActivation(
  client: SupabaseClient,
  organizationId: string,
  rawInput: unknown
): Promise<string> {
  const input = validate(createActivationSchema, rawInput);
  const {
    data: { user },
  } = await client.auth.getUser();

  const { data, error } = await client
    .from("trigger_activations")
    .insert({
      trigger_id: input.triggerId,
      theme_id: input.themeId ?? null,
      core_node_id: input.coreNodeId ?? null,
      activation_delta: input.activationDelta ?? null,
      confidence: input.confidence ?? null,
      rationale: input.rationale ?? null,
      created_by: user?.id ?? null,
    })
    .select("id")
    .single();
  if (error) throw new ServiceError("INTERNAL_ERROR", "Failed to create trigger activation");
  return data.id;
}
