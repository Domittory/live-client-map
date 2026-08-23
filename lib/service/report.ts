import { createHash, randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { renderReportMarkdown } from "@/lib/report/markdown";
import {
  REPORT_CONTRACT,
  REPORT_CONTRACT_VERSION,
  REPORT_DISCLAIMER,
  REPORT_SECTION_HEADINGS,
  type ReportAudience,
  type ReportBlock,
  type ReportSection,
  type ReportSectionKey,
  type SnapshotReportReadModel,
} from "@/lib/report/model";
import { renderReportPdf } from "@/lib/report/pdf";
import { recordAudit } from "./audit";
import { hasConsent } from "./consent";
import { ServiceError } from "./errors";
import { requireExportAccess } from "./export";
import type { ModelExplanation } from "./explanations";
import type { PsychologicalSnapshot, SnapshotItem } from "./snapshots";
import { uuid, validate } from "./validation";

/**
 * Snapshot report read model (ticket 56, docs/data-exchange-contracts.md §13).
 *
 * ONE privacy-filtered read model feeds both renderers, so Markdown and PDF can
 * never disagree about content. Everything the report states about the model
 * comes from the selected IMMUTABLE snapshot version — the report is a view of
 * history, not a recomputation of it. The few facts a snapshot does not store
 * (client label, approved explanations, model changes, scheduled follow-ups)
 * are read from the database but bounded to the snapshot's moment, so a
 * historical report does not quietly acquire newer content.
 *
 * Privacy rules (§10, §13), all fail-closed:
 *   - `visibility` is resolved from the CURRENT rows, never from the snapshot
 *     copy: if an entity was reclassified as sensitive after the snapshot was
 *     taken, the report respects the new classification.
 *   - Client audience receives only `client_visible` records and only
 *     explicitly approved explanations. Risk assessments, model mechanics,
 *     internal digests and anything without an approval flag are withheld.
 *   - `sensitive` requires Owner or primary specialist AND an active
 *     `sensitive_psychological_data` consent.
 *   - Nothing is dropped silently (§10): every withheld group is counted and
 *     named in "Доказательная база и ограничения" — counts only, never content.
 *
 * Generation is read-only: it writes an audit event and nothing else.
 */

export const reportQuerySchema = z
  .object({
    clientId: uuid,
    /**
     * Required by §13 — resolving "latest" is the UI's job, so that a stored
     * or repeated request always names one exact immutable version.
     */
    snapshotVersion: z.coerce.number().int().positive(),
    audience: z.enum(["specialist", "client"]),
  })
  .strict();

export type ReportQuery = z.infer<typeof reportQuerySchema>;

/** Entities whose visibility must be resolved from their current row. */
const VISIBILITY_TABLES = {
  core_nodes: "core_nodes",
  themes: "themes",
  resources: "resources",
  recommendations: "recommendations",
  triggers: "triggers",
} as const;

const MAX_MODEL_CHANGES = 50;
const MAX_FOLLOW_UPS = 20;
const MAX_GOALS = 50;

// --- Small helpers -------------------------------------------------------------

/**
 * Opaque, stable client reference for filenames, footer and PDF metadata.
 * A one-way digest — the contract forbids names anywhere near the file (§10).
 */
export function opaqueClientRef(clientId: string): string {
  return createHash("sha256").update(clientId).digest("hex").slice(0, 16);
}

function text(value: unknown): string {
  if (value === null || value === undefined) return "—";
  const s = String(value).trim();
  return s.length === 0 ? "—" : s;
}

function itemLabel(item: SnapshotItem): string {
  return text(item.title ?? item.name ?? item.proposed_correction ?? item.id);
}

/** ISO timestamp trimmed to minutes — deterministic, locale-independent. */
function formatTimestamp(value: unknown): string {
  if (value === null || value === undefined) return "—";
  const s = String(value);
  return s.length >= 16 ? `${s.slice(0, 10)} ${s.slice(11, 16)}` : s;
}

function table(columns: string[], rows: string[][]): ReportBlock[] {
  return rows.length === 0 ? [] : [{ kind: "table", columns, rows }];
}

function paragraph(value: string | null | undefined): ReportBlock[] {
  const s = (value ?? "").trim();
  return s.length === 0 ? [] : [{ kind: "paragraph", text: s }];
}

// --- Access and visibility -----------------------------------------------------

interface ReportAccess {
  organizationId: string;
  /** Visibility values this report may contain. */
  allowed: Set<string>;
  /** Owner or primary specialist with the sensitive-data consent in place. */
  sensitiveAllowed: boolean;
  /** Specialist-only material (model mechanics, digests, risk) is permitted. */
  internalAllowed: boolean;
}

async function resolveAccess(
  client: SupabaseClient,
  clientId: string,
  audience: ReportAudience
): Promise<ReportAccess> {
  // Tenant + assignment + data_storage consent, shared with ticket 55.
  const { organizationId, role } = await requireExportAccess(client, clientId, false);

  const { data: ownerFlag } = await client.rpc("is_org_owner", { org_id: organizationId });
  const isOwner = Boolean(ownerFlag);

  if (audience === "client") {
    return {
      organizationId,
      allowed: new Set(["client_visible"]),
      sensitiveAllowed: false,
      internalAllowed: false,
    };
  }

  // §10: sensitive is limited to the primary specialist and the Owner, and
  // additionally gated by the client's sensitive-data consent.
  const maySeeSensitive = isOwner || role === "primary_specialist";
  const sensitiveAllowed =
    maySeeSensitive && (await hasConsent(client, clientId, "sensitive_psychological_data"));

  const allowed = new Set(["internal", "client_visible"]);
  if (sensitiveAllowed) allowed.add("sensitive");

  return { organizationId, allowed, sensitiveAllowed, internalAllowed: true };
}

/** Current visibility of the given ids, keyed by id. */
async function visibilityMap(
  client: SupabaseClient,
  table: (typeof VISIBILITY_TABLES)[keyof typeof VISIBILITY_TABLES],
  ids: string[]
): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const { data, error } = await client.from(table).select("id, visibility").in("id", ids);
  if (error) throw new ServiceError("INTERNAL_ERROR", `Failed to read ${table} visibility`);
  return new Map(
    ((data ?? []) as { id: string; visibility: string }[]).map((row) => [row.id, row.visibility])
  );
}

interface Withheld {
  label: string;
  count: number;
}

/**
 * Keep only items the audience may see. An item whose current row is gone has
 * unknown visibility and is withheld (fail-closed). Withheld counts are
 * reported, never silently dropped (§10).
 */
function filterVisible(
  items: SnapshotItem[],
  visibility: Map<string, string>,
  allowed: Set<string>,
  label: string,
  withheld: Withheld[]
): SnapshotItem[] {
  const kept = items.filter((item) => {
    const current = visibility.get(String(item.id));
    return current !== undefined && allowed.has(current);
  });
  const removed = items.length - kept.length;
  if (removed > 0) withheld.push({ label, count: removed });
  return kept;
}

// --- Loaders -------------------------------------------------------------------

async function loadSnapshot(
  client: SupabaseClient,
  clientId: string,
  version: number
): Promise<PsychologicalSnapshot> {
  const { data, error } = await client
    .from("psychological_snapshots")
    .select("*")
    .eq("client_id", clientId)
    .eq("version", version)
    .maybeSingle();
  if (error) throw new ServiceError("INTERNAL_ERROR", "Failed to read snapshot");
  if (!data) throw new ServiceError("NOT_FOUND", "Snapshot version not found");
  return data as PsychologicalSnapshot;
}

/** Latest snapshot version, for the UI to turn "latest" into an exact version. */
export async function resolveLatestSnapshotVersion(
  client: SupabaseClient,
  clientId: string
): Promise<number | null> {
  const { data, error } = await client
    .from("psychological_snapshots")
    .select("version")
    .eq("client_id", validate(uuid, clientId))
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new ServiceError("INTERNAL_ERROR", "Failed to read snapshots");
  return data ? (data as { version: number }).version : null;
}

interface ClientLabelRow {
  display_name: string | null;
  client_visible_notes: string | null;
}

async function loadClientLabel(client: SupabaseClient, clientId: string): Promise<ClientLabelRow> {
  // Only the agreed label and the client-visible notes are read — never names,
  // birth data or private specialist notes.
  const { data, error } = await client
    .from("clients")
    .select("display_name, client_visible_notes")
    .eq("id", clientId)
    .maybeSingle();
  if (error) throw new ServiceError("INTERNAL_ERROR", "Failed to read client");
  if (!data) throw new ServiceError("NOT_FOUND", "Client not found");
  return data as ClientLabelRow;
}

/** Explanations approved for exactly this snapshot (ticket 44). */
async function loadApprovedExplanations(
  client: SupabaseClient,
  clientId: string,
  snapshotId: string
): Promise<ModelExplanation[]> {
  const { data, error } = await client
    .from("model_explanations")
    .select("*")
    .eq("client_id", clientId)
    .eq("after_snapshot_id", snapshotId)
    .eq("status", "approved")
    .order("created_at", { ascending: true });
  if (error) throw new ServiceError("INTERNAL_ERROR", "Failed to read model explanations");
  return (data ?? []) as ModelExplanation[];
}

interface ModelChangeRow {
  id: string;
  entity_type: string;
  entity_id: string;
  change_reason: string;
  evidence_refs: string[];
  occurred_at: string;
}

async function loadModelChanges(
  client: SupabaseClient,
  clientId: string,
  until: string
): Promise<ModelChangeRow[]> {
  const { data, error } = await client
    .from("model_changes")
    .select("id, entity_type, entity_id, change_reason, evidence_refs, occurred_at")
    .eq("client_id", clientId)
    .lte("occurred_at", until)
    .order("occurred_at", { ascending: false })
    .limit(MAX_MODEL_CHANGES);
  if (error) throw new ServiceError("INTERNAL_ERROR", "Failed to read model changes");
  return (data ?? []) as ModelChangeRow[];
}

interface GoalRow {
  id: string;
  title: string;
  target_state: string | null;
  importance: string;
}

async function loadGoals(
  client: SupabaseClient,
  clientId: string,
  until: string
): Promise<GoalRow[]> {
  const { data, error } = await client
    .from("client_goals")
    .select("id, title, target_state, importance")
    .eq("client_id", clientId)
    .eq("status", "active")
    .lte("created_at", until)
    .order("id", { ascending: true })
    .limit(MAX_GOALS);
  if (error) throw new ServiceError("INTERNAL_ERROR", "Failed to read client goals");
  return (data ?? []) as GoalRow[];
}

interface FollowUpRow {
  id: string;
  scheduled_at: string;
  result_status: string;
}

async function loadFollowUps(
  client: SupabaseClient,
  clientId: string,
  until: string
): Promise<FollowUpRow[]> {
  const { data, error } = await client
    .from("follow_ups")
    .select("id, scheduled_at, result_status")
    .eq("client_id", clientId)
    .eq("result_status", "scheduled")
    .lte("created_at", until)
    .order("scheduled_at", { ascending: true })
    .limit(MAX_FOLLOW_UPS);
  if (error) throw new ServiceError("INTERNAL_ERROR", "Failed to read follow-ups");
  return (data ?? []) as FollowUpRow[];
}

// --- Section assembly ----------------------------------------------------------

function section(key: ReportSectionKey, blocks: ReportBlock[]): ReportSection {
  return { key, heading: REPORT_SECTION_HEADINGS[key], blocks };
}

function nodeRows(items: SnapshotItem[]): string[][] {
  return items.map((item) => [
    itemLabel(item),
    text(item.status),
    text(item.confidence_score),
    text(item.activation_score),
    text(item.trend),
  ]);
}

function explanationBlocks(explanations: ModelExplanation[]): ReportBlock[] {
  const blocks: ReportBlock[] = [];
  for (const explanation of explanations) {
    for (const entry of explanation.explanations) {
      blocks.push({ kind: "paragraph", text: `${entry.headline}` });
      if (entry.explanation.trim().length > 0) {
        blocks.push({ kind: "paragraph", text: entry.explanation });
      }
      const details: string[] = [];
      if (entry.score_breakdown_summary.trim().length > 0) {
        details.push(`Оценки: ${entry.score_breakdown_summary}`);
      }
      if (entry.uncertainty.trim().length > 0) {
        details.push(`Неопределённость: ${entry.uncertainty}`);
      }
      if (entry.missing_evidence.length > 0) {
        details.push(`Недостающие данные: ${entry.missing_evidence.join(", ")}`);
      }
      if (details.length > 0) blocks.push({ kind: "list", items: details });
    }
  }
  return blocks;
}

// --- Service -------------------------------------------------------------------

interface AssembledReport {
  model: SnapshotReportReadModel;
  access: ReportAccess;
}

/**
 * Build the immutable, privacy-filtered read model for one snapshot version.
 * Read-only: no business state is touched (§10). The resolved access is
 * returned alongside so callers can audit without re-running the checks.
 */
async function assembleReport(
  client: SupabaseClient,
  query: ReportQuery
): Promise<AssembledReport> {
  const access = await resolveAccess(client, query.clientId, query.audience);
  const snapshot = await loadSnapshot(client, query.clientId, query.snapshotVersion);
  // One timestamp for the whole document: the front matter, the metadata
  // section and the filename must never disagree.
  const generatedAt = new Date().toISOString();

  const withheld: Withheld[] = [];
  const limitations: string[] = [];

  const nodeItems = [
    ...snapshot.active_core_nodes,
    ...snapshot.weakened_nodes,
    ...snapshot.reactivated_nodes,
  ];
  const ids = (items: SnapshotItem[]) => items.map((item) => String(item.id));

  const [nodeVisibility, themeVisibility, resourceVisibility, recommendationVisibility] =
    await Promise.all([
      visibilityMap(client, VISIBILITY_TABLES.core_nodes, ids(nodeItems)),
      visibilityMap(client, VISIBILITY_TABLES.themes, ids(snapshot.active_themes)),
      visibilityMap(client, VISIBILITY_TABLES.resources, ids(snapshot.resource_state)),
      visibilityMap(client, VISIBILITY_TABLES.recommendations, ids(snapshot.recommendations)),
    ]);

  const visibleNodes = filterVisible(
    nodeItems,
    nodeVisibility,
    access.allowed,
    "ключевые узлы",
    withheld
  );
  const visibleThemes = filterVisible(
    snapshot.active_themes,
    themeVisibility,
    access.allowed,
    "темы",
    withheld
  );
  const visibleResources = filterVisible(
    snapshot.resource_state,
    resourceVisibility,
    access.allowed,
    "ресурсы",
    withheld
  );
  const visibleRecommendations = filterVisible(
    snapshot.recommendations,
    recommendationVisibility,
    access.allowed,
    "рекомендации",
    withheld
  );

  const [label, explanations, changes, goals, followUps] = await Promise.all([
    loadClientLabel(client, query.clientId),
    loadApprovedExplanations(client, query.clientId, snapshot.id),
    access.internalAllowed
      ? loadModelChanges(client, query.clientId, snapshot.generated_at)
      : Promise.resolve([] as ModelChangeRow[]),
    access.internalAllowed
      ? loadGoals(client, query.clientId, snapshot.generated_at)
      : Promise.resolve([] as GoalRow[]),
    access.internalAllowed
      ? loadFollowUps(client, query.clientId, snapshot.generated_at)
      : Promise.resolve([] as FollowUpRow[]),
  ]);

  if (!access.internalAllowed) {
    limitations.push(
      "Отчёт для клиента содержит только материалы, явно помеченные как доступные клиенту, " +
        "и объяснения, прошедшие проверку специалистом."
    );
  }
  if (access.internalAllowed && !access.sensitiveAllowed) {
    limitations.push(
      "Материалы уровня sensitive не включены: нужен доступ Owner или primary specialist " +
        "и активное согласие на обработку чувствительных данных."
    );
  }
  for (const item of withheld) {
    limitations.push(`Скрыто по уровню доступа — ${item.label}: ${item.count}.`);
  }

  const sections: ReportSection[] = [
    section("document_metadata", [
      {
        kind: "fields",
        fields: [
          { label: "Контракт", value: `${REPORT_CONTRACT}/${REPORT_CONTRACT_VERSION}` },
          { label: "Сформирован", value: formatTimestamp(generatedAt) },
          {
            label: "Аудитория",
            value: query.audience === "client" ? "клиент" : "специалист",
          },
          { label: "Версия snapshot", value: String(snapshot.version) },
        ],
      },
    ]),

    section("client", [
      {
        kind: "fields",
        fields: [
          { label: "Обращение", value: text(label.display_name) },
          { label: "Ссылка", value: opaqueClientRef(query.clientId) },
        ],
      },
      ...(query.audience === "client" ? paragraph(label.client_visible_notes) : []),
    ]),

    // Requests and goals carry no visibility flag, so there is no way for a
    // specialist to mark them approved for the client — fail-closed, they stay
    // out of the client report and the omission is named in "Ограничения".
    section("requests_goals", [
      ...(access.internalAllowed
        ? table(
            ["Запрос", "Приоритет", "Статус"],
            snapshot.current_requests.map((item) => [
              itemLabel(item),
              text(item.priority),
              text(item.status),
            ])
          )
        : []),
      ...(access.internalAllowed
        ? table(
            ["Цель", "Желаемое состояние", "Важность"],
            goals.map((goal) => [text(goal.title), text(goal.target_state), text(goal.importance)])
          )
        : []),
    ]),

    section("snapshot_summary", [
      ...(access.internalAllowed ? paragraph(snapshot.summary) : []),
      ...(access.sensitiveAllowed ? paragraph(snapshot.risk_notes) : []),
    ]),

    section(
      "active_themes",
      table(
        ["Тема", "Статус", "Активность", "Уверенность", "Тренд"],
        visibleThemes.map((item) => [
          itemLabel(item),
          text(item.status),
          text(item.activity_score),
          text(item.confidence_score),
          text(item.trend),
        ])
      )
    ),

    section("core_hypotheses", [
      ...table(["Гипотеза", "Статус", "Уверенность", "Активация", "Тренд"], nodeRows(visibleNodes)),
      ...explanationBlocks(explanations),
    ]),

    section("evidence", [
      ...(access.internalAllowed ? paragraph(snapshot.evidence_digest) : []),
      ...(limitations.length > 0 ? [{ kind: "list" as const, items: limitations }] : []),
    ]),

    section(
      "resources",
      table(
        ["Ресурс", "Статус", "Сила", "Уверенность", "Тренд"],
        visibleResources.map((item) => [
          itemLabel(item),
          text(item.status),
          text(item.strength_score),
          text(item.confidence_score),
          text(item.trend),
        ])
      )
    ),

    section(
      "development_targets",
      table(
        ["Цель развития", "Текущий уровень", "Целевой уровень", "Важность"],
        snapshot.development_targets.map((item) => [
          itemLabel(item),
          text(item.current_level),
          text(item.target_level),
          text(item.importance),
        ])
      )
    ),

    section(
      "model_changes",
      table(
        ["Когда", "Сущность", "Причина", "Опор"],
        changes.map((change) => [
          formatTimestamp(change.occurred_at),
          text(change.entity_type),
          text(change.change_reason),
          String(change.evidence_refs?.length ?? 0),
        ])
      )
    ),

    section("recommendations", [
      ...table(
        ["Рекомендация", "Статус", "Приоритет"],
        visibleRecommendations.map((item) => [
          itemLabel(item),
          text(item.status),
          text(item.final_priority_score),
        ])
      ),
      ...(access.internalAllowed
        ? table(
            ["Коррекция", "Статус", "Дата"],
            snapshot.recent_corrections.map((item) => [
              itemLabel(item),
              text(item.status),
              text(item.date),
            ])
          )
        : []),
    ]),

    section("trend", [
      ...(access.internalAllowed ? paragraph(snapshot.trend_summary) : []),
      ...(followUps.length > 0
        ? [
            {
              kind: "list" as const,
              items: followUps.map(
                (followUp) => `Следующий пересмотр: ${formatTimestamp(followUp.scheduled_at)}`
              ),
            },
          ]
        : []),
    ]),

    section("provenance", [
      {
        kind: "fields",
        fields: [
          { label: "model_hash", value: snapshot.model_hash },
          { label: "Модель скоринга", value: text(snapshot.scoring_model_version) },
          { label: "Версия онтологии", value: text(snapshot.ontology_version) },
          { label: "AI-модель", value: text(snapshot.ai_model) },
          { label: "Версия промпта", value: text(snapshot.prompt_version) },
        ],
      },
    ]),

    section("disclaimer", [{ kind: "paragraph", text: REPORT_DISCLAIMER }]),
  ];

  return {
    model: {
      contract: REPORT_CONTRACT,
      version: REPORT_CONTRACT_VERSION,
      export_id: randomUUID(),
      generated_at: generatedAt,
      audience: query.audience,
      snapshot_version: snapshot.version,
      model_hash: snapshot.model_hash,
      client_ref: opaqueClientRef(query.clientId),
      sections,
    },
    access,
  };
}

/** Public read model builder — the same model both renderers consume. */
export async function buildSnapshotReport(
  client: SupabaseClient,
  rawQuery: unknown
): Promise<SnapshotReportReadModel> {
  const query = validate(reportQuerySchema, rawQuery ?? {});
  const { model } = await assembleReport(client, query);
  return model;
}

function fileStamp(generatedAt: string): string {
  return generatedAt.replace(/[:.]/g, "-");
}

/** Filename: opaque reference, timestamp and format only — never a name (§10). */
function reportFilename(model: SnapshotReportReadModel, extension: string): string {
  return `report_${model.client_ref}_v${model.snapshot_version}_${fileStamp(model.generated_at)}.${extension}`;
}

async function auditReport(
  client: SupabaseClient,
  organizationId: string,
  query: ReportQuery,
  model: SnapshotReportReadModel,
  format: "markdown" | "pdf"
): Promise<void> {
  await recordAudit(client, {
    organizationId,
    entityType: "client",
    entityId: query.clientId,
    action: `export.snapshot_report_${format}`,
    after: {
      export_id: model.export_id,
      snapshot_version: model.snapshot_version,
      audience: model.audience,
      model_hash: model.model_hash,
    },
  });
}

export interface RenderedReport {
  filename: string;
  model: SnapshotReportReadModel;
}

export interface MarkdownReport extends RenderedReport {
  content: string;
}

export interface PdfReport extends RenderedReport {
  bytes: Uint8Array;
}

/** Markdown rendering of the selected snapshot version. */
export async function exportSnapshotReportMarkdown(
  client: SupabaseClient,
  rawQuery: unknown
): Promise<MarkdownReport> {
  const query = validate(reportQuerySchema, rawQuery ?? {});
  const { model, access } = await assembleReport(client, query);
  await auditReport(client, access.organizationId, query, model, "markdown");
  return { filename: reportFilename(model, "md"), model, content: renderReportMarkdown(model) };
}

/** PDF rendering of the same read model — a visual view, not a new summary. */
export async function exportSnapshotReportPdf(
  client: SupabaseClient,
  rawQuery: unknown
): Promise<PdfReport> {
  const query = validate(reportQuerySchema, rawQuery ?? {});
  const { model, access } = await assembleReport(client, query);
  await auditReport(client, access.organizationId, query, model, "pdf");
  return { filename: reportFilename(model, "pdf"), model, bytes: await renderReportPdf(model) };
}
