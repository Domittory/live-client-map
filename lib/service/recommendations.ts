import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import {
  RISK_REVIEW_THRESHOLD,
  generateRecommendations as generateAiRecommendations,
  type GenerateRecommendationsInput,
  type ScoreCard,
} from "./ai-recommendations";
import type { AiProvider } from "@/lib/ai/provider";
import { getEvidence, type EvidenceDrawer, type EvidenceEntityType } from "./evidence";
import { ServiceError } from "./errors";
import type { EvidenceTrailItem } from "./model-review";
import { conclusionLimits } from "./model-review-presentation";
import type { ScoreInputs } from "./scoring";
import { runAtomicRpc } from "./transaction";
import { uuid, validate } from "./validation";

/**
 * Recommendations read model + human review (ticket 13, SPEC §16/§20/§36).
 *
 * Recommendations are proposed by AI from deterministic score cards
 * (`lib/service/ai-recommendations.ts`, migration 0042) and are persisted as
 * internal `draft` rows. This module never creates a Recommendation itself:
 * it (a) assembles the client context the existing AI service needs,
 * (b) renders an explainable ranking over the stored scores, and
 * (c) reviews / publishes a stored Recommendation through the guarded atomic
 * RPCs of migration 0048.
 *
 * Every Recommendation is returned together with the evidence its targets
 * reference (reusing the canonical Evidence Drawer of `lib/service/evidence.ts`)
 * and the limits of that data — a Recommendation is never a bare conclusion.
 */

export const RECOMMENDATION_STATUSES = ["draft", "approved", "rejected", "archived"] as const;
export const RECOMMENDATION_VISIBILITIES = ["internal", "client_visible"] as const;

export const RECOMMENDATION_REVIEW_ACTIONS = ["approve", "reject"] as const;
export type RecommendationReviewAction = (typeof RECOMMENDATION_REVIEW_ACTIONS)[number];

export type RecommendationTargetKind =
  "core_node" | "theme" | "differential_hypothesis" | "resource" | "development_target";

/** Target kinds that have a canonical evidence trail in the Evidence Drawer. */
const EVIDENCE_TARGET_KINDS: readonly RecommendationTargetKind[] = [
  "core_node",
  "theme",
  "differential_hypothesis",
];

export const recommendationsQuerySchema = z
  .object({
    organizationId: uuid,
    clientId: uuid,
  })
  .strict();

export type RecommendationsQuery = z.infer<typeof recommendationsQuerySchema>;

export interface RecommendationEvidence {
  entityType: EvidenceEntityType;
  entityId: string;
  label: string;
  supporting: EvidenceTrailItem[];
  contradicting: EvidenceTrailItem[];
  limits: string[];
  hasSupportingEvidence: boolean;
  /** True while the referenced conclusion is still an unreviewed AI proposal. */
  isAiProposed: boolean;
}

export interface RecommendationTargetView {
  id: string;
  targetId: string;
  /** Resolved entity kind, or null when the target cannot be found. */
  kind: RecommendationTargetKind | null;
  label: string | null;
  role: string;
  expectedEffect: string | null;
  evidence: RecommendationEvidence | null;
}

export interface RecommendationView {
  id: string;
  proposedCorrection: string;
  rationale: string | null;
  status: string;
  visibility: string;
  humanReviewRequired: boolean;
  riskNotes: string | null;
  missingEvidence: string[];
  rankRationale: string | null;
  scoringModelVersion: string | null;
  scores: ScoreInputs;
  finalPriorityScore: number | null;
  systemicLeverageScore: number | null;
  reviewedAt: string | null;
  reviewedBy: string | null;
  createdAt: string;
  targets: RecommendationTargetView[];
}

export const reviewRecommendationSchema = z
  .object({
    id: uuid,
    decision: z.enum(RECOMMENDATION_REVIEW_ACTIONS),
    reason: z.string().max(2000).nullable().optional(),
  })
  .strict();

export const recommendationVisibilitySchema = z
  .object({
    id: uuid,
    visibility: z.enum(RECOMMENDATION_VISIBILITIES),
    reason: z.string().max(2000).nullable().optional(),
  })
  .strict();

function truncate(value: string, length = 120): string {
  const text = value.trim();
  return text.length > length ? `${text.slice(0, length - 1)}…` : text;
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

interface ResolvedTarget {
  kind: RecommendationTargetKind | null;
  label: string | null;
  /** review_status / status of the referenced entity, used for the limits rule. */
  state: string;
  hasThemeLinks: boolean;
  independentEvidenceCount: number | null;
}

interface TargetRows {
  coreNodes: Record<string, unknown>[];
  themes: Record<string, unknown>[];
  hypotheses: Record<string, unknown>[];
  resources: Record<string, unknown>[];
  developmentTargets: Record<string, unknown>[];
  themeLinkRows: Record<string, unknown>[];
}

async function loadTargetRows(
  client: SupabaseClient,
  clientId: string,
  targetIds: string[]
): Promise<TargetRows> {
  if (targetIds.length === 0) {
    return {
      coreNodes: [],
      themes: [],
      hypotheses: [],
      resources: [],
      developmentTargets: [],
      themeLinkRows: [],
    };
  }

  const [coreNodes, themes, hypotheses, resources, developmentTargets] = await Promise.all([
    client
      .from("core_nodes")
      .select("id, title, status, independent_evidence_count")
      .eq("client_id", clientId)
      .in("id", targetIds),
    client
      .from("themes")
      .select("id, name, review_status, status, independent_evidence_count")
      .eq("client_id", clientId)
      .in("id", targetIds),
    client
      .from("differential_hypotheses")
      .select("id, title, status")
      .eq("client_id", clientId)
      .in("id", targetIds),
    client
      .from("resources")
      .select("id, name, review_status")
      .eq("client_id", clientId)
      .in("id", targetIds),
    client
      .from("development_targets")
      .select("id, name, status")
      .eq("client_id", clientId)
      .in("id", targetIds),
  ]);

  for (const result of [coreNodes, themes, hypotheses, resources, developmentTargets]) {
    if (result.error)
      throw new ServiceError("INTERNAL_ERROR", "Failed to resolve recommendation targets");
  }

  const nodeIds = ((coreNodes.data ?? []) as Record<string, unknown>[]).map((row) =>
    String(row.id)
  );
  const themeLinks =
    nodeIds.length > 0
      ? await client
          .from("theme_core_node_links")
          .select("core_node_id")
          .in("core_node_id", nodeIds)
      : { data: [], error: null };
  if (themeLinks.error) {
    throw new ServiceError("INTERNAL_ERROR", "Failed to resolve recommendation target links");
  }

  return {
    coreNodes: (coreNodes.data ?? []) as Record<string, unknown>[],
    themes: (themes.data ?? []) as Record<string, unknown>[],
    hypotheses: (hypotheses.data ?? []) as Record<string, unknown>[],
    resources: (resources.data ?? []) as Record<string, unknown>[],
    developmentTargets: (developmentTargets.data ?? []) as Record<string, unknown>[],
    themeLinkRows: (themeLinks.data ?? []) as Record<string, unknown>[],
  };
}

function resolveTarget(rows: TargetRows, targetId: string): ResolvedTarget {
  const node = rows.coreNodes.find((row) => row.id === targetId);
  if (node) {
    return {
      kind: "core_node",
      label: String(node.title),
      state: String(node.status ?? "hypothesis"),
      hasThemeLinks: rows.themeLinkRows.some((link) => link.core_node_id === targetId),
      independentEvidenceCount: (node.independent_evidence_count as number | null) ?? null,
    };
  }

  const theme = rows.themes.find((row) => row.id === targetId);
  if (theme) {
    return {
      kind: "theme",
      label: String(theme.name),
      state: String(theme.review_status ?? "pending"),
      hasThemeLinks: true,
      independentEvidenceCount: (theme.independent_evidence_count as number | null) ?? null,
    };
  }

  const hypothesis = rows.hypotheses.find((row) => row.id === targetId);
  if (hypothesis) {
    return {
      kind: "differential_hypothesis",
      label: String(hypothesis.title),
      state: String(hypothesis.status ?? "hypothesis"),
      hasThemeLinks: true,
      independentEvidenceCount: null,
    };
  }

  const resource = rows.resources.find((row) => row.id === targetId);
  if (resource) {
    return {
      kind: "resource",
      label: String(resource.name),
      state: String(resource.review_status ?? "pending"),
      hasThemeLinks: true,
      independentEvidenceCount: null,
    };
  }

  const target = rows.developmentTargets.find((row) => row.id === targetId);
  if (target) {
    return {
      kind: "development_target",
      label: String(target.name),
      state: String(target.status ?? "active"),
      hasThemeLinks: true,
      independentEvidenceCount: null,
    };
  }

  return {
    kind: null,
    label: null,
    state: "unknown",
    hasThemeLinks: false,
    independentEvidenceCount: null,
  };
}

async function evidenceForTarget(
  client: SupabaseClient,
  organizationId: string,
  clientId: string,
  targetId: string,
  resolved: ResolvedTarget
): Promise<RecommendationEvidence | null> {
  if (!resolved.kind || !EVIDENCE_TARGET_KINDS.includes(resolved.kind)) return null;

  const entityType = resolved.kind as EvidenceEntityType;
  let drawer: EvidenceDrawer;
  try {
    drawer = await getEvidence(client, {
      organizationId,
      clientId,
      entityType,
      entityId: targetId,
    });
  } catch (err) {
    // A target that is not readable (or was removed) is a limit, not a crash:
    // the screen still shows the Recommendation and says the evidence is missing.
    if (err instanceof ServiceError && err.code === "NOT_FOUND") return null;
    throw err;
  }

  const supporting = drawer.rawSignals.map(signalTrailItem);
  const contradicting: EvidenceTrailItem[] = drawer.contradictions.map((contradiction) => ({
    id: contradiction.id,
    kind: "contradiction" as const,
    label: contradiction.description ?? contradiction.type,
  }));
  const limits = conclusionLimits({
    entityType,
    state: resolved.state,
    supportingCount: supporting.length,
    contradictingCount: contradicting.length,
    independentEvidenceCount: resolved.independentEvidenceCount,
    hasThemeLinks: resolved.hasThemeLinks,
  });

  return {
    entityType,
    entityId: targetId,
    label: resolved.label ?? truncate(targetId),
    supporting,
    contradicting,
    limits: limits.limits,
    hasSupportingEvidence: limits.hasSupportingEvidence,
    isAiProposed: drawer.aiRationale?.isAiProposed ?? false,
  };
}

/**
 * Client-scoped Recommendation read model for the workspace screen. Includes
 * the full ranking input, the AI's own limits and the evidence trail of every
 * target. Reads are RLS-scoped, so an unassigned caller sees no rows.
 */
export async function getClientRecommendations(
  client: SupabaseClient,
  rawQuery: unknown
): Promise<RecommendationView[]> {
  const query = validate(recommendationsQuerySchema, rawQuery ?? {});

  const { data, error } = await client
    .from("recommendations")
    .select(
      "id, proposed_correction, rationale, status, visibility, human_review_required, risk_notes, missing_evidence, rank_rationale, scoring_model_version, rootness_score, impact_score, activation_score, confidence_score, client_relevance_score, readiness_score, unlock_score, risk_score, systemic_leverage_score, final_priority_score, reviewed_at, reviewed_by, created_at"
    )
    .eq("organization_id", query.organizationId)
    .eq("client_id", query.clientId)
    .order("final_priority_score", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false });

  if (error) throw new ServiceError("INTERNAL_ERROR", "Failed to list recommendations");

  const rows = (data ?? []) as Record<string, unknown>[];
  if (rows.length === 0) return [];

  const recommendationIds = rows.map((row) => String(row.id));
  const { data: targetData, error: targetError } = await client
    .from("recommendation_targets")
    .select("id, recommendation_id, target_type, target_id, role, expected_effect")
    .in("recommendation_id", recommendationIds);
  if (targetError) {
    throw new ServiceError("INTERNAL_ERROR", "Failed to list recommendation targets");
  }

  const targetRows = (targetData ?? []) as Record<string, unknown>[];
  const targetIds = Array.from(new Set(targetRows.map((row) => String(row.target_id))));
  const resolvedRows = await loadTargetRows(client, query.clientId, targetIds);

  const views: RecommendationView[] = [];
  for (const row of rows) {
    const id = String(row.id);
    const targets: RecommendationTargetView[] = [];
    for (const target of targetRows.filter((entry) => entry.recommendation_id === id)) {
      const targetId = String(target.target_id);
      const resolved = resolveTarget(resolvedRows, targetId);
      targets.push({
        id: String(target.id),
        targetId,
        kind: resolved.kind,
        label: resolved.label,
        role: String(target.role ?? ""),
        expectedEffect: (target.expected_effect as string | null) ?? null,
        evidence: await evidenceForTarget(
          client,
          query.organizationId,
          query.clientId,
          targetId,
          resolved
        ),
      });
    }

    views.push({
      id,
      proposedCorrection: String(row.proposed_correction),
      rationale: (row.rationale as string | null) ?? null,
      status: String(row.status ?? "draft"),
      visibility: String(row.visibility ?? "internal"),
      humanReviewRequired: Boolean(row.human_review_required),
      riskNotes: (row.risk_notes as string | null) ?? null,
      missingEvidence: ((row.missing_evidence ?? []) as string[]) ?? [],
      rankRationale: (row.rank_rationale as string | null) ?? null,
      scoringModelVersion: (row.scoring_model_version as string | null) ?? null,
      scores: {
        rootnessScore: (row.rootness_score as number | null) ?? null,
        impactScore: (row.impact_score as number | null) ?? null,
        activationScore: (row.activation_score as number | null) ?? null,
        confidenceScore: (row.confidence_score as number | null) ?? null,
        clientRelevanceScore: (row.client_relevance_score as number | null) ?? null,
        readinessScore: (row.readiness_score as number | null) ?? null,
        unlockScore: (row.unlock_score as number | null) ?? null,
        riskScore: (row.risk_score as number | null) ?? null,
      },
      finalPriorityScore: (row.final_priority_score as number | null) ?? null,
      systemicLeverageScore: (row.systemic_leverage_score as number | null) ?? null,
      reviewedAt: (row.reviewed_at as string | null) ?? null,
      reviewedBy: (row.reviewed_by as string | null) ?? null,
      createdAt: String(row.created_at ?? ""),
      targets,
    });
  }

  return views;
}

/**
 * Assemble the client context the existing `generateRecommendations` service
 * needs. Only human-confirmed entities become evidence: an unreviewed AI
 * proposal (`under_review`, `hypothesis`, `pending`) is never fed back as
 * approved evidence, and a pending Resource is never counted as a strength.
 */
export async function loadRecommendationContext(
  client: SupabaseClient,
  rawQuery: unknown
): Promise<GenerateRecommendationsInput> {
  const query = validate(recommendationsQuerySchema, rawQuery ?? {});

  const [requests, nodes, themes, resources, targets, corrections, methods] = await Promise.all([
    client
      .from("client_requests")
      .select("id, title, description")
      .eq("client_id", query.clientId)
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(1),
    client
      .from("core_nodes")
      .select(
        "id, title, status, rootness_score, impact_score, activation_score, confidence_score, client_relevance_score, readiness_score, unlock_score, risk_score"
      )
      .eq("client_id", query.clientId)
      .not("status", "in", "(archived,rejected,under_review,hypothesis)"),
    client
      .from("themes")
      .select("id, name, review_status, status")
      .eq("client_id", query.clientId)
      .eq("review_status", "approved")
      .neq("status", "archived"),
    client
      .from("resources")
      // Exactly the resource projection of the `ai.generate-recommendations.v1`
      // contract (lib/ai/contracts.ts): the gateway rejects unknown fields, and
      // only human-approved Resources are evidence.
      .select("id, name, domain")
      .eq("client_id", query.clientId)
      .eq("status", "active")
      .eq("review_status", "approved"),
    client
      .from("development_targets")
      .select("id, name, current_level, target_level, importance")
      .eq("client_id", query.clientId)
      .eq("status", "active"),
    client
      .from("corrections")
      .select("id, title, status, date")
      .eq("client_id", query.clientId)
      .is("archived_at", null)
      .order("created_at", { ascending: false })
      .limit(20),
    client.from("intervention_methods").select("id, name").is("archived_at", null).limit(100),
  ]);

  for (const result of [requests, nodes, themes, resources, targets, corrections, methods]) {
    if (result.error) {
      throw new ServiceError("INTERNAL_ERROR", "Failed to assemble recommendation context");
    }
  }

  const nodeRows = (nodes.data ?? []) as Record<string, unknown>[];
  const scoreCards: ScoreCard[] = nodeRows.map((node) => ({
    ref: String(node.id),
    inputs: {
      rootnessScore: (node.rootness_score as number | null) ?? null,
      impactScore: (node.impact_score as number | null) ?? null,
      activationScore: (node.activation_score as number | null) ?? null,
      confidenceScore: (node.confidence_score as number | null) ?? null,
      clientRelevanceScore: (node.client_relevance_score as number | null) ?? null,
      readinessScore: (node.readiness_score as number | null) ?? null,
      unlockScore: (node.unlock_score as number | null) ?? null,
      riskScore: (node.risk_score as number | null) ?? null,
    },
  }));

  const request = ((requests.data ?? []) as Record<string, unknown>[])[0] ?? null;
  const activeRequest = request
    ? [request.title, request.description]
        .filter((part) => typeof part === "string" && part)
        .join("\n")
    : "";

  return {
    organizationId: query.organizationId,
    clientId: query.clientId,
    clientRequestId: request ? String(request.id) : null,
    activeClientRequest: activeRequest,
    approvedEntities: [...((themes.data ?? []) as unknown[]), ...nodeRows],
    resources: (resources.data ?? []) as unknown[],
    developmentTargets: (targets.data ?? []) as unknown[],
    scoreCards,
    risks: nodeRows.filter(
      (node) => ((node.risk_score as number | null) ?? -1) >= RISK_REVIEW_THRESHOLD
    ),
    priorCorrections: (corrections.data ?? []) as unknown[],
    allowedInterventionMethods: ((methods.data ?? []) as Record<string, unknown>[]).map(
      (method) => ({
        id: String(method.id),
        name: String(method.name),
      })
    ),
  };
}

/**
 * Generate AI Recommendations for one client through the existing AI service.
 * The result is always persisted as `draft` / internal (migration 0042), so this
 * call can never publish or approve anything: human review is a separate,
 * explicit action.
 */
export async function generateClientRecommendations(
  client: SupabaseClient,
  provider: AiProvider,
  rawQuery: unknown
): Promise<string[]> {
  const context = await loadRecommendationContext(client, rawQuery);
  return generateAiRecommendations(client, provider, context);
}

/** Explicit human review of one draft Recommendation (migration 0048). */
export async function reviewRecommendation(
  client: SupabaseClient,
  organizationId: string,
  rawInput: unknown
): Promise<void> {
  const input = validate(reviewRecommendationSchema, rawInput);

  const reason = input.reason?.trim() ? input.reason.trim() : null;
  if (input.decision === "reject" && !reason) {
    throw new ServiceError("VALIDATION_ERROR", "Rejecting a recommendation requires a reason");
  }

  await runAtomicRpc<void>(
    client,
    "review_recommendation",
    {
      p_org_id: organizationId,
      p_recommendation_id: input.id,
      p_decision: input.decision,
      p_reason: reason,
    },
    {
      forbidden: "No write access to this client",
      failure: "Failed to review recommendation",
      validation: "Rejecting a recommendation requires a reason",
      conflict: "Recommendation was already reviewed",
    }
  );
}

/**
 * Specialist control over the client-visible (published) projection of one
 * Recommendation (migration 0048). Publishing an unreviewed or high-risk
 * Recommendation is refused in the database, not only in the UI.
 */
export async function setRecommendationVisibility(
  client: SupabaseClient,
  organizationId: string,
  rawInput: unknown
): Promise<void> {
  const input = validate(recommendationVisibilitySchema, rawInput);

  await runAtomicRpc<void>(
    client,
    "set_recommendation_visibility",
    {
      p_org_id: organizationId,
      p_recommendation_id: input.id,
      p_visibility: input.visibility,
      p_reason: input.reason?.trim() ? input.reason.trim() : null,
    },
    {
      forbidden: "No write access to this client",
      failure: "Failed to change recommendation visibility",
      validation:
        "Recommendation can only be published after human approval and when not high-risk",
    }
  );
}
