import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { getEvidence, type EvidenceDrawer, type EvidenceEntityType } from "./evidence";
import { ServiceError } from "./errors";
import { conclusionLimits } from "./model-review-presentation";
import { uuid, validate } from "./validation";

/**
 * Model review read model (ticket 12, SPEC §36).
 *
 * One client-scoped read of the psychological model that the review screen
 * renders: Themes with their Signal links, CoreNodes with their Theme links and
 * several competing DifferentialHypotheses (no automatic winner). For every
 * conclusion the canonical Evidence Trail is reused from `getEvidence` — the
 * same provenance chain the Evidence Drawer shows — so the screen never renders
 * a bare conclusion and never recomputes evidence semantics on its own.
 *
 * Reads are RLS-scoped: an unassigned caller sees no rows at all.
 */

export const modelReviewQuerySchema = z
  .object({
    organizationId: uuid,
    clientId: uuid,
  })
  .strict();

export type ModelReviewQuery = z.infer<typeof modelReviewQuerySchema>;

export interface ReviewSignalLink {
  signalId: string;
  rawStatement: string;
  sourceType: string;
  evidenceLevel: string;
  reviewStatus: string;
  relevanceScore: number | null;
  linkRationale: string | null;
}

export interface ReviewTheme {
  id: string;
  name: string;
  description: string | null;
  domain: string | null;
  reviewStatus: string;
  status: string;
  evidenceCount: number;
  independentEvidenceCount: number;
  createdAt: string | null;
  signalLinks: ReviewSignalLink[];
}

export interface ReviewThemeLink {
  themeId: string;
  themeName: string;
  relationshipType: string;
  confidence: number | null;
  linkRationale: string | null;
}

export interface ReviewCoreNode {
  id: string;
  title: string;
  hypothesis: string | null;
  rootDomain: string | null;
  status: string;
  confidenceScore: number | null;
  evidenceCount: number;
  independentEvidenceCount: number;
  createdAt: string | null;
  lastConfirmedAt: string | null;
  lastConfirmedBy: string | null;
  themeLinks: ReviewThemeLink[];
}

export interface ReviewHypothesis {
  id: string;
  title: string;
  description: string | null;
  status: string;
  confidenceScore: number | null;
  evidenceFor: string[];
  evidenceAgainst: string[];
  createdAt: string | null;
}

export type EvidenceTrailItemKind = "signal" | "reference" | "contradiction";

export interface EvidenceTrailItem {
  id: string;
  kind: EvidenceTrailItemKind;
  /** Main human-readable content: a Signal statement, a contradiction, a ref. */
  label: string;
  sourceType?: string | null;
  evidenceLevel?: string | null;
  reviewStatus?: string | null;
  /** Optional related entity (e.g. the CoreNode a contradiction points at). */
  relatedLabel?: string | null;
}

export interface ReviewEvidenceTrail {
  entityType: EvidenceEntityType;
  entityId: string;
  supporting: EvidenceTrailItem[];
  contradicting: EvidenceTrailItem[];
  limits: string[];
  hasSupportingEvidence: boolean;
  isAiProposed: boolean;
  humanConfirmedAt: string | null;
  humanConfirmedBy: string | null;
  scoreBreakdown: EvidenceDrawer["scoreBreakdown"];
}

export interface ModelReview {
  themes: Array<ReviewTheme & { trail: ReviewEvidenceTrail }>;
  coreNodes: Array<ReviewCoreNode & { trail: ReviewEvidenceTrail }>;
  hypotheses: Array<ReviewHypothesis & { trail: ReviewEvidenceTrail }>;
}

function signalTrailItem(signal: EvidenceDrawer["rawSignals"][number]): EvidenceTrailItem {
  return {
    id: signal.id,
    kind: "signal",
    label: signal.raw_statement,
    sourceType: signal.source_type,
    evidenceLevel: signal.evidence_level,
    reviewStatus: signal.review_status,
  };
}

function themeSignalLinks(themeId: string, rows: Record<string, unknown>[]): ReviewSignalLink[] {
  return rows
    .filter((row) => row.theme_id === themeId)
    .map((row) => {
      const signal = (row.signals ?? {}) as Record<string, unknown>;
      return {
        signalId: String(row.signal_id),
        rawStatement: String(signal.raw_statement ?? ""),
        sourceType: String(signal.source_type ?? ""),
        evidenceLevel: String(signal.evidence_level ?? ""),
        reviewStatus: String(signal.review_status ?? ""),
        relevanceScore: (row.relevance_score as number | null) ?? null,
        linkRationale: (row.link_rationale as string | null) ?? null,
      };
    });
}

function coreNodeThemeLinks(
  coreNodeId: string,
  rows: Record<string, unknown>[],
  themeNames: Map<string, string>
): ReviewThemeLink[] {
  return rows
    .filter((row) => row.core_node_id === coreNodeId)
    .map((row) => {
      const themeId = String(row.theme_id);
      return {
        themeId,
        themeName: themeNames.get(themeId) ?? "Тема недоступна",
        relationshipType: String(row.relationship_type ?? ""),
        confidence: (row.confidence as number | null) ?? null,
        linkRationale: (row.link_rationale as string | null) ?? null,
      };
    });
}

function contradictionItems(
  drawer: EvidenceDrawer,
  relationTitles: Map<string, string>
): EvidenceTrailItem[] {
  return drawer.contradictions.map((contradiction) => ({
    id: contradiction.id,
    kind: "contradiction",
    // For a CoreNode a contradiction is a relation to another node; the drawer
    // exposes the summary and the related node's name adds the context.
    label: contradiction.description ?? relationTitles.get(contradiction.id) ?? contradiction.type,
    relatedLabel: contradiction.description ? (relationTitles.get(contradiction.id) ?? null) : null,
  }));
}

async function trailFor(
  client: SupabaseClient,
  organizationId: string,
  clientId: string,
  entityType: EvidenceEntityType,
  entityId: string,
  options: {
    /** review_status for a theme, status for a core node / hypothesis. */
    state: string;
    supporting?: EvidenceTrailItem[];
    independentEvidenceCount?: number | null;
    hasThemeLinks?: boolean;
    relationTitles?: Map<string, string>;
  }
): Promise<ReviewEvidenceTrail> {
  const drawer = await getEvidence(client, { organizationId, clientId, entityType, entityId });

  const supporting = options.supporting ?? drawer.rawSignals.map(signalTrailItem);
  const contradicting = contradictionItems(drawer, options.relationTitles ?? new Map());

  const limits = conclusionLimits({
    entityType,
    state: options.state,
    supportingCount: supporting.length,
    contradictingCount: contradicting.length,
    independentEvidenceCount: options.independentEvidenceCount,
    hasThemeLinks: options.hasThemeLinks,
  });

  return {
    entityType,
    entityId,
    supporting,
    contradicting,
    limits: limits.limits,
    hasSupportingEvidence: limits.hasSupportingEvidence,
    isAiProposed: drawer.aiRationale?.isAiProposed ?? false,
    humanConfirmedAt: drawer.humanConfirmations?.confirmedAt ?? null,
    humanConfirmedBy: drawer.humanConfirmations?.confirmedBy ?? null,
    scoreBreakdown: drawer.scoreBreakdown,
  };
}

export async function getModelReview(
  client: SupabaseClient,
  rawQuery: unknown
): Promise<ModelReview> {
  const query = validate(modelReviewQuerySchema, rawQuery ?? {});
  const { organizationId, clientId } = query;

  const [themesResult, nodesResult, hypothesesResult, relationsResult] = await Promise.all([
    client
      .from("themes")
      .select(
        "id, name, description, domain, review_status, status, evidence_count, independent_evidence_count, created_at"
      )
      .eq("client_id", clientId)
      .order("created_at", { ascending: true }),
    client
      .from("core_nodes")
      .select(
        "id, title, hypothesis, root_domain, status, confidence_score, evidence_count, independent_evidence_count, created_at, last_confirmed_at, last_confirmed_by"
      )
      .eq("client_id", clientId)
      .order("created_at", { ascending: true }),
    client
      .from("differential_hypotheses")
      .select(
        "id, title, description, status, confidence_score, evidence_for, evidence_against, created_at"
      )
      .eq("client_id", clientId)
      .order("created_at", { ascending: true }),
    client
      .from("core_node_relations")
      .select("id, from_core_node_id, to_core_node_id, relation_type, evidence_summary")
      .eq("client_id", clientId)
      .eq("relation_type", "contradicts"),
  ]);

  for (const result of [themesResult, nodesResult, hypothesesResult, relationsResult]) {
    if (result.error) {
      throw new ServiceError("INTERNAL_ERROR", "Failed to read the client model");
    }
  }

  const allThemeRows = (themesResult.data ?? []) as Record<string, unknown>[];
  const nodeRows = (nodesResult.data ?? []) as Record<string, unknown>[];
  const hypothesisRows = (hypothesesResult.data ?? []) as Record<string, unknown>[];
  const relationRows = (relationsResult.data ?? []) as Record<string, unknown>[];

  const activeThemeRows = allThemeRows.filter((row) => row.status !== "archived");
  const activeNodeRows = nodeRows.filter((row) => row.status !== "archived");
  const activeHypothesisRows = hypothesisRows.filter((row) => row.status !== "archived");

  const themeIds = activeThemeRows.map((row) => String(row.id));
  const nodeIds = activeNodeRows.map((row) => String(row.id));

  const [signalLinksResult, nodeLinksResult] = await Promise.all([
    themeIds.length > 0
      ? client
          .from("signal_theme_links")
          .select(
            "theme_id, signal_id, relevance_score, link_rationale, signals (id, raw_statement, source_type, evidence_level, review_status)"
          )
          .in("theme_id", themeIds)
      : Promise.resolve({ data: [], error: null }),
    nodeIds.length > 0
      ? client
          .from("theme_core_node_links")
          .select("core_node_id, theme_id, relationship_type, confidence, link_rationale")
          .in("core_node_id", nodeIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  for (const result of [signalLinksResult, nodeLinksResult]) {
    if (result.error) {
      throw new ServiceError("INTERNAL_ERROR", "Failed to read the client model links");
    }
  }

  const signalLinkRows = (signalLinksResult.data ?? []) as unknown as Record<string, unknown>[];
  const nodeLinkRows = (nodeLinksResult.data ?? []) as Record<string, unknown>[];

  const themeNames = new Map(allThemeRows.map((row) => [String(row.id), String(row.name)]));
  const nodeTitles = new Map(nodeRows.map((row) => [String(row.id), String(row.title)]));

  // Contradiction relation ids are mapped to "the other node" so the trail can
  // name what a CoreNode contradicts even when the relation has no summary.
  const relationTitles = new Map<string, string>();
  for (const relation of relationRows) {
    const fromId = String(relation.from_core_node_id);
    const toId = String(relation.to_core_node_id);
    const title =
      relation.evidence_summary != null
        ? null
        : `${nodeTitles.get(fromId) ?? "?"} ↔ ${nodeTitles.get(toId) ?? "?"}`;
    if (title) relationTitles.set(String(relation.id), title);
  }

  const themes: ModelReview["themes"] = await Promise.all(
    activeThemeRows.map(async (row) => {
      const id = String(row.id);
      const signalLinks = themeSignalLinks(id, signalLinkRows);
      const supporting = signalLinks.map((link) => ({
        id: link.signalId,
        kind: "signal" as const,
        label: link.rawStatement,
        sourceType: link.sourceType,
        evidenceLevel: link.evidenceLevel,
        reviewStatus: link.reviewStatus,
      }));
      return {
        id,
        name: String(row.name),
        description: (row.description as string | null) ?? null,
        domain: (row.domain as string | null) ?? null,
        reviewStatus: String(row.review_status ?? "pending"),
        status: String(row.status ?? "active"),
        evidenceCount: Number(row.evidence_count ?? 0),
        independentEvidenceCount: Number(row.independent_evidence_count ?? 0),
        createdAt: (row.created_at as string | null) ?? null,
        signalLinks,
        trail: await trailFor(client, organizationId, clientId, "theme", id, {
          state: String(row.review_status ?? "pending"),
          supporting,
          independentEvidenceCount: Number(row.independent_evidence_count ?? 0),
        }),
      };
    })
  );

  const coreNodes: ModelReview["coreNodes"] = await Promise.all(
    activeNodeRows.map(async (row) => {
      const id = String(row.id);
      const themeLinks = coreNodeThemeLinks(id, nodeLinkRows, themeNames);
      return {
        id,
        title: String(row.title),
        hypothesis: (row.hypothesis as string | null) ?? null,
        rootDomain: (row.root_domain as string | null) ?? null,
        status: String(row.status ?? "hypothesis"),
        confidenceScore: (row.confidence_score as number | null) ?? null,
        evidenceCount: Number(row.evidence_count ?? 0),
        independentEvidenceCount: Number(row.independent_evidence_count ?? 0),
        createdAt: (row.created_at as string | null) ?? null,
        lastConfirmedAt: (row.last_confirmed_at as string | null) ?? null,
        lastConfirmedBy: (row.last_confirmed_by as string | null) ?? null,
        themeLinks,
        trail: await trailFor(client, organizationId, clientId, "core_node", id, {
          state: String(row.status ?? "hypothesis"),
          independentEvidenceCount: Number(row.independent_evidence_count ?? 0),
          hasThemeLinks: themeLinks.length > 0,
          relationTitles,
        }),
      };
    })
  );

  const hypotheses: ModelReview["hypotheses"] = await Promise.all(
    activeHypothesisRows.map(async (row) => {
      const id = String(row.id);
      const evidenceFor = ((row.evidence_for ?? []) as string[]) ?? [];
      return {
        id,
        title: String(row.title),
        description: (row.description as string | null) ?? null,
        status: String(row.status ?? "hypothesis"),
        confidenceScore: (row.confidence_score as number | null) ?? null,
        evidenceFor,
        evidenceAgainst: ((row.evidence_against ?? []) as string[]) ?? [],
        createdAt: (row.created_at as string | null) ?? null,
        trail: await trailFor(client, organizationId, clientId, "differential_hypothesis", id, {
          state: String(row.status ?? "hypothesis"),
          supporting: evidenceFor.map((ref, index) => ({
            id: `${id}:for:${index}`,
            kind: "reference" as const,
            label: ref,
          })),
        }),
      };
    })
  );

  return { themes, coreNodes, hypotheses };
}
