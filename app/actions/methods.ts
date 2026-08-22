"use server";

import { revalidatePath } from "next/cache";
import { ServiceError } from "@/lib/service/errors";
import { archiveOrgMethod, createOrgMethod, updateOrgMethod } from "@/lib/service/interventions";
import { createClient } from "@/lib/supabase/server";

export type MethodState = { error: string | null };

function toState(err: unknown): MethodState {
  if (err instanceof ServiceError) return { error: err.message };
  return { error: "Внутренняя ошибка" };
}

function optionalText(formData: FormData, key: string): string | undefined {
  const value = String(formData.get(key) ?? "").trim();
  return value === "" ? undefined : value;
}

function parseContraindications(formData: FormData): string[] {
  return String(formData.get("contraindications") ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function parseFollowUpDays(formData: FormData): number | undefined {
  const raw = String(formData.get("defaultFollowUpDays") ?? "").trim();
  return raw === "" ? undefined : Number(raw);
}

export async function createMethodAction(
  _prev: MethodState,
  formData: FormData
): Promise<MethodState> {
  try {
    const supabase = await createClient();
    await createOrgMethod(supabase, {
      organizationId: String(formData.get("organizationId") ?? ""),
      name: String(formData.get("name") ?? ""),
      description: optionalText(formData, "description"),
      category: optionalText(formData, "category"),
      contraindications: parseContraindications(formData),
      defaultFollowUpDays: parseFollowUpDays(formData),
    });
  } catch (err) {
    return toState(err);
  }
  revalidatePath("/methods");
  return { error: null };
}

export async function updateMethodAction(
  _prev: MethodState,
  formData: FormData
): Promise<MethodState> {
  try {
    const supabase = await createClient();
    await updateOrgMethod(supabase, {
      methodId: String(formData.get("methodId") ?? ""),
      name: String(formData.get("name") ?? ""),
      description: optionalText(formData, "description"),
      category: optionalText(formData, "category"),
      contraindications: parseContraindications(formData),
      defaultFollowUpDays: parseFollowUpDays(formData) ?? null,
    });
  } catch (err) {
    return toState(err);
  }
  revalidatePath("/methods");
  return { error: null };
}

export async function archiveMethodAction(
  _prev: MethodState,
  formData: FormData
): Promise<MethodState> {
  try {
    const supabase = await createClient();
    await archiveOrgMethod(supabase, String(formData.get("methodId") ?? ""));
  } catch (err) {
    return toState(err);
  }
  revalidatePath("/methods");
  return { error: null };
}
