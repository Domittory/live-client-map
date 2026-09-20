import { createHash } from "node:crypto";

/**
 * Export filenames (docs/data-exchange-contracts.md §10–§12, §14).
 *
 * A filename may contain ONLY an opaque reference, a UTC timestamp and a format.
 * Client names, client/organization UUIDs and raw content are forbidden, so
 * callers must use these helpers instead of building names from client data.
 * The reference is a one-way digest, so it cannot be reversed to an identifier.
 */
export function opaqueClientRef(clientId: string): string {
  return createHash("sha256").update(clientId).digest("hex").slice(0, 16);
}

/**
 * §10: the opaque handle of one ExportRequest. Distinct from
 * `opaqueClientRef()` so a filename never doubles as a per-client handle: it
 * refers to the export, not to the subject.
 */
export function opaqueExportRef(exportId: string): string {
  return createHash("sha256").update(exportId).digest("hex").slice(0, 16);
}

/** ISO timestamp with the characters that are awkward in filenames replaced. */
export function exportFileStamp(generatedAt: string): string {
  return generatedAt.replace(/[:.]/g, "-");
}

/** The export kinds whose artifact can be stored (mirrors `public.export_kind`). */
export const EXPORT_KINDS = ["client_archive", "signals_csv", "supervision_export"] as const;

export type ExportKind = (typeof EXPORT_KINDS)[number];

/** File extension per export kind. */
export const EXPORT_EXTENSIONS: Record<ExportKind, string> = {
  client_archive: "json",
  signals_csv: "csv",
  supervision_export: "json",
};

/**
 * Media type per export kind. The JSON contracts use their `+json` media type
 * (§11 and §14); the Signals CSV uses `text/csv` (§12). The value is also the
 * `contentType` of the stored object, so it must stay inside the private
 * bucket's `allowed_mime_types` list (migration 0051).
 */
export const EXPORT_MEDIA_TYPES: Record<ExportKind, string> = {
  client_archive: "application/vnd.live-client-map.client-archive+json",
  signals_csv: "text/csv",
  supervision_export: "application/vnd.live-client-map.supervision-export+json",
};

/**
 * §10: `<kind>_<opaque-ref>_<UTC timestamp>.<ext>`. Three components and
 * nothing else, so no direct identifier and no export content can reach a
 * filename, a log line or a storage listing.
 */
export function exportArtifactFilename(args: {
  kind: ExportKind;
  exportId: string;
  generatedAt: string;
}): string {
  return `${args.kind}_${opaqueExportRef(args.exportId)}_${exportFileStamp(args.generatedAt)}.${EXPORT_EXTENSIONS[args.kind]}`;
}

/**
 * The single private bucket every artifact lives in. Declared in migration 0051
 * and marked `public = false`; no signed URL is issued here.
 */
export const EXPORT_STORAGE_BUCKET = "client-exports";

/**
 * The object path inside the private bucket:
 * `<organization_id>/<export_request_id>/<filename>`. Every segment is an opaque
 * UUID or the opaque filename — never a client identifier or content.
 */
export function exportArtifactPath(args: {
  organizationId: string;
  exportId: string;
  filename: string;
}): string {
  return `${args.organizationId}/${args.exportId}/${args.filename}`;
}

/** §10: `client_archive_<opaque-ref>_<UTC timestamp>.json`. */
export function clientArchiveFilename(clientId: string, generatedAt: string): string {
  return `client_archive_${opaqueClientRef(clientId)}_${exportFileStamp(generatedAt)}.json`;
}

/** §12: `signals_<opaque-client-ref>_<UTC timestamp>.csv`. */
export function signalsCsvFilename(clientId: string, generatedAt: string): string {
  return `signals_${opaqueClientRef(clientId)}_${exportFileStamp(generatedAt)}.csv`;
}

/**
 * §14: the supervision file is named after the per-export opaque `case_key`, so
 * two exports of the same client never share a file reference.
 */
export function supervisionExportFilename(caseKey: string, generatedAt: string): string {
  return `supervision_${caseKey}_${exportFileStamp(generatedAt)}.json`;
}
