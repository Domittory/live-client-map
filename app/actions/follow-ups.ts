"use server";

import { revalidatePath } from "next/cache";
import { FakeAiProvider, OpenAiResponsesProvider, type AiProvider } from "@/lib/ai/provider";
import { getServerEnv } from "@/lib/env";
import { ServiceError } from "@/lib/service/errors";
import {
  cancelFollowUp,
  completeFollowUp,
  evaluateCorrection,
  reviewFollowUpAssessment,
  scheduleFollowUp,
  type CompleteFollowUpInput,
  type ReviewAssessmentInput,
  type ScheduleFollowUpInput,
} from "@/lib/service/follow-ups";
import { createClient } from "@/lib/supabase/server";

export type FollowUpState = { error: string | null };

function toState(err: unknown): FollowUpState {
  if (err instanceof ServiceError) return { error: err.message };
  return { error: "Внутренняя ошибка" };
}

/** Same provider resolution as app/api/ai/run/route.ts (ticket 32). */
function resolveProvider(): AiProvider {
  const env = getServerEnv();
  if (env.AI_PROVIDER === "openai" && env.OPENAI_API_KEY) {
    return new OpenAiResponsesProvider(env.OPENAI_API_KEY);
  }
  return new FakeAiProvider();
}

export async function scheduleFollowUpAction(
  _prev: FollowUpState,
  input: ScheduleFollowUpInput
): Promise<FollowUpState> {
  try {
    const supabase = await createClient();
    await scheduleFollowUp(supabase, input);
  } catch (err) {
    return toState(err);
  }
  revalidatePath(`/corrections/${input.correctionId}`);
  return { error: null };
}

export async function completeFollowUpAction(
  _prev: FollowUpState,
  input: CompleteFollowUpInput & { correctionId: string }
): Promise<FollowUpState> {
  const { correctionId, ...serviceInput } = input;
  try {
    const supabase = await createClient();
    await completeFollowUp(supabase, serviceInput);
  } catch (err) {
    return toState(err);
  }
  revalidatePath(`/corrections/${correctionId}`);
  return { error: null };
}

export async function cancelFollowUpAction(
  _prev: FollowUpState,
  input: { followUpId: string; correctionId: string }
): Promise<FollowUpState> {
  try {
    const supabase = await createClient();
    await cancelFollowUp(supabase, input.followUpId);
  } catch (err) {
    return toState(err);
  }
  revalidatePath(`/corrections/${input.correctionId}`);
  return { error: null };
}

export async function evaluateCorrectionAction(
  _prev: FollowUpState,
  input: { followUpId: string; correctionId: string }
): Promise<FollowUpState> {
  try {
    const supabase = await createClient();
    await evaluateCorrection(supabase, resolveProvider(), input.followUpId);
  } catch (err) {
    return toState(err);
  }
  revalidatePath(`/corrections/${input.correctionId}`);
  return { error: null };
}

export async function reviewFollowUpAssessmentAction(
  _prev: FollowUpState,
  input: ReviewAssessmentInput & { correctionId: string }
): Promise<FollowUpState> {
  const { correctionId, ...serviceInput } = input;
  try {
    const supabase = await createClient();
    await reviewFollowUpAssessment(supabase, serviceInput);
  } catch (err) {
    return toState(err);
  }
  revalidatePath(`/corrections/${correctionId}`);
  return { error: null };
}
