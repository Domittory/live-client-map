import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { ServiceError } from "./errors";
import { runAtomicRpc } from "./transaction";
import { uuid, validate } from "./validation";

/**
 * Client-scoped access model for the client workspace (ticket 09).
 *
 * Authorization truth stays in the database: every function here either calls a
 * guarded RPC (`is_client_accessible`, `is_org_owner`, `grant/revoke_client_assignment`,
 * `list_client_assignments`) or an RLS-protected table read. The service layer
 * never decides on its own whether a user may see or change a client.
 */

export const ACCESS_ROLES = [
  "primary_specialist",
  "secondary_specialist",
  "supervisor",
  "read_only",
] as const;

export type AccessRole = (typeof ACCESS_ROLES)[number];

export interface ClientAccessContext {
  organizationId: string;
  clientId: string;
  /** Read the client and its data (any active assignment, or the Owner). */
  canRead: boolean;
  /** Write access: client edits, consent, corrections (primary/secondary/Owner). */
  canWrite: boolean;
  /** Organization Owner: manages assignments and destructive actions. */
  isOwner: boolean;
}

/** Resolve the caller's effective access to one client from the database. */
export async function getClientAccessContext(
  client: SupabaseClient,
  organizationId: string,
  clientId: string
): Promise<ClientAccessContext> {
  const orgId = validate(uuid, organizationId);
  const id = validate(uuid, clientId);

  const [read, write, owner] = await Promise.all([
    client.rpc("is_client_accessible", {
      p_org_id: orgId,
      p_client_id: id,
      p_require_write: false,
    }),
    client.rpc("is_client_accessible", {
      p_org_id: orgId,
      p_client_id: id,
      p_require_write: true,
    }),
    client.rpc("is_org_owner", { org_id: orgId }),
  ]);

  if (read.error || write.error || owner.error) {
    throw new ServiceError("INTERNAL_ERROR", "Failed to resolve client access");
  }

  return {
    organizationId: orgId,
    clientId: id,
    canRead: Boolean(read.data),
    canWrite: Boolean(write.data),
    isOwner: Boolean(owner.data),
  };
}

export interface ClientAssignment {
  userId: string;
  email: string | null;
  accessRole: string;
  grantedAt: string;
}

interface ClientAssignmentRow {
  user_id: string;
  email: string | null;
  access_role: string;
  granted_at: string;
}

/**
 * Active assignment roster of one client. Owner-only, enforced inside the RPC
 * (client_assignments RLS exposes a user's own rows only).
 */
export async function listClientAssignments(
  client: SupabaseClient,
  input: { organizationId: string; clientId: string }
): Promise<ClientAssignment[]> {
  const { data, error } = await client.rpc("list_client_assignments", {
    p_org_id: validate(uuid, input.organizationId),
    p_client_id: validate(uuid, input.clientId),
  });
  if (error) {
    if (error.code === "42501") {
      throw new ServiceError("FORBIDDEN", "Only the organization owner can view assignments");
    }
    if (error.code === "22023") {
      throw new ServiceError("NOT_FOUND", "Client not found");
    }
    throw new ServiceError("INTERNAL_ERROR", "Failed to list assignments");
  }

  return ((data ?? []) as ClientAssignmentRow[]).map((row) => ({
    userId: row.user_id,
    email: row.email,
    accessRole: row.access_role,
    grantedAt: row.granted_at,
  }));
}

export const grantClientAssignmentSchema = z
  .object({
    organizationId: uuid,
    clientId: uuid,
    email: z.string().trim().email().max(320),
    accessRole: z.enum(ACCESS_ROLES),
  })
  .strict();

export const revokeClientAssignmentSchema = z
  .object({
    organizationId: uuid,
    clientId: uuid,
    userId: uuid,
  })
  .strict();

/**
 * Resolve an active organization member by email without the service-role user
 * directory: organization_members and co-member profiles are readable under RLS.
 */
export async function findActiveMemberByEmail(
  client: SupabaseClient,
  input: { organizationId: string; email: string }
): Promise<{ userId: string; email: string } | null> {
  const orgId = validate(uuid, input.organizationId);
  const email = input.email.trim().toLowerCase();
  if (!email) return null;

  const { data: members, error: membersError } = await client
    .from("organization_members")
    .select("user_id")
    .eq("organization_id", orgId)
    .eq("status", "active");
  if (membersError) throw new ServiceError("INTERNAL_ERROR", "Failed to list members");

  const memberIds = (members ?? []).map((member) => member.user_id);
  if (memberIds.length === 0) return null;

  const { data: profiles, error: profilesError } = await client
    .from("profiles")
    .select("id, email")
    .in("id", memberIds);
  if (profilesError) throw new ServiceError("INTERNAL_ERROR", "Failed to list member profiles");

  const match = (profiles ?? []).find((profile) => profile.email?.trim().toLowerCase() === email);
  return match ? { userId: match.id, email: match.email ?? email } : null;
}

/**
 * Owner-only grant (the RPC enforces the owner rule and validates the target is
 * an active member of the organization). The email lookup is scoped to the
 * organization, so an owner can never assign a client to an outsider.
 */
export async function grantClientAssignment(
  client: SupabaseClient,
  rawInput: unknown
): Promise<void> {
  const input = validate(grantClientAssignmentSchema, rawInput);
  const member = await findActiveMemberByEmail(client, {
    organizationId: input.organizationId,
    email: input.email,
  });
  if (!member) {
    throw new ServiceError("NOT_FOUND", "Member with this email was not found");
  }

  await runAtomicRpc<void>(
    client,
    "grant_client_assignment",
    {
      p_org_id: input.organizationId,
      p_client_id: input.clientId,
      p_user_id: member.userId,
      p_access_role: input.accessRole,
    },
    {
      forbidden: "Only the organization owner can manage assignments",
      failure: "Failed to grant client assignment",
      validation: "Invalid client assignment",
    }
  );
}

/** Owner-only revoke; keeps the assignment row for audit, clears revoked_at on re-grant. */
export async function revokeClientAssignment(
  client: SupabaseClient,
  rawInput: unknown
): Promise<void> {
  const input = validate(revokeClientAssignmentSchema, rawInput);
  await runAtomicRpc<void>(
    client,
    "revoke_client_assignment",
    {
      p_org_id: input.organizationId,
      p_client_id: input.clientId,
      p_user_id: input.userId,
    },
    {
      forbidden: "Only the organization owner can manage assignments",
      failure: "Failed to revoke client assignment",
      validation: "Invalid client assignment",
    }
  );
}
