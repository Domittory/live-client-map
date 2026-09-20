"use server";

import { revalidatePath } from "next/cache";
import { grantClientAssignment, revokeClientAssignment } from "@/lib/service/client-access";
import { getClient } from "@/lib/service/clients";
import { ServiceError } from "@/lib/service/errors";
import { createClient } from "@/lib/supabase/server";

export type AssignmentState = { error: string | null };

/**
 * Client-context assignment mutations (ticket 09).
 *
 * Every action resolves the client through RLS before doing anything: an
 * unassigned or foreign caller gets the same neutral denial as a missing
 * client, with no metadata in the response. The organization is taken from the
 * client row, never from the form, and the database RPC re-checks the Owner
 * rule on the write itself.
 */

const DENIED = "Клиент недоступен или у вас нет прав.";

async function loadClient(clientId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { supabase, client: null };

  const client = await getClient(supabase, clientId);
  return { supabase, client };
}

function messageFor(err: unknown, fallback: string): string {
  if (err instanceof ServiceError) {
    if (err.code === "FORBIDDEN") return "Недостаточно прав: управлять доступом может владелец.";
    if (err.code === "NOT_FOUND") {
      return "Пользователь с таким email не найден среди активных участников организации.";
    }
    if (err.code === "VALIDATION_ERROR") return "Проверьте выбранную роль доступа.";
    if (err.code === "CONFLICT") return "Такое назначение уже существует.";
  }
  return fallback;
}

export async function grantAssignment(
  _prev: AssignmentState,
  formData: FormData
): Promise<AssignmentState> {
  const clientId = String(formData.get("clientId") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const accessRole = String(formData.get("accessRole") ?? "read_only");

  if (!clientId) return { error: "Клиент не указан." };
  if (!email) return { error: "Выберите участника." };

  const { supabase, client } = await loadClient(clientId);
  if (!client) return { error: DENIED };

  try {
    await grantClientAssignment(supabase, {
      organizationId: client.organization_id,
      clientId,
      email,
      accessRole,
    });
  } catch (err) {
    return { error: messageFor(err, "Не удалось назначить доступ.") };
  }

  revalidatePath(`/clients/${clientId}/access`);
  revalidatePath("/access");
  return { error: null };
}

export async function revokeAssignment(
  _prev: AssignmentState,
  formData: FormData
): Promise<AssignmentState> {
  const clientId = String(formData.get("clientId") ?? "").trim();
  const userId = String(formData.get("userId") ?? "").trim();

  if (!clientId || !userId) return { error: "Клиент или участник не указан." };

  const { supabase, client } = await loadClient(clientId);
  if (!client) return { error: DENIED };

  try {
    await revokeClientAssignment(supabase, {
      organizationId: client.organization_id,
      clientId,
      userId,
    });
  } catch (err) {
    return { error: messageFor(err, "Не удалось отозвать доступ.") };
  }

  revalidatePath(`/clients/${clientId}/access`);
  revalidatePath("/access");
  return { error: null };
}
