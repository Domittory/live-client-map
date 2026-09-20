import { getServiceClient } from "@/lib/supabase/admin";
import { ServiceError } from "./errors";
import {
  EXPORT_MEDIA_TYPES,
  EXPORT_STORAGE_BUCKET,
  exportArtifactFilename,
  exportArtifactPath,
  type ExportKind,
} from "./export-names";

/**
 * Private artifact storage for ExportRequests (ticket 19,
 * docs/data-exchange-contracts.md §10).
 *
 * Layout
 *   bucket   : `client-exports` — private, declared in migration 0051
 *   object   : `<organization_id>/<export_request_id>/<opaque filename>`
 *   filename : `<kind>_<opaque-ref>_<UTC timestamp>.<ext>`
 *
 * Privacy properties this module enforces:
 *   - the filename is built ONLY from a contract word, a sha256-derived opaque
 *     reference and a UTC timestamp — never a client name, client id, organization
 *     name or any content;
 *   - no RLS policy exists on `storage.objects` for authenticated/anon, so the
 *     artifact is not reachable through the Storage API even by its requester.
 *     Delivery is ticket 20's separate, re-authorized, audited step;
 *   - `upsert` is false: an export path is written exactly once, so a partial
 *     attempt can never overwrite a complete artifact.
 *
 * Who writes
 *   Writes use the service-role client because artifact generation is a trusted
 *   server-side job, exactly like the ready/delete background work ticket 20
 *   adds. The authorization decision does NOT move here: `request_export` pins
 *   actor, tenant, assignment and consent before this module is ever reached, and
 *   the caller's own session — with its RLS rules — performs every read that
 *   produces the content. Authenticated and anon roles have no write policy on
 *   `storage.objects`, so a browser session cannot upload here even if it knows
 *   the path.
 */

/** Metadata of a successfully uploaded artifact. Identifiers stay opaque. */
export interface StoredArtifact {
  path: string;
  filename: string;
  byte_size: number;
  content_sha256: string;
}

export interface UploadArtifactInput {
  organizationId: string;
  exportId: string;
  kind: ExportKind;
  content: string;
  contentSha256: string;
  generatedAt: Date;
}

/**
 * Write one complete artifact to the private bucket. Rejects on any storage
 * error so the caller records `failed`: bytes that were not confirmed cannot be
 * recorded as an available artifact.
 */
export async function uploadExportArtifact(input: UploadArtifactInput): Promise<StoredArtifact> {
  const filename = exportArtifactFilename({
    kind: input.kind,
    exportId: input.exportId,
    generatedAt: input.generatedAt.toISOString(),
  });
  const path = exportArtifactPath({
    organizationId: input.organizationId,
    exportId: input.exportId,
    filename,
  });

  const { error } = await getServiceClient()
    .storage.from(EXPORT_STORAGE_BUCKET)
    .upload(path, input.content, {
      contentType: EXPORT_MEDIA_TYPES[input.kind],
      upsert: false,
    });
  if (error) {
    throw new ServiceError("INTERNAL_ERROR", "Failed to store export artifact");
  }

  return {
    path,
    filename,
    byte_size: Buffer.byteLength(input.content, "utf8"),
    content_sha256: input.contentSha256,
  };
}

/**
 * Remove an artifact that was uploaded but could not be recorded (the completion
 * RPC failed). Best effort: the database is the source of truth for what is
 * downloadable, so a leftover object is never reachable, and ticket 20's
 * retention job is the backstop that deletes it.
 */
export async function removeExportArtifact(path: string): Promise<void> {
  await getServiceClient().storage.from(EXPORT_STORAGE_BUCKET).remove([path]);
}
