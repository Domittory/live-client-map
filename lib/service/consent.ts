import type { SupabaseClient } from "@supabase/supabase-js";
import { ServiceError } from "./errors";

export const CONSENT_TYPES = [
  "data_storage",
  "ai_analysis",
  "sensitive_psychological_data",
  "health_related_data",
  "supervisor_access",
  "client_portal",
  "anonymized_analytics",
  "relationship_analysis",
] as const;

export type ConsentType = (typeof CONSENT_TYPES)[number];

/** Whether the client has an active (granted, not revoked) consent of this type. */
export async function hasConsent(
  client: SupabaseClient,
  clientId: string,
  type: ConsentType
): Promise<boolean> {
  const { data, error } = await client.rpc("has_consent", {
    p_client_id: clientId,
    p_consent_type: type,
  });
  if (error) throw new ServiceError("INTERNAL_ERROR", "Failed to check consent");
  return Boolean(data);
}

/**
 * Service guard (ticket 13): protected operations call this before running.
 * Throws FORBIDDEN unless the required consent is active.
 */
export async function requireConsent(
  client: SupabaseClient,
  clientId: string,
  type: ConsentType
): Promise<void> {
  if (!(await hasConsent(client, clientId, type))) {
    throw new ServiceError("FORBIDDEN", `Missing consent: ${type}`);
  }
}
