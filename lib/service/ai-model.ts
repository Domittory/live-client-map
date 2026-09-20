import type { SupabaseClient } from "@supabase/supabase-js";
import { runAiFunction } from "@/lib/ai/gateway";
import type { AiProvider } from "@/lib/ai/provider";
import { ServiceError } from "./errors";
import { confidenceWithContradictions } from "./hypotheses";
import { runAtomicRpc } from "./transaction";

/**
 * AI model layer (ticket 35): updateCoreNodes, generateDifferentialHypotheses
 * and detectContradictions as three independent functions (never a mega-prompt).
 * Every proposal is persisted as an unconfirmed mutation:
 *   - CoreNode → status "under_review" (pending human review).
 *   - DifferentialHypothesis → status "hypothesis".
 * A confirmed CoreNode (active or beyond) is never silently overwritten — the
 * AI path may only propose, the human confirms (SPEC §3.4, §36).
 *
 * Each batch, its child theme links and the AuditLog row are written by one
 * atomic RPC, so a partially persisted AI proposal set can no longer exist.
 */

/** Post-hypothesis, human-confirmed lifecycle states (ticket 25). */

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

  // The whole proposal batch (new pending nodes, their theme links and the
  // audit row) is written by one atomic RPC. The RPC also enforces that a
  // confirmed CoreNode is never overwritten.
  return runAtomicRpc<string[]>(
    client,
    "apply_ai_core_node_proposals",
    {
      p_org_id: input.organizationId,
      p_client_id: input.clientId,
      p_proposals: proposals.map((proposal) => ({
        action: proposal.action,
        existing_core_node_id: proposal.existing_core_node_id,
        title: proposal.title,
        hypothesis: proposal.hypothesis,
        root_domain: proposal.root_domain,
        confidence: proposal.confidence,
        theme_links: proposal.theme_links,
        rationale: proposal.rationale,
      })),
    },
    {
      forbidden: "No write access to this client",
      failure: "Failed to persist core node proposals",
    }
  );
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

  // The whole hypothesis batch and its audit row commit or roll back together.
  return runAtomicRpc<string[]>(
    client,
    "create_ai_hypotheses",
    {
      p_org_id: input.organizationId,
      p_client_id: input.clientId,
      p_hypotheses: proposals.map((proposal) => ({
        title: proposal.title,
        description: proposal.description,
        confidence: confidenceWithContradictions(
          proposal.confidence ?? 0,
          proposal.evidence_against_refs.length
        ),
        evidence_for: proposal.evidence_for_refs,
        evidence_against: proposal.evidence_against_refs,
      })),
    },
    {
      forbidden: "No write access to this client",
      failure: "Failed to persist hypothesis proposals",
    }
  );
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

  // Cautious `contradicts` relations and the audit row commit together; the RPC
  // validates endpoint ownership so a proposal can never create a cross-tenant
  // link.
  return runAtomicRpc<string[]>(
    client,
    "create_ai_contradiction_relations",
    {
      p_org_id: input.organizationId,
      p_client_id: input.clientId,
      p_items: contradictions
        .map((contradiction) => ({
          from_core_node_id: contradiction.entity_refs_for[0] ?? null,
          to_core_node_id: contradiction.entity_refs_against[0] ?? null,
          confidence: contradiction.relevance_score,
          evidence_summary: contradiction.description,
        }))
        .filter((item) => item.from_core_node_id && item.to_core_node_id),
    },
    {
      forbidden: "No write access to this client",
      failure: "Failed to persist contradictions",
    }
  );
}
