import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { AI_CONTRACTS, MODEL_CONFIG } from "@/lib/ai/contracts";
import { withAudit } from "./audit";
import { requireConsent } from "./consent";
import { ServiceError } from "./errors";
import { decodeCursor, encodeCursor, pageQuerySchema, toPage, type Page } from "./pagination";
import { SCORING_MODEL_VERSION } from "./scoring";
import { uuid, validate } from "./validation";

/**
 * PsychologicalSnapshot (ticket 43, SPEC §8.32, §25).
 *
 * The snapshot is assembled DETERMINISTICALLY from the current tables — the
 * ai.generate-snapshot.v1 AI contract exists but is deliberately NOT used for
 * assembly: a reproducible client history requires that identical model state
 * and versions always produce an identical model_hash, which a narrative AI
 * call cannot guarantee. The AI contract stays available for narrative
 * summaries on top of the deterministic content in a later ticket.
 *
 * model_hash = sha256 of the canonical JSON of the assembled model content
 * plus the versions (scoring_model_version, ontology_version, ai_model,
 * prompt_version). Canonicalization sorts object keys and arrays, so key and
 * array ordering never affect the hash.
 *
 * Immutability: snapshots are append-only. The table has SELECT/INSERT
 * policies only and this module exposes no update/delete functions — a stored
 * snapshot is never rewritten. version is monotonic per client
 * (unique client_id + version).
 */

/** Snapshot categories (SPEC §25). Keys match the table columns. */
export const SNAPSHOT_CATEGORIES = [
  "active_core_nodes",
  "active_themes",
  "resource_state",
  "development_targets",
  "weakened_nodes",
  "reactivated_nodes",
  "recent_triggers",
  "recent_corrections",
  "current_requests",
  "recommendations",
] as const;

export type SnapshotCategory = (typeof SNAPSHOT_CATEGORIES)[number];

export type SnapshotItem = Record<string, unknown>;

/** Assembled deterministic model content (SPEC §25 categories). */
export type SnapshotContent = Record<SnapshotCategory, SnapshotItem[]>;

export interface SnapshotVersions {
  scoring_model_version: string;
  ontology_version: string;
  ai_model: string;
  prompt_version: string;
}

export interface PsychologicalSnapshot extends SnapshotVersions {
  id: string;
  organization_id: string;
  client_id: string;
  version: number;
  generated_at: string;
  generated_by: string | null;
  reason: string;
  summary: string;
  active_core_nodes: SnapshotItem[];
  active_themes: SnapshotItem[];
  resource_state: SnapshotItem[];
  development_targets: SnapshotItem[];
  weakened_nodes: SnapshotItem[];
  reactivated_nodes: SnapshotItem[];
  recent_triggers: SnapshotItem[];
  recent_corrections: SnapshotItem[];
  current_requests: SnapshotItem[];
  recommendations: SnapshotItem[];
  trend_summary: string;
  risk_notes: string;
  evidence_digest: string;
  changes_since_previous: SnapshotDiff | null;
  model_hash: string;
  created_at: string;
}

export interface CategoryDiff {
  added: string[];
  removed: string[];
  changed: { id: string; before: SnapshotItem; after: SnapshotItem }[];
}

/** "Changes since previous snapshot" (SPEC §25), per category. */
export type SnapshotDiff = Record<SnapshotCategory, CategoryDiff>;

const RECENT_WINDOW_DAYS = 30;
const TOP_RECOMMENDATIONS_LIMIT = 10;
const RISK_ZONE_THRESHOLD = 70;

const generateSnapshotSchema = z
  .object({
    clientId: uuid,
    reason: z.string().trim().min(1).max(2000),
  })
  .strict();

export type GenerateSnapshotInput = z.infer<typeof generateSnapshotSchema>;

const listSnapshotsQuerySchema = pageQuerySchema.extend({
  organizationId: uuid,
  clientId: uuid,
});

// --- Canonical JSON + model hash (pure) --------------------------------------

/**
 * Canonicalize a JSON value: object keys sorted, arrays sorted by their
 * canonical representation. Same logical content always canonicalizes to the
 * same string regardless of key or array order.
 */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    const items = value.map(canonicalJson);
    items.sort();
    return `[${items.join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/**
 * Deterministic model hash: sha256 of the canonical JSON of the model content
 * plus the versions. Identical model state and versions always give the
 * identical hash (repeatability); any difference changes it.
 */
export function computeModelHash(content: SnapshotContent, versions: SnapshotVersions): string {
  return createHash("sha256").update(canonicalJson({ content, versions })).digest("hex");
}

// --- Diff (pure) ---------------------------------------------------------------

function itemId(item: SnapshotItem): string {
  return String(item.id);
}

function diffCategory(before: SnapshotItem[], after: SnapshotItem[]): CategoryDiff {
  const beforeById = new Map(before.map((item) => [itemId(item), item]));
  const afterById = new Map(after.map((item) => [itemId(item), item]));

  const added: string[] = [];
  const changed: CategoryDiff["changed"] = [];
  for (const [id, afterItem] of afterById) {
    const beforeItem = beforeById.get(id);
    if (!beforeItem) {
      added.push(id);
    } else if (canonicalJson(beforeItem) !== canonicalJson(afterItem)) {
      changed.push({ id, before: beforeItem, after: afterItem });
    }
  }
  const removed = [...beforeById.keys()].filter((id) => !afterById.has(id));

  added.sort();
  removed.sort();
  changed.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { added, removed, changed };
}

/** Diff two assembled contents category by category (SPEC §25). */
export function diffSnapshots(previous: SnapshotContent, current: SnapshotContent): SnapshotDiff {
  return Object.fromEntries(
    SNAPSHOT_CATEGORIES.map((category) => [
      category,
      diffCategory(previous[category] ?? [], current[category] ?? []),
    ])
  ) as SnapshotDiff;
}

// --- Assembler ---------------------------------------------------------------

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

async function requireActiveOntologyVersion(client: SupabaseClient): Promise<string> {
  const { data, error } = await client
    .from("ontology_versions")
    .select("version")
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new ServiceError("INTERNAL_ERROR", "Failed to read ontology version");
  if (!data) throw new ServiceError("CONFLICT", "No active ontology version");
  return (data as { version: string }).version;
}

function byId(a: SnapshotItem, b: SnapshotItem): number {
  const aId = String(a.id);
  const bId = String(b.id);
  return aId < bId ? -1 : aId > bId ? 1 : 0;
}

/**
 * Deterministic snapshot assembler (SPEC §25): reads the current model tables
 * for the client and returns the content categories. Same DB state always
 * yields the same content (arrays sorted by id, only model fields included —
 * no timestamps except user-supplied occurred_at/date).
 */
export async function assembleSnapshotContent(
  client: SupabaseClient,
  clientId: string
): Promise<{
  content: SnapshotContent;
  trendSummary: string;
  riskNotes: string;
  evidenceDigest: string;
  summary: string;
}> {
  const recentCutoff = new Date(
    Date.now() - RECENT_WINDOW_DAYS * 24 * 60 * 60 * 1000
  ).toISOString();

  const [coreNodes, themes, resources, targets, triggers, corrections, requests, recs, signals] =
    await Promise.all([
      client
        .from("core_nodes")
        .select(
          "id, title, status, confidence_score, activation_score, strength_score, risk_score, trend, evidence_count, independent_evidence_count"
        )
        .eq("client_id", clientId),
      client
        .from("themes")
        .select("id, name, status, activity_score, confidence_score, trend")
        .eq("client_id", clientId)
        .eq("status", "active"),
      client
        .from("resources")
        .select("id, name, status, strength_score, confidence_score, trend")
        .eq("client_id", clientId)
        .eq("status", "active"),
      client
        .from("development_targets")
        .select("id, name, status, current_level, target_level, importance")
        .eq("client_id", clientId)
        .eq("status", "active"),
      client
        .from("triggers")
        .select("id, title, intensity, occurred_at")
        .eq("client_id", clientId)
        .gte("created_at", recentCutoff)
        .limit(100),
      client
        .from("corrections")
        .select("id, title, status, date")
        .eq("client_id", clientId)
        .is("archived_at", null)
        .gte("created_at", recentCutoff)
        .limit(100),
      client
        .from("client_requests")
        .select("id, title, priority, status")
        .eq("client_id", clientId)
        .eq("status", "active"),
      client
        .from("recommendations")
        .select("id, proposed_correction, status, final_priority_score, risk_score")
        .eq("client_id", clientId)
        .eq("status", "approved")
        .limit(100),
      client.from("signals").select("id, review_status").eq("client_id", clientId).limit(1000),
    ]);
  const results = [
    coreNodes,
    themes,
    resources,
    targets,
    triggers,
    corrections,
    requests,
    recs,
    signals,
  ];
  for (const result of results) {
    if (result.error) {
      throw new ServiceError("INTERNAL_ERROR", "Failed to assemble snapshot content");
    }
  }

  interface CoreNodeItem extends SnapshotItem {
    id: string;
    title: string;
    status: string;
    confidence_score: number | null;
    activation_score: number | null;
    strength_score: number | null;
    risk_score: number | null;
    trend: string | null;
    evidence_count: number;
    independent_evidence_count: number;
  }
  const nodeRows = ((coreNodes.data ?? []) as CoreNodeItem[]).sort(byId);
  const nodeItem = (node: CoreNodeItem): SnapshotItem => ({
    id: node.id,
    title: node.title,
    status: node.status,
    confidence_score: node.confidence_score,
    activation_score: node.activation_score,
    strength_score: node.strength_score,
    risk_score: node.risk_score,
    trend: node.trend,
  });

  const activeNodes = nodeRows.filter((node) => node.status === "active");
  const weakenedNodes = nodeRows.filter((node) => node.status === "weakened");
  const reactivatedNodes = nodeRows.filter((node) => node.status === "reactivated");

  interface RecommendationItem extends SnapshotItem {
    id: string;
    final_priority_score: number | null;
  }
  const recommendations = ((recs.data ?? []) as RecommendationItem[])
    .sort((a, b) => (b.final_priority_score ?? -1) - (a.final_priority_score ?? -1) || byId(a, b))
    .slice(0, TOP_RECOMMENDATIONS_LIMIT)
    .sort(byId);

  const content: SnapshotContent = {
    active_core_nodes: activeNodes.map(nodeItem),
    active_themes: ((themes.data ?? []) as SnapshotItem[]).sort(byId),
    resource_state: ((resources.data ?? []) as SnapshotItem[]).sort(byId),
    development_targets: ((targets.data ?? []) as SnapshotItem[]).sort(byId),
    weakened_nodes: weakenedNodes.map(nodeItem),
    reactivated_nodes: reactivatedNodes.map(nodeItem),
    recent_triggers: ((triggers.data ?? []) as SnapshotItem[]).sort(byId),
    recent_corrections: ((corrections.data ?? []) as SnapshotItem[]).sort(byId),
    current_requests: ((requests.data ?? []) as SnapshotItem[]).sort(byId),
    recommendations,
  };

  // Risk zones (SPEC §25): nodes with a high risk score, deterministic order.
  const riskZones = nodeRows
    .filter(
      (node) =>
        node.status !== "archived" &&
        node.status !== "rejected" &&
        node.risk_score !== null &&
        node.risk_score >= RISK_ZONE_THRESHOLD
    )
    .sort((a, b) => (b.risk_score ?? 0) - (a.risk_score ?? 0) || byId(a, b));
  const riskNotes =
    riskZones.length === 0
      ? "Зон риска не выявлено."
      : `Зоны риска (risk_score >= ${RISK_ZONE_THRESHOLD}): ${riskZones
          .map((node) => `${node.title} (${node.risk_score})`)
          .join("; ")}.`;

  // Trend summary: deterministic trend counts over nodes, themes, resources.
  const trendCounts = new Map<string, number>();
  const collectTrend = (trend: string | null) => {
    if (!trend) return;
    trendCounts.set(trend, (trendCounts.get(trend) ?? 0) + 1);
  };
  for (const node of activeNodes) collectTrend(node.trend);
  for (const theme of (themes.data ?? []) as { trend: string | null }[]) collectTrend(theme.trend);
  for (const resource of (resources.data ?? []) as { trend: string | null }[]) {
    collectTrend(resource.trend);
  }
  const trendSummary =
    trendCounts.size === 0
      ? "Тренды не зафиксированы."
      : [...trendCounts.entries()]
          .sort(([a], [b]) => (a < b ? -1 : 1))
          .map(([trend, count]) => `${trend}: ${count}`)
          .join("; ");

  // Evidence digest: deterministic counts over the evidence base.
  const signalRows = (signals.data ?? []) as { id: string; review_status: string }[];
  const approvedSignals = signalRows.filter((signal) => signal.review_status === "approved");
  const nodeEvidence = nodeRows.reduce((sum, node) => sum + node.evidence_count, 0);
  const nodeIndependentEvidence = nodeRows.reduce(
    (sum, node) => sum + node.independent_evidence_count,
    0
  );
  const evidenceDigest =
    `Signals: ${signalRows.length} (approved: ${approvedSignals.length}); ` +
    `core node evidence: ${nodeEvidence} (independent: ${nodeIndependentEvidence}).`;

  const summary =
    `Active core nodes: ${activeNodes.length}; active themes: ${content.active_themes.length}; ` +
    `resources: ${content.resource_state.length}; development targets: ${content.development_targets.length}; ` +
    `weakened: ${weakenedNodes.length}; reactivated: ${reactivatedNodes.length}; ` +
    `recent triggers: ${content.recent_triggers.length}; recent corrections: ${content.recent_corrections.length}; ` +
    `current requests: ${content.current_requests.length}; top recommendations: ${content.recommendations.length}.`;

  return { content, trendSummary, riskNotes, evidenceDigest, summary };
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

function mapRow(data: unknown): PsychologicalSnapshot {
  return data as PsychologicalSnapshot;
}

function snapshotContent(snapshot: PsychologicalSnapshot): SnapshotContent {
  return Object.fromEntries(
    SNAPSHOT_CATEGORIES.map((category) => [category, snapshot[category] ?? []])
  ) as SnapshotContent;
}

async function latestSnapshot(
  client: SupabaseClient,
  clientId: string
): Promise<PsychologicalSnapshot | null> {
  const { data, error } = await client
    .from("psychological_snapshots")
    .select("*")
    .eq("client_id", clientId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new ServiceError("INTERNAL_ERROR", "Failed to read snapshots");
  return data ? mapRow(data) : null;
}

// --- Service -------------------------------------------------------------------

/**
 * Generate the next immutable snapshot for a client. version = previous + 1
 * (monotonic, unique per client; a concurrent generation conflict is retried
 * once). The snapshot stores the deterministic content, the model_hash and the
 * versions it was generated with. Nothing about previous snapshots is touched.
 */
export async function generateSnapshot(
  client: SupabaseClient,
  rawInput: unknown
): Promise<PsychologicalSnapshot> {
  const input = validate(generateSnapshotSchema, rawInput);
  const userId = await requireUserId(client);

  await requireConsent(client, input.clientId, "data_storage");
  await requireConsent(client, input.clientId, "sensitive_psychological_data");

  const clientRow = await requireClient(client, input.clientId);
  const ontologyVersion = await requireActiveOntologyVersion(client);
  const versions: SnapshotVersions = {
    scoring_model_version: SCORING_MODEL_VERSION,
    ontology_version: ontologyVersion,
    ai_model: MODEL_CONFIG.snapshot,
    prompt_version: AI_CONTRACTS["ai.generate-snapshot.v1"].promptVersion,
  };

  const { content, trendSummary, riskNotes, evidenceDigest, summary } =
    await assembleSnapshotContent(client, input.clientId);
  const modelHash = computeModelHash(content, versions);

  const previous = await latestSnapshot(client, input.clientId);
  const changes = previous ? diffSnapshots(snapshotContent(previous), content) : null;

  const insertRow = (version: number) => ({
    organization_id: clientRow.organization_id,
    client_id: input.clientId,
    version,
    generated_by: userId,
    reason: input.reason,
    summary,
    ...content,
    trend_summary: trendSummary,
    risk_notes: riskNotes,
    evidence_digest: evidenceDigest,
    changes_since_previous: changes,
    model_hash: modelHash,
    ...versions,
  });

  const snapshot = await withAudit(
    client,
    {
      organizationId: clientRow.organization_id,
      entityType: "psychological_snapshot",
      action: "snapshot.generate",
      reason: input.reason,
    },
    async (): Promise<PsychologicalSnapshot> => {
      let version = (previous?.version ?? 0) + 1;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const { data, error } = await client
          .from("psychological_snapshots")
          .insert(insertRow(version))
          .select()
          .single();
        if (!error) return mapRow(data);
        if (error.code === "23505" && attempt === 0) {
          // Concurrent generation took this version; re-read and retry once.
          const latest = await latestSnapshot(client, input.clientId);
          version = (latest?.version ?? 0) + 1;
          continue;
        }
        if (error.code === "23505") {
          throw new ServiceError("CONFLICT", "Snapshot version conflict, retry generation");
        }
        throw mapWriteError(error, "Failed to generate snapshot");
      }
      throw new ServiceError("INTERNAL_ERROR", "Failed to generate snapshot");
    }
  );

  return snapshot;
}

/** Read one snapshot (RLS-enforced). */
export async function getSnapshot(
  client: SupabaseClient,
  snapshotId: string
): Promise<PsychologicalSnapshot> {
  const { data, error } = await client
    .from("psychological_snapshots")
    .select("*")
    .eq("id", validate(uuid, snapshotId))
    .maybeSingle();
  if (error) throw new ServiceError("INTERNAL_ERROR", "Failed to read snapshot");
  if (!data) throw new ServiceError("NOT_FOUND", "Snapshot not found");
  return mapRow(data);
}

/** List snapshots for a client, newest version first. */
export async function listSnapshots(
  client: SupabaseClient,
  rawQuery: unknown
): Promise<Page<PsychologicalSnapshot>> {
  const query = validate(listSnapshotsQuerySchema, rawQuery ?? {});

  let request = client
    .from("psychological_snapshots")
    .select("*")
    .eq("organization_id", query.organizationId)
    .eq("client_id", query.clientId)
    .order("version", { ascending: false })
    .limit(query.limit + 1);

  if (query.cursor) request = request.lt("version", Number(decodeCursor(query.cursor)));

  const { data, error } = await request;
  if (error) throw new ServiceError("INTERNAL_ERROR", "Failed to list snapshots");

  return toPage((data ?? []).map(mapRow), query.limit, (last) =>
    encodeCursor(String(last.version))
  );
}

export interface SnapshotComparison {
  snapshot: PsychologicalSnapshot;
  previous: PsychologicalSnapshot | null;
  /** Null when this is the first snapshot of the client. */
  changes: SnapshotDiff | null;
}

/**
 * Compare a snapshot with the previous version of the same client
 * ("Changes since previous snapshot", SPEC §25). The diff is recomputed from
 * the stored immutable contents, so it is reproducible.
 */
export async function compareWithPrevious(
  client: SupabaseClient,
  snapshotId: string
): Promise<SnapshotComparison> {
  const snapshot = await getSnapshot(client, snapshotId);

  const { data, error } = await client
    .from("psychological_snapshots")
    .select("*")
    .eq("client_id", snapshot.client_id)
    .lt("version", snapshot.version)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new ServiceError("INTERNAL_ERROR", "Failed to read previous snapshot");

  const previous = data ? mapRow(data) : null;
  return {
    snapshot,
    previous,
    changes: previous ? diffSnapshots(snapshotContent(previous), snapshotContent(snapshot)) : null,
  };
}

export { generateSnapshotSchema, listSnapshotsQuerySchema };
