import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { ServiceError } from "./errors";
import { intervalDataLimits } from "./model-change-presentation";
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
 *
 * Version-bounded interval read model (ticket 14): `listModelIntervalChanges`
 * describes what was created between two snapshot versions — ModelChanges,
 * DifferentialHypotheses and contradiction relations — without adding a
 * PsychologicalSnapshot category and without reconstructing state that was
 * never stored. Only rows whose own creation time falls inside the interval are
 * returned; everything the interval cannot describe is listed in `limits`.
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

// --- Version-bounded interval read model (ticket 14) --------------------------

/**
 * A DifferentialHypothesis created inside the interval. `evidenceFor` and
 * `evidenceAgainst` are its current entries: an individual evidence entry has
 * no timestamp of its own, so it cannot be bounded by the snapshot versions
 * (this is stated in `limits`, never hidden).
 */
export interface IntervalHypothesis {
  id: string;
  title: string;
  description: string | null;
  status: string;
  confidenceScore: number | null;
  evidenceFor: string[];
  evidenceAgainst: string[];
  createdAt: string;
}

/** A CoreNode ↔ CoreNode `contradicts` relation created inside the interval. */
export interface IntervalContradiction {
  id: string;
  fromCoreNodeId: string;
  toCoreNodeId: string;
  fromLabel: string;
  toLabel: string;
  confidence: number | null;
  evidenceSummary: string | null;
  createdAt: string;
}

/**
 * Everything the version-bounded read model can say about the window between
 * two snapshot versions: `from` is exclusive (previous snapshot time), `to` is
 * inclusive (compared snapshot time).
 */
export interface ModelIntervalChanges {
  from: string | null;
  to: string;
  modelChanges: ModelChange[];
  hypotheses: IntervalHypothesis[];
  contradictions: IntervalContradiction[];
  /** Explicit gaps of the interval; never empty, never silently dropped. */
  limits: string[];
}

const modelIntervalQuerySchema = z
  .object({
    organizationId: uuid,
    clientId: uuid,
    /** Exclusive lower bound; null means "no previous version". */
    from: z.string().datetime({ offset: true }).nullable(),
    /** Inclusive upper bound (the compared snapshot's generated_at). */
    to: z.string().datetime({ offset: true }),
  })
  .strict();

export type ModelIntervalQuery = z.infer<typeof modelIntervalQuerySchema>;

/** Upper bound on rows read for one interval; a larger interval is truncated. */
const INTERVAL_ROW_LIMIT = 200;

/**
 * Read the model changes, DifferentialHypotheses and contradiction relations
 * created between two snapshot versions. Every row carries its own creation
 * time and is filtered by it, so the result is reproducible from stored data
 * and never includes a row that existed before the interval. RLS still scopes
 * every read to the assigned client; this function adds no authorization of
 * its own.
 */
export async function listModelIntervalChanges(
  client: SupabaseClient,
  rawQuery: unknown
): Promise<ModelIntervalChanges> {
  const query = validate(modelIntervalQuerySchema, rawQuery ?? {});
  const { organizationId, clientId, from, to } = query;

  let changesRequest = client
    .from("model_changes")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("client_id", clientId)
    .lte("occurred_at", to)
    .order("occurred_at", { ascending: true })
    .order("id", { ascending: true })
    .limit(INTERVAL_ROW_LIMIT);
  if (from) changesRequest = changesRequest.gt("occurred_at", from);

  let hypothesesRequest = client
    .from("differential_hypotheses")
    .select(
      "id, title, description, status, confidence_score, evidence_for, evidence_against, created_at"
    )
    .eq("organization_id", organizationId)
    .eq("client_id", clientId)
    .lte("created_at", to)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true })
    .limit(INTERVAL_ROW_LIMIT);
  if (from) hypothesesRequest = hypothesesRequest.gt("created_at", from);

  let contradictionsRequest = client
    .from("core_node_relations")
    .select(
      "id, from_core_node_id, to_core_node_id, relation_type, confidence, evidence_summary, created_at"
    )
    .eq("organization_id", organizationId)
    .eq("client_id", clientId)
    .eq("relation_type", "contradicts")
    .lte("created_at", to)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true })
    .limit(INTERVAL_ROW_LIMIT);
  if (from) contradictionsRequest = contradictionsRequest.gt("created_at", from);

  const [changesResult, hypothesesResult, contradictionsResult] = await Promise.all([
    changesRequest,
    hypothesesRequest,
    contradictionsRequest,
  ]);
  for (const result of [changesResult, hypothesesResult, contradictionsResult]) {
    if (result.error) {
      throw new ServiceError("INTERNAL_ERROR", "Failed to read the model interval changes");
    }
  }

  const hypotheses: IntervalHypothesis[] = (
    (hypothesesResult.data ?? []) as Record<string, unknown>[]
  ).map((row) => ({
    id: String(row.id),
    title: String(row.title),
    description: (row.description as string | null) ?? null,
    status: String(row.status ?? "hypothesis"),
    confidenceScore: (row.confidence_score as number | null) ?? null,
    evidenceFor: (row.evidence_for as string[] | null) ?? [],
    evidenceAgainst: (row.evidence_against as string[] | null) ?? [],
    createdAt: String(row.created_at),
  }));

  const contradictionRows = (contradictionsResult.data ?? []) as Record<string, unknown>[];
  const nodeIds = [
    ...new Set(
      contradictionRows.flatMap((row) => [
        String(row.from_core_node_id),
        String(row.to_core_node_id),
      ])
    ),
  ];
  const nodeTitles = new Map<string, string>();
  if (nodeIds.length > 0) {
    const { data, error } = await client.from("core_nodes").select("id, title").in("id", nodeIds);
    if (error) {
      throw new ServiceError("INTERNAL_ERROR", "Failed to read core node labels");
    }
    for (const row of (data ?? []) as { id: string; title: string }[]) {
      nodeTitles.set(String(row.id), String(row.title));
    }
  }

  const contradictions: IntervalContradiction[] = contradictionRows.map((row) => ({
    id: String(row.id),
    fromCoreNodeId: String(row.from_core_node_id),
    toCoreNodeId: String(row.to_core_node_id),
    fromLabel: nodeTitles.get(String(row.from_core_node_id)) ?? String(row.from_core_node_id),
    toLabel: nodeTitles.get(String(row.to_core_node_id)) ?? String(row.to_core_node_id),
    confidence: (row.confidence as number | null) ?? null,
    evidenceSummary: (row.evidence_summary as string | null) ?? null,
    createdAt: String(row.created_at),
  }));

  const modelChanges = ((changesResult.data ?? []) as unknown[]).map(mapRow);

  return {
    from,
    to,
    modelChanges,
    hypotheses,
    contradictions,
    limits: intervalDataLimits({
      from,
      changeCount: modelChanges.length,
      hypothesisCount: hypotheses.length,
      contradictionCount: contradictions.length,
      hypothesesWithContradictingEvidence: hypotheses.filter(
        (hypothesis) => hypothesis.evidenceAgainst.length > 0
      ).length,
    }),
  };
}

export { recordModelChangeSchema, listModelChangesQuerySchema, modelIntervalQuerySchema };
