import type { SupabaseClient } from "@supabase/supabase-js";
import { runAiFunction } from "@/lib/ai/gateway";
import type { AiProvider } from "@/lib/ai/provider";
import { recordAudit } from "./audit";
import { ServiceError } from "./errors";

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
  const createdIds: string[] = [];

  for (const proposal of proposals) {
    if (proposal.action !== "create") continue;
    const { data, error } = await client
      .from("evidence_clusters")
      .insert({
        organization_id: input.organizationId,
        client_id: input.clientId,
        diagnostic_session_id: input.diagnosticSessionId,
        semantic_topic: proposal.semantic_topic,
        context_key: proposal.context_key,
        signals_count: proposal.signal_ids.length,
        independent_weight: 1,
      })
      .select("id")
      .single();
    if (error) throw new ServiceError("INTERNAL_ERROR", "Failed to create evidence cluster");
    createdIds.push(data.id);
  }

  await recordAudit(client, {
    organizationId: input.organizationId,
    entityType: "diagnostic_session",
    entityId: input.diagnosticSessionId,
    action: "ai.cluster_evidence",
    after: { created_clusters: createdIds.length },
  });

  return createdIds;
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
  const themeIds: string[] = [];

  for (const proposal of proposals) {
    if (proposal.action === "no_change") continue;

    let themeId = proposal.existing_theme_id;
    if (proposal.action === "create") {
      const { data, error } = await client
        .from("themes")
        .insert({
          organization_id: input.organizationId,
          client_id: input.clientId,
          name: proposal.name,
          description: proposal.description,
          domain: proposal.domain,
          confidence_score: proposal.confidence,
          review_status: "pending",
        })
        .select("id")
        .single();
      if (error) throw new ServiceError("INTERNAL_ERROR", "Failed to create theme proposal");
      themeId = data.id;
      themeIds.push(themeId);
    }

    if (!themeId) continue;
    for (const link of proposal.signal_links) {
      const { error } = await client.from("signal_theme_links").insert({
        signal_id: link.signal_id,
        theme_id: themeId,
        relevance_score: link.relevance_score,
        link_rationale: link.link_rationale,
      });
      if (error) throw new ServiceError("INTERNAL_ERROR", "Failed to link signal to theme");
    }
  }

  await recordAudit(client, {
    organizationId: input.organizationId,
    entityType: "client",
    entityId: input.clientId,
    action: "ai.classify_themes",
    after: { proposed_themes: themeIds.length },
  });

  return themeIds;
}
