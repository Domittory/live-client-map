import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { ServiceError } from "./errors";
import { runAtomicRpc } from "./transaction";
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

export interface CoreNode {
  id: string;
  organization_id: string;
  client_id: string;
  title: string;
  hypothesis: string | null;
  root_domain: string | null;
  strength_score: number | null;
  confidence_score: number | null;
  impact_score: number | null;
  activation_score: number | null;
  rootness_score: number | null;
  client_relevance_score: number | null;
  readiness_score: number | null;
  unlock_score: number | null;
  risk_score: number | null;
  evidence_count: number;
  independent_evidence_count: number;
  contexts_count: number;
  status: string;
  trend: string | null;
  visibility: string;
  created_by: string | null;
  last_confirmed_by: string | null;
  created_at: string;
  updated_at: string;
  last_confirmed_at: string | null;
  archived_at: string | null;
}

/** Read one core node (RLS-enforced). */
export async function getCoreNode(client: SupabaseClient, nodeId: string): Promise<CoreNode> {
  const { data, error } = await client
    .from("core_nodes")
    .select("*")
    .eq("id", validate(uuid, nodeId))
    .maybeSingle();
  if (error) throw new ServiceError("INTERNAL_ERROR", "Failed to read core node");
  if (!data) throw new ServiceError("NOT_FOUND", "Core node not found");
  return data as CoreNode;
}

export const coreNodeOptionsQuerySchema = z
  .object({
    organizationId: uuid,
    clientId: uuid,
  })
  .strict();

export interface CoreNodeOption {
  id: string;
  title: string;
  status: string;
}

/**
 * Linkable CoreNode options for a client-scoped form (ticket 13 read model).
 * Archived and rejected nodes are excluded: a DevelopmentTarget is never linked
 * to a conclusion a human already dismissed. Reads are RLS-scoped.
 */
export async function listLinkableCoreNodes(
  client: SupabaseClient,
  rawQuery: unknown
): Promise<CoreNodeOption[]> {
  const query = validate(coreNodeOptionsQuerySchema, rawQuery ?? {});

  const { data, error } = await client
    .from("core_nodes")
    .select("id, title, status")
    .eq("organization_id", query.organizationId)
    .eq("client_id", query.clientId)
    .not("status", "in", "(archived,rejected)")
    .order("created_at", { ascending: true });

  if (error) throw new ServiceError("INTERNAL_ERROR", "Failed to list core node options");
  return (data ?? []) as CoreNodeOption[];
}

/**
 * Create a CoreNode as a working hypothesis (never a confirmed entity) and its
 * AuditLog row in one transaction.
 */
export async function createCoreNode(
  client: SupabaseClient,
  organizationId: string,
  rawInput: unknown
): Promise<string> {
  const input = validate(createCoreNodeSchema, rawInput);

  return runAtomicRpc<string>(
    client,
    "create_core_node",
    {
      p_org_id: organizationId,
      p_client_id: input.clientId,
      p_title: input.title,
      p_hypothesis: input.hypothesis ?? null,
      p_root_domain: input.rootDomain ?? null,
      p_confidence_score: input.confidenceScore ?? null,
    },
    {
      forbidden: "No write access to this client",
      failure: "Failed to create core node",
    }
  );
}

/** Link a Theme to a CoreNode; the link and its audit row commit together. */
export async function linkTheme(
  client: SupabaseClient,
  organizationId: string,
  rawInput: unknown
): Promise<void> {
  const input = validate(linkThemeSchema, rawInput);

  await runAtomicRpc<void>(
    client,
    "link_theme_core_node",
    {
      p_org_id: organizationId,
      p_core_node_id: input.coreNodeId,
      p_theme_id: input.themeId,
      p_relationship_type: input.relationshipType,
      p_confidence: input.confidence ?? null,
      p_link_rationale: input.linkRationale ?? null,
    },
    {
      forbidden: "No write access to this client",
      failure: "Failed to link theme",
    }
  );
}

async function setStatus(
  client: SupabaseClient,
  organizationId: string,
  nodeId: string,
  status: string,
  flags: { confirm?: boolean; archive?: boolean } = {}
): Promise<void> {
  await runAtomicRpc<void>(
    client,
    "set_core_node_status",
    {
      p_org_id: organizationId,
      p_node_id: nodeId,
      p_status: status,
      p_mark_confirmed: flags.confirm ?? false,
      p_mark_archived: flags.archive ?? false,
    },
    {
      forbidden: "No write access to this client",
      failure: "Failed to update core node status",
    }
  );
}

/** Human confirmation: hypothesis → active. */
export async function confirmCoreNode(
  client: SupabaseClient,
  organizationId: string,
  nodeId: string
): Promise<void> {
  await setStatus(client, organizationId, nodeId, "active", { confirm: true });
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
  await setStatus(client, organizationId, nodeId, "archived", { archive: true });
}
