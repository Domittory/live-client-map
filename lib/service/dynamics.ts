import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { ServiceError } from "./errors";
import {
  SNAPSHOT_CATEGORIES,
  diffSnapshots,
  getSnapshot,
  type PsychologicalSnapshot,
  type SnapshotContent,
  type SnapshotDiff,
} from "./snapshots";
import { uuid, validate } from "./validation";

/**
 * Dynamics & History read model (ticket 49, SPEC §25, §26).
 *
 * Answers the question "what changed since last time" from stored, immutable
 * sources only — the history is NEVER recomputed or reinterpreted here:
 *
 *   - getClientTimeline merges diagnostic sessions, corrections, follow-ups,
 *     ModelChange records and snapshot versions into one chronological list.
 *     Every event carries the id and route of its source so the specialist can
 *     navigate to the original record (and to the evidence drawer for
 *     model changes on evidence-backed entities).
 *   - compareSnapshotVersions diffs two stored snapshots with the same
 *     deterministic diff used at generation time (lib/service/snapshots.ts),
 *     so before/after values always match the stored immutable content.
 *
 * This module reads through the regular RLS-scoped client (is_client_accessible
 * policies), performs no mutations and therefore writes no audit entries.
 */

export const TIMELINE_EVENT_TYPES = [
  "diagnostic_session",
  "correction",
  "follow_up",
  "model_change",
  "snapshot",
] as const;

export type TimelineEventType = (typeof TIMELINE_EVENT_TYPES)[number];

/** Entity types that have an evidence drawer (app/clients/[id]/evidence/...). */
export const EVIDENCE_ENTITY_TYPES = ["core_node", "theme", "differential_hypothesis"] as const;

export interface TimelineEvent {
  type: TimelineEventType;
  /** Event time used for chronological ordering (ISO string). */
  occurredAt: string;
  title: string;
  details: string | null;
  /** Id of the source record (session, correction, follow-up, change, snapshot). */
  sourceId: string;
  /** Route to the source record page, null when no page exists for it. */
  sourceRoute: string | null;
  /** Route to the evidence drawer, only for evidence-backed model changes. */
  evidenceRoute: string | null;
}

/** Row shapes read from the existing tables (local interfaces, not Tables<>). */
export interface TimelineSessionRow {
  id: string;
  title: string;
  session_type: string;
  performed_at: string | null;
  created_at: string;
}

export interface TimelineCorrectionRow {
  id: string;
  title: string;
  status: string;
  date: string;
  created_at: string;
}

export interface TimelineFollowUpRow {
  id: string;
  correction_id: string;
  result_status: string;
  scheduled_at: string;
  completed_at: string | null;
  created_at: string;
}

export interface TimelineModelChangeRow {
  id: string;
  entity_type: string;
  entity_id: string;
  change_reason: string;
  occurred_at: string;
  evidence_refs: string[];
}

export interface TimelineSnapshotRow {
  id: string;
  version: number;
  generated_at: string;
  reason: string;
  model_hash: string;
}

export interface TimelineRows {
  sessions: TimelineSessionRow[];
  corrections: TimelineCorrectionRow[];
  followUps: TimelineFollowUpRow[];
  modelChanges: TimelineModelChangeRow[];
  snapshots: TimelineSnapshotRow[];
}

export const timelineQuerySchema = z
  .object({
    organizationId: uuid,
    clientId: uuid,
  })
  .strict();

export const compareSnapshotVersionsQuerySchema = z
  .object({
    fromSnapshotId: uuid,
    toSnapshotId: uuid,
  })
  .strict();

export type CompareSnapshotVersionsQuery = z.infer<typeof compareSnapshotVersionsQuerySchema>;

/** Per-source read cap: the timeline shows recent history, not a full export. */
const TIMELINE_SOURCE_LIMIT = 200;

function isEvidenceEntityType(
  entityType: string
): entityType is (typeof EVIDENCE_ENTITY_TYPES)[number] {
  return (EVIDENCE_ENTITY_TYPES as readonly string[]).includes(entityType);
}

/**
 * Merge the source rows into one chronological timeline (pure).
 * Ordering: occurredAt ascending; ties are broken deterministically by event
 * type (declaration order of TIMELINE_EVENT_TYPES) and then by source id.
 * An empty input yields an empty timeline — no synthesized conclusions.
 */
export function buildTimeline(clientId: string, rows: TimelineRows): TimelineEvent[] {
  const events: TimelineEvent[] = [];

  for (const session of rows.sessions) {
    events.push({
      type: "diagnostic_session",
      occurredAt: session.performed_at ?? session.created_at,
      title: session.title,
      details: `Тип сессии: ${session.session_type}`,
      sourceId: session.id,
      // Diagnostic sessions have no dedicated detail page yet.
      sourceRoute: null,
      evidenceRoute: null,
    });
  }

  for (const correction of rows.corrections) {
    events.push({
      type: "correction",
      occurredAt: correction.created_at,
      title: correction.title,
      details: `Статус: ${correction.status}; дата: ${correction.date}`,
      sourceId: correction.id,
      sourceRoute: `/corrections/${correction.id}`,
      evidenceRoute: null,
    });
  }

  for (const followUp of rows.followUps) {
    events.push({
      type: "follow_up",
      occurredAt: followUp.completed_at ?? followUp.scheduled_at,
      title: `Follow-up: ${followUp.result_status}`,
      details: followUp.completed_at
        ? `Завершён ${followUp.completed_at}`
        : `Запланирован на ${followUp.scheduled_at}`,
      sourceId: followUp.id,
      // Follow-ups are shown on the page of their correction.
      sourceRoute: `/corrections/${followUp.correction_id}`,
      evidenceRoute: null,
    });
  }

  for (const change of rows.modelChanges) {
    events.push({
      type: "model_change",
      occurredAt: change.occurred_at,
      title: change.change_reason,
      details: `${change.entity_type} ${change.entity_id}; evidence: ${change.evidence_refs.length}`,
      sourceId: change.id,
      sourceRoute: change.entity_type === "core_node" ? `/core-nodes/${change.entity_id}` : null,
      evidenceRoute: isEvidenceEntityType(change.entity_type)
        ? `/clients/${clientId}/evidence/${change.entity_type}/${change.entity_id}`
        : null,
    });
  }

  for (const snapshot of rows.snapshots) {
    events.push({
      type: "snapshot",
      occurredAt: snapshot.generated_at,
      title: `Snapshot v${snapshot.version}`,
      details: `${snapshot.reason}; hash ${snapshot.model_hash.slice(0, 12)}…`,
      sourceId: snapshot.id,
      sourceRoute: `/snapshots?clientId=${clientId}&snapshotId=${snapshot.id}`,
      evidenceRoute: null,
    });
  }

  const typeOrder = new Map<string, number>(
    TIMELINE_EVENT_TYPES.map((type, index) => [type, index])
  );
  events.sort(
    (a, b) =>
      a.occurredAt.localeCompare(b.occurredAt) ||
      (typeOrder.get(a.type) ?? 0) - (typeOrder.get(b.type) ?? 0) ||
      a.sourceId.localeCompare(b.sourceId)
  );
  return events;
}

/**
 * Combined chronological timeline for a client (RLS-enforced reads of the
 * existing tables only — no history recomputation).
 */
export async function getClientTimeline(
  client: SupabaseClient,
  rawQuery: unknown
): Promise<TimelineEvent[]> {
  const query = validate(timelineQuerySchema, rawQuery ?? {});

  const [sessions, corrections, followUps, modelChanges, snapshots] = await Promise.all([
    client
      .from("diagnostic_sessions")
      .select("id, title, session_type, performed_at, created_at")
      .eq("organization_id", query.organizationId)
      .eq("client_id", query.clientId)
      .order("created_at", { ascending: true })
      .limit(TIMELINE_SOURCE_LIMIT),
    client
      .from("corrections")
      .select("id, title, status, date, created_at")
      .eq("organization_id", query.organizationId)
      .eq("client_id", query.clientId)
      .order("created_at", { ascending: true })
      .limit(TIMELINE_SOURCE_LIMIT),
    client
      .from("follow_ups")
      .select("id, correction_id, result_status, scheduled_at, completed_at, created_at")
      .eq("organization_id", query.organizationId)
      .eq("client_id", query.clientId)
      .order("created_at", { ascending: true })
      .limit(TIMELINE_SOURCE_LIMIT),
    client
      .from("model_changes")
      .select("id, entity_type, entity_id, change_reason, occurred_at, evidence_refs")
      .eq("organization_id", query.organizationId)
      .eq("client_id", query.clientId)
      .order("occurred_at", { ascending: true })
      .limit(TIMELINE_SOURCE_LIMIT),
    client
      .from("psychological_snapshots")
      .select("id, version, generated_at, reason, model_hash")
      .eq("organization_id", query.organizationId)
      .eq("client_id", query.clientId)
      .order("version", { ascending: true })
      .limit(TIMELINE_SOURCE_LIMIT),
  ]);

  for (const result of [sessions, corrections, followUps, modelChanges, snapshots]) {
    if (result.error) {
      throw new ServiceError("INTERNAL_ERROR", "Failed to assemble client timeline");
    }
  }

  return buildTimeline(query.clientId, {
    sessions: (sessions.data ?? []) as TimelineSessionRow[],
    corrections: (corrections.data ?? []) as TimelineCorrectionRow[],
    followUps: (followUps.data ?? []) as TimelineFollowUpRow[],
    modelChanges: (modelChanges.data ?? []) as TimelineModelChangeRow[],
    snapshots: (snapshots.data ?? []) as TimelineSnapshotRow[],
  });
}

function snapshotContent(snapshot: PsychologicalSnapshot): SnapshotContent {
  return Object.fromEntries(
    SNAPSHOT_CATEGORIES.map((category) => [category, snapshot[category] ?? []])
  ) as SnapshotContent;
}

export interface SnapshotVersionsComparison {
  from: PsychologicalSnapshot;
  to: PsychologicalSnapshot;
  changes: SnapshotDiff;
}

/**
 * Before/after comparison of two stored snapshot versions of the same client
 * (SPEC §26). The diff is recomputed deterministically from the immutable
 * stored contents, so it always matches what is stored in the snapshots.
 */
export async function compareSnapshotVersions(
  client: SupabaseClient,
  rawQuery: unknown
): Promise<SnapshotVersionsComparison> {
  const query = validate(compareSnapshotVersionsQuerySchema, rawQuery ?? {});
  const from = await getSnapshot(client, query.fromSnapshotId);
  const to = await getSnapshot(client, query.toSnapshotId);

  if (from.client_id !== to.client_id) {
    throw new ServiceError("VALIDATION_ERROR", "Snapshots belong to different clients");
  }
  if (from.version >= to.version) {
    throw new ServiceError(
      "VALIDATION_ERROR",
      "The 'from' snapshot must be an older version than the 'to' snapshot"
    );
  }

  return {
    from,
    to,
    changes: diffSnapshots(snapshotContent(from), snapshotContent(to)),
  };
}
