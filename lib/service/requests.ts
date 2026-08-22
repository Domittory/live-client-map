import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { recordAudit } from "./audit";
import { ServiceError } from "./errors";
import { uuid, validate } from "./validation";

export const createRequestSchema = z
  .object({
    clientId: uuid,
    title: z.string().trim().min(1).max(200),
    description: z.string().max(5000).nullable().optional(),
    priority: z.enum(["low", "normal", "high", "urgent"]).optional(),
    successCriteria: z.string().max(5000).nullable().optional(),
  })
  .strict();

export const createGoalSchema = z
  .object({
    clientId: uuid,
    title: z.string().trim().min(1).max(200),
    description: z.string().max(5000).nullable().optional(),
    importance: z.enum(["low", "normal", "high"]).optional(),
    targetState: z.string().max(5000).nullable().optional(),
  })
  .strict();

export const REQUEST_STATUS = ["active", "paused", "completed", "abandoned"] as const;
export type RequestStatus = (typeof REQUEST_STATUS)[number];

const REQUEST_TRANSITIONS: Record<RequestStatus, RequestStatus[]> = {
  active: ["paused", "completed", "abandoned"],
  paused: ["active", "completed", "abandoned"],
  completed: [],
  abandoned: ["active"],
};

export const GOAL_STATUS = ["active", "completed", "archived"] as const;
export type GoalStatus = (typeof GOAL_STATUS)[number];

const GOAL_TRANSITIONS: Record<GoalStatus, GoalStatus[]> = {
  active: ["completed", "archived"],
  completed: ["archived"],
  archived: ["active"],
};

export async function createRequest(
  client: SupabaseClient,
  organizationId: string,
  rawInput: unknown
): Promise<string> {
  const input = validate(createRequestSchema, rawInput);
  const { data, error } = await client
    .from("client_requests")
    .insert({
      organization_id: organizationId,
      client_id: input.clientId,
      title: input.title,
      description: input.description ?? null,
      priority: input.priority ?? "normal",
      success_criteria: input.successCriteria ?? null,
      started_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (error) {
    if (error.code === "42501")
      throw new ServiceError("FORBIDDEN", "No write access to this client");
    throw new ServiceError("INTERNAL_ERROR", "Failed to create request");
  }
  await recordAudit(client, {
    organizationId,
    entityType: "client_request",
    entityId: data.id,
    action: "request.created",
    after: { title: input.title },
  });
  return data.id;
}

export async function listRequests(
  client: SupabaseClient,
  organizationId: string,
  clientId: string
): Promise<unknown[]> {
  const { data, error } = await client
    .from("client_requests")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("client_id", clientId)
    .order("created_at", { ascending: false });
  if (error) throw new ServiceError("INTERNAL_ERROR", "Failed to list requests");
  return (data ?? []) as unknown[];
}

export async function changeRequestStatus(
  client: SupabaseClient,
  organizationId: string,
  requestId: string,
  toStatus: RequestStatus
): Promise<void> {
  const { data: current } = await client
    .from("client_requests")
    .select("status")
    .eq("id", requestId)
    .maybeSingle();
  if (!current) throw new ServiceError("NOT_FOUND", "Request not found");

  const allowed = REQUEST_TRANSITIONS[current.status as RequestStatus] ?? [];
  if (!allowed.includes(toStatus)) {
    throw new ServiceError(
      "VALIDATION_ERROR",
      `Invalid transition: ${current.status} -> ${toStatus}`
    );
  }

  const patch: Record<string, unknown> = { status: toStatus };
  if (toStatus === "completed") patch.completed_at = new Date().toISOString();

  const { error } = await client.from("client_requests").update(patch).eq("id", requestId);
  if (error) {
    if (error.code === "42501")
      throw new ServiceError("FORBIDDEN", "No write access to this client");
    throw new ServiceError("INTERNAL_ERROR", "Failed to update request status");
  }
  await recordAudit(client, {
    organizationId,
    entityType: "client_request",
    entityId: requestId,
    action: `request.${toStatus}`,
    after: { status: toStatus },
  });
}

export async function createGoal(
  client: SupabaseClient,
  organizationId: string,
  rawInput: unknown
): Promise<string> {
  const input = validate(createGoalSchema, rawInput);
  const { data, error } = await client
    .from("client_goals")
    .insert({
      organization_id: organizationId,
      client_id: input.clientId,
      title: input.title,
      description: input.description ?? null,
      importance: input.importance ?? "normal",
      target_state: input.targetState ?? null,
    })
    .select("id")
    .single();
  if (error) {
    if (error.code === "42501")
      throw new ServiceError("FORBIDDEN", "No write access to this client");
    throw new ServiceError("INTERNAL_ERROR", "Failed to create goal");
  }
  await recordAudit(client, {
    organizationId,
    entityType: "client_goal",
    entityId: data.id,
    action: "goal.created",
    after: { title: input.title },
  });
  return data.id;
}

export async function listGoals(
  client: SupabaseClient,
  organizationId: string,
  clientId: string
): Promise<unknown[]> {
  const { data, error } = await client
    .from("client_goals")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("client_id", clientId)
    .order("created_at", { ascending: false });
  if (error) throw new ServiceError("INTERNAL_ERROR", "Failed to list goals");
  return (data ?? []) as unknown[];
}

export async function changeGoalStatus(
  client: SupabaseClient,
  organizationId: string,
  goalId: string,
  toStatus: GoalStatus
): Promise<void> {
  const { data: current } = await client
    .from("client_goals")
    .select("status")
    .eq("id", goalId)
    .maybeSingle();
  if (!current) throw new ServiceError("NOT_FOUND", "Goal not found");

  const allowed = GOAL_TRANSITIONS[current.status as GoalStatus] ?? [];
  if (!allowed.includes(toStatus)) {
    throw new ServiceError(
      "VALIDATION_ERROR",
      `Invalid transition: ${current.status} -> ${toStatus}`
    );
  }

  const { error } = await client.from("client_goals").update({ status: toStatus }).eq("id", goalId);
  if (error) {
    if (error.code === "42501")
      throw new ServiceError("FORBIDDEN", "No write access to this client");
    throw new ServiceError("INTERNAL_ERROR", "Failed to update goal status");
  }
  await recordAudit(client, {
    organizationId,
    entityType: "client_goal",
    entityId: goalId,
    action: `goal.${toStatus}`,
    after: { status: toStatus },
  });
}
