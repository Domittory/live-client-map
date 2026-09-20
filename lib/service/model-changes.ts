import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { ServiceError } from "./errors";
import { decodeCursor, encodeCursor, pageQuerySchema, toPage, type Page } from "./pagination";
import { runAtomicRpc } from "./transaction";
import { uuid, validate } from "./validation";

/**
 * ModelChange (ticket 43, SPEC §8.31).
 *
 * A ModelChange is NOT an AuditLog entry: it records a meaningful transition
 * of the psychological model itself (previous_state → new_state, the reason
 * and the evidence that justifies it), while the audit log records every
 * mutation for compliance.
 *
 * Model changes are generated ONLY for significant model transitions and are
 * recorded explicitly at the transition point — currently:
 *   - CoreNode status change applied by an approved reactivation
 *     (lib/service/reactivation.ts, reviewCoreNodeReactivation);
 *   - final follow-up verdict applied by an approved assessment
 *     (lib/service/follow-ups.ts, reviewFollowUpAssessment).
 * Routine CRUD, AI proposals pending review and rejected proposals never
 * produce a ModelChange. Rows are append-only: the table has no UPDATE/DELETE
 * policies and this module exposes no mutation functions for existing rows.
 */

export interface ModelChange {
  id: string;
  organization_id: string;
  client_id: string;
  occurred_at: string;
  entity_type: string;
  entity_id: string;
  previous_state: Record<string, unknown> | null;
  new_state: Record<string, unknown> | null;
  change_reason: string;
  evidence_refs: string[];
  created_at: string;
}

const recordModelChangeSchema = z
  .object({
    organizationId: uuid,
    clientId: uuid,
    entityType: z.string().trim().min(1).max(100),
    entityId: uuid,
    previousState: z.record(z.string(), z.unknown()).nullable().optional(),
    newState: z.record(z.string(), z.unknown()).nullable().optional(),
    changeReason: z.string().trim().min(1).max(4000),
    evidenceRefs: z.array(uuid).max(500).default([]),
  })
  .strict();

export type RecordModelChangeInput = z.infer<typeof recordModelChangeSchema>;

const listModelChangesQuerySchema = pageQuerySchema.extend({
  organizationId: uuid,
  clientId: uuid.optional(),
  entityType: z.string().trim().min(1).max(100).optional(),
  entityId: uuid.optional(),
});

function mapRow(data: unknown): ModelChange {
  return data as ModelChange;
}

/**
 * Append one ModelChange for a significant model transition. Call this only
 * from flows that actually change the psychological model (see module doc).
 * The ModelChange row and its regular audit entry are written by one RPC, so a
 * failed audit append rolls the model change back.
 */
export async function recordModelChange(
  client: SupabaseClient,
  rawInput: unknown
): Promise<ModelChange> {
  const input = validate(recordModelChangeSchema, rawInput);

  return runAtomicRpc<ModelChange>(
    client,
    "record_model_change",
    {
      p_org_id: input.organizationId,
      p_client_id: input.clientId,
      p_entity_type: input.entityType,
      p_entity_id: input.entityId,
      p_previous_state: input.previousState ?? null,
      p_new_state: input.newState ?? null,
      p_change_reason: input.changeReason,
      p_evidence_refs: input.evidenceRefs,
    },
    {
      forbidden: "You do not have permission to modify this client",
      failure: "Failed to record model change",
    }
  );
}

/** List model changes (history), oldest first, with optional filters. */
export async function listModelChanges(
  client: SupabaseClient,
  rawQuery: unknown
): Promise<Page<ModelChange>> {
  const query = validate(listModelChangesQuerySchema, rawQuery ?? {});

  let request = client
    .from("model_changes")
    .select("*")
    .eq("organization_id", query.organizationId)
    .order("id", { ascending: true })
    .limit(query.limit + 1);

  if (query.clientId) request = request.eq("client_id", query.clientId);
  if (query.entityType) request = request.eq("entity_type", query.entityType);
  if (query.entityId) request = request.eq("entity_id", query.entityId);
  if (query.cursor) request = request.gt("id", decodeCursor(query.cursor));

  const { data, error } = await request;
  if (error) throw new ServiceError("INTERNAL_ERROR", "Failed to list model changes");

  return toPage((data ?? []).map(mapRow), query.limit, (last) => encodeCursor(last.id));
}

/** Read one model change (RLS-enforced). */
export async function getModelChange(
  client: SupabaseClient,
  modelChangeId: string
): Promise<ModelChange> {
  const { data, error } = await client
    .from("model_changes")
    .select("*")
    .eq("id", validate(uuid, modelChangeId))
    .maybeSingle();
  if (error) throw new ServiceError("INTERNAL_ERROR", "Failed to read model change");
  if (!data) throw new ServiceError("NOT_FOUND", "Model change not found");
  return mapRow(data);
}

export { recordModelChangeSchema, listModelChangesQuerySchema };
