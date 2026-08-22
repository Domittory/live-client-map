"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import {
  changeRequestStatus,
  createGoal,
  createRequest,
  type RequestStatus,
} from "@/lib/service/requests";

export type RequestActionState = { error: string | null };

async function currentOrgId(): Promise<string | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: membership } = await supabase
    .from("organization_members")
    .select("organization_id")
    .eq("user_id", user.id)
    .maybeSingle();
  return membership?.organization_id ?? null;
}

export async function createRequestAction(
  _prev: RequestActionState,
  formData: FormData
): Promise<RequestActionState> {
  const orgId = await currentOrgId();
  if (!orgId) return { error: "Организация не найдена." };

  const clientId = String(formData.get("clientId") ?? "");
  const supabase = await createClient();
  try {
    await createRequest(supabase, orgId, {
      clientId,
      title: String(formData.get("title") ?? ""),
      description: String(formData.get("description") ?? "") || null,
      successCriteria: String(formData.get("successCriteria") ?? "") || null,
    });
    revalidatePath(`/clients/${clientId}/requests`);
    return { error: null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Не удалось создать запрос." };
  }
}

export async function createGoalAction(
  _prev: RequestActionState,
  formData: FormData
): Promise<RequestActionState> {
  const orgId = await currentOrgId();
  if (!orgId) return { error: "Организация не найдена." };

  const clientId = String(formData.get("clientId") ?? "");
  const supabase = await createClient();
  try {
    await createGoal(supabase, orgId, {
      clientId,
      title: String(formData.get("title") ?? ""),
      description: String(formData.get("description") ?? "") || null,
      targetState: String(formData.get("targetState") ?? "") || null,
    });
    revalidatePath(`/clients/${clientId}/requests`);
    return { error: null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Не удалось создать цель." };
  }
}

export async function changeRequestStatusAction(
  _prev: RequestActionState,
  formData: FormData
): Promise<RequestActionState> {
  const orgId = await currentOrgId();
  if (!orgId) return { error: "Организация не найдена." };

  const clientId = String(formData.get("clientId") ?? "");
  const supabase = await createClient();
  try {
    await changeRequestStatus(
      supabase,
      orgId,
      String(formData.get("requestId") ?? ""),
      String(formData.get("toStatus") ?? "") as RequestStatus
    );
    revalidatePath(`/clients/${clientId}/requests`);
    return { error: null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Не удалось изменить статус." };
  }
}
