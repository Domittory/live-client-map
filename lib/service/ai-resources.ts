import type { SupabaseClient } from "@supabase/supabase-js";
import { runAiFunction } from "@/lib/ai/gateway";
import type { AiProvider } from "@/lib/ai/provider";
import { recordAudit } from "./audit";
import { ServiceError } from "./errors";

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

function mergeRefs(current: string[] | null, incoming: string[]): string[] {
  const seen = new Set(current ?? []);
  for (const ref of incoming) seen.add(ref);
  return [...seen];
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
  const touchedIds: string[] = [];

  for (const proposal of proposals) {
    if (proposal.action === "no_change") continue;

    if (proposal.action === "create") {
      const { data, error } = await client
        .from("resources")
        .insert({
          organization_id: input.organizationId,
          client_id: input.clientId,
          name: proposal.name,
          description: proposal.description || null,
          domain: proposal.domain,
          strength_score: proposal.proposed_strength,
          confidence_score: proposal.proposed_confidence,
          trend: proposal.proposed_trend,
          evidence_refs: proposal.evidence_refs,
          evidence_summary: proposal.rationale,
          review_status: "pending",
        })
        .select("id")
        .single();
      if (error) throw new ServiceError("INTERNAL_ERROR", "Failed to create resource proposal");
      touchedIds.push(data.id);
      continue;
    }

    // update / link_existing: only touch a resource that belongs to this client.
    const targetId = proposal.existing_resource_id;
    if (!targetId) continue;

    const { data: existing } = await client
      .from("resources")
      .select("evidence_refs")
      .eq("id", targetId)
      .eq("client_id", input.clientId)
      .maybeSingle();
    if (!existing) continue; // cross-tenant or missing — ignore, never side effects

    if (proposal.action === "link_existing") {
      const merged = mergeRefs(existing.evidence_refs, proposal.evidence_refs);
      const { error } = await client
        .from("resources")
        .update({ evidence_refs: merged, review_status: "pending" })
        .eq("id", targetId);
      if (error) throw new ServiceError("INTERNAL_ERROR", "Failed to link evidence to resource");
      touchedIds.push(targetId);
      continue;
    }

    const { error } = await client
      .from("resources")
      .update({
        strength_score: proposal.proposed_strength,
        confidence_score: proposal.proposed_confidence,
        trend: proposal.proposed_trend,
        evidence_refs: proposal.evidence_refs,
        review_status: "pending",
      })
      .eq("id", targetId);
    if (error) throw new ServiceError("INTERNAL_ERROR", "Failed to update resource proposal");
    touchedIds.push(targetId);
  }

  await recordAudit(client, {
    organizationId: input.organizationId,
    entityType: "client",
    entityId: input.clientId,
    action: "ai.update_resources",
    after: { proposed_resources: touchedIds.length },
  });

  return touchedIds;
}
