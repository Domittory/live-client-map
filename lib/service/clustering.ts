import type { EvidenceLevel } from "./signal-interpretation";

export interface ContextDimensions {
  lifeArea?: string;
  relationshipRole?: string;
  triggerType?: string;
  timePeriod?: string;
  environment?: string;
  diagnosticSessionId?: string;
}

/**
 * Canonical context representation (SPEC §8.10). Signals sharing a context key
 * are NOT independent evidence; different context keys may be independent.
 */
export function canonicalContextKey(ctx: ContextDimensions): string {
  return [
    ctx.lifeArea ?? "",
    ctx.relationshipRole ?? "",
    ctx.triggerType ?? "",
    ctx.timePeriod ?? "",
    ctx.environment ?? "",
    ctx.diagnosticSessionId ?? "",
  ].join("|");
}

export interface ClusterInput {
  semanticTopic: string;
  contextKey: string;
}

export interface ClusterSummary {
  semanticTopic: string;
  signalsCount: number;
  independentContextsCount: number;
}

/**
 * Deterministic clustering baseline: group Signals by semantic topic and count
 * signals separately from independent contexts. Twenty synonymous Signals in one
 * session collapse to one independent context (SPEC §53).
 */
export function clusterByTopicAndContext(items: ClusterInput[]): ClusterSummary[] {
  const groups = new Map<string, { count: number; contexts: Set<string> }>();
  for (const item of items) {
    let group = groups.get(item.semanticTopic);
    if (!group) {
      group = { count: 0, contexts: new Set() };
      groups.set(item.semanticTopic, group);
    }
    group.count += 1;
    group.contexts.add(item.contextKey);
  }
  return [...groups.entries()].map(([topic, group]) => ({
    semanticTopic: topic,
    signalsCount: group.count,
    independentContextsCount: group.contexts.size,
  }));
}

/**
 * Evidence level derived from a cluster (SPEC §11, §53, §54). Genuinely
 * independent contexts raise to L3; more signals in a single context only reach
 * L2 — a large volume of similar Signals never inflates independence.
 */
export function evidenceLevelFromCluster(
  signalsCount: number,
  independentContextsCount: number
): EvidenceLevel {
  if (independentContextsCount >= 2) return "L3_MULTI_CONTEXT";
  if (signalsCount >= 2) return "L2_MULTIPLE_SIGNALS";
  return "L1_SINGLE_SIGNAL";
}
