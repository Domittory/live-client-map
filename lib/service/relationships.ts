import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { ServiceError } from "./errors";
import { runAtomicRpc } from "./transaction";
import { score, uuid, validate } from "./validation";

/**
 * Relationship layer (ticket 50 → atomic since ticket 21): two clients of the
 * SAME organization linked by a Relationship; RelationshipDynamics hold
 * cross-client analysis.
 *
 * Both mutations run inside one SECURITY DEFINER RPC (migration 0053). Inside
 * that transaction the actor is resolved from `auth.uid()`, write access to
 * BOTH clients is asserted, active `relationship_analysis` consent for both is
 * re-checked, the row is written and the AuditLog entry is appended — so a
 * revocation that lands while the call is in flight cannot be raced, and a
 * committed relationship always has its audit trail.
 *
 * Private evidence (signals that are not `client_visible`) may not be cited:
 * `create_relationship_dynamic` refuses the write instead of silently storing a
 * private reference. The read view keeps a filter as well, because rows written
 * before this migration may still carry one.
 */

const RELATIONSHIP_CONSENT = "relationship_analysis" as const;

export const createRelationshipSchema = z
  .object({
    organizationId: uuid,
    clientAId: uuid,
    clientBId: uuid,
    relationshipType: z.string().trim().min(1).max(100),
  })
  .strict();

export const createRelationshipDynamicSchema = z
  .object({
    organizationId: uuid,
    relationshipId: uuid,
    title: z.string().trim().min(1).max(200),
    description: z.string().max(5000).nullable().optional(),
    confidenceScore: score.nullable().optional(),
    evidenceRefs: z.array(uuid).max(100).optional(),
    visibility: z.enum(["internal", "sensitive", "client_visible"]).optional(),
  })
  .strict();

export async function createRelationship(
  client: SupabaseClient,
  rawInput: unknown
): Promise<string> {
  const input = validate(createRelationshipSchema, rawInput);
  if (input.clientAId === input.clientBId) {
    throw new ServiceError("VALIDATION_ERROR", "Relationship requires two distinct clients");
  }

  return runAtomicRpc<string>(
    client,
    "create_relationship",
    {
      p_org_id: input.organizationId,
      p_client_a_id: input.clientAId,
      p_client_b_id: input.clientBId,
      p_relationship_type: input.relationshipType,
    },
    {
      forbidden: "No access to relationship clients",
      failure: "Failed to create relationship",
      validation: "Invalid relationship",
      conflict: "Relationship already exists",
    }
  );
}

export async function createRelationshipDynamic(
  client: SupabaseClient,
  rawInput: unknown
): Promise<string> {
  const input = validate(createRelationshipDynamicSchema, rawInput);

  return runAtomicRpc<string>(
    client,
    "create_relationship_dynamic",
    {
      p_org_id: input.organizationId,
      p_relationship_id: input.relationshipId,
      p_title: input.title,
      p_description: input.description ?? null,
      p_confidence_score: input.confidenceScore ?? null,
      p_evidence_refs: input.evidenceRefs ?? [],
      p_visibility: input.visibility ?? "internal",
    },
    {
      forbidden: "No access to relationship clients",
      failure: "Failed to create relationship dynamic",
      validation: "Relationship evidence must be client-visible signals of the two clients",
    }
  );
}

/**
 * Read-time privacy filter (defence in depth for rows written before ticket 21,
 * when the service stripped private refs and a concurrent reclassification
 * could still slip one into storage). Requires active consent for both clients.
 */
async function loadRelationship(
  client: SupabaseClient,
  organizationId: string,
  relationshipId: string
): Promise<{ client_a_id: string; client_b_id: string }> {
  const { data, error } = await client
    .from("relationships")
    .select("client_a_id, client_b_id")
    .eq("id", relationshipId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (error) throw new ServiceError("INTERNAL_ERROR", "Failed to load relationship");
  if (!data) throw new ServiceError("NOT_FOUND", "Relationship not found");
  return data as { client_a_id: string; client_b_id: string };
}

async function assertRelationshipAccess(
  client: SupabaseClient,
  organizationId: string,
  clientAId: string,
  clientBId: string
): Promise<void> {
  for (const clientId of [clientAId, clientBId]) {
    const { data, error } = await client.rpc("is_client_accessible", {
      p_org_id: organizationId,
      p_client_id: clientId,
      p_require_write: true,
    });
    if (error) throw new ServiceError("INTERNAL_ERROR", "Failed to check client access");
    if (!data) throw new ServiceError("FORBIDDEN", "No access to relationship client");

    const { data: consent, error: consentError } = await client.rpc("has_consent", {
      p_client_id: clientId,
      p_consent_type: RELATIONSHIP_CONSENT,
    });
    if (consentError) throw new ServiceError("INTERNAL_ERROR", "Failed to check consent");
    if (!consent) throw new ServiceError("FORBIDDEN", "Missing relationship_analysis consent");
  }
}

/** Drop evidence refs that point to private (internal/sensitive) signals. */
async function filterPrivateEvidenceRefs(
  client: SupabaseClient,
  refs: string[]
): Promise<string[]> {
  if (refs.length === 0) return [];
  const { data, error } = await client.from("signals").select("id, visibility").in("id", refs);
  if (error) throw new ServiceError("INTERNAL_ERROR", "Failed to load evidence refs");
  const privateIds = new Set(
    (data ?? []).filter((s) => s.visibility !== "client_visible").map((s) => s.id)
  );
  return refs.filter((ref) => !privateIds.has(ref));
}

/** Privacy-filtered read view; requires active consent for both clients. */
export async function listRelationshipDynamics(
  client: SupabaseClient,
  organizationId: string,
  relationshipId: string
): Promise<unknown[]> {
  const relationship = await loadRelationship(client, organizationId, relationshipId);
  await assertRelationshipAccess(
    client,
    organizationId,
    relationship.client_a_id,
    relationship.client_b_id
  );

  const { data, error } = await client
    .from("relationship_dynamics")
    .select("*")
    .eq("relationship_id", relationshipId)
    .order("created_at", { ascending: false });
  if (error) throw new ServiceError("INTERNAL_ERROR", "Failed to list relationship dynamics");

  const rows = (data ?? []) as Array<Record<string, unknown> & { evidence_refs: string[] }>;
  const filtered: unknown[] = [];
  for (const row of rows) {
    const evidence_refs = await filterPrivateEvidenceRefs(client, row.evidence_refs ?? []);
    filtered.push({ ...row, evidence_refs });
  }
  return filtered;
}
