"use server";

import { revalidatePath } from "next/cache";
import { executeErasure, setLegalHold } from "@/lib/service/erasure";
import { getServiceClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export type ErasureActionState = { error: string | null; status?: string };

export async function executeErasureAction(
  _prev: ErasureActionState,
  formData: FormData
): Promise<ErasureActionState> {
  const supabase = await createClient();
  const admin = getServiceClient();
  const clientId = String(formData.get("clientId") ?? "");

  try {
    const result = await executeErasure(supabase, admin, clientId);
    revalidatePath("/clients");
    return { error: null, status: result.status };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Не удалось выполнить удаление." };
  }
}

export async function setLegalHoldAction(
  _prev: ErasureActionState,
  formData: FormData
): Promise<ErasureActionState> {
  const supabase = await createClient();
  const admin = getServiceClient();
  const clientId = String(formData.get("clientId") ?? "");
  const hold = formData.get("hold") === "on";

  try {
    await setLegalHold(supabase, admin, clientId, hold);
    revalidatePath("/clients");
    return { error: null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Не удалось изменить удержание." };
  }
}
