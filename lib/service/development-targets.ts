import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { ServiceError } from "./errors";
import { runAtomicRpc } from "./transaction";
import { uuid, validate } from "./validation";

const levelSchema = z.number().int().min(0).max(100);

export const DEVELOPMENT_TARGET_IMPORTANCE = ["low", "normal", "high"] as const;
export const DEVELOPMENT_TARGET_STATUSES = ["active", "achieved", "archived"] as const;

export const createDevelopmentTargetSchema = z
  .object({
    clientId: uuid,
    name: z.string().trim().min(1).max(200),
    description: z.string().max(5000).nullable().optional(),
    domain: z.string().max(200).nullable().optional(),
    currentLevel: levelSchema.nullable().optional(),
    targetLevel: levelSchema.nullable().optional(),
    importance: z.enum(["low", "normal", "high"]).optional(),
    linkedResources: z.array(uuid).max(100).optional(),
    linkedCoreNodes: z.array(uuid).max(100).optional(),
    successMarkers: z.array(z.string().max(200)).max(100).optional(),
  })
  .strict();

/** The target row and its AuditLog entry commit or roll back together. */
export async function createDevelopmentTarget(
  client: SupabaseClient,
  organizationId: string,
  rawInput: unknown
): Promise<string> {
  const input = validate(createDevelopmentTargetSchema, rawInput);

  return runAtomicRpc<string>(
    client,
    "create_development_target",
    {
      p_org_id: organizationId,
      p_client_id: input.clientId,
      p_payload: {
        name: input.name,
        description: input.description ?? null,
        domain: input.domain ?? null,
        current_level: input.currentLevel ?? null,
        target_level: input.targetLevel ?? null,
        importance: input.importance ?? "normal",
        linked_resources: input.linkedResources ?? [],
        linked_core_nodes: input.linkedCoreNodes ?? [],
        success_markers: input.successMarkers ?? [],
      },
    },
    {
      forbidden: "No write access to this client",
      failure: "Failed to create development target",
    }
  );
}

export const updateDevelopmentTargetSchema = z
  .object({
    id: uuid,
    name: z.string().trim().min(1).max(200).optional(),
    description: z.string().max(5000).nullable().optional(),
    domain: z.string().max(200).nullable().optional(),
    currentLevel: levelSchema.nullable().optional(),
    targetLevel: levelSchema.nullable().optional(),
    importance: z.enum(DEVELOPMENT_TARGET_IMPORTANCE).optional(),
    status: z.enum(DEVELOPMENT_TARGET_STATUSES).optional(),
    linkedResources: z.array(uuid).max(100).optional(),
    linkedCoreNodes: z.array(uuid).max(100).optional(),
    successMarkers: z.array(z.string().max(200)).max(100).optional(),
    reason: z.string().max(2000).nullable().optional(),
  })
  .strict();

/**
 * Update one DevelopmentTarget (ticket 13). The target and its audit row commit
 * in one transaction; a progress or lifecycle change must carry a human reason,
 * exactly like a Resource score change (SPEC §8.18/§8.19 keep the positive layer
 * evidence-driven).
 */
export async function updateDevelopmentTarget(
  client: SupabaseClient,
  organizationId: string,
  rawInput: unknown
): Promise<void> {
  const input = validate(updateDevelopmentTargetSchema, rawInput);

  const patch: Record<string, unknown> = {};
  if (input.name !== undefined) patch.name = input.name;
  if (input.description !== undefined) patch.description = input.description;
  if (input.domain !== undefined) patch.domain = input.domain;
  if (input.currentLevel !== undefined) patch.current_level = input.currentLevel;
  if (input.targetLevel !== undefined) patch.target_level = input.targetLevel;
  if (input.importance !== undefined) patch.importance = input.importance;
  if (input.status !== undefined) patch.status = input.status;
  if (input.linkedResources !== undefined) patch.linked_resources = input.linkedResources;
  if (input.linkedCoreNodes !== undefined) patch.linked_core_nodes = input.linkedCoreNodes;
  if (input.successMarkers !== undefined) patch.success_markers = input.successMarkers;

  const reason = input.reason ?? null;
  const changesProgress =
    input.currentLevel !== undefined ||
    input.targetLevel !== undefined ||
    input.status !== undefined;
  if (changesProgress && !reason) {
    throw new ServiceError(
      "VALIDATION_ERROR",
      "Development target level or status change requires a human reason"
    );
  }

  await runAtomicRpc<void>(
    client,
    "update_development_target",
    { p_org_id: organizationId, p_target_id: input.id, p_patch: patch, p_reason: reason },
    {
      forbidden: "No write access to this client",
      failure: "Failed to update development target",
      validation: "Development target level or status change requires a human reason",
      conflict: "Development target was already changed",
    }
  );
}

/** One row of the client DevelopmentTarget read model (ticket 13). */
export interface DevelopmentTargetRecord {
  id: string;
  name: string;
  description: string | null;
  domain: string | null;
  current_level: number | null;
  target_level: number | null;
  importance: string;
  status: string;
  linked_resources: string[];
  linked_core_nodes: string[];
  success_markers: string[];
  created_at: string;
  updated_at: string;
}

export const clientDevelopmentTargetsQuerySchema = z
  .object({
    organizationId: uuid,
    clientId: uuid,
  })
  .strict();

/** Client-scoped DevelopmentTarget read model; RLS hides foreign clients. */
export async function listDevelopmentTargets(
  client: SupabaseClient,
  rawQuery: unknown
): Promise<DevelopmentTargetRecord[]> {
  const query = validate(clientDevelopmentTargetsQuerySchema, rawQuery ?? {});

  const { data, error } = await client
    .from("development_targets")
    .select(
      "id, name, description, domain, current_level, target_level, importance, status, linked_resources, linked_core_nodes, success_markers, created_at, updated_at"
    )
    .eq("organization_id", query.organizationId)
    .eq("client_id", query.clientId)
    .order("created_at", { ascending: false });

  if (error) throw new ServiceError("INTERNAL_ERROR", "Failed to list development targets");
  return (data ?? []) as DevelopmentTargetRecord[];
}
