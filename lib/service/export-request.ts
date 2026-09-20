import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { incrementCounter } from "@/lib/telemetry";
import { getServiceClient } from "@/lib/supabase/admin";
import {
  buildExportArtifact,
  type ExportArtifact,
  type ExportJob,
  type ExportJobBuilder,
} from "./export-artifact";
import { EXPORT_KINDS, EXPORT_MEDIA_TYPES, type ExportKind } from "./export-names";
import { removeExportArtifact, uploadExportArtifact } from "./export-storage";
import { ServiceError } from "./errors";
import { runAtomicRpc } from "./transaction";
import { uuid, validate } from "./validation";

/**
 * Asynchronous ExportRequest lifecycle (ticket 19,
 * docs/data-exchange-contracts.md §10).
 *
 * `request_export` claims (or replays) the request and pins the actor, tenant,
 * assignment and consent checks; this service then assembles the artifact, puts
 * it in private storage and records completion — or records a typed failure.
 * `available` is the only downloadable state, and only
 * `complete_export_request` can set it, after a complete artifact exists.
 */

/** The one format and exact contract version each export kind produces. */
export const EXPORT_KIND_CONTRACTS: Record<
  ExportKind,
  { format: "json" | "csv"; contract: string; version: string }
> = {
  client_archive: {
    format: "json",
    contract: "live-client-map.client-archive",
    version: "1.0",
  },
  signals_csv: {
    format: "csv",
    contract: "live-client-map.signals-csv",
    version: "1.0",
  },
  supervision_export: {
    format: "json",
    contract: "live-client-map.supervision-export",
    version: "1.0",
  },
};

/** The format of a request is a function of its kind; the caller never picks it. */
export function exportFormatForKind(kind: ExportKind): "json" | "csv" {
  return EXPORT_KIND_CONTRACTS[kind].format;
}

/** `live-client-map.<kind>/<version>`, the exact contract version of the file. */
export function exportContractVersion(kind: ExportKind): string {
  const entry = EXPORT_KIND_CONTRACTS[kind];
  return `${entry.contract}/${entry.version}`;
}

/**
 * Request status. `available` is the ONLY state that means "the artifact exists
 * and may be downloaded" (ticket 20 owns the download and the retention job that
 * moves a request to `expired`).
 */
export type ExportRequestStatus =
  "requested" | "generating" | "available" | "failed" | "denied" | "expired";

/**
 * One export request as the service returns it. It never carries the artifact
 * bytes, a storage path the caller could guess, or any client identifier.
 */
export interface ExportRequestTicket {
  exportId: string;
  clientId: string;
  organizationId: string;
  kind: ExportKind;
  format: "json" | "csv";
  contractVersion: string;
  audience: "owner" | "specialist" | "supervisor" | "client";
  snapshotVersion: number | null;
  status: ExportRequestStatus;
  requestedAt: string;
  generatedAt: string | null;
  completedAt: string | null;
  expiresAt: string;
  /** Set only while the export is `available`. */
  artifactFilename: string | null;
  /** Lowercase-hex SHA-256 of the stored bytes; safe to audit. */
  artifactSha256: string | null;
  artifactBytes: number | null;
  /** Stable machine-readable reason for `failed` / `denied`. */
  failureCode: string | null;
  /** True when this call replayed an existing request instead of generating. */
  replayed: boolean;
}

export const createExportRequestSchema = z
  .object({
    clientId: uuid,
    kind: z.enum(EXPORT_KINDS),
    audience: z.enum(["owner", "specialist", "supervisor", "client"]),
    snapshotVersion: z.number().int().positive().optional(),
    idempotencyKey: z.string().trim().min(1).max(200),
  })
  .strict();

export type CreateExportRequestInput = z.infer<typeof createExportRequestSchema>;

/** The `export_requests` columns this service reads back. */
interface ExportRequestRow {
  id: string;
  organization_id: string;
  client_id: string;
  kind: ExportKind;
  format: "json" | "csv";
  contract_version: string;
  audience: "owner" | "specialist" | "supervisor" | "client";
  snapshot_version: number | null;
  status: ExportRequestStatus;
  requested_at: string;
  generated_at: string | null;
  completed_at: string | null;
  expires_at: string;
  artifact_filename: string | null;
  artifact_sha256: string | null;
  artifact_bytes: number | null;
  failure_code: string | null;
}

const REQUEST_COLUMNS =
  "id, organization_id, client_id, kind, format, contract_version, audience, snapshot_version, status, requested_at, generated_at, completed_at, expires_at, artifact_filename, artifact_sha256, artifact_bytes, failure_code";

/**
 * Options for one call.
 *
 * `buildArtifact` is the generation seam: it defaults to
 * `buildExportArtifact()` and exists so a test can inject a failing generator and
 * prove that a failed generation never reaches `available`. It is not part of the
 * product contract and no UI or route passes it.
 */
export interface CreateExportRequestOptions {
  buildArtifact?: ExportJobBuilder;
}

/** Default builder: real reads, real contract assembly. */
const defaultBuilder: ExportJobBuilder = buildExportArtifact;

/**
 * Create or replay an asynchronous export request and return its current state.
 *
 * Flow: the atomic RPC claims the request (or returns the existing one), then the
 * artifact is built, uploaded to private storage and the request is completed in
 * a second atomic RPC. A generation or upload failure leaves the request in
 * `failed` — never `available` — with an audit row.
 */
export async function createExportRequest(
  client: SupabaseClient,
  rawInput: unknown,
  options: CreateExportRequestOptions = {}
): Promise<ExportRequestTicket> {
  const input = validate(createExportRequestSchema, rawInput);
  const contractVersion = exportContractVersion(input.kind);
  const format = exportFormatForKind(input.kind);

  // `request_export` is a set-returning function: PostgREST returns one row.
  // `state` is the request state after the call: `generating` when this call
  // claimed the request, otherwise the state of the equivalent existing request
  // (`available` / `failed`) or `denied` for a refusal.
  const claimedRows = await runAtomicRpc<
    { organization_id: string; export_id: string; state: ExportRequestStatus }[]
  >(
    client,
    "request_export",
    {
      p_client_id: input.clientId,
      p_kind: input.kind,
      p_format: format,
      p_contract_version: contractVersion,
      p_audience: input.audience,
      p_idempotency_key: input.idempotencyKey,
      p_snapshot_version: input.snapshotVersion ?? null,
    },
    {
      forbidden: "Not allowed to export this client",
      failure: "Failed to create export request",
      validation: "Invalid export request",
      conflict: "Idempotency key already used with different export parameters",
    }
  );

  const claimed = claimedRows?.[0];
  if (!claimed) throw new ServiceError("INTERNAL_ERROR", "Failed to create export request");

  const exportId = claimed.export_id;
  const organizationId = claimed.organization_id;

  // A refusal is a persisted `denied` state (with its audit row) rather than a
  // rolled-back exception, so the caller sees the same FORBIDDEN contract while
  // the denial stays auditable.
  if (claimed.state === "denied") {
    throw new ServiceError("FORBIDDEN", "Not allowed to export this client");
  }

  // Idempotent replay: the request already exists (possibly from a previous
  // failed or denied attempt), so the same export is returned unchanged.
  const existing = await loadRequest(client, exportId);
  if (existing && existing.status !== "generating") {
    return toTicket(existing, true);
  }

  // One timestamp for the whole generation: the artifact's own metadata and the
  // opaque filename/hash all describe the same attempt.
  const generatedAt = new Date();
  const job: ExportJob = {
    exportId,
    organizationId,
    clientId: input.clientId,
    kind: input.kind,
    contractVersion,
    audience: input.audience,
    snapshotVersion: input.snapshotVersion ?? null,
    generatedAt,
  };

  let artifact: ExportArtifact;
  let stored: { path: string; filename: string; byte_size: number; content_sha256: string };
  try {
    artifact = await (options.buildArtifact ?? defaultBuilder)(client, job);
    stored = await uploadExportArtifact({
      organizationId,
      exportId,
      kind: input.kind,
      content: artifact.content,
      contentSha256: artifact.content_sha256,
      generatedAt,
    });
  } catch (error) {
    await recordFailure(exportId, failureCodeFor(error));
    throw error;
  }

  try {
    await runAtomicRpc<void>(
      getServiceClient(),
      "complete_export_request",
      {
        p_export_id: exportId,
        p_artifact_path: stored.path,
        p_artifact_filename: stored.filename,
        p_artifact_sha256: stored.content_sha256,
        p_artifact_bytes: stored.byte_size,
      },
      {
        forbidden: "Not allowed to finalize this export",
        failure: "Failed to finalize export request",
        validation: "Incomplete export artifact",
      }
    );
  } catch (error) {
    // The artifact exists but could not be recorded, so it must not linger as a
    // silent second copy. Best effort: the request row stays non-downloadable
    // either way, and ticket 20's retention job is the backstop.
    await removeExportArtifact(stored.path);
    await recordFailure(exportId, "artifact_not_recorded");
    throw error;
  }

  await incrementCounter("export_total", "Total exports by type", { type: input.kind });

  const completed = await loadRequest(client, exportId);
  if (!completed || completed.status !== "available") {
    throw new ServiceError("INTERNAL_ERROR", "Export request was not completed");
  }
  return toTicket(completed, false);
}

/**
 * Record a generation failure on the request. Never throws: the original failure
 * is the error the caller must see, and a request left in `generating` still
 * holds its `export.requested` audit row plus its idempotency key.
 */
async function recordFailure(exportId: string, failureCode: string): Promise<void> {
  try {
    // System transition (service_role only): the requesting actor is pinned on
    // the export row, so the client role cannot drive the state machine.
    await getServiceClient().rpc("fail_export_request", {
      p_export_id: exportId,
      p_failure_code: failureCode,
    });
  } catch {
    // Ignored on purpose — see above.
  }
}

/**
 * A stable, non-sensitive code for the audit row. A generation failure is always
 * reported as a category, never as a raw provider/Postgres message.
 */
export function failureCodeFor(error: unknown): string {
  if (error instanceof ServiceError) {
    if (error.code === "NOT_FOUND" || error.code === "FORBIDDEN") return "access_revoked";
    if (error.code === "VALIDATION_ERROR") return "invalid_artifact";
    return "generation_failed";
  }
  return "generation_failed";
}

async function loadRequest(
  client: SupabaseClient,
  exportId: string
): Promise<ExportRequestRow | null> {
  const { data, error } = await client
    .from("export_requests")
    .select(REQUEST_COLUMNS)
    .eq("id", exportId)
    .maybeSingle();
  if (error) throw new ServiceError("INTERNAL_ERROR", "Failed to read export request");
  return (data as ExportRequestRow | null) ?? null;
}

export function toTicket(row: ExportRequestRow, replayed: boolean): ExportRequestTicket {
  const available = row.status === "available";
  return {
    exportId: row.id,
    clientId: row.client_id,
    organizationId: row.organization_id,
    kind: row.kind,
    format: row.format,
    contractVersion: row.contract_version,
    audience: row.audience,
    snapshotVersion: row.snapshot_version,
    status: row.status,
    requestedAt: row.requested_at,
    generatedAt: row.generated_at,
    completedAt: row.completed_at,
    expiresAt: row.expires_at,
    artifactFilename: available ? row.artifact_filename : null,
    artifactSha256: available ? row.artifact_sha256 : null,
    artifactBytes: available ? row.artifact_bytes : null,
    failureCode: available ? null : row.failure_code,
    replayed,
  };
}

/** Media type of a stored artifact, for the download path (ticket 20). */
export function exportMediaType(kind: ExportKind): string {
  return EXPORT_MEDIA_TYPES[kind];
}
