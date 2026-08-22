"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getServiceClient } from "@/lib/supabase/admin";

export type AssignmentState = { error: string | null };

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

export async function grantAssignment(
  _prev: AssignmentState,
  formData: FormData
): Promise<AssignmentState> {
  const clientId = String(formData.get("clientId") ?? "").trim();
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  const role = String(formData.get("role") ?? "read_only");

  if (!clientId) return { error: "Укажите client_id." };
  if (!email) return { error: "Укажите email." };

  const orgId = await currentOrgId();
  if (!orgId) return { error: "Организация не найдена." };

  const admin = getServiceClient();
  const { data, error: listError } = await admin.auth.admin.listUsers({ perPage: 1000 });
  if (listError) return { error: listError.message };
  const target = data.users.find((u) => u.email?.toLowerCase() === email);
  if (!target) return { error: "Пользователь с таким email не найден." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("grant_client_assignment", {
    p_org_id: orgId,
    p_client_id: clientId,
    p_user_id: target.id,
    p_access_role: role,
  });
  if (error) return { error: error.message };

  revalidatePath("/access");
  return { error: null };
}

export async function revokeAssignment(
  _prev: AssignmentState,
  formData: FormData
): Promise<AssignmentState> {
  const clientId = String(formData.get("clientId") ?? "").trim();
  const userId = String(formData.get("userId") ?? "").trim();

  if (!clientId || !userId) return { error: "Укажите client_id и user_id." };

  const orgId = await currentOrgId();
  if (!orgId) return { error: "Организация не найдена." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("revoke_client_assignment", {
    p_org_id: orgId,
    p_client_id: clientId,
    p_user_id: userId,
  });
  if (error) return { error: error.message };

  revalidatePath("/access");
  return { error: null };
}
