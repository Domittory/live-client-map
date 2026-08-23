import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { recordAudit } from "./audit";
import { ServiceError } from "./errors";
import { uuid } from "./validation";

/**
 * Consent revocation and full data erasure (ticket 58, ticket 05 policy).
 *
 * The Owner revokes `data_storage` (revokeDataStorage) or runs a full hard
 * delete (executeErasure). Hard delete cascades from the `clients` row; every
 * client-scoped table already carries `on delete cascade`. The audit log is
 * anonymized, not deleted; `legal_hold` defers erasure until cleared.
 *
 * Authorization and audit go through the authenticated client (the owner RPC
 * and append_audit read auth.uid(), which is null under service_role); direct
 * mutations and the erasure RPCs go through the service_role admin client.
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
 * set from information_schema). `ai_runs` is handled separately (append-only
 * trigger) and `clients` is the deleted row; `relationships` /
 * `relationship_dynamics` are collected via their own keys. Join tables
 * without a `client_id` column (signal_theme_links, theme_core_node_links,
 * trigger_activations, recommendation_targets, correction_targets, …) are not
 * listed here — they cascade through their parent and carry no personal data.
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

async function requireUserId(auth: SupabaseClient): Promise<string> {
  const {
    data: { user },
  } = await auth.auth.getUser();
  if (!user) throw new ServiceError("UNAUTHORIZED", "Authentication required");
  return user.id;
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

async function upsertRequest(
  admin: SupabaseClient,
  organizationId: string,
  clientRef: string,
  row: {
    client_id: string | null;
    status: ErasureStatus;
    requested_by: string;
    started_at?: string | null;
    blocked_reason?: string | null;
    impacted_counts?: Record<string, number>;
  }
): Promise<ErasureRequestRow> {
  const { data, error } = await admin
    .from("erasure_requests")
    .upsert(
      { organization_id: organizationId, client_ref: clientRef, ...row },
      {
        onConflict: "organization_id,client_ref",
      }
    )
    .select()
    .single();
  if (error) throw new ServiceError("INTERNAL_ERROR", "Failed to record erasure request");
  return data as ErasureRequestRow;
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

/** Set or clear the legal hold that defers erasure. Owner-only. */
export async function setLegalHold(
  auth: SupabaseClient,
  admin: SupabaseClient,
  clientId: string,
  hold: boolean
): Promise<void> {
  const client = await loadClient(admin, clientId);
  if (!client) throw new ServiceError("NOT_FOUND", "Client not found");

  await requireOwner(auth, client.organization_id);

  const { error } = await admin.from("clients").update({ legal_hold: hold }).eq("id", clientId);
  if (error) throw new ServiceError("INTERNAL_ERROR", "Failed to update legal hold");

  await recordAudit(auth, {
    organizationId: client.organization_id,
    entityType: "client",
    entityId: clientId,
    action: hold ? "client.legal_hold_set" : "client.legal_hold_cleared",
    after: { legal_hold: hold },
  });
}

/**
 * Revoke `data_storage` — the trigger that initiates the erasure procedure
 * (ticket 05). Records a `requested` erasure request; full deletion runs via
 * executeErasure. Idempotent: never downgrades an existing terminal request.
 */
export async function revokeDataStorage(
  auth: SupabaseClient,
  admin: SupabaseClient,
  clientId: string
): Promise<string> {
  const client = await loadClient(admin, clientId);
  if (!client) throw new ServiceError("NOT_FOUND", "Client not found");

  await requireOwner(auth, client.organization_id);

  const now = new Date().toISOString();
  const { error } = await admin
    .from("consent_records")
    .update({ revoked_at: now })
    .eq("client_id", clientId)
    .eq("consent_type", "data_storage")
    .is("revoked_at", null);
  if (error) throw new ServiceError("INTERNAL_ERROR", "Failed to revoke data_storage consent");

  const clientRef = opaqueClientRef(clientId);
  const existing = await getRequest(admin, clientRef);
  if (existing?.status === "completed" || existing?.status === "blocked") {
    return existing.id;
  }

  const userId = await requireUserId(auth);
  const request = await upsertRequest(admin, client.organization_id, clientRef, {
    client_id: clientId,
    status: "requested",
    requested_by: userId,
  });
  return request.id;
}

/**
 * Execute the full erasure. Idempotent: every step is a no-op if already
 * applied, so a retry after a partial failure resumes instead of redoing or
 * erroring. Returns `blocked` when legal_hold is set and `already_completed`
 * when the client is already gone.
 */
export async function executeErasure(
  auth: SupabaseClient,
  admin: SupabaseClient,
  clientId: string
): Promise<ErasureResult> {
  const clientRef = opaqueClientRef(clientId);
  const client = await loadClient(admin, clientId);
  const existing = await getRequest(admin, clientRef);

  const organizationId = client?.organization_id ?? existing?.organization_id;
  if (!organizationId) throw new ServiceError("NOT_FOUND", "Client not found");

  await requireOwner(auth, organizationId);

  if (existing?.status === "completed") {
    return {
      status: "already_completed",
      erasureRequestId: existing.id,
      clientRef,
      impacted: existing.impacted_counts ?? {},
    };
  }

  // Client already hard-deleted (a prior run reached the delete but failed to
  // finalize): finish the bookkeeping and report already_completed.
  if (!client) {
    if (!existing) throw new ServiceError("NOT_FOUND", "Client not found");
    const completedAt = new Date().toISOString();
    await admin
      .from("erasure_requests")
      .update({ status: "completed", completed_at: completedAt })
      .eq("id", existing.id);
    await recordAudit(auth, {
      organizationId,
      entityType: "erasure_request",
      entityId: existing.id,
      action: "client.erasure_completed",
      after: { client_ref: clientRef, completed_at: completedAt },
    });
    return {
      status: "already_completed",
      erasureRequestId: existing.id,
      clientRef,
      impacted: existing.impacted_counts ?? {},
    };
  }

  const userId = await requireUserId(auth);

  if (client.legal_hold) {
    const request = await upsertRequest(admin, organizationId, clientRef, {
      client_id: clientId,
      status: "blocked",
      requested_by: userId,
      started_at: null,
      blocked_reason: "legal_hold",
    });
    await recordAudit(auth, {
      organizationId,
      entityType: "client",
      entityId: clientId,
      action: "client.erasure_blocked",
      after: { legal_hold: true },
    });
    return {
      status: "blocked",
      erasureRequestId: request.id,
      clientRef,
      impacted: {},
    };
  }

  // Collect ids BEFORE any mutation — they are needed to anonymize the child
  // audit rows that survive the cascade.
  const impact = await collectImpact(admin, clientId);
  const impacted = impact.impacted;
  const entityIds = [clientId, ...impact.entityIds];

  const request = await upsertRequest(admin, organizationId, clientRef, {
    client_id: clientId,
    status: "in_progress",
    requested_by: userId,
    started_at: new Date().toISOString(),
    blocked_reason: null,
    impacted_counts: impacted,
  });

  await recordAudit(auth, {
    organizationId,
    entityType: "client",
    entityId: clientId,
    action: "client.erasure_requested",
    after: { client_ref: clientRef, impacted },
  });

  try {
    // Revoke every consent — this immediately blocks AI/portal/supervisor
    // through the existing consent gates.
    const revokedAt = new Date().toISOString();
    const consentResult = await admin
      .from("consent_records")
      .update({ revoked_at: revokedAt })
      .eq("client_id", clientId)
      .is("revoked_at", null);
    if (consentResult.error) {
      throw new ServiceError("INTERNAL_ERROR", "Failed to revoke consents");
    }

    // Anonymize the audit trail for this client and its child entities.
    await admin.rpc("anonymize_client_audit", { p_client_id: clientId, p_entity_ids: entityIds });

    // Purge ai_runs first: its append-only trigger would otherwise abort the
    // cascade that the client delete performs.
    await admin.rpc("purge_client_ai_runs", { p_client_id: clientId });

    // Hard delete the client; every client-scoped table cascades.
    const { error: deleteError } = await admin.from("clients").delete().eq("id", clientId);
    if (deleteError) throw new ServiceError("INTERNAL_ERROR", "Failed to delete client");

    const completedAt = new Date().toISOString();
    const backupMarker = {
      policy: "30_day_rotation",
      tombstone_required: true,
      erased_at: completedAt,
      client_ref: clientRef,
      organization_id: organizationId,
      impacted_counts: impacted,
    };
    await admin
      .from("erasure_requests")
      .update({ status: "completed", completed_at: completedAt, backup_marker: backupMarker })
      .eq("id", request.id);

    await recordAudit(auth, {
      organizationId,
      entityType: "erasure_request",
      entityId: request.id,
      action: "client.erasure_completed",
      after: { client_ref: clientRef, impacted, completed_at: completedAt },
    });

    return { status: "completed", erasureRequestId: request.id, clientRef, impacted };
  } catch (err) {
    // Mark the attempt failed but leave the partial state for an idempotent
    // retry to resume.
    await admin
      .from("erasure_requests")
      .update({ status: "failed", failed_at: new Date().toISOString() })
      .eq("id", request.id)
      .then(
        () => undefined,
        () => undefined
      );
    throw err;
  }
}
