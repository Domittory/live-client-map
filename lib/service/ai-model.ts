import type { SupabaseClient } from "@supabase/supabase-js";
import { runAiFunction } from "@/lib/ai/gateway";
import type { AiProvider } from "@/lib/ai/provider";
import { recordAudit } from "./audit";
import { ServiceError } from "./errors";
import { confidenceWithContradictions } from "./hypotheses";

/**
 * AI model layer (ticket 35): updateCoreNodes, generateDifferentialHypotheses
 * and detectContradictions as three independent functions (never a mega-prompt).
 * Every proposal is persisted as an unconfirmed mutation:
 *   - CoreNode → status "under_review" (pending human review).
 *   - DifferentialHypothesis → status "hypothesis".
 * A confirmed CoreNode (active or beyond) is never silently overwritten — the
 * AI path may only propose, the human confirms (SPEC §3.4, §36).
 */

/** Post-hypothesis, human-confirmed lifecycle states (ticket 25). */
const CONFIRMED_CORE_NODE_STATUSES = new Set([
  "active",
  "in_treatment",
  "treated_unverified",
  "weakened",
  "integrated",
  "reactivated",
  "contradicted",
]);

interface CoreNodeProposal {
  action: "create" | "update" | "no_change";
  existing_core_node_id: string | null;
  title: string;
  hypothesis: string;
  root_domain: string | null;
  proposed_status: string;
  theme_links: string[];
  evidence_refs: string[];
  contradictions_considered: string[];
  confidence: number | null;
  rationale: string;
}

interface HypothesisProposal {
  title: string;
  description: string;
  confidence: number | null;
  evidence_for_refs: string[];
  evidence_against_refs: string[];
  missing_evidence: string[];
  disconfirming_questions: string[];
  rationale: string;
}

interface ContradictionProposal {
  entity_refs_for: string[];
  entity_refs_against: string[];
  description: string;
  relevance_score: number | null;
  context_refs: string[];
  rationale: string;
  suggested_follow_up: string;
}

export interface UpdateCoreNodesInput {
  organizationId: string;
  clientId: string;
  approvedThemes: unknown[];
  themeLinks: unknown[];
  existingCoreNodes: unknown[];
  contradictions: unknown[];
  deterministicScoreInputs: unknown;
  currentClientRequestSummary: string;
}

export interface GenerateHypothesesInput {
  organizationId: string;
  clientId: string;
  focalEntityRefs: string[];
  evidenceFor: string[];
  evidenceAgainst: string[];
  contextSummary: string;
  existingHypotheses: unknown[];
}

export interface DetectContradictionsInput {
  organizationId: string;
  clientId: string;
  reviewedSignals: unknown[];
  themes: unknown[];
  coreNodes: unknown[];
  differentialHypotheses: unknown[];
  existingContradictions: unknown[];
  relevantContexts: string[];
}

/**
 * updateCoreNodes: AI proposes new CoreNodes or updates to unconfirmed ones.
 * Counts/scores are never inflated by the model — new nodes get default counts
 * (0) and only the AI-proposed confidence (L0), never evidence/rootness.
 */
export async function updateCoreNodes(
  client: SupabaseClient,
  provider: AiProvider,
  input: UpdateCoreNodesInput
): Promise<string[]> {
  const result = await runAiFunction(client, provider, {
    functionId: "ai.update-core-nodes.v1",
    organizationId: input.organizationId,
    clientId: input.clientId,
    payload: {
      approved_themes: input.approvedThemes,
      theme_links: input.themeLinks,
      existing_core_nodes: input.existingCoreNodes,
      contradictions: input.contradictions,
      deterministic_score_inputs: input.deterministicScoreInputs,
      current_client_request_summary: input.currentClientRequestSummary,
    },
  });
  if (!result.ok) throw new ServiceError("INTERNAL_ERROR", result.error);

  const proposals = (result.result?.core_node_proposals ?? []) as CoreNodeProposal[];
  const {
    data: { user },
  } = await client.auth.getUser();
  const touchedIds: string[] = [];

  for (const proposal of proposals) {
    if (proposal.action === "no_change") continue;

    if (proposal.action === "create") {
      const { data, error } = await client
        .from("core_nodes")
        .insert({
          organization_id: input.organizationId,
          client_id: input.clientId,
          title: proposal.title,
          hypothesis: proposal.hypothesis,
          root_domain: proposal.root_domain,
          confidence_score: proposal.confidence,
          status: "under_review",
          created_by: user?.id ?? null,
        })
        .select("id")
        .single();
      if (error) throw new ServiceError("INTERNAL_ERROR", "Failed to create core node proposal");

      const nodeId = data.id;
      touchedIds.push(nodeId);
      await linkThemes(client, nodeId, proposal.theme_links, proposal.rationale);
      continue;
    }

    // action === "update": never overwrite a confirmed node (SPEC §3.4).
    const targetId = proposal.existing_core_node_id;
    if (!targetId) continue;

    const { data: existing } = await client
      .from("core_nodes")
      .select("status")
      .eq("id", targetId)
      .eq("client_id", input.clientId)
      .maybeSingle();
    if (!existing) continue; // cross-tenant or missing — ignore, never create side effects
    if (CONFIRMED_CORE_NODE_STATUSES.has(existing.status)) continue; // human approval required

    const { error } = await client
      .from("core_nodes")
      .update({
        title: proposal.title,
        hypothesis: proposal.hypothesis,
        root_domain: proposal.root_domain,
        confidence_score: proposal.confidence,
        status: "under_review",
      })
      .eq("id", targetId);
    if (error) throw new ServiceError("INTERNAL_ERROR", "Failed to update core node proposal");
    touchedIds.push(targetId);
  }

  await recordAudit(client, {
    organizationId: input.organizationId,
    entityType: "client",
    entityId: input.clientId,
    action: "ai.update_core_nodes",
    after: { proposed_core_nodes: touchedIds.length },
  });

  return touchedIds;
}

async function linkThemes(
  client: SupabaseClient,
  coreNodeId: string,
  themeIds: string[],
  rationale: string
): Promise<void> {
  for (const themeId of themeIds) {
    const { error } = await client.from("theme_core_node_links").insert({
      theme_id: themeId,
      core_node_id: coreNodeId,
      relationship_type: "supports",
      link_rationale: rationale || null,
    });
    if (error) throw new ServiceError("INTERNAL_ERROR", "Failed to link theme to core node");
  }
}

/**
 * generateDifferentialHypotheses: multiple competing explanations coexist
 * without an automatic winner (SPEC §32, §55). Contradicting evidence lowers
 * confidence deterministically (SPEC §51.4), so an AI hypothesis never
 * confirms itself.
 */
export async function generateDifferentialHypotheses(
  client: SupabaseClient,
  provider: AiProvider,
  input: GenerateHypothesesInput
): Promise<string[]> {
  const result = await runAiFunction(client, provider, {
    functionId: "ai.generate-differential-hypotheses.v1",
    organizationId: input.organizationId,
    clientId: input.clientId,
    payload: {
      focal_entity_refs: input.focalEntityRefs,
      evidence_for: input.evidenceFor,
      evidence_against: input.evidenceAgainst,
      context_summary: input.contextSummary,
      existing_hypotheses: input.existingHypotheses,
    },
  });
  if (!result.ok) throw new ServiceError("INTERNAL_ERROR", result.error);

  const proposals = (result.result?.hypotheses ?? []) as HypothesisProposal[];
  const {
    data: { user },
  } = await client.auth.getUser();
  const createdIds: string[] = [];

  for (const proposal of proposals) {
    const confidence = confidenceWithContradictions(
      proposal.confidence ?? 0,
      proposal.evidence_against_refs.length
    );

    const { data, error } = await client
      .from("differential_hypotheses")
      .insert({
        organization_id: input.organizationId,
        client_id: input.clientId,
        title: proposal.title,
        description: proposal.description,
        confidence_score: confidence,
        status: "hypothesis",
        evidence_for: proposal.evidence_for_refs,
        evidence_against: proposal.evidence_against_refs,
        created_by: user?.id ?? null,
      })
      .select("id")
      .single();
    if (error) throw new ServiceError("INTERNAL_ERROR", "Failed to create hypothesis proposal");
    createdIds.push(data.id);
  }

  await recordAudit(client, {
    organizationId: input.organizationId,
    entityType: "client",
    entityId: input.clientId,
    action: "ai.generate_differential_hypotheses",
    after: { proposed_hypotheses: createdIds.length },
  });

  return createdIds;
}

/**
 * detectContradictions: representation contradictions between two CoreNodes are
 * persisted as cautious `contradicts` relations (never `causes` — SPEC §8.16).
 * Contradictions referencing non-core-node entities are advisory only.
 */
export async function detectContradictions(
  client: SupabaseClient,
  provider: AiProvider,
  input: DetectContradictionsInput
): Promise<string[]> {
  const result = await runAiFunction(client, provider, {
    functionId: "ai.detect-contradictions.v1",
    organizationId: input.organizationId,
    clientId: input.clientId,
    payload: {
      reviewed_signals: input.reviewedSignals,
      themes: input.themes,
      core_nodes: input.coreNodes,
      differential_hypotheses: input.differentialHypotheses,
      existing_contradictions: input.existingContradictions,
      relevant_contexts: input.relevantContexts,
    },
  });
  if (!result.ok) throw new ServiceError("INTERNAL_ERROR", result.error);

  const contradictions = (result.result?.contradictions ?? []) as ContradictionProposal[];
  const {
    data: { user },
  } = await client.auth.getUser();
  const relationIds: string[] = [];

  for (const contradiction of contradictions) {
    const fromId = contradiction.entity_refs_for[0];
    const toId = contradiction.entity_refs_against[0];
    if (!fromId || !toId) continue;

    // Only core-node pairs map to a `contradicts` relation; validate ownership
    // so a proposal can never create a cross-tenant link.
    const { data: nodes } = await client
      .from("core_nodes")
      .select("id")
      .in("id", [fromId, toId])
      .eq("client_id", input.clientId);
    if (!nodes || nodes.length !== 2) continue;

    const { data, error } = await client
      .from("core_node_relations")
      .insert({
        organization_id: input.organizationId,
        client_id: input.clientId,
        from_core_node_id: fromId,
        to_core_node_id: toId,
        relation_type: "contradicts",
        confidence: contradiction.relevance_score,
        evidence_summary: contradiction.description,
        created_by: user?.id ?? null,
      })
      .select("id")
      .single();
    if (error) throw new ServiceError("INTERNAL_ERROR", "Failed to persist contradiction");
    relationIds.push(data.id);
  }

  await recordAudit(client, {
    organizationId: input.organizationId,
    entityType: "client",
    entityId: input.clientId,
    action: "ai.detect_contradictions",
    after: { contradiction_relations: relationIds.length },
  });

  return relationIds;
}
