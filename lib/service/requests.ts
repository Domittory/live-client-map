import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { ServiceError } from "./errors";
import { runAtomicRpc } from "./transaction";
import { uuid, validate } from "./validation";

/**
 * Client requests and goals (ticket 18 → atomic since ticket 21).
 *
 * Every mutation runs inside one SECURITY DEFINER RPC (migration 0053) that
 * asserts organization membership and client write access, validates the status
 * transition against the current row and appends the AuditLog entry in the same
 * transaction. The transition maps that used to live here are now
 * `request_status_transition_allowed` / `goal_status_transition_allowed` in
 * SQL, so "is this transition legal" and the write cannot be split by a
 * concurrent caller.
 */

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

export const GOAL_STATUS = ["active", "completed", "archived"] as const;
export type GoalStatus = (typeof GOAL_STATUS)[number];

export async function createRequest(
  client: SupabaseClient,
  organizationId: string,
  rawInput: unknown
): Promise<string> {
  const input = validate(createRequestSchema, rawInput);
  return runAtomicRpc<string>(
    client,
    "create_client_request",
    {
      p_org_id: organizationId,
      p_client_id: input.clientId,
      p_title: input.title,
      p_description: input.description ?? null,
      p_priority: input.priority ?? "normal",
      p_success_criteria: input.successCriteria ?? null,
    },
    {
      forbidden: "No write access to this client",
      failure: "Failed to create request",
      validation: "Invalid request",
    }
  );
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
  await runAtomicRpc<void>(
    client,
    "change_request_status",
    {
      p_org_id: organizationId,
      p_request_id: requestId,
      p_to_status: toStatus,
    },
    {
      forbidden: "No write access to this client",
      failure: "Failed to update request status",
      validation: `Invalid transition to ${toStatus}`,
    }
  );
}

export async function createGoal(
  client: SupabaseClient,
  organizationId: string,
  rawInput: unknown
): Promise<string> {
  const input = validate(createGoalSchema, rawInput);
  return runAtomicRpc<string>(
    client,
    "create_client_goal",
    {
      p_org_id: organizationId,
      p_client_id: input.clientId,
      p_title: input.title,
      p_description: input.description ?? null,
      p_importance: input.importance ?? "normal",
      p_target_state: input.targetState ?? null,
    },
    {
      forbidden: "No write access to this client",
      failure: "Failed to create goal",
      validation: "Invalid goal",
    }
  );
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
  await runAtomicRpc<void>(
    client,
    "change_goal_status",
    {
      p_org_id: organizationId,
      p_goal_id: goalId,
      p_to_status: toStatus,
    },
    {
      forbidden: "No write access to this client",
      failure: "Failed to update goal status",
      validation: `Invalid transition to ${toStatus}`,
    }
  );
}
