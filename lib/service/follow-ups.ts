import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { runAiFunction } from "@/lib/ai/gateway";
import type { AiProvider } from "@/lib/ai/provider";
import { withAudit } from "./audit";
import { requireConsent } from "./consent";
import { ServiceError } from "./errors";
import { decodeCursor, encodeCursor, pageQuerySchema, toPage, type Page } from "./pagination";
import { uuid, validate } from "./validation";

/**
 * FollowUp + evaluateCorrection (ticket 41, SPEC §8.30, §33, §51.9).
 *
 * Lifecycle: scheduled → completed (retest/behavioral results and feedback are
 * filled) → effective / partially_effective / ineffective / unclear (only after
 * a human approves the pending AI assessment). "cancelled" ends a scheduled
 * follow-up that will not happen.
 *
 * Hard guarantees:
 *   - A completed Correction is never effective without follow-up evidence:
 *     a deterministic guard runs before (and independently of) the AI, and the
 *     same guard is re-checked on human approval.
 *   - ai_assessment is stored in its own column, separate from client_feedback
 *     and specialist_assessment, and stays approval_status="pending" until a
 *     specialist approves or rejects it.
 *   - The AI's proposed_core_node_status is only recorded inside ai_assessment;
 *     this module never writes to core_nodes, so completing/evaluating a
 *     correction can never mark a CoreNode integrated by itself (SPEC §23, §51.9).
 *   - History is preserved: many follow-ups per correction, never overwritten.
 */

/** FollowUp result_status lifecycle (SPEC §8.30 + migration 0030). */
export type FollowUpResultStatus =
  | "scheduled"
  | "completed"
  | "cancelled"
  | "effective"
  | "partially_effective"
  | "ineffective"
  | "unclear";

/** Final statuses reachable only via human approval of an assessment. */
export type FollowUpFinalStatus = "effective" | "partially_effective" | "ineffective" | "unclear";

export type FollowUpApprovalStatus = "pending" | "approved" | "rejected";

/**
 * Structured retest outcome (jsonb). Presence of retest_result counts as
 * objective follow-up evidence.
 */
export interface FollowUpRetestResult {
  summary: string;
  stress_before?: number;
  stress_after?: number;
  contexts?: string[];
}

/** Structured behavioral outcome (jsonb): what changed in observable behavior. */
export interface FollowUpBehavioralResult {
  summary: string;
  marker_ids?: string[];
  observed_changes?: string[];
}

/** Client self-report (jsonb). Subjective: never counts as evidence alone. */
export interface FollowUpClientFeedback {
  summary: string;
  perceived_effect?: "positive" | "neutral" | "negative";
}

/** Specialist's own assessment (jsonb). Separate from the AI assessment. */
export interface FollowUpSpecialistAssessment {
  summary: string;
  proposed_result_status?: FollowUpFinalStatus;
}

/**
 * Stored ai_assessment jsonb: the ai.evaluate-correction.v1 contract result
 * plus human-approval workflow metadata.
 */
export interface FollowUpAiAssessment {
  proposed_result_status: FollowUpFinalStatus;
  confidence: number | null;
  evidence_refs: string[];
  context_changes: string[];
  marker_changes: string[];
  missing_evidence: string[];
  /** Recorded for the human reviewer; never applied to core_nodes by this module. */
  proposed_core_node_status: string | null;
  rationale: string;
  follow_up_recommendation: string;
  approval_status: FollowUpApprovalStatus;
  /** "deterministic_guard" when insufficient evidence short-circuited the AI call. */
  source: "ai" | "deterministic_guard";
  run_id: string | null;
  created_at: string;
  decided_by: string | null;
  decided_at: string | null;
}

export interface FollowUp {
  id: string;
  organization_id: string;
  client_id: string;
  correction_id: string;
  scheduled_at: string;
  completed_at: string | null;
  retest_result: FollowUpRetestResult | null;
  behavioral_result: FollowUpBehavioralResult | null;
  client_feedback: FollowUpClientFeedback | null;
  specialist_assessment: FollowUpSpecialistAssessment | null;
  ai_assessment: FollowUpAiAssessment | null;
  result_status: FollowUpResultStatus;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

/** Objective evidence available for a follow-up evaluation. */
export interface FollowUpEvidence {
  hasRetest: boolean;
  hasBehavioralResult: boolean;
  observationCount: number;
  /** Markers with both baseline and current values (a measurable change). */
  measuredMarkerCount: number;
}

const finalStatus = z.enum(["effective", "partially_effective", "ineffective", "unclear"]);

const stressScore = z.number().int().min(0).max(100);

const retestResultSchema = z
  .object({
    summary: z.string().trim().min(1).max(4000),
    stress_before: stressScore.optional(),
    stress_after: stressScore.optional(),
    contexts: z.array(z.string().trim().min(1).max(200)).max(50).optional(),
  })
  .strict();

const behavioralResultSchema = z
  .object({
    summary: z.string().trim().min(1).max(4000),
    marker_ids: z.array(uuid).max(100).optional(),
    observed_changes: z.array(z.string().trim().min(1).max(500)).max(50).optional(),
  })
  .strict();

const clientFeedbackSchema = z
  .object({
    summary: z.string().trim().min(1).max(4000),
    perceived_effect: z.enum(["positive", "neutral", "negative"]).optional(),
  })
  .strict();

const specialistAssessmentSchema = z
  .object({
    summary: z.string().trim().min(1).max(4000),
    proposed_result_status: finalStatus.optional(),
  })
  .strict();

const scheduleFollowUpSchema = z
  .object({
    organizationId: uuid,
    clientId: uuid,
    correctionId: uuid,
    scheduledAt: z.string().datetime({ offset: true }),
  })
  .strict();

export type ScheduleFollowUpInput = z.infer<typeof scheduleFollowUpSchema>;

const completeFollowUpSchema = z
  .object({
    followUpId: uuid,
    retestResult: retestResultSchema.optional(),
    behavioralResult: behavioralResultSchema.optional(),
    clientFeedback: clientFeedbackSchema.optional(),
    specialistAssessment: specialistAssessmentSchema.optional(),
  })
  .strict()
  .refine(
    (input) =>
      input.retestResult !== undefined ||
      input.behavioralResult !== undefined ||
      input.clientFeedback !== undefined ||
      input.specialistAssessment !== undefined,
    { message: "At least one result or feedback field is required" }
  );

export type CompleteFollowUpInput = z.infer<typeof completeFollowUpSchema>;

const listFollowUpsQuerySchema = pageQuerySchema.extend({
  organizationId: uuid,
  clientId: uuid.optional(),
  correctionId: uuid.optional(),
  resultStatus: z
    .enum([
      "scheduled",
      "completed",
      "cancelled",
      "effective",
      "partially_effective",
      "ineffective",
      "unclear",
    ])
    .optional(),
});

const reviewAssessmentSchema = z
  .object({
    followUpId: uuid,
    decision: z.enum(["approve", "reject"]),
    /** Optional human override of the AI-proposed final status on approve. */
    finalStatus: finalStatus.optional(),
  })
  .strict();

export type ReviewAssessmentInput = z.infer<typeof reviewAssessmentSchema>;

// --- Deterministic evidence guard (SPEC §51.9) --------------------------------

/**
 * Which evidence kinds are missing. Objective evidence is retest results,
 * behavioral results, linked observations or measured markers; client feedback
 * and the specialist's own assessment are subjective and never suffice alone.
 */
export function collectMissingEvidence(evidence: FollowUpEvidence): string[] {
  const missing: string[] = [];
  if (!evidence.hasRetest) missing.push("retest_result");
  if (!evidence.hasBehavioralResult) missing.push("behavioral_result");
  if (evidence.observationCount === 0) missing.push("observations");
  if (evidence.measuredMarkerCount === 0) missing.push("behavioral_markers");
  return missing;
}

/** At least one objective evidence source is required for any evaluation. */
export function hasSufficientEvidence(evidence: FollowUpEvidence): boolean {
  return (
    evidence.hasRetest ||
    evidence.hasBehavioralResult ||
    evidence.observationCount > 0 ||
    evidence.measuredMarkerCount > 0
  );
}

/**
 * "effective" is forbidden without follow-up evidence (SPEC §51.9,
 * docs/ai-contracts.md). This guard is enforced before the AI call, on the AI
 * result and again on human approval — the AI can never unlock it by itself.
 */
export function canBeEffective(evidence: FollowUpEvidence): boolean {
  return hasSufficientEvidence(evidence);
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
    return new ServiceError("FORBIDDEN", "You do not have permission to modify this follow-up");
  }
  return new ServiceError("INTERNAL_ERROR", fallback);
}

async function requireCorrectionInScope(
  client: SupabaseClient,
  correctionId: string,
  organizationId: string,
  clientId: string
): Promise<{ id: string; status: string; priority_score_before: number | null }> {
  const { data, error } = await client
    .from("corrections")
    .select("id, status, priority_score_before")
    .eq("id", correctionId)
    .eq("organization_id", organizationId)
    .eq("client_id", clientId)
    .is("archived_at", null)
    .maybeSingle();
  if (error) throw new ServiceError("INTERNAL_ERROR", "Failed to read correction");
  if (!data) {
    throw new ServiceError("VALIDATION_ERROR", `Invalid correction reference: ${correctionId}`);
  }
  return data as { id: string; status: string; priority_score_before: number | null };
}

function mapRow(data: unknown): FollowUp {
  return data as FollowUp;
}

// --- Lifecycle ------------------------------------------------------------

/**
 * Schedule a follow-up for a correction. Allowed once the correction is
 * in progress or completed; cancelled/archived corrections are excluded by
 * requireCorrectionInScope (archived) and the status check below.
 */
export async function scheduleFollowUp(
  client: SupabaseClient,
  rawInput: unknown
): Promise<FollowUp> {
  const input = validate(scheduleFollowUpSchema, rawInput);
  const userId = await requireUserId(client);

  await requireConsent(client, input.clientId, "data_storage");
  await requireConsent(client, input.clientId, "sensitive_psychological_data");

  const correction = await requireCorrectionInScope(
    client,
    input.correctionId,
    input.organizationId,
    input.clientId
  );
  if (correction.status !== "in_progress" && correction.status !== "completed") {
    throw new ServiceError(
      "CONFLICT",
      "Follow-ups can be scheduled only for in_progress or completed corrections"
    );
  }

  return withAudit(
    client,
    {
      organizationId: input.organizationId,
      entityType: "follow_up",
      action: "follow_up.schedule",
      reason: `For correction ${input.correctionId}`,
    },
    async () => {
      const { data, error } = await client
        .from("follow_ups")
        .insert({
          organization_id: input.organizationId,
          client_id: input.clientId,
          correction_id: input.correctionId,
          scheduled_at: input.scheduledAt,
          result_status: "scheduled",
          created_by: userId,
        })
        .select()
        .single();
      if (error) throw mapWriteError(error, "Failed to schedule follow-up");
      return mapRow(data);
    }
  );
}

/** List follow-ups (history) for a correction or client, oldest first. */
export async function listFollowUps(
  client: SupabaseClient,
  rawQuery: unknown
): Promise<Page<FollowUp>> {
  const query = validate(listFollowUpsQuerySchema, rawQuery ?? {});

  let request = client
    .from("follow_ups")
    .select("*")
    .eq("organization_id", query.organizationId)
    .order("id", { ascending: true })
    .limit(query.limit + 1);

  if (query.clientId) request = request.eq("client_id", query.clientId);
  if (query.correctionId) request = request.eq("correction_id", query.correctionId);
  if (query.resultStatus) request = request.eq("result_status", query.resultStatus);
  if (query.cursor) request = request.gt("id", decodeCursor(query.cursor));

  const { data, error } = await request;
  if (error) throw new ServiceError("INTERNAL_ERROR", "Failed to list follow-ups");

  return toPage((data ?? []).map(mapRow), query.limit, (last) => encodeCursor(last.id));
}

/** Read one follow-up. */
export async function getFollowUp(client: SupabaseClient, followUpId: string): Promise<FollowUp> {
  const { data, error } = await client
    .from("follow_ups")
    .select("*")
    .eq("id", validate(uuid, followUpId))
    .maybeSingle();
  if (error) throw new ServiceError("INTERNAL_ERROR", "Failed to read follow-up");
  if (!data) throw new ServiceError("NOT_FOUND", "Follow-up not found");
  return mapRow(data);
}

/**
 * Fill in follow-up results and feedback: scheduled → completed.
 * client_feedback, specialist_assessment and (later) ai_assessment are stored
 * in separate columns and never mixed.
 */
export async function completeFollowUp(
  client: SupabaseClient,
  rawInput: unknown
): Promise<FollowUp> {
  const input = validate(completeFollowUpSchema, rawInput);
  await requireUserId(client);

  const before = await getFollowUp(client, input.followUpId);
  if (before.result_status !== "scheduled") {
    throw new ServiceError(
      "CONFLICT",
      `Follow-up in status "${before.result_status}" cannot be completed`
    );
  }

  await requireConsent(client, before.client_id, "data_storage");
  await requireConsent(client, before.client_id, "sensitive_psychological_data");

  const patch = {
    retest_result: input.retestResult ?? null,
    behavioral_result: input.behavioralResult ?? null,
    client_feedback: input.clientFeedback ?? null,
    specialist_assessment: input.specialistAssessment ?? null,
    completed_at: new Date().toISOString(),
    result_status: "completed",
    updated_at: new Date().toISOString(),
  };

  const updated = await withAudit(
    client,
    {
      organizationId: before.organization_id,
      entityType: "follow_up",
      entityId: before.id,
      action: "follow_up.complete",
      before,
      after: { ...before, ...patch },
    },
    async () => {
      const { data, error } = await client
        .from("follow_ups")
        .update(patch)
        .eq("id", before.id)
        .eq("result_status", "scheduled")
        .select()
        .single();
      if (error) throw mapWriteError(error, "Failed to complete follow-up");
      if (!data) throw new ServiceError("NOT_FOUND", "Follow-up not found");
      return mapRow(data);
    }
  );

  return updated;
}

/** Cancel a scheduled follow-up that will not happen. */
export async function cancelFollowUp(
  client: SupabaseClient,
  followUpId: string
): Promise<FollowUp> {
  const id = validate(uuid, followUpId);
  await requireUserId(client);

  const before = await getFollowUp(client, id);
  if (before.result_status !== "scheduled") {
    throw new ServiceError(
      "CONFLICT",
      `Follow-up in status "${before.result_status}" cannot be cancelled`
    );
  }

  const now = new Date().toISOString();
  return withAudit(
    client,
    {
      organizationId: before.organization_id,
      entityType: "follow_up",
      entityId: before.id,
      action: "follow_up.cancel",
      before,
      after: { ...before, result_status: "cancelled" },
    },
    async () => {
      const { data, error } = await client
        .from("follow_ups")
        .update({ result_status: "cancelled", updated_at: now })
        .eq("id", before.id)
        .eq("result_status", "scheduled")
        .select()
        .single();
      if (error) throw mapWriteError(error, "Failed to cancel follow-up");
      if (!data) throw new ServiceError("NOT_FOUND", "Follow-up not found");
      return mapRow(data);
    }
  );
}

// --- Evaluation -------------------------------------------------------------

interface CorrectionEvidenceBundle {
  evidence: FollowUpEvidence;
  payload: Record<string, unknown>;
}

/**
 * Gather everything evaluateCorrection (SPEC §33) must consider: retest and
 * feedback from the follow-up itself, observations linked to the correction,
 * behavioral markers with baseline/current/trend, expected markers, previous
 * follow-ups (history) and change across contexts (life areas).
 */
async function gatherEvidence(
  client: SupabaseClient,
  followUp: FollowUp
): Promise<CorrectionEvidenceBundle> {
  const correction = await requireCorrectionInScope(
    client,
    followUp.correction_id,
    followUp.organization_id,
    followUp.client_id
  );

  const [targets, expectedMarkers, observations, markers, history] = await Promise.all([
    client.from("correction_targets").select("*").eq("correction_id", correction.id),
    client.from("correction_expected_markers").select("*").eq("correction_id", correction.id),
    client
      .from("observations")
      .select(
        "id, date, source_type, description, life_areas, valence, intensity, supports_improvement, confidence"
      )
      .eq("correction_id", correction.id)
      .order("date", { ascending: true })
      .limit(100),
    client
      .from("behavioral_markers")
      .select(
        "id, name, life_area, marker_type, scale_min, scale_max, baseline_value, current_value, trend"
      )
      .eq("client_id", followUp.client_id)
      .order("created_at", { ascending: true })
      .limit(100),
    client
      .from("follow_ups")
      .select(
        "id, scheduled_at, completed_at, retest_result, behavioral_result, client_feedback, specialist_assessment, result_status"
      )
      .eq("correction_id", correction.id)
      .order("created_at", { ascending: true })
      .limit(100),
  ]);
  for (const result of [targets, expectedMarkers, observations, markers, history]) {
    if (result.error) {
      throw new ServiceError("INTERNAL_ERROR", "Failed to gather follow-up evidence");
    }
  }

  const observationRows = (observations.data ?? []) as {
    id: string;
    life_areas: string[];
  }[];
  const markerRows = (markers.data ?? []) as {
    id: string;
    life_area: string | null;
    baseline_value: number | null;
    current_value: number | null;
  }[];

  const evidence: FollowUpEvidence = {
    hasRetest: followUp.retest_result !== null,
    hasBehavioralResult: followUp.behavioral_result !== null,
    observationCount: observationRows.length,
    measuredMarkerCount: markerRows.filter(
      (marker) => marker.baseline_value !== null && marker.current_value !== null
    ).length,
  };

  const contexts = new Set<string>();
  for (const observation of observationRows) {
    for (const area of observation.life_areas ?? []) contexts.add(area);
  }
  for (const marker of markerRows) {
    if (marker.life_area) contexts.add(marker.life_area);
  }
  for (const context of followUp.retest_result?.contexts ?? []) contexts.add(context);

  const payload = {
    correction_id: correction.id,
    target_refs: ((targets.data ?? []) as { target_id: string }[]).map((t) => t.target_id),
    expected_markers: expectedMarkers.data ?? [],
    baselines: markerRows.map((marker) => ({
      marker_id: marker.id,
      baseline_value: marker.baseline_value,
    })),
    observations: observations.data ?? [],
    behavioral_markers: markers.data ?? [],
    follow_ups: (history.data ?? []) as unknown[],
    affected_contexts: [...contexts],
    current_deterministic_scores: {
      // priority_score_before is double precision; the contract requires an
      // integer 0–100 score, so round it (null stays null).
      priority_score_before:
        correction.priority_score_before === null
          ? null
          : Math.round(correction.priority_score_before),
    },
  };

  return { evidence, payload };
}

function deterministicGuardAssessment(missing: string[]): FollowUpAiAssessment {
  return {
    proposed_result_status: "unclear",
    confidence: null,
    evidence_refs: [],
    context_changes: [],
    marker_changes: [],
    missing_evidence: missing,
    proposed_core_node_status: null,
    rationale:
      "Недостаточно follow-up evidence: нет ни retest, ни behavioral result, ни наблюдений, ни измеренных маркеров. Эффективность не может быть подтверждена.",
    follow_up_recommendation: "Соберите retest, наблюдения или измерения маркеров.",
    approval_status: "pending",
    source: "deterministic_guard",
    run_id: null,
    created_at: new Date().toISOString(),
    decided_by: null,
    decided_at: null,
  };
}

async function saveAssessment(
  client: SupabaseClient,
  followUp: FollowUp,
  assessment: FollowUpAiAssessment,
  action: string
): Promise<FollowUp> {
  const patch = { ai_assessment: assessment, updated_at: new Date().toISOString() };
  return withAudit(
    client,
    {
      organizationId: followUp.organization_id,
      entityType: "follow_up",
      entityId: followUp.id,
      action,
      before: { ai_assessment: followUp.ai_assessment },
      after: { ai_assessment: assessment },
    },
    async () => {
      const { data, error } = await client
        .from("follow_ups")
        .update(patch)
        .eq("id", followUp.id)
        .select()
        .single();
      if (error) throw mapWriteError(error, "Failed to save AI assessment");
      if (!data) throw new ServiceError("NOT_FOUND", "Follow-up not found");
      return mapRow(data);
    }
  );
}

/**
 * evaluateCorrection (SPEC §33): collects retest, observations, behavioral
 * markers, client/specialist feedback and change across contexts, then calls
 * the ai.evaluate-correction.v1 contract through the AI gateway.
 *
 * The result is stored as a PENDING ai_assessment — result_status stays
 * "completed" until a human approves (reviewFollowUpAssessment). Without
 * objective evidence a deterministic guard short-circuits the AI and proposes
 * "unclear" (missing-data case). The AI's proposed_core_node_status is stored
 * for the reviewer but never applied to core_nodes here (SPEC §51.9).
 */
export async function evaluateCorrection(
  client: SupabaseClient,
  provider: AiProvider,
  followUpId: string
): Promise<FollowUp> {
  const id = validate(uuid, followUpId);
  await requireUserId(client);

  const followUp = await getFollowUp(client, id);
  if (followUp.result_status !== "completed") {
    throw new ServiceError(
      "CONFLICT",
      `Follow-up in status "${followUp.result_status}" cannot be evaluated`
    );
  }
  if (followUp.ai_assessment?.approval_status === "pending") {
    throw new ServiceError("CONFLICT", "Follow-up already has a pending assessment");
  }

  const { evidence, payload } = await gatherEvidence(client, followUp);

  // Deterministic missing-data gate: no objective evidence → unclear, no AI call.
  if (!hasSufficientEvidence(evidence)) {
    return saveAssessment(
      client,
      followUp,
      deterministicGuardAssessment(collectMissingEvidence(evidence)),
      "follow_up.evaluate_guard"
    );
  }

  const result = await runAiFunction(client, provider, {
    functionId: "ai.evaluate-correction.v1",
    organizationId: followUp.organization_id,
    clientId: followUp.client_id,
    payload,
  });
  if (!result.ok) throw new ServiceError("INTERNAL_ERROR", result.error);
  if (result.result === null) {
    // Idempotent reuse: identical evidence was already evaluated.
    throw new ServiceError("CONFLICT", "An identical evaluation was already performed");
  }

  const assessment = (
    result.result as {
      assessment: Omit<
        FollowUpAiAssessment,
        "approval_status" | "source" | "run_id" | "created_at" | "decided_by" | "decided_at"
      >;
    }
  ).assessment;

  // Defense in depth: the AI can never propose "effective" without evidence.
  const proposed: FollowUpFinalStatus =
    assessment.proposed_result_status === "effective" && !canBeEffective(evidence)
      ? "unclear"
      : assessment.proposed_result_status;

  return saveAssessment(
    client,
    followUp,
    {
      ...assessment,
      proposed_result_status: proposed,
      approval_status: "pending",
      source: "ai",
      run_id: result.runId,
      created_at: new Date().toISOString(),
      decided_by: null,
      decided_at: null,
    },
    "follow_up.evaluate"
  );
}

/**
 * Human approval flow: the specialist approves or rejects the pending AI
 * assessment. Only approval makes result_status final. The deterministic guard
 * runs again here: approving "effective" (proposed or overridden) without
 * objective follow-up evidence is rejected (SPEC §51.9).
 */
export async function reviewFollowUpAssessment(
  client: SupabaseClient,
  rawInput: unknown
): Promise<FollowUp> {
  const input = validate(reviewAssessmentSchema, rawInput);
  const userId = await requireUserId(client);

  const followUp = await getFollowUp(client, input.followUpId);
  const assessment = followUp.ai_assessment;
  if (followUp.result_status !== "completed" || !assessment) {
    throw new ServiceError("CONFLICT", "Follow-up has no assessment to review");
  }
  if (assessment.approval_status !== "pending") {
    throw new ServiceError("CONFLICT", "Assessment was already reviewed");
  }

  const now = new Date().toISOString();

  if (input.decision === "reject") {
    const rejected: FollowUpAiAssessment = {
      ...assessment,
      approval_status: "rejected",
      decided_by: userId,
      decided_at: now,
    };
    return saveAssessment(client, followUp, rejected, "follow_up.assessment_reject");
  }

  const finalStatus = input.finalStatus ?? assessment.proposed_result_status;
  if (finalStatus === "effective") {
    const { evidence } = await gatherEvidence(client, followUp);
    if (!canBeEffective(evidence)) {
      throw new ServiceError(
        "FORBIDDEN",
        "A correction cannot be marked effective without follow-up evidence (retest, behavioral result, observations or measured markers)"
      );
    }
  }

  const approved: FollowUpAiAssessment = {
    ...assessment,
    approval_status: "approved",
    decided_by: userId,
    decided_at: now,
  };
  const patch = {
    ai_assessment: approved,
    result_status: finalStatus,
    updated_at: now,
  };

  return withAudit(
    client,
    {
      organizationId: followUp.organization_id,
      entityType: "follow_up",
      entityId: followUp.id,
      action: "follow_up.assessment_approve",
      before: { ai_assessment: followUp.ai_assessment, result_status: followUp.result_status },
      after: { ai_assessment: approved, result_status: finalStatus },
    },
    async () => {
      const { data, error } = await client
        .from("follow_ups")
        .update(patch)
        .eq("id", followUp.id)
        .eq("result_status", "completed")
        .select()
        .single();
      if (error) throw mapWriteError(error, "Failed to review assessment");
      if (!data) throw new ServiceError("NOT_FOUND", "Follow-up not found");
      return mapRow(data);
    }
  );
}

export {
  scheduleFollowUpSchema,
  completeFollowUpSchema,
  listFollowUpsQuerySchema,
  reviewAssessmentSchema,
  retestResultSchema,
  behavioralResultSchema,
  clientFeedbackSchema,
  specialistAssessmentSchema,
};
