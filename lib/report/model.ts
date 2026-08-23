/**
 * Snapshot report read model (ticket 56, docs/data-exchange-contracts.md §13).
 *
 * Markdown and PDF are two renderings of ONE immutable, privacy-filtered read
 * model — never two independent assemblies. Content equality between the two
 * formats therefore holds by construction: both consume the same
 * `SnapshotReportReadModel` and neither adds data of its own.
 *
 * The layout is a fixed, ordered list of 14 sections (§13). A section with no
 * permitted content is still rendered, with the text `Нет подтверждённых
 * данных` — an empty section is never dropped, so a reader can tell "nothing
 * was approved here" apart from "this report has no such section".
 */

export const REPORT_CONTRACT = "live-client-map.snapshot-report";
export const REPORT_CONTRACT_VERSION = "1.0";

/** Rendered in place of a section whose permitted content is empty (§13). */
export const EMPTY_SECTION_TEXT = "Нет подтверждённых данных";

export type ReportAudience = "specialist" | "client";

/** Ordered section keys — the layout of §13, positions 1–14. */
export const REPORT_SECTION_KEYS = [
  "document_metadata",
  "client",
  "requests_goals",
  "snapshot_summary",
  "active_themes",
  "core_hypotheses",
  "evidence",
  "resources",
  "development_targets",
  "model_changes",
  "recommendations",
  "trend",
  "provenance",
  "disclaimer",
] as const;

export type ReportSectionKey = (typeof REPORT_SECTION_KEYS)[number];

/** Fixed headings; both audiences get the identical layout (§13). */
export const REPORT_SECTION_HEADINGS: Record<ReportSectionKey, string> = {
  document_metadata: "Метаданные документа",
  client: "Клиент",
  requests_goals: "Текущие запросы и цели",
  snapshot_summary: "Сводка snapshot",
  active_themes: "Активные темы",
  core_hypotheses: "Ключевые гипотезы и объяснения",
  evidence: "Доказательная база и ограничения",
  resources: "Ресурсы",
  development_targets: "Цели развития",
  model_changes: "Недавние изменения модели",
  recommendations: "Рекомендации и активные коррекции",
  trend: "Тренды и маркеры следующего пересмотра",
  provenance: "Происхождение данных",
  disclaimer: "Дисклеймер",
};

export const REPORT_TITLE = "Отчёт по модели клиента";

/**
 * Mandatory disclaimer (§13.14): the model states hypotheses, not diagnoses.
 */
export const REPORT_DISCLAIMER =
  "Гипотезы в этом отчёте — рабочие интерпретации специалиста и модели, " +
  "а не медицинский диагноз. Они не заменяют консультацию врача и не " +
  "являются основанием для назначения лечения.";

export interface ReportField {
  label: string;
  value: string;
}

export type ReportBlock =
  | { kind: "paragraph"; text: string }
  | { kind: "list"; items: string[] }
  | { kind: "fields"; fields: ReportField[] }
  | { kind: "table"; columns: string[]; rows: string[][] };

export interface ReportSection {
  key: ReportSectionKey;
  heading: string;
  /** Empty means the section renders as EMPTY_SECTION_TEXT. */
  blocks: ReportBlock[];
}

export interface SnapshotReportReadModel {
  contract: typeof REPORT_CONTRACT;
  version: typeof REPORT_CONTRACT_VERSION;
  export_id: string;
  generated_at: string;
  audience: ReportAudience;
  snapshot_version: number;
  model_hash: string;
  /**
   * Opaque, non-reversible client reference. Used in filenames, the PDF footer
   * and PDF metadata so that no name ever leaves the document body (§10, §13).
   */
  client_ref: string;
  sections: ReportSection[];
}

/** True when the section has no renderable content. */
export function isEmptySection(section: ReportSection): boolean {
  return section.blocks.every((block) => {
    if (block.kind === "paragraph") return block.text.trim().length === 0;
    if (block.kind === "list") return block.items.length === 0;
    if (block.kind === "fields") return block.fields.length === 0;
    return block.rows.length === 0;
  });
}
