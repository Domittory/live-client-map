"use server";

import { revalidatePath } from "next/cache";
import { ServiceError } from "@/lib/service/errors";
import {
  createMarker,
  createObservation,
  recordMarkerValue,
  updateMarker,
  updateObservation,
  type CreateMarkerInput,
  type CreateObservationInput,
  type RecordMarkerValueInput,
  type UpdateMarkerInput,
  type UpdateObservationInput,
} from "@/lib/service/observations";
import { createClient } from "@/lib/supabase/server";

export type ObservationState = { error: string | null };

function toState(err: unknown): ObservationState {
  if (err instanceof ServiceError) return { error: err.message };
  return { error: "Внутренняя ошибка" };
}

export async function createObservationAction(
  _prev: ObservationState,
  input: CreateObservationInput
): Promise<ObservationState> {
  try {
    const supabase = await createClient();
    await createObservation(supabase, input);
  } catch (err) {
    return toState(err);
  }
  revalidatePath("/observations");
  return { error: null };
}

export async function updateObservationAction(
  _prev: ObservationState,
  input: UpdateObservationInput
): Promise<ObservationState> {
  try {
    const supabase = await createClient();
    await updateObservation(supabase, input);
  } catch (err) {
    return toState(err);
  }
  revalidatePath("/observations");
  return { error: null };
}

export async function createMarkerAction(
  _prev: ObservationState,
  input: CreateMarkerInput
): Promise<ObservationState> {
  try {
    const supabase = await createClient();
    await createMarker(supabase, input);
  } catch (err) {
    return toState(err);
  }
  revalidatePath("/observations");
  return { error: null };
}

export async function updateMarkerAction(
  _prev: ObservationState,
  input: UpdateMarkerInput
): Promise<ObservationState> {
  try {
    const supabase = await createClient();
    await updateMarker(supabase, input);
  } catch (err) {
    return toState(err);
  }
  revalidatePath("/observations");
  return { error: null };
}

export async function recordMarkerValueAction(
  _prev: ObservationState,
  input: RecordMarkerValueInput
): Promise<ObservationState> {
  try {
    const supabase = await createClient();
    await recordMarkerValue(supabase, input);
  } catch (err) {
    return toState(err);
  }
  revalidatePath("/observations");
  return { error: null };
}
