"use server";

import { revalidatePath } from "next/cache";
import { FakeAiProvider, OpenAiResponsesProvider, type AiProvider } from "@/lib/ai/provider";
import { getServerEnv } from "@/lib/env";
import { ServiceError } from "@/lib/service/errors";
import {
  explainModelChanges,
  reviewModelExplanation,
  type ReviewModelExplanationInput,
} from "@/lib/service/explanations";
import { createClient } from "@/lib/supabase/server";

export type ExplanationState = { error: string | null; explanationId: string | null };

function toState(err: unknown): ExplanationState {
  if (err instanceof ServiceError) return { error: err.message, explanationId: null };
  return { error: "Внутренняя ошибка", explanationId: null };
}

/** Same provider resolution as app/api/ai/run/route.ts (ticket 32). */
function resolveProvider(): AiProvider {
  const env = getServerEnv();
  if (env.AI_PROVIDER === "openai" && env.OPENAI_API_KEY) {
    return new OpenAiResponsesProvider(env.OPENAI_API_KEY);
  }
  return new FakeAiProvider();
}

export async function explainModelChangesAction(
  _prev: ExplanationState,
  input: { clientId: string }
): Promise<ExplanationState> {
  let explanationId: string;
  try {
    const supabase = await createClient();
    const explanation = await explainModelChanges(supabase, resolveProvider(), input);
    explanationId = explanation.id;
  } catch (err) {
    return toState(err);
  }
  revalidatePath("/snapshots");
  return { error: null, explanationId };
}

export async function reviewModelExplanationAction(
  _prev: ExplanationState,
  input: ReviewModelExplanationInput
): Promise<ExplanationState> {
  try {
    const supabase = await createClient();
    await reviewModelExplanation(supabase, input);
  } catch (err) {
    return toState(err);
  }
  revalidatePath("/snapshots");
  return { error: null, explanationId: null };
}
