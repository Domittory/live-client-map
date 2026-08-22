import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Tables } from "@/lib/supabase/database.types";
import { recordAudit } from "./audit";
import { ServiceError } from "./errors";
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

export async function createClient(client: SupabaseClient, rawInput: unknown): Promise<string> {
  const input = validate(createClientSchema, rawInput);
  const { data, error } = await client.rpc("create_client", {
    p_organization_id: input.organizationId,
    p_display_name: input.displayName,
    p_first_name: input.firstName ?? null,
    p_last_name: input.lastName ?? null,
  });
  if (error) {
    if (error.code === "42501") {
      throw new ServiceError("FORBIDDEN", "Not a member of this organization");
    }
    throw new ServiceError("INTERNAL_ERROR", "Failed to create client");
  }

  const id = data as string;
  await recordAudit(client, {
    organizationId: input.organizationId,
    entityType: "client",
    entityId: id,
    action: "client.created",
    after: { display_name: input.displayName },
  });
  return id;
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

export async function updateClient(
  client: SupabaseClient,
  organizationId: string,
  rawInput: unknown
): Promise<void> {
  const input = validate(updateClientSchema, rawInput);
  const dbFields: Record<string, unknown> = {};
  if (input.displayName !== undefined) dbFields.display_name = input.displayName;
  if (input.firstName !== undefined) dbFields.first_name = input.firstName;
  if (input.lastName !== undefined) dbFields.last_name = input.lastName;
  if (input.occupation !== undefined) dbFields.occupation = input.occupation;
  if (input.specialistNotesPrivate !== undefined) {
    dbFields.specialist_notes_private = input.specialistNotesPrivate;
  }
  if (input.clientVisibleNotes !== undefined) {
    dbFields.client_visible_notes = input.clientVisibleNotes;
  }

  const { error } = await client.from("clients").update(dbFields).eq("id", input.id);
  if (error) {
    if (error.code === "42501")
      throw new ServiceError("FORBIDDEN", "No write access to this client");
    throw new ServiceError("INTERNAL_ERROR", "Failed to update client");
  }

  await recordAudit(client, {
    organizationId,
    entityType: "client",
    entityId: input.id,
    action: "client.updated",
    after: dbFields,
  });
}

export async function archiveClient(
  client: SupabaseClient,
  organizationId: string,
  id: string
): Promise<void> {
  const { error } = await client
    .from("clients")
    .update({ status: "archived", archived_at: new Date().toISOString() })
    .eq("id", id);
  if (error) {
    if (error.code === "42501")
      throw new ServiceError("FORBIDDEN", "No write access to this client");
    throw new ServiceError("INTERNAL_ERROR", "Failed to archive client");
  }

  await recordAudit(client, {
    organizationId,
    entityType: "client",
    entityId: id,
    action: "client.archived",
  });
}

/** Client-visible projection: private specialist notes are never included. */
export function toClientVisible(client: ClientRow): Omit<ClientRow, "specialist_notes_private"> {
  const { specialist_notes_private, ...visible } = client;
  void specialist_notes_private;
  return visible;
}
