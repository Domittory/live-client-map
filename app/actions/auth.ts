"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import {
  getEmailConfirmationRedirect,
  getInviteDestination,
  safeAuthRedirectPath,
} from "@/lib/auth/onboarding";
import { createClient } from "@/lib/supabase/server";

export type AuthState = { error: string | null };

export async function signIn(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const redirectTo = safeAuthRedirectPath(String(formData.get("redirectTo") ?? ""));

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { error: error.message };

  redirect(redirectTo);
}

export async function signUp(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const orgName = String(formData.get("orgName") ?? "").trim();
  const rawInvite = String(formData.get("inviteToken") ?? "");
  const invite = rawInvite ? getInviteDestination(rawInvite) : null;

  if (rawInvite && !invite) return { error: "Недействительная ссылка приглашения." };
  if (!invite && !orgName) return { error: "Укажите название организации." };

  const supabase = await createClient();
  const origin = (await headers()).get("origin");
  const emailRedirectTo =
    invite && origin ? getEmailConfirmationRedirect(origin, invite.path) : null;
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    ...(emailRedirectTo
      ? {
          options: {
            emailRedirectTo,
          },
        }
      : {}),
  });
  if (error) return { error: error.message };
  if (!data.session) {
    if (invite) redirect(`/login?redirectTo=${encodeURIComponent(invite.path)}`);
    return { error: "Подтвердите email перед входом." };
  }

  if (invite) {
    redirect(invite.path);
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
