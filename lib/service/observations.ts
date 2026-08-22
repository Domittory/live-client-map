import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { withAudit } from "./audit";
import { requireConsent } from "./consent";
import { ServiceError } from "./errors";
import { decodeCursor, encodeCursor, pageQuerySchema, toPage, type Page } from "./pagination";
import { uuid, validate } from "./validation";

/** Observation source types (SPEC §8.28, ticket 40). */
export type ObservationSourceType =
  "specialist_observation" | "client_report" | "measurement" | "external_report";

/** Observation valence. */
export type ObservationValence = "positive" | "negative" | "neutral";

/** Observation visibility: private (specialist only) or client_visible. */
export type ObservationVisibility = "private" | "client_visible";

/** Behavioral marker measurement types (SPEC §8.29; mirrors expected markers). */
export type MarkerType = "scale" | "boolean" | "frequency" | "subjective" | "behavioral_count";

/**
 * Behavioral marker trend. Deterministic: compares current_value with
 * baseline_value using a 5%-of-scale epsilon (higher-is-better semantics).
 */
export type MarkerTrend = "improving" | "stable" | "worsening" | "unknown";

/** Evidence link entity types supported by validate_behavioral_marker_link. */
export type MarkerLinkType = "core_node" | "theme" | "resource";

export const OBSERVATION_INTENSITY_MIN = 1;
export const OBSERVATION_INTENSITY_MAX = 10;
export const OBSERVATION_CONFIDENCE_MIN = 0;
export const OBSERVATION_CONFIDENCE_MAX = 100;

export interface Observation {
  id: string;
  organization_id: string;
  client_id: string;
  correction_id: string | null;
  date: string;
  source_type: ObservationSourceType;
  description: string;
  life_areas: string[];
  valence: ObservationValence;
  intensity: number;
  supports_improvement: boolean;
  confidence: number;
  visibility: ObservationVisibility;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface BehavioralMarker {
  id: string;
  organization_id: string;
  client_id: string;
  name: string;
  description: string | null;
  life_area: string | null;
  marker_type: MarkerType;
  scale_min: number;
  scale_max: number;
  current_value: number | null;
  baseline_value: number | null;
  trend: MarkerTrend;
  linked_core_node_id: string | null;
  linked_theme_id: string | null;
  linked_resource_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface BehavioralMarkerEntry {
  id: string;
  marker_id: string;
  value: number;
  note: string | null;
  recorded_by: string | null;
  recorded_at: string;
}

export interface BehavioralMarkerDetail extends BehavioralMarker {
  entries: BehavioralMarkerEntry[];
}

const sourceType = z.enum([
  "specialist_observation",
  "client_report",
  "measurement",
  "external_report",
]);
const valence = z.enum(["positive", "negative", "neutral"]);
const visibility = z.enum(["private", "client_visible"]);
const markerType = z.enum(["scale", "boolean", "frequency", "subjective", "behavioral_count"]);

const intensity = z.number().int().min(OBSERVATION_INTENSITY_MIN).max(OBSERVATION_INTENSITY_MAX);
const confidence = z.number().int().min(OBSERVATION_CONFIDENCE_MIN).max(OBSERVATION_CONFIDENCE_MAX);
const lifeAreas = z.array(z.string().trim().min(1).max(200)).max(20).default([]);

const createObservationSchema = z
  .object({
    organizationId: uuid,
    clientId: uuid,
    correctionId: uuid.optional(),
    date: z.string().date().optional(),
    sourceType,
    description: z.string().trim().min(1).max(4000),
    lifeAreas,
    valence,
    intensity,
    supportsImprovement: z.boolean().default(false),
    confidence,
    visibility: visibility.default("private"),
  })
  .strict();

export type CreateObservationInput = z.infer<typeof createObservationSchema>;

const updateObservationSchema = z
  .object({
    observationId: uuid,
    date: z.string().date().optional(),
    sourceType: sourceType.optional(),
    description: z.string().trim().min(1).max(4000).optional(),
    lifeAreas: lifeAreas.optional(),
    valence: valence.optional(),
    intensity: intensity.optional(),
    supportsImprovement: z.boolean().optional(),
    confidence: confidence.optional(),
    visibility: visibility.optional(),
  })
  .strict();

export type UpdateObservationInput = z.infer<typeof updateObservationSchema>;

const listObservationsQuerySchema = pageQuerySchema.extend({
  organizationId: uuid,
  clientId: uuid.optional(),
  correctionId: uuid.optional(),
  sourceType: sourceType.optional(),
  // Client-facing contexts must pass visibility="client_visible" so private
  // observations never leak to the client portal (ticket 40 acceptance).
  visibility: visibility.optional(),
});

const markerLinksSchema = {
  linkedCoreNodeId: uuid.nullable().optional(),
  linkedThemeId: uuid.nullable().optional(),
  linkedResourceId: uuid.nullable().optional(),
} as const;

const createMarkerSchema = z
  .object({
    organizationId: uuid,
    clientId: uuid,
    name: z.string().trim().min(1).max(500),
    description: z.string().trim().min(1).max(4000).optional(),
    lifeArea: z.string().trim().min(1).max(200).optional(),
    markerType,
    scaleMin: z.number().default(0),
    scaleMax: z.number().default(10),
    baselineValue: z.number().optional(),
    currentValue: z.number().optional(),
    ...markerLinksSchema,
  })
  .strict()
  .refine((input) => input.scaleMin < input.scaleMax, {
    message: "scaleMin must be less than scaleMax",
  });

export type CreateMarkerInput = z.infer<typeof createMarkerSchema>;

// baselineValue, currentValue and trend are intentionally absent: the baseline
// is immutable after creation and current/trend change only via
// recordMarkerValue, which appends a history entry (ticket 40 acceptance).
const updateMarkerSchema = z
  .object({
    markerId: uuid,
    name: z.string().trim().min(1).max(500).optional(),
    description: z.string().trim().min(1).max(4000).nullable().optional(),
    lifeArea: z.string().trim().min(1).max(200).nullable().optional(),
    markerType: markerType.optional(),
    scaleMin: z.number().optional(),
    scaleMax: z.number().optional(),
    ...markerLinksSchema,
  })
  .strict();

export type UpdateMarkerInput = z.infer<typeof updateMarkerSchema>;

const listMarkersQuerySchema = pageQuerySchema.extend({
  organizationId: uuid,
  clientId: uuid.optional(),
  markerType: markerType.optional(),
});

const recordMarkerValueSchema = z
  .object({
    markerId: uuid,
    value: z.number(),
    note: z.string().trim().min(1).max(2000).optional(),
  })
  .strict();

export type RecordMarkerValueInput = z.infer<typeof recordMarkerValueSchema>;

/**
 * Deterministic trend computation: compares the current value with the
 * baseline using an epsilon of 5% of the scale range. Values above the
 * baseline count as improving (higher-is-better semantics; the specialist
 * defines the scale direction when creating the marker).
 */
export function computeTrend(
  currentValue: number | null,
  baselineValue: number | null,
  scaleMin: number,
  scaleMax: number
): MarkerTrend {
  if (currentValue === null || baselineValue === null) return "unknown";
  const epsilon = (scaleMax - scaleMin) * 0.05;
  const diff = currentValue - baselineValue;
  if (Math.abs(diff) <= epsilon) return "stable";
  return diff > 0 ? "improving" : "worsening";
}

/** Whether a marker value fits the marker's scale range. */
export function isValueInScale(value: number, scaleMin: number, scaleMax: number): boolean {
  return value >= scaleMin && value <= scaleMax;
}

async function requireUserId(client: SupabaseClient): Promise<string> {
  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user) throw new ServiceError("UNAUTHORIZED", "Authentication required");
  return user.id;
}

function mapWriteError(error: { code?: string }, fallback: string): ServiceError {
  if (error.code === "42501") {
    return new ServiceError("FORBIDDEN", "You do not have permission to modify this record");
  }
  return new ServiceError("INTERNAL_ERROR", fallback);
}

async function requireObservationConsents(
  client: SupabaseClient,
  clientId: string,
  targetVisibility: ObservationVisibility
): Promise<void> {
  await requireConsent(client, clientId, "data_storage");
  await requireConsent(client, clientId, "sensitive_psychological_data");
  if (targetVisibility === "client_visible") {
    await requireConsent(client, clientId, "client_portal");
  }
}

/** Verify that an optional correction reference belongs to the same org/client. */
async function requireCorrectionInScope(
  client: SupabaseClient,
  correctionId: string,
  organizationId: string,
  clientId: string
): Promise<void> {
  const { data, error } = await client
    .from("corrections")
    .select("id")
    .eq("id", correctionId)
    .eq("organization_id", organizationId)
    .eq("client_id", clientId)
    .maybeSingle();
  if (error) throw new ServiceError("INTERNAL_ERROR", "Failed to read correction");
  if (!data) {
    throw new ServiceError("VALIDATION_ERROR", `Invalid correction reference: ${correctionId}`);
  }
}

async function validateMarkerLinks(
  client: SupabaseClient,
  links: { type: MarkerLinkType; id: string | null | undefined }[],
  organizationId: string,
  clientId: string
): Promise<void> {
  for (const link of links) {
    if (!link.id) continue;
    const { data: valid, error } = await client.rpc("validate_behavioral_marker_link", {
      p_link_type: link.type,
      p_link_id: link.id,
      p_organization_id: organizationId,
      p_client_id: clientId,
    });
    if (error) throw new ServiceError("INTERNAL_ERROR", "Failed to validate marker link");
    if (!valid) {
      throw new ServiceError("VALIDATION_ERROR", `Invalid link: ${link.type} ${link.id}`);
    }
  }
}

function assertValueInScale(value: number, scaleMin: number, scaleMax: number): void {
  if (!isValueInScale(value, scaleMin, scaleMax)) {
    throw new ServiceError(
      "VALIDATION_ERROR",
      `Value ${value} is outside the marker scale [${scaleMin}, ${scaleMax}]`
    );
  }
}

/**
 * Record an Observation (ticket 40). Enforces consent gates and validates the
 * optional correction reference against the same organization/client.
 */
export async function createObservation(
  client: SupabaseClient,
  rawInput: unknown
): Promise<Observation> {
  const input = validate(createObservationSchema, rawInput);
  const userId = await requireUserId(client);

  await requireObservationConsents(client, input.clientId, input.visibility);

  if (input.correctionId) {
    await requireCorrectionInScope(
      client,
      input.correctionId,
      input.organizationId,
      input.clientId
    );
  }

  return withAudit(
    client,
    {
      organizationId: input.organizationId,
      entityType: "observation",
      action: "observation.create",
      reason: input.correctionId ? `Linked to correction ${input.correctionId}` : undefined,
    },
    async () => {
      const { data, error } = await client
        .from("observations")
        .insert({
          organization_id: input.organizationId,
          client_id: input.clientId,
          correction_id: input.correctionId ?? null,
          date: input.date ?? new Date().toISOString().slice(0, 10),
          source_type: input.sourceType,
          description: input.description,
          life_areas: input.lifeAreas,
          valence: input.valence,
          intensity: input.intensity,
          supports_improvement: input.supportsImprovement,
          confidence: input.confidence,
          visibility: input.visibility,
          created_by: userId,
        })
        .select()
        .single();
      if (error) throw mapWriteError(error, "Failed to create observation");
      return data as Observation;
    }
  );
}

/** List observations; pass visibility="client_visible" for client-facing reads. */
export async function listObservations(
  client: SupabaseClient,
  rawQuery: unknown
): Promise<Page<Observation>> {
  const query = validate(listObservationsQuerySchema, rawQuery ?? {});

  let request = client
    .from("observations")
    .select("*")
    .eq("organization_id", query.organizationId)
    .order("id", { ascending: true })
    .limit(query.limit + 1);

  if (query.clientId) request = request.eq("client_id", query.clientId);
  if (query.correctionId) request = request.eq("correction_id", query.correctionId);
  if (query.sourceType) request = request.eq("source_type", query.sourceType);
  if (query.visibility) request = request.eq("visibility", query.visibility);
  if (query.cursor) request = request.gt("id", decodeCursor(query.cursor));

  const { data, error } = await request;
  if (error) throw new ServiceError("INTERNAL_ERROR", "Failed to list observations");

  return toPage((data ?? []) as Observation[], query.limit, (last) => encodeCursor(last.id));
}

/** Read one observation. */
export async function getObservation(
  client: SupabaseClient,
  observationId: string
): Promise<Observation> {
  const { data, error } = await client
    .from("observations")
    .select("*")
    .eq("id", validate(uuid, observationId))
    .maybeSingle();
  if (error) throw new ServiceError("INTERNAL_ERROR", "Failed to read observation");
  if (!data) throw new ServiceError("NOT_FOUND", "Observation not found");
  return data as Observation;
}

/** Update an observation. Switching to client_visible requires client_portal consent. */
export async function updateObservation(
  client: SupabaseClient,
  rawInput: unknown
): Promise<Observation> {
  const input = validate(updateObservationSchema, rawInput);
  await requireUserId(client);

  const before = await getObservation(client, input.observationId);

  const patch: Record<string, unknown> = {};
  if (input.date !== undefined) patch.date = input.date;
  if (input.sourceType !== undefined) patch.source_type = input.sourceType;
  if (input.description !== undefined) patch.description = input.description;
  if (input.lifeAreas !== undefined) patch.life_areas = input.lifeAreas;
  if (input.valence !== undefined) patch.valence = input.valence;
  if (input.intensity !== undefined) patch.intensity = input.intensity;
  if (input.supportsImprovement !== undefined) {
    patch.supports_improvement = input.supportsImprovement;
  }
  if (input.confidence !== undefined) patch.confidence = input.confidence;
  if (input.visibility !== undefined) {
    if (input.visibility === "client_visible" && before.visibility !== "client_visible") {
      await requireObservationConsents(client, before.client_id, "client_visible");
    }
    patch.visibility = input.visibility;
  }
  patch.updated_at = new Date().toISOString();

  if (Object.keys(patch).length === 1 && patch.updated_at) {
    return before;
  }

  const updated = await withAudit(
    client,
    {
      organizationId: before.organization_id,
      entityType: "observation",
      entityId: before.id,
      action: "observation.update",
      before,
      after: { ...before, ...patch },
    },
    async () => {
      const { data, error } = await client
        .from("observations")
        .update(patch)
        .eq("id", before.id)
        .select()
        .single();
      if (error) throw mapWriteError(error, "Failed to update observation");
      if (!data) throw new ServiceError("NOT_FOUND", "Observation not found");
      return data as Observation;
    }
  );

  return updated;
}

/**
 * Create a BehavioralMarker (ticket 40). The baseline is captured here and is
 * never overwritten afterwards; when provided it also seeds the value history.
 */
export async function createMarker(
  client: SupabaseClient,
  rawInput: unknown
): Promise<BehavioralMarkerDetail> {
  const input = validate(createMarkerSchema, rawInput);
  const userId = await requireUserId(client);

  await requireConsent(client, input.clientId, "data_storage");
  await requireConsent(client, input.clientId, "sensitive_psychological_data");

  if (input.baselineValue !== undefined) {
    assertValueInScale(input.baselineValue, input.scaleMin, input.scaleMax);
  }
  if (input.currentValue !== undefined) {
    assertValueInScale(input.currentValue, input.scaleMin, input.scaleMax);
  }

  await validateMarkerLinks(
    client,
    [
      { type: "core_node", id: input.linkedCoreNodeId },
      { type: "theme", id: input.linkedThemeId },
      { type: "resource", id: input.linkedResourceId },
    ],
    input.organizationId,
    input.clientId
  );

  const baseline = input.baselineValue ?? null;
  const current = input.currentValue ?? null;
  const trend = computeTrend(current, baseline, input.scaleMin, input.scaleMax);

  const marker = await withAudit(
    client,
    {
      organizationId: input.organizationId,
      entityType: "behavioral_marker",
      action: "behavioral_marker.create",
    },
    async () => {
      const { data, error } = await client
        .from("behavioral_markers")
        .insert({
          organization_id: input.organizationId,
          client_id: input.clientId,
          name: input.name,
          description: input.description ?? null,
          life_area: input.lifeArea ?? null,
          marker_type: input.markerType,
          scale_min: input.scaleMin,
          scale_max: input.scaleMax,
          current_value: current,
          baseline_value: baseline,
          trend,
          linked_core_node_id: input.linkedCoreNodeId ?? null,
          linked_theme_id: input.linkedThemeId ?? null,
          linked_resource_id: input.linkedResourceId ?? null,
        })
        .select()
        .single();
      if (error) throw mapWriteError(error, "Failed to create behavioral marker");
      return data as BehavioralMarker;
    }
  );

  if (baseline !== null) {
    const { error } = await client.from("behavioral_marker_entries").insert({
      marker_id: marker.id,
      value: baseline,
      note: "baseline",
      recorded_by: userId,
    });
    if (error) throw mapWriteError(error, "Failed to record baseline entry");
  }

  return getMarker(client, marker.id);
}

/** List behavioral markers for a client or organization. */
export async function listMarkers(
  client: SupabaseClient,
  rawQuery: unknown
): Promise<Page<BehavioralMarker>> {
  const query = validate(listMarkersQuerySchema, rawQuery ?? {});

  let request = client
    .from("behavioral_markers")
    .select("*")
    .eq("organization_id", query.organizationId)
    .order("id", { ascending: true })
    .limit(query.limit + 1);

  if (query.clientId) request = request.eq("client_id", query.clientId);
  if (query.markerType) request = request.eq("marker_type", query.markerType);
  if (query.cursor) request = request.gt("id", decodeCursor(query.cursor));

  const { data, error } = await request;
  if (error) throw new ServiceError("INTERNAL_ERROR", "Failed to list behavioral markers");

  return toPage((data ?? []) as BehavioralMarker[], query.limit, (last) => encodeCursor(last.id));
}

/** Read one marker with its value history (oldest first). */
export async function getMarker(
  client: SupabaseClient,
  markerId: string
): Promise<BehavioralMarkerDetail> {
  const { data, error } = await client
    .from("behavioral_markers")
    .select("*")
    .eq("id", validate(uuid, markerId))
    .maybeSingle();
  if (error) throw new ServiceError("INTERNAL_ERROR", "Failed to read behavioral marker");
  if (!data) throw new ServiceError("NOT_FOUND", "Behavioral marker not found");

  const entries = await client
    .from("behavioral_marker_entries")
    .select("*")
    .eq("marker_id", markerId)
    .order("recorded_at", { ascending: true })
    .order("id", { ascending: true });
  if (entries.error) {
    throw new ServiceError("INTERNAL_ERROR", "Failed to read behavioral marker history");
  }

  return {
    ...(data as BehavioralMarker),
    entries: (entries.data ?? []) as BehavioralMarkerEntry[],
  };
}

/**
 * Update marker metadata and evidence links. Baseline cannot be changed here
 * (the schema carries no baseline field); current value changes go through
 * recordMarkerValue so every change lands in the history.
 */
export async function updateMarker(
  client: SupabaseClient,
  rawInput: unknown
): Promise<BehavioralMarkerDetail> {
  const input = validate(updateMarkerSchema, rawInput);
  await requireUserId(client);

  const before = await getMarker(client, input.markerId);

  await validateMarkerLinks(
    client,
    [
      { type: "core_node", id: input.linkedCoreNodeId },
      { type: "theme", id: input.linkedThemeId },
      { type: "resource", id: input.linkedResourceId },
    ],
    before.organization_id,
    before.client_id
  );

  const scaleMin = input.scaleMin ?? before.scale_min;
  const scaleMax = input.scaleMax ?? before.scale_max;
  if (scaleMin >= scaleMax) {
    throw new ServiceError("VALIDATION_ERROR", "scaleMin must be less than scaleMax");
  }

  const patch: Record<string, unknown> = {};
  if (input.name !== undefined) patch.name = input.name;
  if (input.description !== undefined) patch.description = input.description;
  if (input.lifeArea !== undefined) patch.life_area = input.lifeArea;
  if (input.markerType !== undefined) patch.marker_type = input.markerType;
  if (input.scaleMin !== undefined) patch.scale_min = input.scaleMin;
  if (input.scaleMax !== undefined) patch.scale_max = input.scaleMax;
  if (input.linkedCoreNodeId !== undefined) patch.linked_core_node_id = input.linkedCoreNodeId;
  if (input.linkedThemeId !== undefined) patch.linkedThemeId = input.linkedThemeId;
  if (input.linkedResourceId !== undefined) patch.linked_resource_id = input.linkedResourceId;
  patch.updated_at = new Date().toISOString();

  if (Object.keys(patch).length === 1 && patch.updated_at) {
    return before;
  }

  const updated = await withAudit(
    client,
    {
      organizationId: before.organization_id,
      entityType: "behavioral_marker",
      entityId: before.id,
      action: "behavioral_marker.update",
      before,
      after: { ...before, ...patch },
    },
    async () => {
      const { data, error } = await client
        .from("behavioral_markers")
        .update(patch)
        .eq("id", before.id)
        .select()
        .single();
      if (error) throw mapWriteError(error, "Failed to update behavioral marker");
      if (!data) throw new ServiceError("NOT_FOUND", "Behavioral marker not found");
      return data as BehavioralMarker;
    }
  );

  return getMarker(client, updated.id);
}

/**
 * Record a new current value: appends a history entry and recomputes the
 * trend relative to the baseline. Never touches baseline_value.
 */
export async function recordMarkerValue(
  client: SupabaseClient,
  rawInput: unknown
): Promise<BehavioralMarkerDetail> {
  const input = validate(recordMarkerValueSchema, rawInput);
  const userId = await requireUserId(client);

  const before = await getMarker(client, input.markerId);
  assertValueInScale(input.value, before.scale_min, before.scale_max);

  const trend = computeTrend(
    input.value,
    before.baseline_value,
    before.scale_min,
    before.scale_max
  );
  const now = new Date().toISOString();

  const { error: entryError } = await client.from("behavioral_marker_entries").insert({
    marker_id: before.id,
    value: input.value,
    note: input.note ?? null,
    recorded_by: userId,
  });
  if (entryError) throw mapWriteError(entryError, "Failed to record marker value");

  await withAudit(
    client,
    {
      organizationId: before.organization_id,
      entityType: "behavioral_marker",
      entityId: before.id,
      action: "behavioral_marker.record_value",
      before: {
        current_value: before.current_value,
        baseline_value: before.baseline_value,
        trend: before.trend,
      },
      after: { current_value: input.value, baseline_value: before.baseline_value, trend },
      reason: input.note,
    },
    async () => {
      const { data, error } = await client
        .from("behavioral_markers")
        .update({ current_value: input.value, trend, updated_at: now })
        .eq("id", before.id)
        .select()
        .single();
      if (error) throw mapWriteError(error, "Failed to update marker current value");
      if (!data) throw new ServiceError("NOT_FOUND", "Behavioral marker not found");
      return data as BehavioralMarker;
    }
  );

  return getMarker(client, before.id);
}

export {
  createObservationSchema,
  updateObservationSchema,
  listObservationsQuerySchema,
  createMarkerSchema,
  updateMarkerSchema,
  listMarkersQuerySchema,
  recordMarkerValueSchema,
};
