import { createHash, randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { recordAudit } from "./audit";
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

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

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
  const query = validate(exportQuerySchema, rawQuery ?? {});
  const { organizationId, role } = await requireExportAccess(client, query.clientId, true);

  let request = client
    .from("signals")
    .select("*")
    .eq("client_id", query.clientId)
    .order("created_at", { ascending: true });
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

export async function exportClientArchive(
  client: SupabaseClient,
  rawQuery: unknown
): Promise<unknown> {
  const query = validate(exportQuerySchema, rawQuery ?? {});

  const { data: clientRow, error } = await client
    .from("clients")
    .select("organization_id")
    .eq("id", query.clientId)
    .maybeSingle();
  if (error) throw new ServiceError("INTERNAL_ERROR", "Failed to read client");
  if (!clientRow) throw new ServiceError("NOT_FOUND", "Client not found");
  const organizationId = (clientRow as { organization_id: string }).organization_id;

  const { data: owner } = await client.rpc("is_org_owner", { org_id: organizationId });
  if (!owner)
    throw new ServiceError("FORBIDDEN", "Only the organization owner can export a full archive");

  await requireConsent(client, query.clientId, "data_storage");

  const [clientData, requests, signals, themes, coreNodes, resources, targets, recommendations] =
    await Promise.all([
      client
        .from("clients")
        .select(
          "id, display_name, first_name, last_name, birth_date, birth_time, birth_place, gender, relationship_status, occupation, current_role, children_info, client_visible_notes, status"
        )
        .eq("id", query.clientId)
        .maybeSingle(),
      client.from("client_requests").select("*").eq("client_id", query.clientId),
      client.from("signals").select("*").eq("client_id", query.clientId),
      client.from("themes").select("*").eq("client_id", query.clientId),
      client.from("core_nodes").select("*").eq("client_id", query.clientId),
      client.from("resources").select("*").eq("client_id", query.clientId),
      client.from("development_targets").select("*").eq("client_id", query.clientId),
      client.from("recommendations").select("*").eq("client_id", query.clientId),
    ]);

  const all = [
    clientData,
    requests,
    signals,
    themes,
    coreNodes,
    resources,
    targets,
    recommendations,
  ];
  for (const result of all) {
    if (result.error) throw new ServiceError("INTERNAL_ERROR", "Failed to assemble client archive");
  }

  const data = {
    client: clientData.data ?? null,
    client_requests: requests.data ?? [],
    signals: signals.data ?? [],
    themes: themes.data ?? [],
    core_nodes: coreNodes.data ?? [],
    resources: resources.data ?? [],
    development_targets: targets.data ?? [],
    recommendations: recommendations.data ?? [],
  };

  const archive = {
    contract: "live-client-map.client-archive",
    version: "1.0",
    export_id: randomUUID(),
    generated_at: new Date().toISOString(),
    source_organization_id: organizationId,
    subject_client_id: query.clientId,
    manifest: {
      data_dictionary_version: "1.0",
      scoring_model_versions: [],
      ontology_versions: [],
      snapshot_versions: [],
      record_counts: {
        client_requests: (requests.data ?? []).length,
        signals: (signals.data ?? []).length,
        themes: (themes.data ?? []).length,
        core_nodes: (coreNodes.data ?? []).length,
        resources: (resources.data ?? []).length,
        development_targets: (targets.data ?? []).length,
        recommendations: (recommendations.data ?? []).length,
      },
      warnings: [],
      data_sha256: sha256(JSON.stringify(data)),
    },
    data,
  };

  await recordAudit(client, {
    organizationId,
    entityType: "client",
    entityId: query.clientId,
    action: "export.client_archive",
    after: archive.manifest.record_counts,
  });
  incrementCounter("export_total", "Total exports by type", { type: "client_archive" });
  return archive;
}
