import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { requireConsent } from "./consent";
import { ServiceError } from "./errors";
import { runAtomicRpc } from "./transaction";
import { uuid, validate } from "./validation";

/**
 * Client Portal (ticket 51, ticket 04 resolution). The portal is a separate
 * controlled identity (client_portal_users, matched by email) — never an
 * organization member. The read model returns only explicitly published,
 * client-visible records: no private notes, no risk, no pending AI hypotheses.
 * Base business tables stay org-member/assignment scoped via RLS, so a portal
 * user cannot read them directly.
 */

export interface ClientPortalOverview {
  clientId: string;
  displayName: string | null;
  notes: string | null;
  agreedTargets: {
    id: string;
    name: string;
    current_level: number | null;
    target_level: number | null;
  }[];
  clientVisibleRecommendations: {
    id: string;
    proposed_correction: string;
    final_priority_score: number | null;
  }[];
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

/** Privacy-filtered portal read model: only published, client-visible data. */
export async function getClientPortal(
  client: SupabaseClient,
  rawQuery: unknown
): Promise<ClientPortalOverview> {
  const query = validate(portalOverviewQuerySchema, rawQuery ?? {});

  const [clientRow, targets, recommendations] = await Promise.all([
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
  ]);

  if (clientRow.error || targets.error || recommendations.error) {
    throw new ServiceError("INTERNAL_ERROR", "Failed to assemble client portal");
  }
  if (!clientRow.data) throw new ServiceError("NOT_FOUND", "Client not found");

  const c = clientRow.data as { display_name: string | null; client_visible_notes: string | null };
  return {
    clientId: query.clientId,
    displayName: c.display_name,
    notes: c.client_visible_notes,
    agreedTargets: (targets.data ?? []) as ClientPortalOverview["agreedTargets"],
    clientVisibleRecommendations: (recommendations.data ??
      []) as ClientPortalOverview["clientVisibleRecommendations"],
  };
}
