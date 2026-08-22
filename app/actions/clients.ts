"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  archiveClient,
  createClient as createClientService,
  updateClient,
} from "@/lib/service/clients";

export type ClientActionState = { error: string | null };

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

export async function createClientAction(
  _prev: ClientActionState,
  formData: FormData
): Promise<ClientActionState> {
  const orgId = await currentOrgId();
  if (!orgId) return { error: "Организация не найдена." };

  const supabase = await createClient();
  try {
    const id = await createClientService(supabase, {
      organizationId: orgId,
      displayName: String(formData.get("displayName") ?? ""),
      firstName: String(formData.get("firstName") ?? "") || null,
      lastName: String(formData.get("lastName") ?? "") || null,
    });
    revalidatePath("/clients");
    redirect(`/clients/${id}`);
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Не удалось создать клиента." };
  }
}

export async function updateClientAction(
  _prev: ClientActionState,
  formData: FormData
): Promise<ClientActionState> {
  const orgId = await currentOrgId();
  if (!orgId) return { error: "Организация не найдена." };

  const supabase = await createClient();
  try {
    await updateClient(supabase, orgId, {
      id: String(formData.get("id") ?? ""),
      displayName: String(formData.get("displayName") ?? "") || undefined,
      occupation: String(formData.get("occupation") ?? "") || null,
      specialistNotesPrivate: String(formData.get("specialistNotesPrivate") ?? "") || null,
      clientVisibleNotes: String(formData.get("clientVisibleNotes") ?? "") || null,
    });
    revalidatePath("/clients");
    return { error: null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Не удалось обновить клиента." };
  }
}

export async function archiveClientAction(
  _prev: ClientActionState,
  formData: FormData
): Promise<ClientActionState> {
  const orgId = await currentOrgId();
  if (!orgId) return { error: "Организация не найдена." };

  const supabase = await createClient();
  try {
    await archiveClient(supabase, orgId, String(formData.get("id") ?? ""));
    revalidatePath("/clients");
    return { error: null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Не удалось архивировать клиента." };
  }
}
