import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { requireConsent } from "./consent";
import { ServiceError } from "./errors";
import { decodeCursor, encodeCursor, pageQuerySchema, toPage, type Page } from "./pagination";
import { runAtomicRpc } from "./transaction";
import { uuid, validate } from "./validation";

/** Correction statuses (SPEC §8.25). */
export type CorrectionStatus = "planned" | "in_progress" | "completed" | "cancelled" | "archived";

/** Correction target roles (SPEC §8.26). */
export type CorrectionTargetRole = "primary" | "secondary" | "downstream" | "context";

/** Target entity types supported by validate_correction_target. */
export type CorrectionTargetType =
  "core_node" | "theme" | "resource" | "client_request" | "development_target";

/** Expected marker directions (SPEC §8.27). */
export type ExpectedMarkerDirection = "increase" | "decrease" | "stable" | "observable_change";

/** Measurement types for expected markers. */
export type ExpectedMarkerMeasurementType =
  "scale" | "boolean" | "frequency" | "subjective" | "behavioral_count";

export interface Correction {
  id: string;
  organization_id: string;
  client_id: string;
  recommendation_id: string | null;
  intervention_method_id: string | null;
  date: string;
  title: string;
  method_notes: string | null;
  rationale: string | null;
  expected_effect: string | null;
  priority_score_before: number | null;
  status: CorrectionStatus;
  specialist_notes: string | null;
  client_visible_summary: string | null;
  contraindications_acknowledged: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
}

export interface CorrectionTarget {
  id: string;
  correction_id: string;
  target_type: CorrectionTargetType;
  target_id: string;
  role: CorrectionTargetRole;
  expected_effect: string | null;
  created_at: string;
}

export interface CorrectionExpectedMarker {
  id: string;
  correction_id: string;
  marker: string;
  life_area: string | null;
  expected_direction: ExpectedMarkerDirection;
  measurement_type: ExpectedMarkerMeasurementType;
  baseline_value: string | null;
  target_value: string | null;
  created_at: string;
  updated_at: string;
}

export interface CorrectionDetail extends Correction {
  targets: CorrectionTarget[];
  expected_markers: CorrectionExpectedMarker[];
}

const correctionStatus = z.enum(["planned", "in_progress", "completed", "cancelled", "archived"]);

const targetRole = z.enum(["primary", "secondary", "downstream", "context"]);
const targetType = z.enum([
  "core_node",
  "theme",
  "resource",
  "client_request",
  "development_target",
]);

const markerDirection = z.enum(["increase", "decrease", "stable", "observable_change"]);
const measurementType = z.enum(["scale", "boolean", "frequency", "subjective", "behavioral_count"]);

const correctionTargetSchema = z
  .object({
    targetType: targetType,
    targetId: uuid,
    role: targetRole,
    expectedEffect: z.string().trim().min(1).max(2000).optional(),
  })
  .strict();

const correctionExpectedMarkerSchema = z
  .object({
    marker: z.string().trim().min(1).max(500),
    lifeArea: z.string().trim().min(1).max(200).optional(),
    expectedDirection: markerDirection,
    measurementType: measurementType,
    baselineValue: z.string().trim().min(1).max(500).optional(),
    targetValue: z.string().trim().min(1).max(500).optional(),
  })
  .strict();

const createFromRecommendationSchema = z
  .object({
    organizationId: uuid,
    clientId: uuid,
    recommendationId: uuid,
    interventionMethodId: uuid.optional(),
    title: z.string().trim().min(1).max(500),
    date: z.string().date().optional(),
    methodNotes: z.string().trim().min(1).max(4000).optional(),
    rationale: z.string().trim().min(1).max(4000).optional(),
    expectedEffect: z.string().trim().min(1).max(4000).optional(),
    specialistNotes: z.string().trim().min(1).max(4000).optional(),
    clientVisibleSummary: z.string().trim().min(1).max(4000).optional(),
    contraindicationsAcknowledged: z.boolean().default(false),
    targets: z.array(correctionTargetSchema).min(1).max(50),
    expectedMarkers: z.array(correctionExpectedMarkerSchema).min(1).max(50),
  })
  .strict();

export type CreateFromRecommendationInput = z.infer<typeof createFromRecommendationSchema>;

const listCorrectionsQuerySchema = pageQuerySchema.extend({
  organizationId: uuid,
  clientId: uuid.optional(),
  recommendationId: uuid.optional(),
  status: correctionStatus.optional(),
});

const updateCorrectionSchema = z
  .object({
    correctionId: uuid,
    title: z.string().trim().min(1).max(500).optional(),
    date: z.string().date().optional(),
    methodNotes: z.string().trim().min(1).max(4000).nullable().optional(),
    rationale: z.string().trim().min(1).max(4000).nullable().optional(),
    expectedEffect: z.string().trim().min(1).max(4000).nullable().optional(),
    specialistNotes: z.string().trim().min(1).max(4000).nullable().optional(),
    clientVisibleSummary: z.string().trim().min(1).max(4000).nullable().optional(),
    status: correctionStatus.optional(),
    contraindicationsAcknowledged: z.boolean().optional(),
  })
  .strict();

export type UpdateCorrectionInput = z.infer<typeof updateCorrectionSchema>;

async function requireUserId(client: SupabaseClient): Promise<string> {
  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user) throw new ServiceError("UNAUTHORIZED", "Authentication required");
  return user.id;
}

async function requireRecommendation(
  client: SupabaseClient,
  recommendationId: string,
  organizationId: string,
  clientId: string
): Promise<{ id: string; final_priority_score: number | null; status: string }> {
  const { data, error } = await client
    .from("recommendations")
    .select("id, final_priority_score, status")
    .eq("id", recommendationId)
    .eq("organization_id", organizationId)
    .eq("client_id", clientId)
    .maybeSingle();
  if (error) throw new ServiceError("INTERNAL_ERROR", "Failed to read recommendation");
  if (!data) throw new ServiceError("NOT_FOUND", "Recommendation not found");
  return data as { id: string; final_priority_score: number | null; status: string };
}

async function requireMethod(
  client: SupabaseClient,
  methodId: string
): Promise<{ id: string; archived_at: string | null; contraindications: string[] }> {
  const { data, error } = await client
    .from("intervention_methods")
    .select("id, archived_at, contraindications")
    .eq("id", methodId)
    .maybeSingle();
  if (error) throw new ServiceError("INTERNAL_ERROR", "Failed to read intervention method");
  if (!data) throw new ServiceError("NOT_FOUND", "Intervention method not found");
  return data as { id: string; archived_at: string | null; contraindications: string[] };
}

async function validateTargets(
  client: SupabaseClient,
  targets: CreateFromRecommendationInput["targets"],
  organizationId: string,
  clientId: string
): Promise<void> {
  for (const target of targets) {
    const { data: valid, error } = await client.rpc("validate_correction_target", {
      p_target_type: target.targetType,
      p_target_id: target.targetId,
      p_organization_id: organizationId,
      p_client_id: clientId,
    });
    if (error) throw new ServiceError("INTERNAL_ERROR", "Failed to validate correction target");
    if (!valid) {
      throw new ServiceError(
        "VALIDATION_ERROR",
        `Invalid target: ${target.targetType} ${target.targetId}`
      );
    }
  }
}

async function countExpectedMarkers(client: SupabaseClient, correctionId: string): Promise<number> {
  const { count, error } = await client
    .from("correction_expected_markers")
    .select("*", { count: "exact", head: true })
    .eq("correction_id", correctionId);
  if (error) throw new ServiceError("INTERNAL_ERROR", "Failed to count expected markers");
  return count ?? 0;
}

/**
 * Create a Correction from an approved Recommendation (ticket 39).
 * Enforces consent, target validity, method contraindications and copies the
 * recommendation's final priority score for future comparison.
 *
 * The correction row, every target, every expected marker and both audit rows
 * (plan + create) are written by one atomic RPC: a failure at any step — audit
 * append included — rolls the whole correction back, so a Correction can never
 * exist with only part of its targets/markers or without its audit trail.
 */
export async function createCorrectionFromRecommendation(
  client: SupabaseClient,
  rawInput: unknown
): Promise<CorrectionDetail> {
  const input = validate(createFromRecommendationSchema, rawInput);
  await requireUserId(client);

  await requireConsent(client, input.clientId, "data_storage");
  await requireConsent(client, input.clientId, "sensitive_psychological_data");
  if (input.clientVisibleSummary) {
    await requireConsent(client, input.clientId, "client_portal");
  }

  // Read-only pre-checks keep the service-level error contract (NOT_FOUND /
  // FORBIDDEN / CONFLICT) informative. Every rule is re-asserted inside the RPC
  // transaction, which is what actually guarantees consistency.
  const recommendation = await requireRecommendation(
    client,
    input.recommendationId,
    input.organizationId,
    input.clientId
  );
  if (recommendation.status !== "approved") {
    throw new ServiceError("FORBIDDEN", "Only approved recommendations can become corrections");
  }

  if (input.interventionMethodId) {
    const method = await requireMethod(client, input.interventionMethodId);
    if (method.archived_at !== null) {
      throw new ServiceError("CONFLICT", "Archived intervention methods cannot be used");
    }
    if (method.contraindications.length > 0 && !input.contraindicationsAcknowledged) {
      throw new ServiceError(
        "FORBIDDEN",
        "Intervention method contraindications must be acknowledged"
      );
    }
  }

  await validateTargets(client, input.targets, input.organizationId, input.clientId);

  const correctionId = await runAtomicRpc<string>(
    client,
    "create_correction_from_recommendation",
    {
      p_org_id: input.organizationId,
      p_client_id: input.clientId,
      p_payload: {
        recommendation_id: input.recommendationId,
        intervention_method_id: input.interventionMethodId ?? null,
        date: input.date ?? null,
        title: input.title,
        method_notes: input.methodNotes ?? null,
        rationale: input.rationale ?? null,
        expected_effect: input.expectedEffect ?? null,
        specialist_notes: input.specialistNotes ?? null,
        client_visible_summary: input.clientVisibleSummary ?? null,
        contraindications_acknowledged: input.contraindicationsAcknowledged,
        targets: input.targets.map((target) => ({
          target_type: target.targetType,
          target_id: target.targetId,
          role: target.role,
          expected_effect: target.expectedEffect ?? null,
        })),
        expected_markers: input.expectedMarkers.map((marker) => ({
          marker: marker.marker,
          life_area: marker.lifeArea ?? null,
          expected_direction: marker.expectedDirection,
          measurement_type: marker.measurementType,
          baseline_value: marker.baselineValue ?? null,
          target_value: marker.targetValue ?? null,
        })),
      },
    },
    {
      forbidden: "You do not have permission to modify this client",
      failure: "Failed to create correction",
      validation: "Invalid correction, target or expected marker",
      conflict: "Archived intervention methods cannot be used",
    }
  );

  return getCorrection(client, correctionId);
}

/** List corrections for a client or organization. */
export async function listCorrections(
  client: SupabaseClient,
  rawQuery: unknown
): Promise<Page<Correction>> {
  const query = validate(listCorrectionsQuerySchema, rawQuery ?? {});

  let request = client
    .from("corrections")
    .select("*")
    .eq("organization_id", query.organizationId)
    .is("archived_at", null)
    .order("id", { ascending: true })
    .limit(query.limit + 1);

  if (query.clientId) request = request.eq("client_id", query.clientId);
  if (query.recommendationId) request = request.eq("recommendation_id", query.recommendationId);
  if (query.status) request = request.eq("status", query.status);
  if (query.cursor) request = request.gt("id", decodeCursor(query.cursor));

  const { data, error } = await request;
  if (error) throw new ServiceError("INTERNAL_ERROR", "Failed to list corrections");

  return toPage((data ?? []) as Correction[], query.limit, (last) => encodeCursor(last.id));
}

/** Read one correction with all targets and expected markers. */
export async function getCorrection(
  client: SupabaseClient,
  correctionId: string
): Promise<CorrectionDetail> {
  const { data, error } = await client
    .from("corrections")
    .select("*")
    .eq("id", validate(uuid, correctionId))
    .maybeSingle();
  if (error) throw new ServiceError("INTERNAL_ERROR", "Failed to read correction");
  if (!data) throw new ServiceError("NOT_FOUND", "Correction not found");

  const [targets, markers] = await Promise.all([
    client
      .from("correction_targets")
      .select("*")
      .eq("correction_id", correctionId)
      .order("created_at", { ascending: true }),
    client
      .from("correction_expected_markers")
      .select("*")
      .eq("correction_id", correctionId)
      .order("created_at", { ascending: true }),
  ]);
  if (targets.error) throw new ServiceError("INTERNAL_ERROR", "Failed to read correction targets");
  if (markers.error)
    throw new ServiceError("INTERNAL_ERROR", "Failed to read correction expected markers");

  return {
    ...(data as Correction),
    targets: (targets.data ?? []) as CorrectionTarget[],
    expected_markers: (markers.data ?? []) as CorrectionExpectedMarker[],
  };
}

/**
 * Update a correction. Status transition to completed requires expected markers.
 *
 * The update and its audit row are written by one atomic RPC; the "expected
 * markers present" rule and the consent gates are re-checked inside that
 * transaction, so a completed correction can never exist without markers and a
 * failed audit append leaves the previous correction untouched.
 */
export async function updateCorrection(
  client: SupabaseClient,
  rawInput: unknown
): Promise<CorrectionDetail> {
  const input = validate(updateCorrectionSchema, rawInput);
  await requireUserId(client);

  const before = await getCorrection(client, input.correctionId);
  if (before.archived_at !== null) {
    throw new ServiceError("CONFLICT", "Archived corrections cannot be edited");
  }

  if (input.status === "completed") {
    const markerCount = await countExpectedMarkers(client, before.id);
    if (markerCount === 0) {
      throw new ServiceError(
        "VALIDATION_ERROR",
        "Expected markers must be captured before completing a correction"
      );
    }
    await requireConsent(client, before.client_id, "data_storage");
    await requireConsent(client, before.client_id, "sensitive_psychological_data");
  }

  const patch: Record<string, unknown> = {};
  if (input.title !== undefined) patch.title = input.title;
  if (input.date !== undefined) patch.date = input.date;
  if (input.methodNotes !== undefined) patch.method_notes = input.methodNotes;
  if (input.rationale !== undefined) patch.rationale = input.rationale;
  if (input.expectedEffect !== undefined) patch.expected_effect = input.expectedEffect;
  if (input.specialistNotes !== undefined) patch.specialist_notes = input.specialistNotes;
  if (input.clientVisibleSummary !== undefined) {
    patch.client_visible_summary = input.clientVisibleSummary;
    if (input.clientVisibleSummary) {
      await requireConsent(client, before.client_id, "client_portal");
    }
  }
  if (input.status !== undefined) patch.status = input.status;
  if (input.contraindicationsAcknowledged !== undefined) {
    patch.contraindications_acknowledged = input.contraindicationsAcknowledged;
  }

  if (Object.keys(patch).length === 0) {
    return before;
  }

  await runAtomicRpc<Correction>(
    client,
    "update_correction",
    {
      p_correction_id: before.id,
      p_patch: patch,
    },
    {
      forbidden: "You do not have permission to modify this correction",
      failure: "Failed to update correction",
      validation: "Invalid correction update",
      conflict: "Archived corrections cannot be edited",
    }
  );

  return getCorrection(client, before.id);
}

/**
 * Soft-delete a correction. The archive flag and its audit row are written by
 * one atomic RPC; an archived correction is idempotent and never produces a
 * second audit row.
 */
export async function archiveCorrection(
  client: SupabaseClient,
  correctionId: string
): Promise<void> {
  const id = validate(uuid, correctionId);
  const before = await getCorrection(client, id);
  if (before.archived_at !== null) return;

  await runAtomicRpc<void>(
    client,
    "archive_correction",
    { p_correction_id: before.id },
    {
      forbidden: "You do not have permission to modify this correction",
      failure: "Failed to archive correction",
      validation: "Correction not found",
    }
  );
}

export { createFromRecommendationSchema, updateCorrectionSchema, listCorrectionsQuerySchema };
