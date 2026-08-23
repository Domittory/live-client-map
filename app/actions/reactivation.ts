"use server";

import { revalidatePath } from "next/cache";
import { ServiceError } from "@/lib/service/errors";
import {
  evaluateCoreNodeReactivation,
  reviewCoreNodeReactivation,
  type ReviewReactivationInput,
} from "@/lib/service/reactivation";
import { createClient } from "@/lib/supabase/server";

export type ReactivationState = { error: string | null };

function toState(err: unknown): ReactivationState {
  if (err instanceof ServiceError) return { error: err.message };
  return { error: "Внутренняя ошибка" };
}

export async function evaluateReactivationAction(
  _prev: ReactivationState,
  input: { coreNodeId: string }
): Promise<ReactivationState> {
  try {
    const supabase = await createClient();
    await evaluateCoreNodeReactivation(supabase, { coreNodeId: input.coreNodeId });
  } catch (err) {
    return toState(err);
  }
  revalidatePath(`/core-nodes/${input.coreNodeId}`);
  return { error: null };
}

export async function reviewReactivationAction(
  _prev: ReactivationState,
  input: ReviewReactivationInput & { coreNodeId: string }
): Promise<ReactivationState> {
  const { coreNodeId, ...serviceInput } = input;
  try {
    const supabase = await createClient();
    await reviewCoreNodeReactivation(supabase, serviceInput);
  } catch (err) {
    return toState(err);
  }
  revalidatePath(`/core-nodes/${coreNodeId}`);
  return { error: null };
}
