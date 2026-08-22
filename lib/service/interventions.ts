import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { recordAudit, withAudit } from "./audit";
import { ServiceError } from "./errors";
import { decodeCursor, encodeCursor, pageQuerySchema, toPage, type Page } from "./pagination";
import { uuid, validate } from "./validation";

/** intervention_methods (migration 0014); system rows have organization_id = null. */
export interface InterventionMethod {
  id: string;
  organization_id: string | null;
  name: string;
  description: string | null;
  category: string | null;
  contraindications: string[];
  default_follow_up_days: number | null;
  is_system: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
}

const followUpDays = z.number().int().min(1).max(365);

export const methodListQuerySchema = pageQuerySchema.extend({
  q: z.string().trim().min(1).max(200).optional(),
  category: z.string().trim().min(1).max(100).optional(),
  scope: z.enum(["system", "organization", "all"]).default("all"),
  includeArchived: z.coerce.boolean().default(false),
});

const methodFields = {
  organizationId: uuid,
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().min(1).max(4000).optional(),
  category: z.string().trim().min(1).max(100).optional(),
  contraindications: z.array(z.string().trim().min(1).max(500)).max(50).default([]),
  defaultFollowUpDays: followUpDays.optional(),
};

export const createOrgMethodSchema = z.object(methodFields).strict();

export const updateOrgMethodSchema = z
  .object({
    methodId: uuid,
    name: methodFields.name.optional(),
    description: methodFields.description,
    category: methodFields.category,
    contraindications: methodFields.contraindications.optional(),
    defaultFollowUpDays: followUpDays.nullable().optional(),
  })
  .strict();

async function requireUserId(client: SupabaseClient): Promise<string> {
  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user) throw new ServiceError("UNAUTHORIZED", "Authentication required");
  return user.id;
}

function mapWriteError(error: { code?: string }, fallback: string): ServiceError {
  if (error.code === "42501") {
    return new ServiceError(
      "FORBIDDEN",
      "Only active owners/specialists of the organization can modify methods"
    );
  }
  if (error.code === "23505") {
    return new ServiceError("CONFLICT", "Method name already exists in this scope");
  }
  return new ServiceError("INTERNAL_ERROR", fallback);
}

/** List/search the method catalog (system + own org, per RLS). */
export async function listMethods(
  client: SupabaseClient,
  rawQuery: unknown
): Promise<Page<InterventionMethod>> {
  const query = validate(methodListQuerySchema, rawQuery ?? {});

  let request = client
    .from("intervention_methods")
    .select("*")
    .order("id", { ascending: true })
    .limit(query.limit + 1);

  if (!query.includeArchived) request = request.is("archived_at", null);
  if (query.q) {
    const pattern = `%${query.q.replaceAll("%", "").replaceAll(",", " ")}%`;
    request = request.or(`name.ilike.${pattern},description.ilike.${pattern}`);
  }
  if (query.category) request = request.eq("category", query.category);
  if (query.scope === "system") request = request.is("organization_id", null);
  if (query.scope === "organization") request = request.not("organization_id", "is", null);
  if (query.cursor) request = request.gt("id", decodeCursor(query.cursor));

  const { data, error } = await request;
  if (error) throw new ServiceError("INTERNAL_ERROR", "Failed to list intervention methods");

  return toPage((data ?? []) as InterventionMethod[], query.limit, (last) => encodeCursor(last.id));
}

/** Read one method by id — archived included (old Corrections keep references). */
export async function getMethod(
  client: SupabaseClient,
  methodId: string
): Promise<InterventionMethod> {
  const { data, error } = await client
    .from("intervention_methods")
    .select("*")
    .eq("id", validate(uuid, methodId))
    .maybeSingle();
  if (error) throw new ServiceError("INTERNAL_ERROR", "Failed to read intervention method");
  if (!data) throw new ServiceError("NOT_FOUND", "Intervention method not found");
  return data as InterventionMethod;
}

export async function createOrgMethod(
  client: SupabaseClient,
  rawInput: unknown
): Promise<InterventionMethod> {
  const input = validate(createOrgMethodSchema, rawInput);
  const userId = await requireUserId(client);

  const { data, error } = await client
    .from("intervention_methods")
    .insert({
      organization_id: input.organizationId,
      name: input.name,
      description: input.description ?? null,
      category: input.category ?? null,
      contraindications: input.contraindications,
      default_follow_up_days: input.defaultFollowUpDays ?? null,
      is_system: false,
      created_by: userId,
    })
    .select()
    .single();
  if (error) throw mapWriteError(error, "Failed to create intervention method");

  await recordAudit(client, {
    organizationId: input.organizationId,
    entityType: "intervention_method",
    entityId: (data as InterventionMethod).id,
    action: "intervention_method.create",
    after: data,
  });
  return data as InterventionMethod;
}

export async function updateOrgMethod(
  client: SupabaseClient,
  rawInput: unknown
): Promise<InterventionMethod> {
  const input = validate(updateOrgMethodSchema, rawInput);

  const before = await getMethod(client, input.methodId);
  if (before.is_system || before.organization_id === null) {
    throw new ServiceError("FORBIDDEN", "System methods cannot be modified");
  }
  if (before.archived_at !== null) {
    throw new ServiceError("CONFLICT", "Archived methods cannot be edited");
  }

  const patch = {
    ...(input.name !== undefined ? { name: input.name } : {}),
    ...(input.description !== undefined ? { description: input.description } : {}),
    ...(input.category !== undefined ? { category: input.category } : {}),
    ...(input.contraindications !== undefined
      ? { contraindications: input.contraindications }
      : {}),
    ...(input.defaultFollowUpDays !== undefined
      ? { default_follow_up_days: input.defaultFollowUpDays }
      : {}),
    updated_at: new Date().toISOString(),
  };

  const updated = await withAudit(
    client,
    {
      organizationId: before.organization_id,
      entityType: "intervention_method",
      entityId: before.id,
      action: "intervention_method.update",
      before,
      after: { ...before, ...patch },
    },
    async () => {
      const { data, error } = await client
        .from("intervention_methods")
        .update(patch)
        .eq("id", before.id)
        .eq("is_system", false)
        .is("archived_at", null)
        .select()
        .single();
      if (error) throw mapWriteError(error, "Failed to update intervention method");
      if (!data)
        throw new ServiceError("NOT_FOUND", "Intervention method not found or not editable");
      return data as InterventionMethod;
    }
  );
  return updated;
}

/** Soft delete (ticket 03): archived methods stay readable for old Corrections. */
export async function archiveOrgMethod(client: SupabaseClient, methodId: string): Promise<void> {
  const before = await getMethod(client, methodId);
  if (before.is_system || before.organization_id === null) {
    throw new ServiceError("FORBIDDEN", "System methods cannot be archived");
  }
  if (before.archived_at !== null) return;

  const archivedAt = new Date().toISOString();
  await withAudit(
    client,
    {
      organizationId: before.organization_id,
      entityType: "intervention_method",
      entityId: before.id,
      action: "intervention_method.archive",
      before,
      after: { ...before, archived_at: archivedAt },
    },
    async () => {
      const { data, error } = await client
        .from("intervention_methods")
        .update({ archived_at: archivedAt })
        .eq("id", before.id)
        .eq("is_system", false)
        .is("archived_at", null)
        .select("id");
      if (error) throw mapWriteError(error, "Failed to archive intervention method");
      if (!data || data.length === 0) {
        throw new ServiceError("NOT_FOUND", "Intervention method not found or not editable");
      }
    }
  );
}
