import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { recordAudit } from "./audit";
import { ServiceError } from "./errors";
import { uuid, validate } from "./validation";

const visibilitySchema = z.enum(["internal", "sensitive", "client_visible"]);

export const createLifeEventSchema = z
  .object({
    clientId: uuid,
    title: z.string().trim().min(1).max(200),
    date: z.string().date().nullable().optional(),
    description: z.string().max(5000).nullable().optional(),
    eventType: z.string().trim().max(100).nullable().optional(),
    significance: z.string().trim().max(100).nullable().optional(),
    sourceType: z.string().trim().max(100).nullable().optional(),
    visibility: visibilitySchema.optional(),
  })
  .strict();

export const createTriggerSchema = z
  .object({
    clientId: uuid,
    title: z.string().trim().min(1).max(200),
    lifeEventId: uuid.nullable().optional(),
    description: z.string().max(5000).nullable().optional(),
    intensity: z.number().int().min(0).max(100).nullable().optional(),
    occurredAt: z.string().datetime({ offset: true }).nullable().optional(),
    sourceType: z.string().trim().max(100).nullable().optional(),
    visibility: visibilitySchema.optional(),
  })
  .strict();

export async function createLifeEvent(
  client: SupabaseClient,
  organizationId: string,
  rawInput: unknown
): Promise<string> {
  const input = validate(createLifeEventSchema, rawInput);
  const { data, error } = await client
    .from("life_events")
    .insert({
      organization_id: organizationId,
      client_id: input.clientId,
      title: input.title,
      date: input.date ?? null,
      description: input.description ?? null,
      event_type: input.eventType ?? null,
      significance: input.significance ?? null,
      source_type: input.sourceType ?? null,
      visibility: input.visibility ?? "internal",
    })
    .select("id")
    .single();
  if (error) {
    if (error.code === "42501")
      throw new ServiceError("FORBIDDEN", "No write access to this client");
    throw new ServiceError("INTERNAL_ERROR", "Failed to create life event");
  }
  await recordAudit(client, {
    organizationId,
    entityType: "life_event",
    entityId: data.id,
    action: "life_event.created",
    after: { title: input.title },
  });
  return data.id;
}

export async function createTrigger(
  client: SupabaseClient,
  organizationId: string,
  rawInput: unknown
): Promise<string> {
  const input = validate(createTriggerSchema, rawInput);
  const { data, error } = await client
    .from("triggers")
    .insert({
      organization_id: organizationId,
      client_id: input.clientId,
      life_event_id: input.lifeEventId ?? null,
      title: input.title,
      description: input.description ?? null,
      intensity: input.intensity ?? null,
      occurred_at: input.occurredAt ?? null,
      source_type: input.sourceType ?? null,
      visibility: input.visibility ?? "internal",
    })
    .select("id")
    .single();
  if (error) {
    if (error.code === "42501")
      throw new ServiceError("FORBIDDEN", "No write access to this client");
    throw new ServiceError("INTERNAL_ERROR", "Failed to create trigger");
  }
  await recordAudit(client, {
    organizationId,
    entityType: "trigger",
    entityId: data.id,
    action: "trigger.created",
    after: { title: input.title, life_event_id: input.lifeEventId ?? null },
  });
  return data.id;
}

export async function listLifeEvents(
  client: SupabaseClient,
  organizationId: string,
  clientId: string
): Promise<unknown[]> {
  const { data, error } = await client
    .from("life_events")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("client_id", clientId)
    .order("created_at", { ascending: false });
  if (error) throw new ServiceError("INTERNAL_ERROR", "Failed to list life events");
  return (data ?? []) as unknown[];
}

export async function listTriggers(
  client: SupabaseClient,
  organizationId: string,
  clientId: string
): Promise<unknown[]> {
  const { data, error } = await client
    .from("triggers")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("client_id", clientId)
    .order("created_at", { ascending: false });
  if (error) throw new ServiceError("INTERNAL_ERROR", "Failed to list triggers");
  return (data ?? []) as unknown[];
}
