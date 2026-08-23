import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { ServiceError } from "./errors";
import { uuid, validate } from "./validation";

/**
 * Living Map read model (ticket 46, SPEC §39). Nodes are the six entity types
 * of SPEC §13/§39; edges come only from saved relations/links — the UI never
 * recomputes graph semantics on its own. Assignment scoping and row visibility
 * are enforced by RLS on each underlying table; pending/AI-only nodes are
 * flagged so the UI can hide them.
 */

export const GRAPH_NODE_TYPES = [
  "core_node",
  "theme",
  "resource",
  "trigger",
  "correction",
  "development_target",
] as const;

export type GraphNodeType = (typeof GRAPH_NODE_TYPES)[number];

export interface GraphNode {
  id: string;
  type: GraphNodeType;
  label: string;
  status: string;
  visibility: string;
  isAiOnly: boolean;
}

export interface GraphEdge {
  id: string;
  from: string;
  to: string;
  type: string;
}

export interface LivingMap {
  clientId: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export const livingMapQuerySchema = z
  .object({
    organizationId: uuid,
    clientId: uuid,
  })
  .strict();

export type LivingMapQuery = z.infer<typeof livingMapQuerySchema>;

const NODE_LIMIT = 500;

function node(type: GraphNodeType, row: Record<string, unknown>, isAiOnly: boolean): GraphNode {
  return {
    id: String(row.id),
    type,
    label: String(row.title ?? row.name ?? row.id),
    status: String(row.status ?? "active"),
    visibility: String(row.visibility ?? "internal"),
    isAiOnly,
  };
}

export async function getLivingMap(client: SupabaseClient, rawQuery: unknown): Promise<LivingMap> {
  const query = validate(livingMapQuerySchema, rawQuery ?? {});

  const [
    coreNodes,
    themes,
    resources,
    triggers,
    corrections,
    targets,
    relations,
    themeLinks,
    correctionTargets,
  ] = await Promise.all([
    client
      .from("core_nodes")
      .select("id, title, status, visibility")
      .eq("client_id", query.clientId)
      .not("status", "in", "(archived,rejected)")
      .limit(NODE_LIMIT),
    client
      .from("themes")
      .select("id, name, status, visibility, review_status")
      .eq("client_id", query.clientId)
      .eq("status", "active")
      .limit(NODE_LIMIT),
    client
      .from("resources")
      .select("id, name, status, visibility, review_status")
      .eq("client_id", query.clientId)
      .eq("status", "active")
      .limit(NODE_LIMIT),
    client
      .from("triggers")
      .select("id, title, visibility")
      .eq("client_id", query.clientId)
      .order("occurred_at", { ascending: false, nullsFirst: false })
      .limit(NODE_LIMIT),
    client
      .from("corrections")
      .select("id, title, status")
      .eq("client_id", query.clientId)
      .is("archived_at", null)
      .limit(NODE_LIMIT),
    client
      .from("development_targets")
      .select("id, name, status, linked_core_nodes, linked_resources")
      .eq("client_id", query.clientId)
      .eq("status", "active")
      .limit(NODE_LIMIT),
    client
      .from("core_node_relations")
      .select("id, from_core_node_id, to_core_node_id, relation_type")
      .eq("client_id", query.clientId)
      .limit(NODE_LIMIT),
    client
      .from("theme_core_node_links")
      .select("id, theme_id, core_node_id, relationship_type")
      .limit(NODE_LIMIT),
    client
      .from("correction_targets")
      .select("id, correction_id, target_type, target_id, role")
      .in("target_type", ["core_node", "theme", "resource", "development_target"])
      .limit(NODE_LIMIT),
  ]);

  const results = [
    coreNodes,
    themes,
    resources,
    triggers,
    corrections,
    targets,
    relations,
    themeLinks,
    correctionTargets,
  ];
  for (const result of results) {
    if (result.error) throw new ServiceError("INTERNAL_ERROR", "Failed to assemble living map");
  }

  const nodes: GraphNode[] = [];
  for (const row of (coreNodes.data ?? []) as Record<string, unknown>[]) {
    nodes.push(node("core_node", row, row.status === "under_review"));
  }
  for (const row of (themes.data ?? []) as Record<string, unknown>[]) {
    nodes.push(node("theme", row, row.review_status === "pending"));
  }
  for (const row of (resources.data ?? []) as Record<string, unknown>[]) {
    nodes.push(node("resource", row, row.review_status === "pending"));
  }
  for (const row of (triggers.data ?? []) as Record<string, unknown>[]) {
    nodes.push(node("trigger", row, false));
  }
  for (const row of (corrections.data ?? []) as Record<string, unknown>[]) {
    nodes.push(node("correction", row, false));
  }
  for (const row of (targets.data ?? []) as Record<string, unknown>[]) {
    nodes.push(node("development_target", row, false));
  }

  const nodeIds = new Set(nodes.map((n) => n.id));
  const edges: GraphEdge[] = [];

  for (const rel of (relations.data ?? []) as Record<string, unknown>[]) {
    const from = String(rel.from_core_node_id);
    const to = String(rel.to_core_node_id);
    if (!nodeIds.has(from) || !nodeIds.has(to)) continue;
    edges.push({
      id: `${from}:${to}:${rel.relation_type}`,
      from,
      to,
      type: String(rel.relation_type),
    });
  }

  for (const link of (themeLinks.data ?? []) as Record<string, unknown>[]) {
    const from = String(link.theme_id);
    const to = String(link.core_node_id);
    if (!nodeIds.has(from) || !nodeIds.has(to)) continue;
    edges.push({
      id: `${from}:${to}:${link.relationship_type ?? "linked"}`,
      from,
      to,
      type: String(link.relationship_type ?? "linked"),
    });
  }

  for (const target of (correctionTargets.data ?? []) as Record<string, unknown>[]) {
    const from = String(target.correction_id);
    const to = String(target.target_id);
    if (!nodeIds.has(from) || !nodeIds.has(to)) continue;
    edges.push({ id: `${from}:${to}:${target.role}`, from, to, type: String(target.role) });
  }

  for (const target of (targets.data ?? []) as Record<string, unknown>[]) {
    const from = String(target.id);
    for (const linkedId of (target.linked_core_nodes ?? []) as string[]) {
      if (nodeIds.has(linkedId)) {
        edges.push({
          id: `${from}:${linkedId}:linked_core_node`,
          from,
          to: linkedId,
          type: "linked_core_node",
        });
      }
    }
    for (const linkedId of (target.linked_resources ?? []) as string[]) {
      if (nodeIds.has(linkedId)) {
        edges.push({
          id: `${from}:${linkedId}:linked_resource`,
          from,
          to: linkedId,
          type: "linked_resource",
        });
      }
    }
  }

  return { clientId: query.clientId, nodes, edges };
}
