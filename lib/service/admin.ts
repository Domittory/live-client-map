import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { ServiceError } from "./errors";
import { runAtomicRpc } from "./transaction";
import { uuid, validate } from "./validation";

/** Ticket 05 retention policy bounds; audit/backup periods are fixed. */
export const RETENTION_POLICY = {
  clientDataYears: { min: 1, max: 5, default: 5 },
  exportDays: { min: 1, max: 30, default: 30 },
  auditYears: 3,
  backupDays: 30,
} as const;

export const retentionSettingsSchema = z
  .object({
    clientDataYears: z
      .number()
      .int()
      .min(RETENTION_POLICY.clientDataYears.min)
      .max(RETENTION_POLICY.clientDataYears.max),
    exportDays: z
      .number()
      .int()
      .min(RETENTION_POLICY.exportDays.min)
      .max(RETENTION_POLICY.exportDays.max),
  })
  .strict();

export const inviteMemberSchema = z
  .object({
    organizationId: uuid,
    email: z.string().trim().email().max(320),
    role: z.enum(["specialist", "supervisor"]),
  })
  .strict();

export const updateMemberRoleSchema = z
  .object({
    organizationId: uuid,
    userId: uuid,
    role: z.enum(["specialist", "supervisor"]),
  })
  .strict();

export const setMemberStatusSchema = z
  .object({
    organizationId: uuid,
    userId: uuid,
    status: z.enum(["active", "suspended"]),
  })
  .strict();

export const transferOwnershipSchema = z
  .object({
    organizationId: uuid,
    newOwnerId: uuid,
  })
  .strict();

export const updateOrgSettingsSchema = z
  .object({
    organizationId: uuid,
    name: z.string().trim().min(1).max(200).optional(),
    retention: retentionSettingsSchema.optional(),
  })
  .strict();

/** Map RPC errors raised by the 0007 admin functions to the error contract. */
function mapRpcError(error: { code?: string; message?: string }, fallback: string): ServiceError {
  if (error.code === "42501") return new ServiceError("FORBIDDEN", error.message ?? fallback);
  if (error.code === "22023")
    return new ServiceError("VALIDATION_ERROR", error.message ?? fallback);
  if (error.code === "23505") return new ServiceError("CONFLICT", error.message ?? fallback);
  return new ServiceError("INTERNAL_ERROR", fallback);
}

export async function inviteMember(client: SupabaseClient, rawInput: unknown): Promise<string> {
  const input = validate(inviteMemberSchema, rawInput);
  const { data, error } = await client.rpc("invite_member", {
    p_org_id: input.organizationId,
    p_email: input.email,
    p_role: input.role,
  });
  if (error) throw mapRpcError(error, "Failed to invite member");
  return data as string;
}

export async function acceptInvitation(client: SupabaseClient, token: string): Promise<string> {
  const { data, error } = await client.rpc("accept_invitation", {
    p_token: validate(uuid, token),
  });
  if (error) throw mapRpcError(error, "Failed to accept invitation");
  return data as string;
}

export async function updateMemberRole(client: SupabaseClient, rawInput: unknown): Promise<void> {
  const input = validate(updateMemberRoleSchema, rawInput);
  const { error } = await client.rpc("update_member_role", {
    p_org_id: input.organizationId,
    p_user_id: input.userId,
    p_role: input.role,
  });
  if (error) throw mapRpcError(error, "Failed to update member role");
}

export async function setMemberStatus(client: SupabaseClient, rawInput: unknown): Promise<void> {
  const input = validate(setMemberStatusSchema, rawInput);
  const { error } = await client.rpc("set_member_status", {
    p_org_id: input.organizationId,
    p_user_id: input.userId,
    p_status: input.status,
  });
  if (error) throw mapRpcError(error, "Failed to update member status");
}

export async function transferOwnership(client: SupabaseClient, rawInput: unknown): Promise<void> {
  const input = validate(transferOwnershipSchema, rawInput);
  const { error } = await client.rpc("transfer_ownership", {
    p_org_id: input.organizationId,
    p_new_owner_id: input.newOwnerId,
  });
  if (error) throw mapRpcError(error, "Failed to transfer ownership");
}

/**
 * Owner updates org name and/or retention settings. The change and its audit row
 * are one atomic RPC (ticket 04); the retention bounds stay enforced by the
 * database CHECK constraint (SQLSTATE 23514).
 */
export async function updateOrgSettings(client: SupabaseClient, rawInput: unknown): Promise<void> {
  const input = validate(updateOrgSettingsSchema, rawInput);

  const retention = input.retention
    ? {
        client_data_years: input.retention.clientDataYears,
        export_days: input.retention.exportDays,
      }
    : null;

  await runAtomicRpc<void>(
    client,
    "update_organization_settings",
    {
      p_org_id: input.organizationId,
      p_name: input.name ?? null,
      p_retention: retention,
    },
    {
      forbidden: "Only the organization owner can edit settings",
      failure: "Failed to update organization settings",
      validation: "Retention settings violate the policy",
    }
  );
}

export interface AdminMember {
  userId: string;
  email: string;
  role: string;
  status: string;
  isOwner: boolean;
}

export interface AdminInvitation {
  id: string;
  email: string;
  role: string;
  token: string;
  expiresAt: string;
}

/** Owner-only member directory + pending invitations for the admin section. */
export async function listMembers(
  client: SupabaseClient,
  organizationId: string
): Promise<{ members: AdminMember[]; invitations: AdminInvitation[] }> {
  const { data: org } = await client
    .from("organizations")
    .select("id, owner_user_id")
    .eq("id", validate(uuid, organizationId))
    .eq("owner_user_id", (await client.auth.getUser()).data.user?.id ?? "")
    .maybeSingle();
  if (!org) throw new ServiceError("FORBIDDEN", "Only the organization owner can view members");

  const { data: members, error: membersError } = await client
    .from("organization_members")
    .select("user_id, role, status")
    .eq("organization_id", organizationId)
    .order("joined_at", { ascending: true });
  if (membersError) throw new ServiceError("INTERNAL_ERROR", "Failed to list members");

  const memberIds = (members ?? []).map((member) => member.user_id);
  const { data: profiles, error: profilesError } = memberIds.length
    ? await client.from("profiles").select("id, email").in("id", memberIds)
    : { data: [], error: null };
  if (profilesError) throw new ServiceError("INTERNAL_ERROR", "Failed to list member profiles");

  const emailByUserId = new Map((profiles ?? []).map((profile) => [profile.id, profile.email]));

  const { data: invitations, error: invitationsError } = await client
    .from("organization_invitations")
    .select("id, email, role, token, expires_at")
    .eq("organization_id", organizationId)
    .is("accepted_at", null)
    .order("created_at", { ascending: false });
  if (invitationsError) throw new ServiceError("INTERNAL_ERROR", "Failed to list invitations");

  return {
    members: (members ?? []).map((member) => ({
      userId: member.user_id,
      email: emailByUserId.get(member.user_id) ?? member.user_id,
      role: member.role,
      status: member.status,
      isOwner: member.user_id === org.owner_user_id,
    })),
    invitations: (invitations ?? []).map((invitation) => ({
      id: invitation.id,
      email: invitation.email,
      role: invitation.role,
      token: invitation.token,
      expiresAt: invitation.expires_at,
    })),
  };
}
