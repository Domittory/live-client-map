"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import {
  getEmailConfirmationRedirect,
  getInviteDestination,
  safeAuthRedirectPath,
} from "@/lib/auth/onboarding";
import { browserOrigin, recoveryRedirectTarget } from "@/lib/auth/recovery";
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
  const email = String(formData.get("email") ?? "").trim();

  // The reset link may only point back at an allowlisted origin taken from the
  // request; a forged `Origin`/`Host` can never inject an attacker's domain.
  // When the origin is not trusted, Supabase falls back to its own `site_url`.
  const origin = browserOrigin(await headers());
  const redirectTo = origin ? recoveryRedirectTarget(origin) : null;

  const supabase = await createClient();
  try {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      ...(redirectTo ? { redirectTo } : {}),
    });
    if (error) {
      // Log server-side only. The response is identical for known and unknown
      // addresses, so it can never be used to enumerate accounts.
      console.error("resetPasswordForEmail failed:", error.message);
    }
  } catch (err) {
    console.error("resetPasswordForEmail threw:", err);
  }

  return { sent: true, error: null };
}

/**
 * Set a new password through a verified recovery session (ticket 17).
 *
 * The caller must already hold a session: the only way to obtain one from a
 * recovery email is `/auth/confirm`, which redeems the single-use token with
 * `verifyOtp({ type: "recovery" })`. Without a session the action refuses, so a
 * malformed or expired link can never reach this mutation.
 *
 * The post-success destination is sanitised against the same allowlist used by
 * every other auth redirect, so neither the hidden field nor a query parameter
 * can turn the redirect into an open redirect.
 */
export async function updatePassword(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const password = String(formData.get("password") ?? "");
  const confirmation = String(formData.get("passwordConfirmation") ?? "");
  const next = safeAuthRedirectPath(String(formData.get("next") ?? ""));

  if (password.length < 8) return { error: "Пароль должен быть не короче 8 символов." };
  if (password !== confirmation) return { error: "Пароли не совпадают." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: "Ссылка для сброса пароля недействительна или истекла. Запросите новую." };
  }

  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    return { error: "Не удалось сохранить новый пароль. Запросите новую ссылку." };
  }

  redirect(next);
}
