import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { ServiceError } from "./errors";
import { runAtomicRpc } from "./transaction";
import { uuid } from "./validation";

/**
 * Consent revocation and full data erasure (ticket 58, ticket 05 policy; made
 * atomic in ticket 08).
 *
 * The Owner revokes `data_storage` (revokeDataStorage) or runs a full hard
 * delete (executeErasure). Hard delete cascades from the `clients` row; every
 * client-scoped table already carries `on delete cascade`. The audit log is
 * anonymized, not deleted; `legal_hold` defers erasure until cleared.
 *
 * Every mutation is one SECURITY DEFINER RPC (migration 0044) invoked through
 * the authenticated client: the actor comes from auth.uid(), the Owner check,
 * the legal-hold/consent gates, the audit anonymization, the ai_runs purge and
 * the client delete commit or roll back together. The service no longer pairs a
 * mutation with a separate recordAudit() call, and no longer orchestrates the
 * erasure step by step. The `admin` (service_role) client is used only for the
 * read-only preview, which must see every child row regardless of RLS.
 */

export const ERASURE_STATUSES = [
  "requested",
  "in_progress",
  "completed",
  "blocked",
  "failed",
] as const;
export type ErasureStatus = (typeof ERASURE_STATUSES)[number];

export interface ErasureRequestRow {
  id: string;
  organization_id: string;
  client_id: string | null;
  client_ref: string;
  status: ErasureStatus;
  requested_by: string;
  requested_at: string;
  started_at: string | null;
  completed_at: string | null;
  failed_at: string | null;
  blocked_reason: string | null;
  impacted_counts: Record<string, number>;
  backup_marker: Record<string, unknown> | null;
}

export interface ErasurePreview {
  clientId: string;
  clientRef: string;
  legalHold: boolean;
  status: ErasureStatus | null;
  impacted: Record<string, number>;
  entityIds: string[];
  backupPolicy: { rotation_days: number; tombstone_required: boolean };
}

export interface ErasureResult {
  status: "completed" | "blocked" | "already_completed";
  erasureRequestId: string;
  clientRef: string;
  impacted: Record<string, number>;
}

export const erasureInputSchema = z
  .object({
    clientId: uuid,
  })
  .strict();

export const legalHoldInputSchema = z
  .object({
    clientId: uuid,
    hold: z.boolean(),
  })
  .strict();

/** Opaque, non-reversible client reference (same algorithm as report.ts). */
export function opaqueClientRef(clientId: string): string {
  return createHash("sha256").update(clientId).digest("hex").slice(0, 16);
}

/**
 * Client-scoped tables whose `client_id` cascades from `clients` (the exact
 * set from information_schema, mirrored by public.erasure_impact_tables() in
 * migration 0044). `ai_runs` is handled separately (append-only trigger) and
 * `clients` is the deleted row; `relationships` / `relationship_dynamics` are
 * collected via their own keys. Join tables without a `client_id` column
 * (signal_theme_links, theme_core_node_links, trigger_activations,
 * recommendation_targets, correction_targets, …) are not listed here — they
 * cascade through their parent and carry no personal data.
 */
const ERASURE_IMPACT_TABLES = [
  "behavioral_markers",
  "client_assignments",
  "client_feedback_forms",
  "client_goals",
  "client_portal_users",
  "client_requests",
  "consent_records",
  "core_node_reactivations",
  "core_node_relations",
  "core_nodes",
  "corrections",
  "development_targets",
  "diagnostic_session_summaries",
  "diagnostic_sessions",
  "differential_hypotheses",
  "evidence_clusters",
  "follow_ups",
  "imports",
  "life_events",
  "model_changes",
  "model_explanations",
  "observations",
  "psychological_snapshots",
  "purpose_profiles",
  "purpose_syntheses",
  "recommendations",
  "resources",
  "safety_reviews",
  "signals",
  "themes",
  "triggers",
] as const;

const BACKUP_ROTATION_DAYS = 30;

/** Pure: collapse per-table id lists into counts and a deduped id set. */
export function summarizeImpact(rowsByTable: Record<string, { id: string }[]>): {
  impacted: Record<string, number>;
  entityIds: string[];
} {
  const impacted: Record<string, number> = {};
  const entityIds = new Set<string>();
  for (const [table, rows] of Object.entries(rowsByTable)) {
    impacted[table] = rows.length;
    for (const row of rows) entityIds.add(row.id);
  }
  return { impacted, entityIds: [...entityIds].sort() };
}

interface ClientRow {
  id: string;
  organization_id: string;
  legal_hold: boolean;
}

async function loadClient(admin: SupabaseClient, clientId: string): Promise<ClientRow | null> {
  const { data, error } = await admin
    .from("clients")
    .select("id, organization_id, legal_hold")
    .eq("id", clientId)
    .maybeSingle();
  if (error) throw new ServiceError("INTERNAL_ERROR", "Failed to read client");
  return (data as ClientRow | null) ?? null;
}

async function requireOwner(auth: SupabaseClient, organizationId: string): Promise<void> {
  const { data: isOwner, error } = await auth.rpc("is_org_owner", { org_id: organizationId });
  if (error) throw new ServiceError("INTERNAL_ERROR", "Failed to verify organization owner");
  if (!isOwner) {
    throw new ServiceError("FORBIDDEN", "Only the organization owner can manage erasure");
  }
}

async function getRequest(
  admin: SupabaseClient,
  clientRef: string
): Promise<ErasureRequestRow | null> {
  const { data, error } = await admin
    .from("erasure_requests")
    .select("*")
    .eq("client_ref", clientRef)
    .maybeSingle();
  if (error) throw new ServiceError("INTERNAL_ERROR", "Failed to read erasure request");
  return (data as ErasureRequestRow | null) ?? null;
}

/** Collect child-entity ids and per-table counts before any mutation. */
async function collectImpact(
  admin: SupabaseClient,
  clientId: string
): Promise<ReturnType<typeof summarizeImpact>> {
  const rowsByTable: Record<string, { id: string }[]> = {};

  const results = await Promise.all(
    ERASURE_IMPACT_TABLES.map(async (table) => {
      const { data, error } = await admin.from(table).select("id").eq("client_id", clientId);
      if (error) throw new ServiceError("INTERNAL_ERROR", `Failed to read ${table} for erasure`);
      return { table, rows: (data ?? []) as { id: string }[] };
    })
  );
  for (const { table, rows } of results) rowsByTable[table] = rows;

  const [relA, relB] = await Promise.all([
    admin.from("relationships").select("id").eq("client_a_id", clientId),
    admin.from("relationships").select("id").eq("client_b_id", clientId),
  ]);
  if (relA.error || relB.error) {
    throw new ServiceError("INTERNAL_ERROR", "Failed to read relationships for erasure");
  }
  const relationships = [...(relA.data ?? []), ...(relB.data ?? [])] as { id: string }[];
  rowsByTable["relationships"] = relationships;

  if (relationships.length > 0) {
    const { data: dynamics, error } = await admin
      .from("relationship_dynamics")
      .select("id")
      .in(
        "relationship_id",
        relationships.map((relationship) => relationship.id)
      );
    if (error) {
      throw new ServiceError("INTERNAL_ERROR", "Failed to read relationship dynamics for erasure");
    }
    rowsByTable["relationship_dynamics"] = (dynamics ?? []) as { id: string }[];
  } else {
    rowsByTable["relationship_dynamics"] = [];
  }

  return summarizeImpact(rowsByTable);
}

/** Owner-only preview of what a full erasure would remove. */
export async function previewErasure(
  auth: SupabaseClient,
  admin: SupabaseClient,
  clientId: string
): Promise<ErasurePreview> {
  const client = await loadClient(admin, clientId);
  if (!client) throw new ServiceError("NOT_FOUND", "Client not found");

  await requireOwner(auth, client.organization_id);

  const clientRef = opaqueClientRef(clientId);
  const existing = await getRequest(admin, clientRef);
  const impact = await collectImpact(admin, clientId);

  return {
    clientId,
    clientRef,
    legalHold: client.legal_hold,
    status: existing?.status ?? null,
    impacted: impact.impacted,
    entityIds: [clientId, ...impact.entityIds],
    backupPolicy: { rotation_days: BACKUP_ROTATION_DAYS, tombstone_required: true },
  };
}

/**
 * Set or clear the legal hold that defers erasure. Owner-only, one transaction
 * with its audit row (migration 0044). The client row is locked inside the RPC,
 * so the decision cannot race a concurrent erasure.
 */
export async function setLegalHold(
  auth: SupabaseClient,
  admin: SupabaseClient,
  clientId: string,
  hold: boolean
): Promise<void> {
  const client = await loadClient(admin, clientId);
  if (!client) throw new ServiceError("NOT_FOUND", "Client not found");

  await requireOwner(auth, client.organization_id);

  await runAtomicRpc(
    auth,
    "set_client_legal_hold",
    { p_client_id: clientId, p_hold: hold },
    {
      forbidden: "Only the organization owner can manage the legal hold",
      failure: "Failed to update legal hold",
    }
  );
}

/**
 * Revoke `data_storage` — the trigger that initiates the erasure procedure
 * (ticket 05). The consent revocation and the `requested` erasure request are
 * recorded in one transaction; full deletion runs via executeErasure.
 * Idempotent: never downgrades an existing terminal request.
 */
export async function revokeDataStorage(
  auth: SupabaseClient,
  admin: SupabaseClient,
  clientId: string
): Promise<string> {
  const client = await loadClient(admin, clientId);
  if (!client) throw new ServiceError("NOT_FOUND", "Client not found");

  await requireOwner(auth, client.organization_id);

  const result = await runAtomicRpc<{ erasure_request_id: string }>(
    auth,
    "request_client_erasure",
    { p_client_id: clientId },
    {
      forbidden: "Only the organization owner can manage erasure",
      failure: "Failed to record the erasure request",
    }
  );
  return result.erasure_request_id;
}

/**
 * Execute the full erasure inside one RPC. Idempotent and recoverable: a
 * completed request is never re-run, a legal hold returns `blocked` before
 * anything irreversible happens, and a request whose client is already gone is
 * finalized instead of failing. A failed attempt leaves no partial deletion —
 * the whole transaction rolled back, including the anonymized audit rows.
 */
export async function executeErasure(
  auth: SupabaseClient,
  admin: SupabaseClient,
  clientId: string
): Promise<ErasureResult> {
  const clientRef = opaqueClientRef(clientId);
  const client = await loadClient(admin, clientId);
  const existing = await getRequest(admin, clientRef);

  // Keep the NOT_FOUND contract: the RPC would otherwise report a validation
  // error for an unknown client id.
  if (!client && !existing) throw new ServiceError("NOT_FOUND", "Client not found");

  const result = await runAtomicRpc<{
    status: "completed" | "blocked" | "already_completed";
    erasure_request_id: string;
    client_ref: string;
    impacted: Record<string, number>;
  }>(
    auth,
    "execute_client_erasure",
    { p_client_id: clientId },
    {
      forbidden: "Only the organization owner can manage erasure",
      failure: "Failed to execute erasure",
    }
  );

  return {
    status: result.status,
    erasureRequestId: result.erasure_request_id,
    clientRef: result.client_ref,
    impacted: result.impacted ?? {},
  };
}
