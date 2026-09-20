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

/** ISO timestamp with the characters that are awkward in filenames replaced. */
export function exportFileStamp(generatedAt: string): string {
  return generatedAt.replace(/[:.]/g, "-");
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
