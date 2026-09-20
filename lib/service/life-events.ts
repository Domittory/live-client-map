import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { ServiceError } from "./errors";
import { runAtomicRpc } from "./transaction";
import { uuid, validate } from "./validation";

/**
 * Life events and triggers (ticket 19 → atomic since ticket 21).
 *
 * Both mutations run inside one SECURITY DEFINER RPC
 * (`create_life_event` / `create_trigger`, migration 0053) that asserts the
 * caller's organization membership and client write access, writes the row and
 * appends its AuditLog entry in the same transaction. The service layer no
 * longer pairs an insert with a separate `recordAudit()` call, so a committed
 * life event or trigger can never be missing its audit trail.
 */

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
  return runAtomicRpc<string>(
    client,
    "create_life_event",
    {
      p_org_id: organizationId,
      p_client_id: input.clientId,
      p_title: input.title,
      p_date: input.date ?? null,
      p_description: input.description ?? null,
      p_event_type: input.eventType ?? null,
      p_significance: input.significance ?? null,
      p_source_type: input.sourceType ?? null,
      p_visibility: input.visibility ?? "internal",
    },
    {
      forbidden: "No write access to this client",
      failure: "Failed to create life event",
      validation: "Invalid life event",
    }
  );
}

export async function createTrigger(
  client: SupabaseClient,
  organizationId: string,
  rawInput: unknown
): Promise<string> {
  const input = validate(createTriggerSchema, rawInput);
  return runAtomicRpc<string>(
    client,
    "create_trigger",
    {
      p_org_id: organizationId,
      p_client_id: input.clientId,
      p_title: input.title,
      p_life_event_id: input.lifeEventId ?? null,
      p_description: input.description ?? null,
      p_intensity: input.intensity ?? null,
      p_occurred_at: input.occurredAt ?? null,
      p_source_type: input.sourceType ?? null,
      p_visibility: input.visibility ?? "internal",
    },
    {
      forbidden: "No write access to this client",
      failure: "Failed to create trigger",
      validation: "Invalid trigger",
    }
  );
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
