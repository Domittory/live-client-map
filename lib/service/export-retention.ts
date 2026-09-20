import { getServiceClient } from "@/lib/supabase/admin";
import { ServiceError } from "./errors";
import { EXPORT_STORAGE_BUCKET } from "./export-names";

/**
 * 30-day export retention (ticket 20, docs/data-exchange-contracts.md §10:
 * "Файл в системе хранится 30 дней, затем удаляется").
 *
 * Two states can outlive their `expires_at`:
 *   * `available`  — a complete artifact exists in the private bucket and must be
 *                    deleted, after which the request moves to `expired`;
 *   * `generating` — ticket 19's hung request: generation never completed, so no
 *                    artifact exists and none ever will. It is closed as `failed`
 *                    with `generation_timeout`, which releases it from the
 *                    candidate scan instead of pinning it forever.
 *
 * Why storage deletion happens HERE and the database transition happens in the RPC
 * (`expire_export_requests`, migration 0052):
 *   * only the service-role storage client can delete the object, and a SQL
 *     function cannot reach Storage;
 *   * deleting first, then transitioning, makes every partial failure safe to
 *     re-run. If the process dies between the two steps, the row is still
 *     `available` with an object that is already gone: the next run deletes
 *     nothing (a missing object is not an error in Supabase Storage) and still
 *     expires the row. If it dies before deleting, the row was never transitioned
 *     and the artifact is served only if it passes the live re-authorization —
 *     and the next sweep deletes it then.
 *   * the RPC selects candidates `for update skip locked` and commits per row, so
 *     two concurrent runs cannot double-expire and a re-run writes no second
 *     audit row.
 *
 * Every deletion and transition is audited by the RPC through
 * `append_export_audit()` (attributed to the actor pinned on the request), and the
 * audit payload carries counts and a sha256 only — never a filename or a path.
 */

/** Candidates fetched per storage-delete batch. Bounded like the RPC argument. */
export const RETENTION_BATCH_SIZE = 100;

/** Largest batch the RPC accepts (mirrors migration 0052). */
export const RETENTION_MAX_BATCH_SIZE = 1000;

/** Outcome of one retention run. Counts only: no path, filename or content. */
export interface ExportRetentionResult {
  /** Rows due this run, as the candidate scan saw them. */
  scanned: number;
  /** `available` rows whose artifact was deleted and whose row is now `expired`. */
  expired: number;
  /** `generating` rows closed as `failed` / `generation_timeout`. */
  failed: number;
  /** Rows whose storage deletion failed; they stay candidates for the next run. */
  storageErrors: number;
}

/** One due request as the CLI reports it. No path, no filename, no content. */
export interface DueExportRequest {
  exportId: string;
  kind: string;
  status: string;
  expiresAt: string;
  /** Opaque object path; internal to this module and never logged. */
  artifactPath: string | null;
}

interface OutcomeRow {
  export_id: string;
  outcome: "expired" | "failed";
}

/**
 * The requests a sweep would process, in the order the RPC takes them: available
 * and hung-generating rows whose `expires_at` has passed. Read-only, so the CLI's
 * `--dry-run` and the real sweep share one candidate rule.
 */
export async function listDueExportRequests(
  limit = RETENTION_BATCH_SIZE
): Promise<DueExportRequest[]> {
  const { data, error } = await getServiceClient()
    .from("export_requests")
    .select("id, kind, status, expires_at, artifact_path")
    .in("status", ["available", "generating"])
    .lte("expires_at", new Date().toISOString())
    .order("expires_at", { ascending: true })
    .limit(limit);
  if (error) {
    throw new ServiceError("INTERNAL_ERROR", "Failed to list expired export requests");
  }

  const rows = (data ?? []) as Array<{
    id: string;
    kind: string;
    status: string;
    expires_at: string;
    artifact_path: string | null;
  }>;

  return rows.map((row) => ({
    exportId: row.id,
    kind: row.kind,
    status: row.status,
    expiresAt: row.expires_at,
    artifactPath: row.artifact_path,
  }));
}

/**
 * One idempotent retention sweep.
 *
 * `limit` bounds how many rows one call closes (default 100, max 1000 — the RPC
 * enforces the same bound). A backlog larger than one batch is drained by running
 * the CLI again; a second run over already-expired rows reports zeros and writes
 * nothing, which is the idempotent no-op the ticket asks for.
 */
export async function reapExpiredExports(
  options: { limit?: number } = {}
): Promise<ExportRetentionResult> {
  const limit = options.limit ?? RETENTION_BATCH_SIZE;
  if (!Number.isInteger(limit) || limit <= 0 || limit > RETENTION_MAX_BATCH_SIZE) {
    throw new ServiceError(
      "VALIDATION_ERROR",
      `Retention batch size must be between 1 and ${RETENTION_MAX_BATCH_SIZE}`
    );
  }

  const due = await listDueExportRequests(limit);
  const paths = due
    .map((row) => row.artifactPath)
    .filter((path): path is string => typeof path === "string" && path.length > 0);

  if (paths.length > 0) {
    // The private bucket holds one object per available request. `remove` is
    // idempotent for an object that is already gone, so a partial failure is
    // retried by the next run without special handling.
    const { error: removeError } = await getServiceClient()
      .storage.from(EXPORT_STORAGE_BUCKET)
      .remove(paths);

    if (removeError) {
      // A reported error is a real operational failure: the rows stay `available`
      // and remain candidates for the next run. The database transition must not
      // run, otherwise a row would claim its artifact is gone while the object
      // still exists and would be served by a later download.
      return { scanned: due.length, expired: 0, failed: 0, storageErrors: paths.length };
    }
  }

  // System transition (service_role only): status, expiry timestamp and the audit
  // row are written in one transaction per row.
  const { data: outcomes, error: rpcError } = await getServiceClient().rpc(
    "expire_export_requests",
    { p_limit: limit }
  );
  if (rpcError) {
    throw new ServiceError("INTERNAL_ERROR", "Failed to expire export requests");
  }

  const rows = (outcomes ?? []) as OutcomeRow[];
  return {
    scanned: due.length,
    expired: rows.filter((row) => row.outcome === "expired").length,
    failed: rows.filter((row) => row.outcome === "failed").length,
    storageErrors: 0,
  };
}
