import type { SupabaseClient } from "@supabase/supabase-js";
import { runAiFunction } from "@/lib/ai/gateway";
import type { AiProvider } from "@/lib/ai/provider";
import { ServiceError } from "./errors";
import { runAtomicRpc } from "./transaction";

interface ClusterProposal {
  action: "create" | "update" | "no_change";
  semantic_topic: string;
  context_key: string;
  signal_ids: string[];
}

interface ThemeProposal {
  action: "create" | "link_existing" | "no_change";
  existing_theme_id: string | null;
  name: string;
  description: string;
  domain: string | null;
  confidence: number | null;
  signal_links: { signal_id: string; relevance_score: number | null; link_rationale: string }[];
}

/**
 * clusterEvidence (ticket 34): AI proposes grouping; deterministic context
 * rules (ticket 22) stay the authority for counts, so AI-created clusters get
 * independent_weight = 1 (never inflated by the model).
 */
export async function clusterEvidence(
  client: SupabaseClient,
  provider: AiProvider,
  input: {
    organizationId: string;
    clientId: string;
    diagnosticSessionId: string;
    signals: unknown[];
    existingClusters: unknown[];
  }
): Promise<string[]> {
  const result = await runAiFunction(client, provider, {
    functionId: "ai.cluster-evidence.v1",
    organizationId: input.organizationId,
    clientId: input.clientId,
    payload: {
      diagnostic_session_id: input.diagnosticSessionId,
      signals: input.signals,
      existing_clusters: input.existingClusters,
    },
  });
  if (!result.ok) throw new ServiceError("INTERNAL_ERROR", result.error);

  const proposals = (result.result?.clusters ?? []) as ClusterProposal[];

  // Only `create` proposals are persisted; the whole batch, its audit row and
  // the deterministic independent_weight = 1 commit in one transaction.
  return runAtomicRpc<string[]>(
    client,
    "create_evidence_clusters",
    {
      p_org_id: input.organizationId,
      p_client_id: input.clientId,
      p_session_id: input.diagnosticSessionId,
      p_clusters: proposals
        .filter((proposal) => proposal.action === "create")
        .map((proposal) => ({
          semantic_topic: proposal.semantic_topic,
          context_key: proposal.context_key,
          signals_count: proposal.signal_ids.length,
        })),
    },
    {
      forbidden: "No write access to this client",
      failure: "Failed to create evidence clusters",
    }
  );
}

/**
 * classifyThemes (ticket 34): AI proposes new pending Themes or links to
 * existing ones, each link carrying rationale and source references.
 */
export async function classifyThemes(
  client: SupabaseClient,
  provider: AiProvider,
  input: {
    organizationId: string;
    clientId: string;
    reviewedSignals: unknown[];
    evidenceClusters: unknown[];
    existingThemes: unknown[];
    currentModelSummary: string;
  }
): Promise<string[]> {
  const result = await runAiFunction(client, provider, {
    functionId: "ai.classify-themes.v1",
    organizationId: input.organizationId,
    clientId: input.clientId,
    payload: {
      reviewed_signals: input.reviewedSignals,
      evidence_clusters: input.evidenceClusters,
      existing_themes: input.existingThemes,
      current_model_summary: input.currentModelSummary,
    },
  });
  if (!result.ok) throw new ServiceError("INTERNAL_ERROR", result.error);

  const proposals = (result.result?.theme_proposals ?? []) as ThemeProposal[];

  // AI themes are created pending and their signal links commit in the same
  // transaction; a failed link rolls the new theme back.
  return runAtomicRpc<string[]>(
    client,
    "apply_ai_theme_proposals",
    {
      p_org_id: input.organizationId,
      p_client_id: input.clientId,
      p_proposals: proposals.map((proposal) => ({
        action: proposal.action,
        existing_theme_id: proposal.existing_theme_id,
        name: proposal.name,
        description: proposal.description,
        domain: proposal.domain,
        confidence: proposal.confidence,
        signal_links: proposal.signal_links,
      })),
    },
    {
      forbidden: "No write access to this client",
      failure: "Failed to persist theme proposals",
    }
  );
}
