import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Tables } from "@/lib/supabase/database.types";
import { ServiceError } from "./errors";
import { runAtomicRpc } from "./transaction";
import { uuid, validate } from "./validation";

export type ClientRow = Tables<"clients">;

export const createClientSchema = z
  .object({
    organizationId: uuid,
    displayName: z.string().trim().min(1).max(200),
    firstName: z.string().trim().max(100).nullable().optional(),
    lastName: z.string().trim().max(100).nullable().optional(),
  })
  .strict();

export const updateClientSchema = z
  .object({
    id: uuid,
    displayName: z.string().trim().min(1).max(200).optional(),
    firstName: z.string().trim().max(100).nullable().optional(),
    lastName: z.string().trim().max(100).nullable().optional(),
    occupation: z.string().trim().max(200).nullable().optional(),
    specialistNotesPrivate: z.string().max(20000).nullable().optional(),
    clientVisibleNotes: z.string().max(20000).nullable().optional(),
  })
  .strict();

export type UpdateClientInput = z.infer<typeof updateClientSchema>;

/**
 * Client + primary_specialist assignment + client.created audit row are one
 * atomic RPC (ticket 01): the audit append happens inside create_client(), so
 * there is no separate recordAudit() call that could fail on its own and leave
 * an un-audited client behind.
 */
export async function createClient(client: SupabaseClient, rawInput: unknown): Promise<string> {
  const input = validate(createClientSchema, rawInput);
  return runAtomicRpc<string>(
    client,
    "create_client",
    {
      p_organization_id: input.organizationId,
      p_display_name: input.displayName,
      p_first_name: input.firstName ?? null,
      p_last_name: input.lastName ?? null,
    },
    {
      forbidden: "Not a member of this organization",
      failure: "Failed to create client",
    }
  );
}

export async function listActiveClients(
  client: SupabaseClient,
  organizationId: string
): Promise<ClientRow[]> {
  const { data, error } = await client
    .from("clients")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("status", "active")
    .order("created_at", { ascending: false });
  if (error) throw new ServiceError("INTERNAL_ERROR", "Failed to list clients");
  return (data ?? []) as ClientRow[];
}

export async function getClient(client: SupabaseClient, id: string): Promise<ClientRow | null> {
  const { data, error } = await client.from("clients").select("*").eq("id", id).maybeSingle();
  if (error) throw new ServiceError("INTERNAL_ERROR", "Failed to read client");
  return (data ?? null) as ClientRow | null;
}

/**
 * Client update and its AuditLog row are one atomic RPC (ticket 04): the patch
 * is whitelisted inside update_client(), which also revalidates tenant and write
 * assignment. The public camel-case input stays unchanged.
 */
export async function updateClient(
  client: SupabaseClient,
  organizationId: string,
  rawInput: unknown
): Promise<void> {
  const input = validate(updateClientSchema, rawInput);
  const patch: Record<string, unknown> = {};
  if (input.displayName !== undefined) patch.display_name = input.displayName;
  if (input.firstName !== undefined) patch.first_name = input.firstName;
  if (input.lastName !== undefined) patch.last_name = input.lastName;
  if (input.occupation !== undefined) patch.occupation = input.occupation;
  if (input.specialistNotesPrivate !== undefined) {
    patch.specialist_notes_private = input.specialistNotesPrivate;
  }
  if (input.clientVisibleNotes !== undefined) {
    patch.client_visible_notes = input.clientVisibleNotes;
  }

  if (Object.keys(patch).length === 0) {
    throw new ServiceError("VALIDATION_ERROR", "No fields to update");
  }

  await runAtomicRpc<void>(
    client,
    "update_client",
    { p_client_id: input.id, p_org_id: organizationId, p_patch: patch },
    {
      forbidden: "No write access to this client",
      failure: "Failed to update client",
      validation: "Invalid client update",
    }
  );
}

export async function archiveClient(
  client: SupabaseClient,
  organizationId: string,
  id: string
): Promise<void> {
  await runAtomicRpc<void>(
    client,
    "archive_client",
    { p_client_id: id, p_org_id: organizationId },
    {
      forbidden: "No write access to this client",
      failure: "Failed to archive client",
      validation: "Client not found in this organization",
    }
  );
}

/** Client-visible projection: private specialist notes are never included. */
export function toClientVisible(client: ClientRow): Omit<ClientRow, "specialist_notes_private"> {
  const { specialist_notes_private, ...visible } = client;
  void specialist_notes_private;
  return visible;
}
