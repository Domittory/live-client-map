"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  acceptInvitation,
  inviteMember,
  setMemberStatus,
  transferOwnership,
  updateMemberRole,
  updateOrgSettings,
} from "@/lib/service/admin";
import { ServiceError } from "@/lib/service/errors";
import { createClient } from "@/lib/supabase/server";

export type AdminState = { error: string | null };

function toState(err: unknown): AdminState {
  if (err instanceof ServiceError) return { error: err.message };
  return { error: "Внутренняя ошибка" };
}

export async function inviteMemberAction(
  _prev: AdminState,
  formData: FormData
): Promise<AdminState> {
  try {
    const supabase = await createClient();
    await inviteMember(supabase, {
      organizationId: String(formData.get("organizationId") ?? ""),
      email: String(formData.get("email") ?? ""),
      role: String(formData.get("role") ?? ""),
    });
  } catch (err) {
    return toState(err);
  }
  revalidatePath("/admin");
  return { error: null };
}

export async function updateMemberRoleAction(
  _prev: AdminState,
  formData: FormData
): Promise<AdminState> {
  try {
    const supabase = await createClient();
    await updateMemberRole(supabase, {
      organizationId: String(formData.get("organizationId") ?? ""),
      userId: String(formData.get("userId") ?? ""),
      role: String(formData.get("role") ?? ""),
    });
  } catch (err) {
    return toState(err);
  }
  revalidatePath("/admin");
  return { error: null };
}

export async function setMemberStatusAction(
  _prev: AdminState,
  formData: FormData
): Promise<AdminState> {
  try {
    const supabase = await createClient();
    await setMemberStatus(supabase, {
      organizationId: String(formData.get("organizationId") ?? ""),
      userId: String(formData.get("userId") ?? ""),
      status: String(formData.get("status") ?? ""),
    });
  } catch (err) {
    return toState(err);
  }
  revalidatePath("/admin");
  return { error: null };
}

export async function transferOwnershipAction(
  _prev: AdminState,
  formData: FormData
): Promise<AdminState> {
  try {
    const supabase = await createClient();
    await transferOwnership(supabase, {
      organizationId: String(formData.get("organizationId") ?? ""),
      newOwnerId: String(formData.get("newOwnerId") ?? ""),
    });
  } catch (err) {
    return toState(err);
  }
  revalidatePath("/admin");
  return { error: null };
}

export async function updateOrgSettingsAction(
  _prev: AdminState,
  formData: FormData
): Promise<AdminState> {
  try {
    const supabase = await createClient();
    await updateOrgSettings(supabase, {
      organizationId: String(formData.get("organizationId") ?? ""),
      name: String(formData.get("name") ?? "") || undefined,
      retention: {
        clientDataYears: Number(formData.get("clientDataYears")),
        exportDays: Number(formData.get("exportDays")),
      },
    });
  } catch (err) {
    return toState(err);
  }
  revalidatePath("/admin");
  return { error: null };
}

export async function acceptInvitationAction(
  _prev: AdminState,
  formData: FormData
): Promise<AdminState> {
  try {
    const supabase = await createClient();
    await acceptInvitation(supabase, String(formData.get("token") ?? ""));
  } catch (err) {
    return toState(err);
  }
  redirect("/");
}
