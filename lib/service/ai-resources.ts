import type { SupabaseClient } from "@supabase/supabase-js";
import { runAiFunction } from "@/lib/ai/gateway";
import type { AiProvider } from "@/lib/ai/provider";
import { ServiceError } from "./errors";
import { runAtomicRpc } from "./transaction";

/**
 * updateResources (ticket 36): AI proposes new or updated Resources from
 * independently confirmable evidence. Resource development is kept separate
 * from problem reduction — weakening a CoreNode never creates or strengthens a
 * Resource (SPEC §8.18). Every proposal is persisted with
 * review_status = "pending" until a human approves/rejects it.
 */

interface ResourceProposal {
  action: "create" | "update" | "link_existing" | "no_change";
  existing_resource_id: string | null;
  name: string;
  description: string;
  domain: string | null;
  proposed_strength: number | null;
  proposed_confidence: number | null;
  proposed_trend: "strengthening" | "stable" | "weakening" | "unknown";
  evidence_refs: string[];
  rationale: string;
}

export interface UpdateResourcesInput {
  organizationId: string;
  clientId: string;
  existingResources: unknown[];
  positiveEvidence: unknown[];
  observations: unknown[];
  behavioralMarkers: unknown[];
  coreNodeChanges: unknown[];
  existingLinks: unknown[];
}

export async function updateResources(
  client: SupabaseClient,
  provider: AiProvider,
  input: UpdateResourcesInput
): Promise<string[]> {
  const result = await runAiFunction(client, provider, {
    functionId: "ai.update-resources.v1",
    organizationId: input.organizationId,
    clientId: input.clientId,
    payload: {
      existing_resources: input.existingResources,
      positive_evidence: input.positiveEvidence,
      observations: input.observations,
      behavioral_markers: input.behavioralMarkers,
      core_node_changes: input.coreNodeChanges,
      existing_links: input.existingLinks,
    },
  });
  if (!result.ok) throw new ServiceError("INTERNAL_ERROR", result.error);

  const proposals = (result.result?.resource_proposals ?? []) as ResourceProposal[];

  // The whole proposal batch (new/updated Resources, merged evidence refs and
  // the audit row) commits in one transaction. AI-created Resources stay
  // pending review and only a resource of this client is ever touched.
  return runAtomicRpc<string[]>(
    client,
    "apply_ai_resource_proposals",
    {
      p_org_id: input.organizationId,
      p_client_id: input.clientId,
      p_proposals: proposals.map((proposal) => ({
        action: proposal.action,
        existing_resource_id: proposal.existing_resource_id,
        name: proposal.name,
        description: proposal.description,
        domain: proposal.domain,
        proposed_strength: proposal.proposed_strength,
        proposed_confidence: proposal.proposed_confidence,
        proposed_trend: proposal.proposed_trend,
        evidence_refs: proposal.evidence_refs,
        rationale: proposal.rationale,
      })),
    },
    {
      forbidden: "No write access to this client",
      failure: "Failed to persist resource proposals",
    }
  );
}
