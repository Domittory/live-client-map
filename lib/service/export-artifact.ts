import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  CLIENT_ARCHIVE_CONTRACT,
  CLIENT_ARCHIVE_VERSION,
  assembleClientArchive,
  buildClientArchiveArtifact,
  canonicalStringify,
  type ArchiveWarning,
} from "./client-archive";
import {
  SIGNALS_CSV_CONTRACT,
  SIGNALS_CSV_VERSION,
  loadSignalsForExport,
  renderSignalsCsv,
} from "./export";
import { EXPORT_MEDIA_TYPES, type ExportKind } from "./export-names";
import {
  SUPERVISION_CONTRACT,
  SUPERVISION_VERSION,
  assertAllowlistedProjection,
  loadSupervisionSource,
  projectSupervisionCase,
} from "./supervision-export";

/**
 * Artifact construction for an ExportRequest (ticket 19,
 * docs/data-exchange-contracts.md §10–§12, §14).
 *
 * Reads and authorization live in the existing service loaders
 * (`assembleClientArchive`, `loadSignalsForExport`, `loadSupervisionSource`);
 * this module only turns their result into the exact file that will be written
 * to private storage, together with the metadata the request row records.
 *
 * Guarantees that make "no partial file ever becomes downloadable" real:
 *   - the artifact is serialized AND hashed here, and the hash is computed over
 *     the same bytes that are uploaded, so the request can never point at a file
 *     whose checksum disagrees with what the database recorded;
 *   - `byte_size` is the UTF-8 length of those bytes and must be > 0 (the
 *     database constraint rejects an `available` row without it);
 *   - a contract validation failure throws, so the caller records `failed`
 *     instead of publishing anything.
 *
 * Nothing here writes to a log or an audit payload: callers pass only
 * `counts`, `warnings` and the checksum onward.
 */

/** What a caller must know about one export before it can be built. */
export interface ExportJob {
  exportId: string;
  organizationId: string;
  clientId: string;
  kind: ExportKind;
  contractVersion: string;
  audience: "owner" | "specialist" | "supervisor" | "client";
  snapshotVersion: number | null;
  /** Generation timestamp; the artifact metadata and its filename must agree. */
  generatedAt: Date;
}

/** The serialized file plus the metadata an ExportRequest stores about it. */
export interface ExportArtifact {
  content: string;
  content_type: string;
  byte_size: number;
  content_sha256: string;
  /** `record_counts` for a client archive; otherwise a per-section count. */
  counts: Record<string, number>;
  /** Manifest warnings for a client archive; empty for the other kinds. */
  warnings: ArchiveWarning[];
}

/** Lowercase-hex SHA-256 of the exact bytes that will be uploaded. */
export function artifactChecksum(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

/** Shared envelope: bytes in, metadata out. Size and hash come from one value. */
function sealArtifact(
  content: string,
  kind: ExportKind,
  counts: Record<string, number>,
  warnings: ArchiveWarning[] = []
): ExportArtifact {
  const byteSize = Buffer.byteLength(content, "utf8");
  if (byteSize <= 0) {
    throw new Error("export artifact is empty");
  }
  return {
    content,
    content_type: EXPORT_MEDIA_TYPES[kind],
    byte_size: byteSize,
    content_sha256: artifactChecksum(content),
    counts,
    warnings,
  };
}

function assertContract(job: ExportJob, expected: string): void {
  if (job.contractVersion !== expected) {
    // The RPC already pins the contract version; this is the second, in-process
    // check so a service-level mistake cannot produce a mislabelled file.
    throw new Error(`unsupported contract version for ${job.kind}`);
  }
}

/** Injection seam for the generation step (defaults to `buildExportArtifact`). */
export type ExportJobBuilder = (client: SupabaseClient, job: ExportJob) => Promise<ExportArtifact>;

/**
 * Build one artifact. `client` is the caller's own session, so every read keeps
 * the RLS and visibility rules of that caller; the ExportRequest RPC decided
 * whether the caller may export at all.
 */
export async function buildExportArtifact(
  client: SupabaseClient,
  job: ExportJob
): Promise<ExportArtifact> {
  if (job.kind === "client_archive") {
    assertContract(job, `${CLIENT_ARCHIVE_CONTRACT}/${CLIENT_ARCHIVE_VERSION}`);
    const { archive } = await assembleClientArchive(client, job.clientId, {
      exportId: job.exportId,
      generatedAt: job.generatedAt.toISOString(),
    });
    const artifact = buildClientArchiveArtifact(archive);
    return sealArtifact(artifact.content, job.kind, artifact.counts, artifact.warnings);
  }

  if (job.kind === "signals_csv") {
    assertContract(job, `${SIGNALS_CSV_CONTRACT}/${SIGNALS_CSV_VERSION}`);
    const source = await loadSignalsForExport(client, { clientId: job.clientId });
    const content = renderSignalsCsv(source.signals);
    return sealArtifact(content, job.kind, { signals: source.signals.length });
  }

  assertContract(job, `${SUPERVISION_CONTRACT}/${SUPERVISION_VERSION}`);
  const source = await loadSupervisionSource(client, job.clientId);
  const casePayload = projectSupervisionCase(source);
  assertAllowlistedProjection(casePayload);

  const payload = {
    contract: SUPERVISION_CONTRACT,
    version: SUPERVISION_VERSION,
    export_id: job.exportId,
    case_key: job.exportId,
    generated_at: job.generatedAt.toISOString(),
    language: "ru",
    case: casePayload,
  };

  // Canonical serialization keeps the stored file deterministic: two exports of
  // unchanged data differ only in their `export_id`/`generated_at` metadata.
  const content = canonicalStringify(payload);
  const counts = Object.fromEntries(
    Object.entries(casePayload).map(([key, value]) => [
      key,
      Array.isArray(value) ? value.length : 0,
    ])
  );
  return sealArtifact(content, job.kind, counts);
}

export { EXPORT_MEDIA_TYPES };
