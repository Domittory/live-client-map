import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { recordAudit } from "./audit";
import { assembleClientArchive, type ClientArchive } from "./client-archive";
import { requireConsent } from "./consent";
import { ServiceError } from "./errors";
import { incrementCounter } from "@/lib/telemetry";
import { uuid, validate } from "./validation";

/**
 * Export (ticket 55, docs/data-exchange-contracts.md §11–§12).
 * - Full client JSON archive: Owner-only, versioned, lossless for the allowed
 *   portable read model, excludes private specialist notes and secrets.
 * - Signals CSV: Owner/primary/secondary specialist; preserves raw statement,
 *   source lineage and review status; secondary specialists never get sensitive.
 * Both require data_storage consent and an active assignment; both write an
 * audit trail.
 */

export const CSV_COLUMNS = [
  "contract_version",
  "external_id",
  "source_session_ref",
  "source_type",
  "source_ref",
  "epistemic_type",
  "raw_statement",
  "statement_polarity",
  "test_result",
  "normalized_meaning",
  "inferred_opposite",
  "intensity",
  "confidence",
  "life_areas_json",
  "tags_json",
  "context_json",
  "time_scope",
  "claimed_evidence_level",
  "visibility",
  "source_review_status",
  "source_created_at",
  "source_updated_at",
];

const exportQuerySchema = z
  .object({
    clientId: uuid,
  })
  .strict();

/** §12: archived Signals are opt-in; the default export is the live set. */
const signalsExportQuerySchema = exportQuerySchema.extend({
  includeArchived: z.boolean().optional(),
});

function csvCell(value: unknown): string {
  const s = value === null || value === undefined ? "" : String(value);
  if (/[",\n\r]/.test(s)) {
    return `"${s.replaceAll('"', '""')}"`;
  }
  return s;
}

/**
 * Shared export authorization: tenant + assignment (`is_client_accessible`) +
 * active `data_storage` consent, returning the caller's assignment role for
 * visibility filtering. Reused by the snapshot report (ticket 56) so that both
 * export paths enforce one identical rule instead of drifting apart.
 */
export async function requireExportAccess(
  client: SupabaseClient,
  clientId: string,
  requireWrite: boolean
): Promise<{ organizationId: string; role: string | null }> {
  const { data: clientRow, error } = await client
    .from("clients")
    .select("organization_id")
    .eq("id", clientId)
    .maybeSingle();
  if (error) throw new ServiceError("INTERNAL_ERROR", "Failed to read client");
  if (!clientRow) throw new ServiceError("NOT_FOUND", "Client not found");

  const organizationId = (clientRow as { organization_id: string }).organization_id;
  const { data: accessible } = await client.rpc("is_client_accessible", {
    p_org_id: organizationId,
    p_client_id: clientId,
    p_require_write: requireWrite,
  });
  if (!accessible) throw new ServiceError("FORBIDDEN", "No access to this client");

  await requireConsent(client, clientId, "data_storage");

  // Resolve the caller's assignment role (for sensitive filtering).
  const {
    data: { user },
  } = await client.auth.getUser();
  const { data: assignment } = await client
    .from("client_assignments")
    .select("access_role")
    .eq("client_id", clientId)
    .eq("user_id", user?.id)
    .maybeSingle();

  return {
    organizationId,
    role: assignment ? (assignment as { access_role: string }).access_role : null,
  };
}

export async function exportSignalsCsv(client: SupabaseClient, rawQuery: unknown): Promise<string> {
  const query = validate(signalsExportQuerySchema, rawQuery ?? {});
  const { organizationId, role } = await requireExportAccess(client, query.clientId, true);

  // §12: deterministic row order is `source_created_at`, then `external_id`
  // (the Signal UUID); archived rows are excluded unless explicitly requested.
  let request = client
    .from("signals")
    .select("*")
    .eq("client_id", query.clientId)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });
  if (!query.includeArchived) {
    request = request.is("archived_at", null);
  }
  if (role === "secondary_specialist") {
    request = request.neq("visibility", "sensitive");
  }

  const { data: signals, error } = await request;
  if (error) throw new ServiceError("INTERNAL_ERROR", "Failed to export signals");

  const rows: string[][] = [CSV_COLUMNS];
  for (const signal of (signals ?? []) as Record<string, unknown>[]) {
    rows.push(
      CSV_COLUMNS.map((column) => {
        if (column === "contract_version") return "live-client-map.signals-csv/1.0";
        if (column === "external_id") return String(signal.id);
        if (column === "source_ref") return String(signal.source_ref_id ?? "");
        if (column === "life_areas_json") return JSON.stringify(signal.life_areas ?? []);
        if (column === "tags_json") return JSON.stringify(signal.tags ?? []);
        if (column === "context_json") return JSON.stringify(signal.context ?? null);
        if (column === "source_review_status") return String(signal.review_status ?? "");
        if (column === "claimed_evidence_level") return String(signal.evidence_level ?? "");
        return String(signal[column] ?? "");
      })
    );
  }

  const csv = rows.map((row) => row.map(csvCell).join(",")).join("\n");

  await recordAudit(client, {
    organizationId,
    entityType: "client",
    entityId: query.clientId,
    action: "export.signals_csv",
    after: { signals: rows.length - 1 },
  });
  incrementCounter("export_total", "Total exports by type", { type: "signals_csv" });
  return csv;
}

/**
 * Full client JSON archive (ticket 18). The contract-compliant assembler lives in
 * `client-archive.ts`; this wrapper owns validation, the audit trail and the
 * telemetry counter. The audit payload carries counts, ids and a hash only —
 * never raw client content or a second client's identifier.
 */
export async function exportClientArchive(
  client: SupabaseClient,
  rawQuery: unknown
): Promise<ClientArchive> {
  const query = validate(exportQuerySchema, rawQuery ?? {});
  const { archive, organizationId } = await assembleClientArchive(client, query.clientId);

  await recordAudit(client, {
    organizationId,
    entityType: "client",
    entityId: query.clientId,
    action: "export.client_archive",
    after: {
      export_id: archive.export_id,
      contract: archive.contract,
      version: archive.version,
      data_sha256: archive.manifest.data_sha256,
      record_counts: archive.manifest.record_counts,
    },
  });
  incrementCounter("export_total", "Total exports by type", { type: "client_archive" });
  return archive;
}
