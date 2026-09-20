"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createPortalUser, revokePortalUser } from "@/lib/service/client-portal";
import { getClient } from "@/lib/service/clients";
import { ServiceError } from "@/lib/service/errors";
import { createClient } from "@/lib/supabase/server";

/**
 * Client Portal access mutations (ticket 15).
 *
 * The specialist resolves the client through RLS first, then:
 *   1. grants/re-activates the portal identity through the atomic
 *      `create_portal_user` RPC (which re-checks `client_portal` consent), and
 *   2. sends a single-use, time-limited sign-in link with `signInWithOtp`.
 *
 * The link is requested server-side, so it is delivered through the customized
 * magic-link email template (supabase/templates/magic_link.html) that points at
 * our own `/auth/confirm` route instead of the Supabase `/verify` endpoint.
 * A PKCE code verifier issued to the specialist's browser could never be
 * presented by the client's browser, while the `token_hash` route works there.
 */

const DENIED = "Клиент недоступен или у вас нет прав.";

export type PortalInviteState = { error: string | null; sent: boolean };
export type PortalRevokeState = { error: string | null; revoked: boolean };

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
    if (err.code === "FORBIDDEN") {
      return "Недостаточно прав: нужен доступ на запись и действующее согласие «Портал клиента».";
    }
    if (err.code === "VALIDATION_ERROR") return "Проверьте email.";
    if (err.code === "NOT_FOUND") return "Клиент или портал не найден.";
    if (err.code === "CONFLICT") return "Портал клиента уже выдан.";
  }
  return fallback;
}

export async function invitePortalUser(
  _prev: PortalInviteState,
  formData: FormData
): Promise<PortalInviteState> {
  const clientId = String(formData.get("clientId") ?? "").trim();
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();

  if (!clientId) return { error: "Клиент не указан.", sent: false };
  if (!email) return { error: "Укажите email клиента.", sent: false };

  const { supabase, client } = await loadClient(clientId);
  if (!client) return { error: DENIED, sent: false };

  try {
    await createPortalUser(supabase, { clientId, email });
  } catch (err) {
    return { error: messageFor(err, "Не удалось выдать доступ к порталу."), sent: false };
  }

  const origin = (await headers()).get("origin");
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      shouldCreateUser: true,
      ...(origin ? { emailRedirectTo: `${origin}/auth/confirm` } : {}),
    },
  });

  revalidatePath(`/clients/${clientId}/portal`);

  if (error) {
    return {
      error: "Доступ выдан, но письмо со ссылкой отправить не удалось. Повторите приглашение.",
      sent: false,
    };
  }

  return { error: null, sent: true };
}

export async function revokePortalUserAccess(
  _prev: PortalRevokeState,
  formData: FormData
): Promise<PortalRevokeState> {
  const clientId = String(formData.get("clientId") ?? "").trim();
  const portalUserId = String(formData.get("portalUserId") ?? "").trim();

  if (!clientId || !portalUserId) {
    return { error: "Клиент или портал не указан.", revoked: false };
  }

  const { supabase, client } = await loadClient(clientId);
  if (!client) return { error: DENIED, revoked: false };

  try {
    await revokePortalUser(supabase, portalUserId);
  } catch (err) {
    return { error: messageFor(err, "Не удалось отозвать доступ к порталу."), revoked: false };
  }

  revalidatePath(`/clients/${clientId}/portal`);
  return { error: null, revoked: true };
}

/** Sign the portal identity out of the portal back to its own entry page. */
export async function portalSignOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/portal/login");
}
