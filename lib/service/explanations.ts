import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { runAiFunction } from "@/lib/ai/gateway";
import type { AiProvider } from "@/lib/ai/provider";
import { withAudit } from "./audit";
import { requireConsent } from "./consent";
import { ServiceError } from "./errors";
import type { ModelChange } from "./model-changes";
import { decodeCursor, encodeCursor, pageQuerySchema, toPage, type Page } from "./pagination";
import { SCORING_MODEL_VERSION } from "./scoring";
import {
  diffSnapshots,
  SNAPSHOT_CATEGORIES,
  type PsychologicalSnapshot,
  type SnapshotContent,
  type SnapshotDiff,
  type SnapshotItem,
} from "./snapshots";
import { uuid, validate } from "./validation";

/**
 * ModelExplanation — explainModelChanges (ticket 44, SPEC §26, §27).
 *
 * After new diagnostics the specialist gets a cautious explanation of what
 * changed in the model and why. Hard guarantees:
 *
 *   - The AI only writes the narrative. Factual before/after values always
 *     come from ModelChange records and the deterministic snapshot diff —
 *     never from AI text (UI renders them from those sources directly).
 *   - The AI input is structured only: ModelChange records, before/after
 *     snapshot content, a resolved evidence digest and deterministic score
 *     diffs plus version metadata. No free-text prompt fields.
 *   - Grounding validation (deterministic, post-AI): every explanation entry
 *     must reference a ModelChange id that was actually in the input, and
 *     every evidence_ref must point at a real recorded evidence ref. An
 *     explanation with fabricated references is stored as "rejected" with
 *     grounding_errors and can never be approved (fabricated-change
 *     rejection); the grounding sets are re-checked on human approval.
 *   - The AI never changes the model: this module writes only to
 *     model_explanations (plus the gateway's ai_runs/audit telemetry).
 *   - Missing data is named explicitly: without ModelChange records or a
 *     previous snapshot a deterministic guard stores a pending explanation
 *     with an empty narrative and the gaps listed in missing_evidence —
 *     the AI is not called at all.
 *
 * Lifecycle: pending (awaiting human review) → approved / rejected.
 */

export type ModelExplanationStatus = "pending" | "approved" | "rejected";
export type ModelExplanationSource = "ai" | "deterministic_guard";

/** One entry of the ai.explain-model-changes.v1 contract result. */
export interface ExplanationEntry {
  model_change_id: string;
  headline: string;
  explanation: string;
  evidence_refs: string[];
  score_breakdown_summary: string;
  uncertainty: string;
  missing_evidence: string[];
}

/** The exact id sets an explanation was grounded against. */
export interface ExplanationGrounding {
  model_change_ids: string[];
  evidence_ids: string[];
}

export interface ExplanationVersions {
  scoring_model_version: string;
  ontology_version: string;
  ai_model: string;
  prompt_version: string;
}

export interface ModelExplanation {
  id: string;
  organization_id: string;
  client_id: string;
  status: ModelExplanationStatus;
  source: ModelExplanationSource;
  before_snapshot_id: string | null;
  after_snapshot_id: string | null;
  explanations: ExplanationEntry[];
  grounding: ExplanationGrounding;
  grounding_errors: string[];
  missing_evidence: string[];
  versions: Partial<ExplanationVersions>;
  run_id: string | null;
  created_by: string | null;
  created_at: string;
  decided_by: string | null;
  decided_at: string | null;
}

const explainModelChangesSchema = z
  .object({
    clientId: uuid,
  })
  .strict();

export type ExplainModelChangesInput = z.infer<typeof explainModelChangesSchema>;

const reviewModelExplanationSchema = z
  .object({
    explanationId: uuid,
    decision: z.enum(["approve", "reject"]),
  })
  .strict();

export type ReviewModelExplanationInput = z.infer<typeof reviewModelExplanationSchema>;

const listModelExplanationsQuerySchema = pageQuerySchema.extend({
  organizationId: uuid,
  clientId: uuid,
  status: z.enum(["pending", "approved", "rejected"]).optional(),
});

// --- Grounding validation (pure) ----------------------------------------------

/**
 * Deterministic grounding check: returns the list of violations (empty = OK).
 * An explanation may only reference ModelChange ids that were in the AI input
 * and evidence refs that were recorded on those changes — invented changes or
 * invented evidence are reported, never silently dropped.
 */
export function validateExplanationGrounding(
  explanations: ExplanationEntry[],
  grounding: ExplanationGrounding
): string[] {
  const knownChanges = new Set(grounding.model_change_ids);
  const knownEvidence = new Set(grounding.evidence_ids);
  const errors: string[] = [];
  const seen = new Set<string>();

  for (const entry of explanations) {
    if (!knownChanges.has(entry.model_change_id)) {
      errors.push(`fabricated model_change_id: ${entry.model_change_id}`);
    } else if (seen.has(entry.model_change_id)) {
      errors.push(`duplicate model_change_id: ${entry.model_change_id}`);
    }
    seen.add(entry.model_change_id);
    for (const ref of entry.evidence_refs) {
      if (!knownEvidence.has(ref)) {
        errors.push(`fabricated evidence_ref: ${ref} (change ${entry.model_change_id})`);
      }
    }
  }
  return errors.sort();
}

/**
 * Deterministic score diffs from a snapshot diff (SPEC §26: before → after
 * numbers come from snapshots, not from AI text). Keys are
 * "<category>.<entityId>.<scoreField>", values are integer deltas.
 */
export function computeScoreDiffs(diff: SnapshotDiff): Record<string, number> {
  const diffs: Record<string, number> = {};
  for (const category of SNAPSHOT_CATEGORIES) {
    for (const change of diff[category].changed) {
      const fields = new Set([...Object.keys(change.before), ...Object.keys(change.after)]);
      for (const field of fields) {
        if (!field.endsWith("_score")) continue;
        const before = change.before[field];
        const after = change.after[field];
        if (typeof before !== "number" || typeof after !== "number") continue;
        const delta = Math.round(after) - Math.round(before);
        if (delta !== 0) diffs[`${category}.${change.id}.${field}`] = delta;
      }
    }
  }
  return diffs;
}

// --- Internals -----------------------------------------------------------------

async function requireUserId(client: SupabaseClient): Promise<string> {
  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user) throw new ServiceError("UNAUTHORIZED", "Authentication required");
  return user.id;
}

function mapWriteError(error: { code?: string }, fallback: string): ServiceError {
  if (error.code === "42501") {
    return new ServiceError("FORBIDDEN", "You do not have permission to modify this client");
  }
  return new ServiceError("INTERNAL_ERROR", fallback);
}

function mapRow(data: unknown): ModelExplanation {
  return data as ModelExplanation;
}

interface ClientRow {
  id: string;
  organization_id: string;
}

async function requireClient(client: SupabaseClient, clientId: string): Promise<ClientRow> {
  const { data, error } = await client
    .from("clients")
    .select("id, organization_id")
    .eq("id", clientId)
    .maybeSingle();
  if (error) throw new ServiceError("INTERNAL_ERROR", "Failed to read client");
  if (!data) throw new ServiceError("NOT_FOUND", "Client not found");
  return data as ClientRow;
}

function snapshotContent(snapshot: PsychologicalSnapshot): SnapshotContent {
  return Object.fromEntries(
    SNAPSHOT_CATEGORIES.map((category) => [category, snapshot[category] ?? []])
  ) as SnapshotContent;
}

async function latestSnapshots(
  client: SupabaseClient,
  clientId: string,
  count: number
): Promise<PsychologicalSnapshot[]> {
  const { data, error } = await client
    .from("psychological_snapshots")
    .select("*")
    .eq("client_id", clientId)
    .order("version", { ascending: false })
    .limit(count);
  if (error) throw new ServiceError("INTERNAL_ERROR", "Failed to read snapshots");
  return (data ?? []).map((row) => row as PsychologicalSnapshot);
}

async function changesSince(
  client: SupabaseClient,
  clientId: string,
  since: string | null
): Promise<ModelChange[]> {
  let request = client
    .from("model_changes")
    .select("*")
    .eq("client_id", clientId)
    .order("occurred_at", { ascending: true })
    .limit(200);
  if (since) request = request.gt("occurred_at", since);
  const { data, error } = await request;
  if (error) throw new ServiceError("INTERNAL_ERROR", "Failed to read model changes");
  return (data ?? []).map((row) => row as ModelChange);
}

/** Resolve evidence refs to real signal rows for the evidence digest. */
async function resolveEvidenceDigest(
  client: SupabaseClient,
  evidenceIds: string[]
): Promise<Record<string, unknown>[]> {
  if (evidenceIds.length === 0) return [];
  const { data, error } = await client
    .from("signals")
    .select("id, normalized_meaning, source_type")
    .in("id", evidenceIds)
    .limit(500);
  if (error) throw new ServiceError("INTERNAL_ERROR", "Failed to resolve evidence digest");
  return (data ?? []) as Record<string, unknown>[];
}

async function saveExplanation(
  client: SupabaseClient,
  row: {
    organization_id: string;
    client_id: string;
    status: ModelExplanationStatus;
    source: ModelExplanationSource;
    before_snapshot_id: string | null;
    after_snapshot_id: string | null;
    explanations: ExplanationEntry[];
    grounding: ExplanationGrounding;
    grounding_errors: string[];
    missing_evidence: string[];
    versions: Partial<ExplanationVersions>;
    run_id: string | null;
    created_by: string;
  },
  action: string
): Promise<ModelExplanation> {
  return withAudit(
    client,
    {
      organizationId: row.organization_id,
      entityType: "model_explanation",
      action,
      reason: `client ${row.client_id}`,
    },
    async () => {
      const { data, error } = await client.from("model_explanations").insert(row).select().single();
      if (error) throw mapWriteError(error, "Failed to save model explanation");
      return mapRow(data);
    }
  );
}

// --- Service -------------------------------------------------------------------

/**
 * explainModelChanges (SPEC §26, §27): builds the structured AI input only
 * from deterministic sources — ModelChange records since the previous
 * snapshot, the before/after snapshot contents, a resolved evidence digest and
 * deterministic score diffs — then calls the ai.explain-model-changes.v1
 * contract through the AI gateway.
 *
 * The result is stored as a PENDING explanation (human review). Without a
 * previous snapshot or any ModelChange records a deterministic guard stores a
 * pending explanation that names the missing data explicitly and the AI is
 * not called. Fabricated references mark the explanation rejected at once.
 */
export async function explainModelChanges(
  client: SupabaseClient,
  provider: AiProvider,
  rawInput: unknown
): Promise<ModelExplanation> {
  const input = validate(explainModelChangesSchema, rawInput);
  const userId = await requireUserId(client);

  await requireConsent(client, input.clientId, "data_storage");
  await requireConsent(client, input.clientId, "sensitive_psychological_data");

  const clientRow = await requireClient(client, input.clientId);
  const [latest, previous] = await latestSnapshots(client, input.clientId, 2);
  const changes = await changesSince(
    client,
    input.clientId,
    previous ? previous.generated_at : null
  );

  // Deterministic missing-data guard (SPEC: недостаток данных называется явно).
  const missing: string[] = [];
  if (!latest) missing.push("snapshots");
  if (!previous) missing.push("previous_snapshot");
  if (changes.length === 0) missing.push("model_changes");

  const versions: Partial<ExplanationVersions> = latest
    ? {
        scoring_model_version: latest.scoring_model_version,
        ontology_version: latest.ontology_version,
        ai_model: latest.ai_model,
        prompt_version: latest.prompt_version,
      }
    : { scoring_model_version: SCORING_MODEL_VERSION };

  if (missing.length > 0) {
    return saveExplanation(
      client,
      {
        organization_id: clientRow.organization_id,
        client_id: input.clientId,
        status: "pending",
        source: "deterministic_guard",
        before_snapshot_id: previous?.id ?? null,
        after_snapshot_id: latest?.id ?? null,
        explanations: [],
        grounding: { model_change_ids: [], evidence_ids: [] },
        grounding_errors: [],
        missing_evidence: missing,
        versions,
        run_id: null,
        created_by: userId,
      },
      "model_explanation.explain_guard"
    );
  }

  const grounding: ExplanationGrounding = {
    model_change_ids: changes.map((change) => change.id).sort(),
    evidence_ids: [...new Set(changes.flatMap((change) => change.evidence_refs))].sort(),
  };
  const evidenceDigest = await resolveEvidenceDigest(client, grounding.evidence_ids);
  const scoreDiffs = computeScoreDiffs(
    diffSnapshots(snapshotContent(previous!), snapshotContent(latest!))
  );

  const payload = {
    model_changes: changes.map((change) => ({
      id: change.id,
      entity_type: change.entity_type,
      entity_id: change.entity_id,
      previous_state: change.previous_state,
      new_state: change.new_state,
      change_reason: change.change_reason,
      evidence_refs: change.evidence_refs,
      occurred_at: change.occurred_at,
    })),
    before_snapshot: {
      version: previous!.version,
      model_hash: previous!.model_hash,
      content: snapshotContent(previous!),
    },
    after_snapshot: {
      version: latest!.version,
      model_hash: latest!.model_hash,
      content: snapshotContent(latest!),
    },
    supporting_evidence: evidenceDigest,
    score_diffs: scoreDiffs,
  };

  const result = await runAiFunction(client, provider, {
    functionId: "ai.explain-model-changes.v1",
    organizationId: clientRow.organization_id,
    clientId: input.clientId,
    payload,
    scoringModelVersion: SCORING_MODEL_VERSION,
    sourceSnapshotVersion: latest!.version,
  });
  if (!result.ok) throw new ServiceError("INTERNAL_ERROR", result.error);
  if (result.result === null) {
    // Idempotent reuse: identical model state was already explained.
    throw new ServiceError("CONFLICT", "An identical explanation was already generated");
  }

  const explanations = (result.result as { explanations: ExplanationEntry[] }).explanations;

  // Fabricated-change rejection: invented change/evidence references are
  // detected deterministically and the explanation is rejected immediately.
  const groundingErrors = validateExplanationGrounding(explanations, grounding);

  return saveExplanation(
    client,
    {
      organization_id: clientRow.organization_id,
      client_id: input.clientId,
      status: groundingErrors.length > 0 ? "rejected" : "pending",
      source: "ai",
      before_snapshot_id: previous!.id,
      after_snapshot_id: latest!.id,
      explanations,
      grounding,
      grounding_errors: groundingErrors,
      missing_evidence: [],
      versions,
      run_id: result.runId,
      created_by: userId,
    },
    "model_explanation.explain"
  );
}

/** Read one model explanation (RLS-enforced). */
export async function getModelExplanation(
  client: SupabaseClient,
  explanationId: string
): Promise<ModelExplanation> {
  const { data, error } = await client
    .from("model_explanations")
    .select("*")
    .eq("id", validate(uuid, explanationId))
    .maybeSingle();
  if (error) throw new ServiceError("INTERNAL_ERROR", "Failed to read model explanation");
  if (!data) throw new ServiceError("NOT_FOUND", "Model explanation not found");
  return mapRow(data);
}

/** List model explanations for a client, oldest first. */
export async function listModelExplanations(
  client: SupabaseClient,
  rawQuery: unknown
): Promise<Page<ModelExplanation>> {
  const query = validate(listModelExplanationsQuerySchema, rawQuery ?? {});

  let request = client
    .from("model_explanations")
    .select("*")
    .eq("organization_id", query.organizationId)
    .eq("client_id", query.clientId)
    .order("id", { ascending: true })
    .limit(query.limit + 1);

  if (query.status) request = request.eq("status", query.status);
  if (query.cursor) request = request.gt("id", decodeCursor(query.cursor));

  const { data, error } = await request;
  if (error) throw new ServiceError("INTERNAL_ERROR", "Failed to list model explanations");

  return toPage((data ?? []).map(mapRow), query.limit, (last) => encodeCursor(last.id));
}

/**
 * Human review: approve or reject a pending explanation. On approve the
 * stored grounding sets are re-validated — an explanation with fabricated
 * references can never become approved.
 */
export async function reviewModelExplanation(
  client: SupabaseClient,
  rawInput: unknown
): Promise<ModelExplanation> {
  const input = validate(reviewModelExplanationSchema, rawInput);
  const userId = await requireUserId(client);

  const before = await getModelExplanation(client, input.explanationId);
  if (before.status !== "pending") {
    throw new ServiceError("CONFLICT", "Explanation was already reviewed");
  }

  if (input.decision === "approve") {
    // Defense in depth: re-run the deterministic grounding check.
    const errors = validateExplanationGrounding(before.explanations, before.grounding);
    if (errors.length > 0) {
      throw new ServiceError(
        "FORBIDDEN",
        "Explanation references changes or evidence that do not exist and cannot be approved"
      );
    }
  }

  const now = new Date().toISOString();
  const status: ModelExplanationStatus = input.decision === "approve" ? "approved" : "rejected";

  return withAudit(
    client,
    {
      organizationId: before.organization_id,
      entityType: "model_explanation",
      entityId: before.id,
      action: `model_explanation.${input.decision}`,
      before: { status: before.status },
      after: { status },
    },
    async () => {
      const { data, error } = await client
        .from("model_explanations")
        .update({ status, decided_by: userId, decided_at: now })
        .eq("id", before.id)
        .eq("status", "pending")
        .select()
        .single();
      if (error) throw mapWriteError(error, "Failed to review model explanation");
      if (!data) throw new ServiceError("NOT_FOUND", "Model explanation not found");
      return mapRow(data);
    }
  );
}

export {
  explainModelChangesSchema,
  listModelExplanationsQuerySchema,
  reviewModelExplanationSchema,
};

export type { SnapshotItem };
