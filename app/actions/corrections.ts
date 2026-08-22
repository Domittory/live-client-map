"use server";

import { revalidatePath } from "next/cache";
import { ServiceError } from "@/lib/service/errors";
import {
  archiveCorrection,
  createCorrectionFromRecommendation,
  updateCorrection,
  type CreateFromRecommendationInput,
  type UpdateCorrectionInput,
} from "@/lib/service/corrections";
import { createClient } from "@/lib/supabase/server";

export type CorrectionState = { error: string | null };

function toState(err: unknown): CorrectionState {
  if (err instanceof ServiceError) return { error: err.message };
  return { error: "Внутренняя ошибка" };
}

export async function createCorrectionAction(
  _prev: CorrectionState,
  input: CreateFromRecommendationInput
): Promise<CorrectionState> {
  try {
    const supabase = await createClient();
    await createCorrectionFromRecommendation(supabase, input);
  } catch (err) {
    return toState(err);
  }
  revalidatePath("/corrections");
  return { error: null };
}

export async function updateCorrectionAction(
  _prev: CorrectionState,
  input: UpdateCorrectionInput
): Promise<CorrectionState> {
  try {
    const supabase = await createClient();
    await updateCorrection(supabase, input);
  } catch (err) {
    return toState(err);
  }
  revalidatePath("/corrections");
  revalidatePath(`/corrections/${input.correctionId}`);
  return { error: null };
}

export async function archiveCorrectionAction(
  _prev: CorrectionState,
  correctionId: string
): Promise<CorrectionState> {
  try {
    const supabase = await createClient();
    await archiveCorrection(supabase, correctionId);
  } catch (err) {
    return toState(err);
  }
  revalidatePath("/corrections");
  return { error: null };
}
