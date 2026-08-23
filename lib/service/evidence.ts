import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { ServiceError } from "./errors";
import { scoreBreakdown, type ScoreInputs } from "./scoring";
import { uuid, validate } from "./validation";

/**
 * Evidence Drawer read model (ticket 48, SPEC §40). For a supported entity it
 * returns the full provenance chain — raw signals, contradictions/against,
 * score breakdown, human confirmations and an explicit AI-rationale marker —
 * separated from independent confirmation. Reads are RLS-scoped to the
 * assigned client, so inaccessible sensitive records never appear.
 */

export const EVIDENCE_ENTITY_TYPES = ["core_node", "theme", "differential_hypothesis"] as const;
export type EvidenceEntityType = (typeof EVIDENCE_ENTITY_TYPES)[number];

export interface RawSignal {
  id: string;
  raw_statement: string;
  source_type: string;
  evidence_level: string;
  review_status: string;
  visibility: string;
}

export interface Contradiction {
  id: string;
  type: string;
  description: string | null;
}

export interface EvidenceDrawer {
  entityType: EvidenceEntityType;
  entityId: string;
  label: string;
  rawSignals: RawSignal[];
  contradictions: Contradiction[];
  scoreBreakdown: {
    version: string;
    finalPriorityScore: number | null;
    components: Record<string, number | null>;
  } | null;
  humanConfirmations: { confirmedBy: string | null; confirmedAt: string | null } | null;
  /** AI-rationale marker, kept separate from independent confirmation. */
  aiRationale: { isAiProposed: boolean } | null;
}

export const evidenceQuerySchema = z
  .object({
    organizationId: uuid,
    clientId: uuid,
    entityType: z.enum(EVIDENCE_ENTITY_TYPES),
    entityId: uuid,
  })
  .strict();

export type EvidenceQuery = z.infer<typeof evidenceQuerySchema>;

async function loadCoreNode(
  client: SupabaseClient,
  clientId: string,
  entityId: string
): Promise<EvidenceDrawer> {
  const { data: node, error } = await client
    .from("core_nodes")
    .select(
      "id, title, status, last_confirmed_by, last_confirmed_at, rootness_score, impact_score, activation_score, confidence_score, client_relevance_score, readiness_score, unlock_score, risk_score"
    )
    .eq("id", entityId)
    .eq("client_id", clientId)
    .maybeSingle();
  if (error) throw new ServiceError("INTERNAL_ERROR", "Failed to read core node");
  if (!node) throw new ServiceError("NOT_FOUND", "Core node not found");

  const { data: themeLinks } = await client
    .from("theme_core_node_links")
    .select("theme_id")
    .eq("core_node_id", entityId);
  const themeIds = (themeLinks ?? []).map((l) => l.theme_id);

  let rawSignals: RawSignal[] = [];
  if (themeIds.length > 0) {
    const { data: signalLinks } = await client
      .from("signal_theme_links")
      .select("signal_id")
      .in("theme_id", themeIds);
    const signalIds = (signalLinks ?? []).map((l) => l.signal_id);
    if (signalIds.length > 0) {
      const { data: signals } = await client
        .from("signals")
        .select("id, raw_statement, source_type, evidence_level, review_status, visibility")
        .in("id", signalIds);
      rawSignals = (signals ?? []) as RawSignal[];
    }
  }

  const { data: contradictions } = await client
    .from("core_node_relations")
    .select("id, relation_type, evidence_summary")
    .eq("client_id", clientId)
    .eq("relation_type", "contradicts")
    .or(`from_core_node_id.eq.${entityId},to_core_node_id.eq.${entityId}`);

  const nodeRow = node as Record<string, unknown>;
  const inputs: ScoreInputs = {
    rootnessScore: (nodeRow.rootness_score as number | null) ?? null,
    impactScore: (nodeRow.impact_score as number | null) ?? null,
    activationScore: (nodeRow.activation_score as number | null) ?? null,
    confidenceScore: (nodeRow.confidence_score as number | null) ?? null,
    clientRelevanceScore: (nodeRow.client_relevance_score as number | null) ?? null,
    readinessScore: (nodeRow.readiness_score as number | null) ?? null,
    unlockScore: (nodeRow.unlock_score as number | null) ?? null,
    riskScore: (nodeRow.risk_score as number | null) ?? null,
  };

  return {
    entityType: "core_node",
    entityId,
    label: String(nodeRow.title),
    rawSignals,
    contradictions: ((contradictions ?? []) as Record<string, unknown>[]).map((c) => ({
      id: String(c.id),
      type: String(c.relation_type),
      description: (c.evidence_summary as string | null) ?? null,
    })),
    scoreBreakdown: scoreBreakdown(inputs),
    humanConfirmations:
      nodeRow.last_confirmed_at === null
        ? null
        : {
            confirmedBy: (nodeRow.last_confirmed_by as string | null) ?? null,
            confirmedAt: (nodeRow.last_confirmed_at as string | null) ?? null,
          },
    aiRationale: { isAiProposed: nodeRow.status === "under_review" },
  };
}

async function loadTheme(
  client: SupabaseClient,
  clientId: string,
  entityId: string
): Promise<EvidenceDrawer> {
  const { data: theme, error } = await client
    .from("themes")
    .select("id, name, review_status")
    .eq("id", entityId)
    .eq("client_id", clientId)
    .maybeSingle();
  if (error) throw new ServiceError("INTERNAL_ERROR", "Failed to read theme");
  if (!theme) throw new ServiceError("NOT_FOUND", "Theme not found");

  const { data: signalLinks } = await client
    .from("signal_theme_links")
    .select("signal_id")
    .eq("theme_id", entityId);
  const signalIds = (signalLinks ?? []).map((l) => l.signal_id);
  let rawSignals: RawSignal[] = [];
  if (signalIds.length > 0) {
    const { data: signals } = await client
      .from("signals")
      .select("id, raw_statement, source_type, evidence_level, review_status, visibility")
      .in("id", signalIds);
    rawSignals = (signals ?? []) as RawSignal[];
  }

  return {
    entityType: "theme",
    entityId,
    label: String((theme as Record<string, unknown>).name),
    rawSignals,
    contradictions: [],
    scoreBreakdown: null,
    humanConfirmations: null,
    aiRationale: { isAiProposed: (theme as Record<string, unknown>).review_status === "pending" },
  };
}

async function loadHypothesis(
  client: SupabaseClient,
  clientId: string,
  entityId: string
): Promise<EvidenceDrawer> {
  const { data: hypothesis, error } = await client
    .from("differential_hypotheses")
    .select("id, title, status, confidence_score, evidence_for, evidence_against")
    .eq("id", entityId)
    .eq("client_id", clientId)
    .maybeSingle();
  if (error) throw new ServiceError("INTERNAL_ERROR", "Failed to read hypothesis");
  if (!hypothesis) throw new ServiceError("NOT_FOUND", "Hypothesis not found");

  const row = hypothesis as Record<string, unknown>;
  const evidenceAgainst = (row.evidence_against ?? []) as string[];

  return {
    entityType: "differential_hypothesis",
    entityId,
    label: String(row.title),
    rawSignals: [],
    contradictions: evidenceAgainst.map((ref, i) => ({
      id: `${entityId}:against:${i}`,
      type: "evidence_against",
      description: ref,
    })),
    scoreBreakdown: {
      version: "1.0.0",
      finalPriorityScore: (row.confidence_score as number | null) ?? null,
      components: { confidence: (row.confidence_score as number | null) ?? null },
    },
    humanConfirmations: null,
    aiRationale: { isAiProposed: row.status === "hypothesis" },
  };
}

export async function getEvidence(
  client: SupabaseClient,
  rawQuery: unknown
): Promise<EvidenceDrawer> {
  const query = validate(evidenceQuerySchema, rawQuery ?? {});

  if (query.entityType === "core_node") {
    return loadCoreNode(client, query.clientId, query.entityId);
  }
  if (query.entityType === "theme") {
    return loadTheme(client, query.clientId, query.entityId);
  }
  return loadHypothesis(client, query.clientId, query.entityId);
}
