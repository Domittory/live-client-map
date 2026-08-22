import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { recordAudit } from "./audit";
import { requireConsent } from "./consent";
import { ServiceError } from "./errors";
import { score, uuid, validate } from "./validation";

/**
 * Relationship layer (ticket 50): two clients of the SAME organization linked
 * by a Relationship; RelationshipDynamics hold cross-client analysis. Every
 * operation requires write access to BOTH clients and active
 * `relationship_analysis` consent for both — so revocation stops new analyses
 * and read views. Private evidence (signals with internal/sensitive visibility)
 * is filtered out of dynamics so a partner's private data never leaks.
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

interface RelationshipRow {
  id: string;
  organization_id: string;
  client_a_id: string;
  client_b_id: string;
}

async function assertClientAccessible(
  client: SupabaseClient,
  organizationId: string,
  clientId: string,
  requireWrite: boolean
): Promise<void> {
  const { data, error } = await client.rpc("is_client_accessible", {
    p_org_id: organizationId,
    p_client_id: clientId,
    p_require_write: requireWrite,
  });
  if (error) throw new ServiceError("INTERNAL_ERROR", "Failed to check client access");
  if (!data) throw new ServiceError("FORBIDDEN", "No access to relationship client");
}

async function assertSameOrganization(
  client: SupabaseClient,
  organizationId: string,
  clientAId: string,
  clientBId: string
): Promise<void> {
  const { data, error } = await client
    .from("clients")
    .select("id")
    .eq("organization_id", organizationId)
    .in("id", [clientAId, clientBId]);
  if (error) throw new ServiceError("INTERNAL_ERROR", "Failed to load relationship clients");
  if (!data || data.length !== 2) {
    throw new ServiceError(
      "FORBIDDEN",
      "Relationship clients must belong to the same organization"
    );
  }
}

/** Both clients must be accessible (write) AND have relationship_analysis consent. */
async function assertRelationshipAccess(
  client: SupabaseClient,
  organizationId: string,
  clientAId: string,
  clientBId: string
): Promise<void> {
  await assertSameOrganization(client, organizationId, clientAId, clientBId);
  await assertClientAccessible(client, organizationId, clientAId, true);
  await assertClientAccessible(client, organizationId, clientBId, true);
  await requireConsent(client, clientAId, RELATIONSHIP_CONSENT);
  await requireConsent(client, clientBId, RELATIONSHIP_CONSENT);
}

async function loadRelationship(
  client: SupabaseClient,
  organizationId: string,
  relationshipId: string
): Promise<RelationshipRow> {
  const { data, error } = await client
    .from("relationships")
    .select("id, organization_id, client_a_id, client_b_id")
    .eq("id", relationshipId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (error) throw new ServiceError("INTERNAL_ERROR", "Failed to load relationship");
  if (!data) throw new ServiceError("NOT_FOUND", "Relationship not found");
  return data as RelationshipRow;
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

export async function createRelationship(
  client: SupabaseClient,
  rawInput: unknown
): Promise<string> {
  const input = validate(createRelationshipSchema, rawInput);
  if (input.clientAId === input.clientBId) {
    throw new ServiceError("VALIDATION_ERROR", "Relationship requires two distinct clients");
  }
  await assertRelationshipAccess(client, input.organizationId, input.clientAId, input.clientBId);

  const { data, error } = await client
    .from("relationships")
    .insert({
      organization_id: input.organizationId,
      client_a_id: input.clientAId,
      client_b_id: input.clientBId,
      relationship_type: input.relationshipType,
    })
    .select("id")
    .single();
  if (error) {
    if (error.code === "42501")
      throw new ServiceError("FORBIDDEN", "No access to relationship clients");
    if (error.code === "23505") throw new ServiceError("CONFLICT", "Relationship already exists");
    throw new ServiceError("INTERNAL_ERROR", "Failed to create relationship");
  }

  await recordAudit(client, {
    organizationId: input.organizationId,
    entityType: "relationship",
    entityId: data.id,
    action: "relationship.created",
    after: { client_a_id: input.clientAId, client_b_id: input.clientBId },
  });
  return data.id;
}

export async function createRelationshipDynamic(
  client: SupabaseClient,
  rawInput: unknown
): Promise<string> {
  const input = validate(createRelationshipDynamicSchema, rawInput);
  const relationship = await loadRelationship(client, input.organizationId, input.relationshipId);
  await assertRelationshipAccess(
    client,
    input.organizationId,
    relationship.client_a_id,
    relationship.client_b_id
  );

  // Privacy gate: private signal refs are stripped before persisting.
  const safeRefs = await filterPrivateEvidenceRefs(client, input.evidenceRefs ?? []);

  const { data, error } = await client
    .from("relationship_dynamics")
    .insert({
      relationship_id: input.relationshipId,
      title: input.title,
      description: input.description ?? null,
      confidence_score: input.confidenceScore ?? null,
      evidence_refs: safeRefs,
      visibility: input.visibility ?? "internal",
    })
    .select("id")
    .single();
  if (error) {
    if (error.code === "42501")
      throw new ServiceError("FORBIDDEN", "No access to relationship clients");
    throw new ServiceError("INTERNAL_ERROR", "Failed to create relationship dynamic");
  }

  await recordAudit(client, {
    organizationId: input.organizationId,
    entityType: "relationship_dynamic",
    entityId: data.id,
    action: "relationship_dynamic.created",
    after: { title: input.title },
  });
  return data.id;
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
