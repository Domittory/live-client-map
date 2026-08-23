"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type AuthState = { error: string | null };

function safeRedirectPath(value: string): string {
  return value.startsWith("/") && !value.startsWith("//") ? value : "/";
}

export async function signIn(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const redirectTo = safeRedirectPath(String(formData.get("redirectTo") ?? ""));

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { error: error.message };

  redirect(redirectTo);
}

export async function signUp(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const orgName = String(formData.get("orgName") ?? "").trim();
  const inviteToken = String(formData.get("inviteToken") ?? "");

  if (!inviteToken && !orgName) return { error: "Укажите название организации." };

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error) return { error: error.message };
  if (!data.session) return { error: "Подтвердите email перед входом." };

  if (inviteToken) {
    const { error: invitationError } = await supabase.rpc("accept_invitation", {
      p_token: inviteToken,
    });
    if (invitationError) return { error: invitationError.message };
  } else {
    const { error: orgError } = await supabase.rpc("create_organization", { org_name: orgName });
    if (orgError) return { error: orgError.message };
  }

  redirect("/");
}

export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

export async function resetPassword(
  _prev: { sent: boolean; error: string | null },
  formData: FormData
) {
  const email = String(formData.get("email") ?? "");

  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(email);
  if (error) return { sent: false, error: error.message };

  return { sent: true, error: null };
}
