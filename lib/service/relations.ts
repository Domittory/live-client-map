import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { recordAudit } from "./audit";
import { ServiceError } from "./errors";
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

export async function createRelation(
  client: SupabaseClient,
  organizationId: string,
  rawInput: unknown
): Promise<string> {
  const input = validate(createRelationSchema, rawInput);
  const {
    data: { user },
  } = await client.auth.getUser();

  const { data, error } = await client
    .from("core_node_relations")
    .insert({
      organization_id: organizationId,
      client_id: input.clientId,
      from_core_node_id: input.fromCoreNodeId,
      to_core_node_id: input.toCoreNodeId,
      relation_type: input.relationType,
      strength: input.strength ?? null,
      confidence: input.confidence ?? null,
      evidence_summary: input.evidenceSummary ?? null,
      created_by: user?.id ?? null,
    })
    .select("id")
    .single();
  if (error) {
    if (error.code === "42501")
      throw new ServiceError("FORBIDDEN", "No write access to this client");
    throw new ServiceError("INTERNAL_ERROR", "Failed to create relation");
  }
  await recordAudit(client, {
    organizationId,
    entityType: "core_node_relation",
    entityId: data.id,
    action: "relation.created",
    after: { relation_type: input.relationType },
  });
  return data.id;
}

/**
 * Human-confirmed strong causal relation. Requires an explicit reason (SPEC
 * §8.16) — the AI path can never reach causes_confirmed.
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
  const { error } = await client
    .from("core_node_relations")
    .update({ relation_type: "causes_confirmed" })
    .eq("id", relationId);
  if (error) throw new ServiceError("INTERNAL_ERROR", "Failed to confirm causal relation");

  await recordAudit(client, {
    organizationId,
    entityType: "core_node_relation",
    entityId: relationId,
    action: "relation.causes_confirmed",
    after: { relation_type: "causes_confirmed" },
    reason,
  });
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
