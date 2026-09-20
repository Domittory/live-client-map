import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { ServiceError } from "./errors";
import { decodeCursor, encodeCursor, pageQuerySchema, toPage, type Page } from "./pagination";
import { runAtomicRpc } from "./transaction";
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
  await requireUserId(client);

  // The method row and its audit entry commit together; the RPC re-asserts the
  // owner/specialist role required by the library RLS policy.
  return runAtomicRpc<InterventionMethod>(
    client,
    "create_org_method",
    {
      p_org_id: input.organizationId,
      p_payload: {
        name: input.name,
        description: input.description ?? null,
        category: input.category ?? null,
        contraindications: input.contraindications,
        default_follow_up_days: input.defaultFollowUpDays ?? null,
      },
    },
    {
      forbidden: "Only active owners/specialists of the organization can modify methods",
      failure: "Failed to create intervention method",
      conflict: "Method name already exists in this scope",
    }
  );
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
  };

  return runAtomicRpc<InterventionMethod>(
    client,
    "update_org_method",
    { p_method_id: before.id, p_patch: patch },
    {
      forbidden: "Only active owners/specialists of the organization can modify methods",
      failure: "Failed to update intervention method",
      conflict: "Archived methods cannot be edited",
    }
  );
}

/** Soft delete (ticket 03): archived methods stay readable for old Corrections. */
export async function archiveOrgMethod(client: SupabaseClient, methodId: string): Promise<void> {
  const before = await getMethod(client, methodId);
  if (before.is_system || before.organization_id === null) {
    throw new ServiceError("FORBIDDEN", "System methods cannot be archived");
  }
  if (before.archived_at !== null) return;

  await runAtomicRpc<void>(
    client,
    "archive_org_method",
    { p_method_id: before.id },
    {
      forbidden: "Only active owners/specialists of the organization can modify methods",
      failure: "Failed to archive intervention method",
    }
  );
}
