import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { recordAudit } from "./audit";
import { ServiceError } from "./errors";
import { uuid, validate } from "./validation";

export const createCoreNodeSchema = z
  .object({
    clientId: uuid,
    title: z.string().trim().min(1).max(200),
    hypothesis: z.string().max(5000).nullable().optional(),
    rootDomain: z.string().max(200).nullable().optional(),
    confidenceScore: z.number().int().min(0).max(100).nullable().optional(),
  })
  .strict();

export const linkThemeSchema = z
  .object({
    coreNodeId: uuid,
    themeId: uuid,
    relationshipType: z.string().trim().min(1).max(100),
    confidence: z.number().int().min(0).max(100).nullable().optional(),
    linkRationale: z.string().max(2000).nullable().optional(),
  })
  .strict();

export async function createCoreNode(
  client: SupabaseClient,
  organizationId: string,
  rawInput: unknown
): Promise<string> {
  const input = validate(createCoreNodeSchema, rawInput);
  const {
    data: { user },
  } = await client.auth.getUser();

  const { data, error } = await client
    .from("core_nodes")
    .insert({
      organization_id: organizationId,
      client_id: input.clientId,
      title: input.title,
      hypothesis: input.hypothesis ?? null,
      root_domain: input.rootDomain ?? null,
      confidence_score: input.confidenceScore ?? null,
      created_by: user?.id ?? null,
      status: "hypothesis",
    })
    .select("id")
    .single();
  if (error) {
    if (error.code === "42501")
      throw new ServiceError("FORBIDDEN", "No write access to this client");
    throw new ServiceError("INTERNAL_ERROR", "Failed to create core node");
  }
  await recordAudit(client, {
    organizationId,
    entityType: "core_node",
    entityId: data.id,
    action: "core_node.created",
    after: { title: input.title },
  });
  return data.id;
}

export async function linkTheme(
  client: SupabaseClient,
  organizationId: string,
  rawInput: unknown
): Promise<void> {
  const input = validate(linkThemeSchema, rawInput);
  const {
    data: { user },
  } = await client.auth.getUser();

  const { error } = await client.from("theme_core_node_links").insert({
    theme_id: input.themeId,
    core_node_id: input.coreNodeId,
    relationship_type: input.relationshipType,
    confidence: input.confidence ?? null,
    link_rationale: input.linkRationale ?? null,
    created_by: user?.id ?? null,
  });
  if (error) throw new ServiceError("INTERNAL_ERROR", "Failed to link theme");

  await recordAudit(client, {
    organizationId,
    entityType: "theme_core_node_link",
    entityId: input.coreNodeId,
    action: "core_node.theme_linked",
    after: { theme_id: input.themeId, relationship_type: input.relationshipType },
  });
}

async function setStatus(
  client: SupabaseClient,
  organizationId: string,
  nodeId: string,
  status: string,
  extra: Record<string, unknown> = {}
): Promise<void> {
  const { data: current } = await client
    .from("core_nodes")
    .select("status")
    .eq("id", nodeId)
    .maybeSingle();
  if (!current) throw new ServiceError("NOT_FOUND", "Core node not found");

  const { error } = await client
    .from("core_nodes")
    .update({ status, ...extra })
    .eq("id", nodeId);
  if (error) {
    if (error.code === "42501")
      throw new ServiceError("FORBIDDEN", "No write access to this client");
    throw new ServiceError("INTERNAL_ERROR", "Failed to update core node status");
  }
  await recordAudit(client, {
    organizationId,
    entityType: "core_node",
    entityId: nodeId,
    action: `core_node.${status}`,
    after: { status },
  });
}

/** Human confirmation: hypothesis → active. */
export async function confirmCoreNode(
  client: SupabaseClient,
  organizationId: string,
  nodeId: string
): Promise<void> {
  const {
    data: { user },
  } = await client.auth.getUser();
  await setStatus(client, organizationId, nodeId, "active", {
    last_confirmed_by: user?.id ?? null,
    last_confirmed_at: new Date().toISOString(),
  });
}

export async function rejectCoreNode(
  client: SupabaseClient,
  organizationId: string,
  nodeId: string
): Promise<void> {
  await setStatus(client, organizationId, nodeId, "rejected");
}

/** Soft delete: archived nodes are preserved in history, not destroyed. */
export async function archiveCoreNode(
  client: SupabaseClient,
  organizationId: string,
  nodeId: string
): Promise<void> {
  await setStatus(client, organizationId, nodeId, "archived", {
    archived_at: new Date().toISOString(),
  });
}
