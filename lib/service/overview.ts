import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { ServiceError } from "./errors";
import { finalPriorityScore, type ScoreInputs } from "./scoring";
import { uuid, validate } from "./validation";

/**
 * Client Overview read model (ticket 45, SPEC §38). Aggregates the existing
 * model tables into a single specialist-facing screen. The service only reads
 * and never creates a new psychological interpretation; hidden/archived rows
 * are excluded, and "top" items are ranked by the versioned scoring engine
 * (ticket 28) from stored component scores.
 */

export interface OverviewItem {
  id: string;
  [key: string]: unknown;
}

export interface ClientOverview {
  clientId: string;
  activeRequest: OverviewItem | null;
  topCoreNodes: OverviewItem[];
  topResources: OverviewItem[];
  developmentTargets: OverviewItem[];
  recentTriggers: OverviewItem[];
  lastCorrection: OverviewItem | null;
  latestModelChanges: OverviewItem[];
  nextRecommendation: OverviewItem | null;
  pendingReviewCount: number;
}

export const overviewQuerySchema = z
  .object({
    organizationId: uuid,
    clientId: uuid,
  })
  .strict();

export type OverviewQuery = z.infer<typeof overviewQuerySchema>;

const TOP_LIMIT = 5;

/** Map a stored CoreNode row to the deterministic priority score (ticket 28). */
export function coreNodePriorityScore(node: {
  rootness_score: number | null;
  impact_score: number | null;
  activation_score: number | null;
  confidence_score: number | null;
  client_relevance_score: number | null;
  readiness_score: number | null;
  unlock_score: number | null;
  risk_score: number | null;
}): number | null {
  const inputs: ScoreInputs = {
    rootnessScore: node.rootness_score,
    impactScore: node.impact_score,
    activationScore: node.activation_score,
    confidenceScore: node.confidence_score,
    clientRelevanceScore: node.client_relevance_score,
    readinessScore: node.readiness_score,
    unlockScore: node.unlock_score,
    riskScore: node.risk_score,
  };
  return finalPriorityScore(inputs);
}

async function fetchAll(client: SupabaseClient, clientId: string) {
  const [
    requests,
    coreNodes,
    resources,
    targets,
    triggers,
    corrections,
    modelChanges,
    recommendations,
    pendingSignals,
    pendingThemes,
    pendingNodes,
    pendingRecommendations,
  ] = await Promise.all([
    client
      .from("client_requests")
      .select("id, title, priority, status")
      .eq("client_id", clientId)
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(1),
    client
      .from("core_nodes")
      .select(
        "id, title, status, strength_score, confidence_score, impact_score, activation_score, rootness_score, client_relevance_score, readiness_score, unlock_score, risk_score"
      )
      .eq("client_id", clientId)
      .not("status", "in", "(archived,rejected)"),
    client
      .from("resources")
      .select("id, name, strength_score, confidence_score, status")
      .eq("client_id", clientId)
      .eq("status", "active"),
    client
      .from("development_targets")
      .select("id, name, status, current_level, target_level")
      .eq("client_id", clientId)
      .eq("status", "active"),
    client
      .from("triggers")
      .select("id, title, intensity, occurred_at")
      .eq("client_id", clientId)
      .order("occurred_at", { ascending: false, nullsFirst: false })
      .limit(TOP_LIMIT),
    client
      .from("corrections")
      .select("id, title, status, date")
      .eq("client_id", clientId)
      .is("archived_at", null)
      .order("created_at", { ascending: false })
      .limit(1),
    client
      .from("model_changes")
      .select("id, entity_type, entity_id, change_reason, occurred_at")
      .eq("client_id", clientId)
      .order("occurred_at", { ascending: false })
      .limit(TOP_LIMIT),
    client
      .from("recommendations")
      .select("id, proposed_correction, status, final_priority_score, risk_score")
      .eq("client_id", clientId)
      .in("status", ["draft", "approved"])
      .order("final_priority_score", { ascending: false, nullsFirst: false })
      .limit(1),
    client
      .from("signals")
      .select("id", { count: "exact", head: true })
      .eq("client_id", clientId)
      .eq("review_status", "pending"),
    client
      .from("themes")
      .select("id", { count: "exact", head: true })
      .eq("client_id", clientId)
      .eq("review_status", "pending"),
    client
      .from("core_nodes")
      .select("id", { count: "exact", head: true })
      .eq("client_id", clientId)
      .eq("status", "under_review"),
    client
      .from("recommendations")
      .select("id", { count: "exact", head: true })
      .eq("client_id", clientId)
      .eq("status", "draft"),
  ]);

  const all = [
    requests,
    coreNodes,
    resources,
    targets,
    triggers,
    corrections,
    modelChanges,
    recommendations,
    pendingSignals,
    pendingThemes,
    pendingNodes,
    pendingRecommendations,
  ];
  for (const result of all) {
    if (result.error)
      throw new ServiceError("INTERNAL_ERROR", "Failed to assemble client overview");
  }

  return {
    activeRequest: (requests.data ?? [])[0] ?? null,
    coreNodes: coreNodes.data ?? [],
    resources: resources.data ?? [],
    targets: targets.data ?? [],
    triggers: triggers.data ?? [],
    lastCorrection: (corrections.data ?? [])[0] ?? null,
    modelChanges: modelChanges.data ?? [],
    nextRecommendation: (recommendations.data ?? [])[0] ?? null,
    pendingReviewCount:
      (pendingSignals.count ?? 0) +
      (pendingThemes.count ?? 0) +
      (pendingNodes.count ?? 0) +
      (pendingRecommendations.count ?? 0),
  };
}

/** Specialist-facing overview (RLS already scopes to the assigned client). */
export async function getClientOverview(
  client: SupabaseClient,
  rawQuery: unknown
): Promise<ClientOverview> {
  const query = validate(overviewQuerySchema, rawQuery ?? {});
  const data = await fetchAll(client, query.clientId);

  const topCoreNodes = data.coreNodes
    .map((node) => {
      const score = coreNodePriorityScore(node as Parameters<typeof coreNodePriorityScore>[0]);
      return { ...(node as OverviewItem), final_priority_score: score };
    })
    .sort(
      (a, b) =>
        (b.final_priority_score ?? -1) - (a.final_priority_score ?? -1) ||
        (a.id as string).localeCompare(b.id as string)
    )
    .slice(0, TOP_LIMIT);

  const topResources = data.resources
    .map((r) => r as OverviewItem)
    .sort(
      (a, b) =>
        ((b.strength_score as number | null) ?? -1) - ((a.strength_score as number | null) ?? -1) ||
        ((b.confidence_score as number | null) ?? -1) -
          ((a.confidence_score as number | null) ?? -1)
    )
    .slice(0, TOP_LIMIT);

  return {
    clientId: query.clientId,
    activeRequest: data.activeRequest as OverviewItem | null,
    topCoreNodes,
    topResources,
    developmentTargets: data.targets as OverviewItem[],
    recentTriggers: data.triggers as OverviewItem[],
    lastCorrection: data.lastCorrection as OverviewItem | null,
    latestModelChanges: data.modelChanges as OverviewItem[],
    nextRecommendation: data.nextRecommendation as OverviewItem | null,
    pendingReviewCount: data.pendingReviewCount,
  };
}
