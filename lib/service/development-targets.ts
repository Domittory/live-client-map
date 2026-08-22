import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { recordAudit } from "./audit";
import { ServiceError } from "./errors";
import { uuid, validate } from "./validation";

const levelSchema = z.number().int().min(0).max(100);

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

export async function createDevelopmentTarget(
  client: SupabaseClient,
  organizationId: string,
  rawInput: unknown
): Promise<string> {
  const input = validate(createDevelopmentTargetSchema, rawInput);
  const { data, error } = await client
    .from("development_targets")
    .insert({
      organization_id: organizationId,
      client_id: input.clientId,
      name: input.name,
      description: input.description ?? null,
      domain: input.domain ?? null,
      current_level: input.currentLevel ?? null,
      target_level: input.targetLevel ?? null,
      importance: input.importance ?? "normal",
      linked_resources: input.linkedResources ?? [],
      linked_core_nodes: input.linkedCoreNodes ?? [],
      success_markers: input.successMarkers ?? [],
    })
    .select("id")
    .single();
  if (error) {
    if (error.code === "42501")
      throw new ServiceError("FORBIDDEN", "No write access to this client");
    throw new ServiceError("INTERNAL_ERROR", "Failed to create development target");
  }
  await recordAudit(client, {
    organizationId,
    entityType: "development_target",
    entityId: data.id,
    action: "development_target.created",
    after: { name: input.name },
  });
  return data.id;
}
