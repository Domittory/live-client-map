import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { ServiceError } from "./errors";
import { uuid, validate } from "./validation";

/**
 * Living Map read model (tickets 46–47, SPEC §39). Nodes are the six entity
 * types of SPEC §13/§39; edges come only from saved relations/links. Filters
 * (life area, evidence strength, hide AI-only) and historical mode (a selected
 * snapshot version) are applied read-only — the underlying model is never
 * mutated.
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
  /** Non-empty only for entities that carry life areas (e.g. triggers). */
  lifeAreas: string[];
  /** Evidence count; 0 when the entity has no evidence-count dimension. */
  evidenceStrength: number;
}

export interface GraphEdge {
  id: string;
  from: string;
  to: string;
  type: string;
}

export interface LivingMap {
  clientId: string;
  /** True when the map was built from a historical snapshot, not current data. */
  historical: boolean;
  snapshotVersion: number | null;
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export const livingMapQuerySchema = z
  .object({
    organizationId: uuid,
    clientId: uuid,
    lifeArea: z.string().trim().min(1).max(200).optional(),
    minEvidenceStrength: z.number().int().min(0).max(100).optional(),
    hideAiOnly: z.coerce.boolean().default(false),
    snapshotVersion: z.number().int().min(1).optional(),
  })
  .strict();

export type LivingMapQuery = z.infer<typeof livingMapQuerySchema>;

const NODE_LIMIT = 500;

function node(
  type: GraphNodeType,
  row: Record<string, unknown>,
  isAiOnly: boolean,
  lifeAreas: string[] = [],
  evidenceStrength = 0
): GraphNode {
  return {
    id: String(row.id),
    type,
    label: String(row.title ?? row.name ?? row.id),
    status: String(row.status ?? "active"),
    visibility: String(row.visibility ?? "internal"),
    isAiOnly,
    lifeAreas,
    evidenceStrength,
  };
}

async function buildCurrentNodes(
  client: SupabaseClient,
  clientId: string
): Promise<{ nodes: GraphNode[]; edges: GraphEdge[] }> {
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
      .select("id, title, status, visibility, evidence_count")
      .eq("client_id", clientId)
      .not("status", "in", "(archived,rejected)")
      .limit(NODE_LIMIT),
    client
      .from("themes")
      .select("id, name, status, visibility, review_status")
      .eq("client_id", clientId)
      .eq("status", "active")
      .limit(NODE_LIMIT),
    client
      .from("resources")
      .select("id, name, status, visibility, review_status")
      .eq("client_id", clientId)
      .eq("status", "active")
      .limit(NODE_LIMIT),
    client
      .from("triggers")
      .select("id, title, visibility, life_areas")
      .eq("client_id", clientId)
      .order("occurred_at", { ascending: false, nullsFirst: false })
      .limit(NODE_LIMIT),
    client
      .from("corrections")
      .select("id, title, status")
      .eq("client_id", clientId)
      .is("archived_at", null)
      .limit(NODE_LIMIT),
    client
      .from("development_targets")
      .select("id, name, status, linked_core_nodes, linked_resources")
      .eq("client_id", clientId)
      .eq("status", "active")
      .limit(NODE_LIMIT),
    client
      .from("core_node_relations")
      .select("id, from_core_node_id, to_core_node_id, relation_type")
      .eq("client_id", clientId)
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
    nodes.push(
      node("core_node", row, row.status === "under_review", [], Number(row.evidence_count ?? 0))
    );
  }
  for (const row of (themes.data ?? []) as Record<string, unknown>[]) {
    nodes.push(node("theme", row, row.review_status === "pending"));
  }
  for (const row of (resources.data ?? []) as Record<string, unknown>[]) {
    nodes.push(node("resource", row, row.review_status === "pending"));
  }
  for (const row of (triggers.data ?? []) as Record<string, unknown>[]) {
    nodes.push(node("trigger", row, false, (row.life_areas ?? []) as string[]));
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

  return { nodes, edges };
}

/** Build nodes from a stored snapshot (historical mode). Edges are not stored. */
function snapshotNodes(snapshot: Record<string, unknown>): GraphNode[] {
  const mapping: Array<{ key: string; type: GraphNodeType }> = [
    { key: "active_core_nodes", type: "core_node" },
    { key: "weakened_nodes", type: "core_node" },
    { key: "reactivated_nodes", type: "core_node" },
    { key: "active_themes", type: "theme" },
    { key: "resource_state", type: "resource" },
    { key: "development_targets", type: "development_target" },
    { key: "recent_triggers", type: "trigger" },
    { key: "recent_corrections", type: "correction" },
  ];

  const nodes: GraphNode[] = [];
  for (const { key, type } of mapping) {
    const rows = (snapshot[key] ?? []) as Record<string, unknown>[];
    for (const row of rows) {
      nodes.push(node(type, row, false));
    }
  }
  return nodes;
}

function applyFilters(
  nodes: GraphNode[],
  edges: GraphEdge[],
  query: LivingMapQuery
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  let filtered = nodes;
  let filteredEdges = edges;

  if (query.hideAiOnly) {
    filtered = filtered.filter((n) => !n.isAiOnly);
  }
  if (query.lifeArea) {
    filtered = filtered.filter(
      (n) => n.lifeAreas.length === 0 || n.lifeAreas.includes(query.lifeArea!)
    );
  }
  if (query.minEvidenceStrength !== undefined) {
    filtered = filtered.filter(
      (n) => n.evidenceStrength === 0 || n.evidenceStrength >= query.minEvidenceStrength!
    );
  }

  const kept = new Set(filtered.map((n) => n.id));
  filteredEdges = filteredEdges.filter((e) => kept.has(e.from) && kept.has(e.to));

  return { nodes: filtered, edges: filteredEdges };
}

export async function getLivingMap(client: SupabaseClient, rawQuery: unknown): Promise<LivingMap> {
  const query = validate(livingMapQuerySchema, rawQuery ?? {});

  let nodes: GraphNode[];
  let edges: GraphEdge[];
  let historical = false;

  if (query.snapshotVersion !== undefined) {
    const { data: snapshot, error } = await client
      .from("psychological_snapshots")
      .select("*")
      .eq("client_id", query.clientId)
      .eq("version", query.snapshotVersion)
      .maybeSingle();
    if (error) throw new ServiceError("INTERNAL_ERROR", "Failed to read snapshot");
    if (!snapshot) throw new ServiceError("NOT_FOUND", "Snapshot not found");

    nodes = snapshotNodes(snapshot as Record<string, unknown>);
    edges = [];
    historical = true;
  } else {
    const current = await buildCurrentNodes(client, query.clientId);
    nodes = current.nodes;
    edges = current.edges;
  }

  const filtered = applyFilters(nodes, edges, query);

  return {
    clientId: query.clientId,
    historical,
    snapshotVersion: query.snapshotVersion ?? null,
    nodes: filtered.nodes,
    edges: filtered.edges,
  };
}
