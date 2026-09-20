import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { requireConsent } from "./consent";
import { ServiceError } from "./errors";
import { runAtomicRpc } from "./transaction";
import { uuid, validate } from "./validation";

/**
 * Client Portal (ticket 51, ticket 04 resolution; published view ticket 15).
 * The portal is a separate controlled identity (client_portal_users, matched
 * by the verified email claim) — never an organization member. SPEC §5.4/§43:
 * a portal identity gets no direct access to the base tables.
 *
 * Two read paths exist on purpose:
 *   * `getClientPortal` — the specialist path. It runs on the caller's RLS
 *     context and is used for review/preview by staff who already have access.
 *   * `getPortalOverview` — the portal identity path. It calls the guarded
 *     `get_client_portal_overview` RPC (migration 0049), which resolves the
 *     caller from auth.uid()/email, re-checks the `client_portal` consent and
 *     re-checks the portal access on every call.
 *
 * Both return only explicitly published, client-visible records: no
 * `specialist_notes_private`, no `rationale` / `risk_notes` / `rank_rationale`,
 * no pending AI output and no DifferentialHypotheses.
 */

export interface PortalTarget {
  id: string;
  name: string;
  current_level: number | null;
  target_level: number | null;
}

export interface PortalRecommendation {
  id: string;
  proposed_correction: string;
  final_priority_score: number | null;
}

export interface PortalSummary {
  id: string;
  date: string | null;
  title: string;
  summary: string;
  status: string;
}

export interface ClientPortalOverview {
  clientId: string;
  displayName: string | null;
  notes: string | null;
  agreedTargets: PortalTarget[];
  clientVisibleRecommendations: PortalRecommendation[];
  publishedSummaries: PortalSummary[];
}

export interface PortalUser {
  id: string;
  email: string;
  status: string;
  invitedAt: string;
  lastLoginAt: string | null;
  revokedAt: string | null;
}

export const createPortalUserSchema = z
  .object({
    clientId: uuid,
    email: z.string().trim().email().max(200),
  })
  .strict();

export const portalOverviewQuerySchema = z
  .object({
    clientId: uuid,
  })
  .strict();

export const portalUsersQuerySchema = z
  .object({
    clientId: uuid,
  })
  .strict();

/** Shape returned by the `get_client_portal_overview` RPC (snake_case jsonb). */
const portalOverviewRowSchema = z.object({
  client_id: uuid,
  display_name: z.string().nullable(),
  notes: z.string().nullable(),
  agreed_targets: z.array(
    z.object({
      id: uuid,
      name: z.string(),
      current_level: z.number().int().nullable(),
      target_level: z.number().int().nullable(),
    })
  ),
  client_visible_recommendations: z.array(
    z.object({
      id: uuid,
      proposed_correction: z.string(),
      final_priority_score: z.number().nullable(),
    })
  ),
  published_summaries: z.array(
    z.object({
      id: uuid,
      date: z.string().nullable(),
      title: z.string(),
      summary: z.string(),
      status: z.string(),
    })
  ),
});

/**
 * Grant (or re-activate) a portal identity. The `client_portal` consent is
 * checked as an informative first gate here and re-checked inside the atomic
 * RPC (migration 0044), which also appends the audit row in the same
 * transaction.
 */
export async function createPortalUser(client: SupabaseClient, rawInput: unknown): Promise<string> {
  const input = validate(createPortalUserSchema, rawInput);
  await requireConsent(client, input.clientId, "client_portal");

  return runAtomicRpc<string>(
    client,
    "create_portal_user",
    { p_client_id: input.clientId, p_email: input.email },
    {
      forbidden: "No access to manage this client's portal",
      validation: "Invalid portal user payload",
      failure: "Failed to create portal user",
    }
  );
}

/** Revoke a portal identity and its audit row in one transaction. */
export async function revokePortalUser(
  client: SupabaseClient,
  portalUserId: string
): Promise<void> {
  const { data: row } = await client
    .from("client_portal_users")
    .select("client_id, email")
    .eq("id", validate(uuid, portalUserId))
    .maybeSingle();
  if (!row) throw new ServiceError("NOT_FOUND", "Portal user not found");

  await runAtomicRpc<boolean>(
    client,
    "revoke_portal_user",
    { p_portal_user_id: portalUserId },
    {
      forbidden: "No access to manage this client's portal",
      failure: "Failed to revoke portal user",
    }
  );
}

/** Map a portal user's email to their active client_id (null when revoked). */
export async function portalClientId(
  client: SupabaseClient,
  email: string
): Promise<string | null> {
  const { data, error } = await client
    .from("client_portal_users")
    .select("client_id")
    .eq("email", email)
    .eq("status", "active")
    .maybeSingle();
  if (error) throw new ServiceError("INTERNAL_ERROR", "Failed to resolve portal user");
  return data ? (data as { client_id: string }).client_id : null;
}

/** Portal identities a specialist manages for one client (RLS-scoped). */
export async function listPortalUsers(
  client: SupabaseClient,
  rawQuery: unknown
): Promise<PortalUser[]> {
  const query = validate(portalUsersQuerySchema, rawQuery);
  const { data, error } = await client
    .from("client_portal_users")
    .select("id, email, status, invited_at, last_login_at, revoked_at")
    .eq("client_id", query.clientId)
    .order("invited_at", { ascending: false });
  if (error) throw new ServiceError("INTERNAL_ERROR", "Failed to list portal users");

  return (data ?? []).map((row) => {
    const r = row as {
      id: string;
      email: string;
      status: string;
      invited_at: string;
      last_login_at: string | null;
      revoked_at: string | null;
    };
    return {
      id: r.id,
      email: r.email,
      status: r.status,
      invitedAt: r.invited_at,
      lastLoginAt: r.last_login_at,
      revokedAt: r.revoked_at,
    };
  });
}

/**
 * Privacy-filtered portal read model for the currently signed-in portal
 * identity. Returns null when the caller has no active portal access (no
 * mapping, revoked access, or revoked `client_portal` consent) — the same
 * neutral result for all three, so a revoked identity is indistinguishable
 * from a foreign one.
 */
export async function getPortalOverview(
  client: SupabaseClient
): Promise<ClientPortalOverview | null> {
  const { data, error } = await client.rpc("get_client_portal_overview");
  if (error) {
    // 42501 = insufficient_privilege, raised by the portal guard when the
    // caller is not an active portal identity or consent was revoked.
    if (error.code === "42501") return null;
    throw new ServiceError("INTERNAL_ERROR", "Failed to load the client portal");
  }

  const row = validate(portalOverviewRowSchema, data);
  return {
    clientId: row.client_id,
    displayName: row.display_name,
    notes: row.notes,
    agreedTargets: row.agreed_targets,
    clientVisibleRecommendations: row.client_visible_recommendations,
    publishedSummaries: row.published_summaries,
  };
}

/**
 * Privacy-filtered portal read model for a specialist previewing a client they
 * have access to. Reads the base tables through RLS and selects a restricted
 * column set — private specialist reasoning is never part of the select list.
 */
export async function getClientPortal(
  client: SupabaseClient,
  rawQuery: unknown
): Promise<ClientPortalOverview> {
  const query = validate(portalOverviewQuerySchema, rawQuery ?? {});

  const [clientRow, targets, recommendations, corrections] = await Promise.all([
    client
      .from("clients")
      .select("id, display_name, client_visible_notes")
      .eq("id", query.clientId)
      .maybeSingle(),
    client
      .from("development_targets")
      .select("id, name, current_level, target_level")
      .eq("client_id", query.clientId)
      .eq("status", "active"),
    client
      .from("recommendations")
      .select("id, proposed_correction, final_priority_score")
      .eq("client_id", query.clientId)
      .eq("status", "approved")
      .eq("visibility", "client_visible"),
    client
      .from("corrections")
      .select("id, date, title, client_visible_summary, status")
      .eq("client_id", query.clientId)
      .neq("status", "archived")
      .not("client_visible_summary", "is", null),
  ]);

  if (clientRow.error || targets.error || recommendations.error || corrections.error) {
    throw new ServiceError("INTERNAL_ERROR", "Failed to assemble client portal");
  }
  if (!clientRow.data) throw new ServiceError("NOT_FOUND", "Client not found");

  const c = clientRow.data as { display_name: string | null; client_visible_notes: string | null };
  const summaries = (
    (corrections.data ?? []) as {
      id: string;
      date: string | null;
      title: string;
      client_visible_summary: string | null;
      status: string;
    }[]
  )
    .filter((row) => (row.client_visible_summary ?? "").trim() !== "")
    .map((row) => ({
      id: row.id,
      date: row.date,
      title: row.title,
      summary: row.client_visible_summary as string,
      status: row.status,
    }));

  return {
    clientId: query.clientId,
    displayName: c.display_name,
    notes: c.client_visible_notes,
    agreedTargets: (targets.data ?? []) as PortalTarget[],
    clientVisibleRecommendations: (recommendations.data ?? []) as PortalRecommendation[],
    publishedSummaries: summaries,
  };
}
