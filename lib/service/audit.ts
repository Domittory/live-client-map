import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Tables } from "@/lib/supabase/database.types";
import { ServiceError } from "./errors";
import { decodeCursor, encodeCursor, pageQuerySchema, toPage, type Page } from "./pagination";
import { uuid, validate } from "./validation";

export type AuditLogEntry = Tables<"audit_log">;

/**
 * Secrets and sensitive auth material must never land in an audit payload
 * (ticket 14 acceptance). Matching keys are replaced with "[redacted]"
 * recursively before anything is sent to the database.
 */
const SENSITIVE_KEY = /pass(word)?|secret|token|api[-_]?key|authorization|cookie|session/i;

export const REDACTED = "[redacted]";

export function sanitizeAuditPayload(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeAuditPayload);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
        key,
        SENSITIVE_KEY.test(key) ? REDACTED : sanitizeAuditPayload(entry),
      ])
    );
  }
  return value;
}

export const recordAuditSchema = z
  .object({
    organizationId: uuid,
    entityType: z.string().trim().min(1).max(100),
    entityId: uuid.optional(),
    action: z.string().trim().min(1).max(100),
    before: z.unknown().optional(),
    after: z.unknown().optional(),
    reason: z.string().trim().min(1).max(2000).optional(),
    ipAddress: z.string().max(100).optional(),
    userAgent: z.string().max(500).optional(),
  })
  .strict();

export type RecordAuditInput = z.infer<typeof recordAuditSchema>;

/** Append one audit entry. The DB pins actor_user_id to the real caller. */
export async function recordAudit(client: SupabaseClient, rawInput: unknown): Promise<string> {
  const input = validate(recordAuditSchema, rawInput);
  const { data, error } = await client.rpc("append_audit", {
    p_organization_id: input.organizationId,
    p_entity_type: input.entityType,
    p_entity_id: input.entityId ?? null,
    p_action: input.action,
    p_before: (sanitizeAuditPayload(input.before) ?? null) as never,
    p_after: (sanitizeAuditPayload(input.after) ?? null) as never,
    p_reason: input.reason ?? null,
    p_ip_address: input.ipAddress ?? null,
    p_user_agent: input.userAgent ?? null,
  });
  if (error) {
    if (error.code === "42501") {
      throw new ServiceError("FORBIDDEN", "Not allowed to write audit for this organization");
    }
    throw new ServiceError("INTERNAL_ERROR", "Failed to write audit record");
  }
  return data as string;
}

/**
 * Reusable mutation wrapper (ticket 14, step 2): runs the mutation, then
 * appends the audit record with before/after, actor and reason. Downstream
 * services call this instead of hand-rolling audit inserts.
 */
export async function withAudit<T>(
  client: SupabaseClient,
  entry: Omit<RecordAuditInput, "before" | "after"> & { before?: unknown; after?: unknown },
  mutate: () => Promise<T>
): Promise<T> {
  const result = await mutate();
  await recordAudit(client, entry);
  return result;
}

/** Owner audit viewer query contract (safe server-side filtering). */
export const auditListQuerySchema = pageQuerySchema.extend({
  organizationId: uuid,
  entityType: z.string().trim().min(1).max(100).optional(),
  entityId: uuid.optional(),
  actorId: uuid.optional(),
  action: z.string().trim().min(1).max(100).optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
});

export async function listAuditLog(
  client: SupabaseClient,
  rawQuery: unknown
): Promise<Page<AuditLogEntry>> {
  const query = validate(auditListQuerySchema, rawQuery ?? {});

  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user) throw new ServiceError("UNAUTHORIZED", "Authentication required");

  // Owner-only viewer (SPEC §8.33 + ticket 14): membership alone is not enough.
  const { data: org } = await client
    .from("organizations")
    .select("id")
    .eq("id", query.organizationId)
    .eq("owner_user_id", user.id)
    .maybeSingle();
  if (!org) {
    throw new ServiceError("FORBIDDEN", "Only the organization owner can view the audit log");
  }

  let request = client
    .from("audit_log")
    .select("*")
    .eq("organization_id", query.organizationId)
    .order("created_at", { ascending: false })
    .limit(query.limit + 1);

  if (query.entityType) request = request.eq("entity_type", query.entityType);
  if (query.entityId) request = request.eq("entity_id", query.entityId);
  if (query.actorId) request = request.eq("actor_user_id", query.actorId);
  if (query.action) request = request.eq("action", query.action);
  if (query.from) request = request.gte("created_at", query.from);
  if (query.to) request = request.lte("created_at", query.to);
  if (query.cursor) request = request.lt("created_at", decodeCursor(query.cursor));

  const { data, error } = await request;
  if (error) throw new ServiceError("INTERNAL_ERROR", "Failed to list audit log");

  return toPage((data ?? []) as AuditLogEntry[], query.limit, (last) =>
    encodeCursor(last.created_at)
  );
}
