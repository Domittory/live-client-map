import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { incrementCounter } from "@/lib/telemetry";
import { getServiceClient } from "@/lib/supabase/admin";
import { ServiceError } from "./errors";
import { EXPORT_MEDIA_TYPES, EXPORT_STORAGE_BUCKET, type ExportKind } from "./export-names";
import { uuid, validate } from "./validation";

/**
 * Secure export download (ticket 20, docs/data-exchange-contracts.md §10).
 *
 * "Export обязан проверять tenant, ClientAssignment, role, active consents,
 * visibility и relationship privacy на момент сборки и ещё раз перед download."
 *
 * The re-authorization is `claim_export_download()` (migration 0052): it runs as
 * the CALLER's own session and re-evaluates tenant, assignment, audience role,
 * type-specific consent, relationship privacy and the retention window before it
 * returns anything. A revoked assignment or consent therefore blocks delivery of
 * an ALREADY PREPARED artifact — the file exists, the row is `available`, and the
 * download still fails, with a durable `export.denied` audit row.
 *
 *   The refusal is a returned state, not an exception: PostgREST runs one RPC as
 *   one transaction, so a function that wrote the denial and then raised would roll
 *   the evidence back (the lesson migration 0051 records for request_export). The
 *   RPC writes the denial, returns `outcome = 'denied'`, and this module maps that
 *   to the ordinary FORBIDDEN contract.
 *
 * How the bytes are served
 *   The object lives in the private `client-exports` bucket with no
 *   `storage.objects` policy for authenticated/anon, so the browser can never read
 *   it directly. This module reads it with the service-role client, verifies the
 *   bytes against the sha256 recorded at completion, and returns them to the
 *   caller. No signed URL is created and no public link is handed out: either
 *   would outlive the authorization decision and could be replayed after a
 *   revocation. The artifact is therefore streamed by the server, on every
 *   download, only after a fresh authorization check.
 *
 * What is audited
 *   `record_export_download()` writes `export.downloaded` with kind, format,
 *   contract version, audience, delivered byte size, the artifact sha256 and the
 *   running download count. The audit payload never contains the file content, the
 *   artifact filename, a storage path or a signed URL.
 *
 * Order of operations, and why
 *   1. claim      — re-authorize and learn the opaque object path;
 *   2. read       — fetch the bytes with the service role;
 *   3. verify     — UTF-8 length and sha256 must match the completion metadata
 *                   (a truncated or corrupted object is never delivered);
 *   4. re-check   — `is_client_accessible()` once more, immediately before the
 *                   response is handed to the framework, so a revocation that
 *                   landed during the read still blocks delivery;
 *   5. record     — audit the delivery, then return the bytes.
 *
 *   Step 4 is deliberately narrower than step 1: it is the last authorization
 *   question before delivery and it does not write (a second denial row would
 *   double-count a single refusal). Steps 1 and 5 bracket the read, so the audit
 *   row describes bytes that were actually authorized and actually served.
 */

/** One re-authorized delivery candidate. Never leaves the server. */
export interface ExportDownloadClaim {
  exportId: string;
  organizationId: string;
  clientId: string;
  kind: ExportKind;
  format: "json" | "csv";
  contractVersion: string;
  audience: "owner" | "specialist" | "supervisor" | "client";
  artifactPath: string;
  artifactFilename: string;
  artifactSha256: string;
  artifactBytes: number;
  expiresAt: string;
  downloadCount: number;
}

/** Verified artifact bytes plus the metadata the caller needs for the response. */
export interface ExportArtifactPayload {
  exportId: string;
  kind: ExportKind;
  format: "json" | "csv";
  contentType: string;
  filename: string;
  bytes: Uint8Array;
  sha256: string;
  downloadCount: number;
}

/** The `claim_export_download()` row shape. */
interface ClaimRow {
  outcome: "granted" | "denied" | "unavailable";
  claim_export_id: string | null;
  claim_organization_id: string | null;
  claim_client_id: string | null;
  claim_kind: ExportKind | null;
  claim_format: "json" | "csv" | null;
  claim_contract_version: string | null;
  claim_audience: "owner" | "specialist" | "supervisor" | "client" | null;
  claim_artifact_path: string | null;
  claim_artifact_filename: string | null;
  claim_artifact_sha256: string | null;
  claim_artifact_bytes: number | string | null;
  claim_expires_at: string | null;
  claim_download_count: number | null;
}

/**
 * Media type of an artifact for the HTTP response. Mirrors the `contentType` the
 * object was stored with, so a client that inspects the response sees the same
 * contract media type (§11/§12/§14).
 */
export function exportContentType(kind: ExportKind): string {
  return EXPORT_MEDIA_TYPES[kind];
}

/** Lowercase-hex SHA-256 of exactly the bytes that will be delivered. */
export function deliveredChecksum(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Re-authorize this caller for this export and return the delivery candidate.
 *
 * Outcomes, matching `claim_export_download()` (migration 0052):
 *   * `granted`     — the caller passed every re-check; the candidate is returned;
 *   * `denied`      — a revocation refused the download; the RPC already wrote the
 *                     `export.denied` audit row and the denial counter in its own
 *                     transaction, so the service only translates it to FORBIDDEN;
 *   * `unavailable` — the request is not downloadable (terminal status or past its
 *                     retention deadline). No denial row: an expired artifact is
 *                     not an access refusal, it is the retention job's business;
 *   * SQLSTATE 42501 — anonymous caller, unknown export id or no tenant/client
 *                     access. Nothing was written, so a caller who may not know the
 *                     client leaves no trace.
 */
export async function claimExportDownload(
  client: SupabaseClient,
  exportId: string
): Promise<ExportDownloadClaim> {
  const id = validate(uuid, exportId);
  const { data, error } = await client.rpc("claim_export_download", { p_export_id: id });

  if (error) {
    if (error.code === "42501") {
      throw new ServiceError("FORBIDDEN", "Export download is not authorized");
    }
    if (error.code === "22023") {
      throw new ServiceError("VALIDATION_ERROR", "Invalid export request");
    }
    throw new ServiceError("INTERNAL_ERROR", "Failed to authorize export download");
  }

  const row = (data as ClaimRow[] | null)?.[0];
  if (!row) throw new ServiceError("NOT_FOUND", "Export artifact is not available");

  if (row.outcome === "denied" || row.outcome === "unavailable") {
    throw new ServiceError("FORBIDDEN", "Export download is not authorized");
  }

  // The granted branch always fills every column (the RPC's grant query selects
  // them from a complete `available` row), so these assertions document that
  // invariant instead of guessing defaults.
  if (
    !row.claim_export_id ||
    !row.claim_organization_id ||
    !row.claim_client_id ||
    !row.claim_kind ||
    !row.claim_format ||
    !row.claim_contract_version ||
    !row.claim_audience ||
    !row.claim_artifact_path ||
    !row.claim_artifact_filename ||
    !row.claim_artifact_sha256 ||
    !row.claim_artifact_bytes ||
    !row.claim_expires_at
  ) {
    throw new ServiceError("INTERNAL_ERROR", "Export download claim is incomplete");
  }

  return {
    exportId: row.claim_export_id,
    organizationId: row.claim_organization_id,
    clientId: row.claim_client_id,
    kind: row.claim_kind,
    format: row.claim_format,
    contractVersion: row.claim_contract_version,
    audience: row.claim_audience,
    artifactPath: row.claim_artifact_path,
    artifactFilename: row.claim_artifact_filename,
    artifactSha256: row.claim_artifact_sha256,
    artifactBytes: Number(row.claim_artifact_bytes),
    expiresAt: row.claim_expires_at,
    downloadCount: row.claim_download_count ?? 0,
  };
}

/**
 * Read the private object. The service-role client bypasses storage RLS on purpose:
 * `claim_export_download()` has already decided that THIS caller may receive these
 * bytes, and the object remains unreachable from the browser.
 */
async function readArtifact(claim: ExportDownloadClaim): Promise<Uint8Array> {
  const { data, error } = await getServiceClient()
    .storage.from(EXPORT_STORAGE_BUCKET)
    .download(claim.artifactPath);
  if (error || !data) {
    // The row says `available` but the object is gone: never deliver a partial or
    // missing file, and never invent a failure transition here — the retention
    // reaper closes the row (ticket 20, migration 0052).
    throw new ServiceError("NOT_FOUND", "Export artifact is no longer available");
  }
  return new Uint8Array(await data.arrayBuffer());
}

/**
 * Final authorization question before delivery. Narrower than the claim: it does
 * not write a second denial row, but it does stop a delivery whose access was
 * revoked while the artifact was being read.
 */
async function assertStillAccessible(
  client: SupabaseClient,
  claim: ExportDownloadClaim
): Promise<void> {
  const { data, error } = await client.rpc("is_client_accessible", {
    p_org_id: claim.organizationId,
    p_client_id: claim.clientId,
    p_require_write: false,
  });
  if (error) throw new ServiceError("INTERNAL_ERROR", "Failed to re-check client access");
  if (!data) throw new ServiceError("FORBIDDEN", "Export download is not authorized");
}

/**
 * Authorize, read, verify, re-check, audit and return the artifact bytes.
 *
 * The whole path runs on every download: nothing is cached, so a revoked consent
 * cannot be bypassed by a previously issued link or a warm response.
 */
export async function downloadExportArtifact(
  client: SupabaseClient,
  exportId: string
): Promise<ExportArtifactPayload> {
  const claim = await claimExportDownload(client, exportId);
  const bytes = await readArtifact(claim);

  // Integrity gate: the delivered payload must be the artifact that was completed.
  if (
    bytes.byteLength !== claim.artifactBytes ||
    deliveredChecksum(bytes) !== claim.artifactSha256
  ) {
    throw new ServiceError("INTERNAL_ERROR", "Stored export artifact failed its checksum");
  }

  // Re-authorization immediately before delivery.
  await assertStillAccessible(client, claim);

  // Delivery audit first: a download that is not recorded must not be served.
  // `record_export_download` is a service_role-only system transition; it refuses
  // a row that expired while the bytes were being read.
  const { data: count, error } = await getServiceClient().rpc("record_export_download", {
    p_export_id: claim.exportId,
    p_bytes: bytes.byteLength,
    p_sha256: claim.artifactSha256,
  });
  if (error) {
    throw new ServiceError("CONFLICT", "Export artifact is no longer downloadable");
  }

  await incrementCounter("export_download_total", "Total export downloads", { type: claim.kind });

  return {
    exportId: claim.exportId,
    kind: claim.kind,
    format: claim.format,
    contentType: exportContentType(claim.kind),
    // Filename that reaches the client: opaque kind + timestamp name built at
    // completion, never a client identifier (§10).
    filename: claim.artifactFilename,
    bytes,
    sha256: claim.artifactSha256,
    downloadCount: typeof count === "number" ? count : claim.downloadCount + 1,
  };
}

/**
 * `Content-Disposition` for a delivered artifact. Uses the stored opaque filename
 * and marks the response private and uncacheable, so a proxy cannot keep serving
 * bytes after the authorization they were granted for has been revoked.
 */
export function exportDownloadHeaders(payload: {
  contentType: string;
  filename: string;
}): Record<string, string> {
  return {
    "Content-Type": payload.contentType,
    "Content-Disposition": `attachment; filename="${payload.filename}"`,
    "Cache-Control": "no-store, private",
  };
}

/** One `Response` carrying the authorized bytes. */
export function toExportDownloadResponse(payload: ExportArtifactPayload): Response {
  // A fresh Uint8Array over its own ArrayBuffer: a plain BufferSource for both the
  // DOM and Node type definitions, and it never exposes bytes of the source buffer
  // beyond the delivered payload.
  return new Response(new Uint8Array(payload.bytes), {
    headers: exportDownloadHeaders(payload),
  });
}
