import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { ServiceError } from "./errors";
import { runAtomicRpc } from "./transaction";
import { uuid, validate } from "./validation";

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

export interface ClientConsent {
  consentType: ConsentType;
  scope: string;
  documentVersion: string;
  grantedAt: string | null;
  isActive: boolean;
}

interface ConsentRecordRow {
  consent_type: string;
  scope: string;
  document_version: string;
  granted_at: string;
  revoked_at: string | null;
}

/**
 * Latest consent state per type for one client (ticket 09). Reads through the
 * caller's RLS session; the `consent_records` policy already limits rows to the
 * organization, and callers only reach this after the client access guard.
 * Mirrors `has_consent()`: the newest record decides whether consent is active.
 */
export async function listClientConsents(
  client: SupabaseClient,
  input: { organizationId: string; clientId: string }
): Promise<ClientConsent[]> {
  const { data, error } = await client
    .from("consent_records")
    .select("consent_type, scope, document_version, granted_at, revoked_at")
    .eq("organization_id", validate(uuid, input.organizationId))
    .eq("client_id", validate(uuid, input.clientId))
    .order("granted_at", { ascending: false });

  if (error) throw new ServiceError("INTERNAL_ERROR", "Failed to list consent records");

  const latest = new Map<string, ClientConsent>();
  for (const row of (data ?? []) as ConsentRecordRow[]) {
    if (latest.has(row.consent_type)) continue;
    latest.set(row.consent_type, {
      consentType: row.consent_type as ConsentType,
      scope: row.scope,
      documentVersion: row.document_version,
      grantedAt: row.granted_at,
      isActive: row.revoked_at === null,
    });
  }

  return CONSENT_TYPES.map(
    (type) =>
      latest.get(type) ?? {
        consentType: type,
        scope: "",
        documentVersion: "",
        grantedAt: null,
        isActive: false,
      }
  );
}

export const grantClientConsentSchema = z
  .object({
    organizationId: uuid,
    clientId: uuid,
    consentType: z.enum(CONSENT_TYPES),
    scope: z.string().trim().max(2000).default(""),
    documentVersion: z.string().trim().min(1).max(100),
  })
  .strict();

export const revokeClientConsentSchema = z
  .object({
    organizationId: uuid,
    clientId: uuid,
    consentType: z.enum(CONSENT_TYPES),
  })
  .strict();

/**
 * Append a new versioned consent record. The atomic RPC revalidates write access
 * and the client tenant, and appends the audit row in the same transaction.
 */
export async function grantClientConsent(
  client: SupabaseClient,
  rawInput: unknown
): Promise<string> {
  const input = validate(grantClientConsentSchema, rawInput);
  return runAtomicRpc<string>(
    client,
    "grant_consent",
    {
      p_org_id: input.organizationId,
      p_client_id: input.clientId,
      p_consent_type: input.consentType,
      p_scope: input.scope,
      p_document_version: input.documentVersion,
    },
    {
      forbidden: "No write access to this client",
      failure: "Failed to grant consent",
      validation: "Invalid consent record",
    }
  );
}

/** Revoke the active consent record of one type through the same guarded RPC. */
export async function revokeClientConsent(
  client: SupabaseClient,
  rawInput: unknown
): Promise<void> {
  const input = validate(revokeClientConsentSchema, rawInput);
  await runAtomicRpc<void>(
    client,
    "revoke_consent",
    {
      p_org_id: input.organizationId,
      p_client_id: input.clientId,
      p_consent_type: input.consentType,
    },
    {
      forbidden: "No write access to this client",
      failure: "Failed to revoke consent",
      validation: "Invalid consent record",
    }
  );
}
