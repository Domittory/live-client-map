"use server";

import { revalidatePath } from "next/cache";
import { grantClientConsent, revokeClientConsent } from "@/lib/service/consent";
import { getClient } from "@/lib/service/clients";
import { ServiceError } from "@/lib/service/errors";
import { createClient } from "@/lib/supabase/server";

export type ConsentState = { error: string | null };

/**
 * Client-context consent mutations (ticket 09).
 *
 * The client is resolved through RLS first; an unassigned or foreign caller is
 * denied with the same neutral message as a missing client. The organization is
 * taken from the client row, and the atomic RPC revalidates write access and
 * tenant before appending the versioned consent record.
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
    if (err.code === "FORBIDDEN") {
      return "Недостаточно прав: нет права записи по этому клиенту.";
    }
    if (err.code === "VALIDATION_ERROR") {
      return "Проверьте тип согласия, область действия и версию документа.";
    }
  }
  return fallback;
}

export async function grantConsent(_prev: ConsentState, formData: FormData): Promise<ConsentState> {
  const clientId = String(formData.get("clientId") ?? "").trim();
  const consentType = String(formData.get("consentType") ?? "").trim();
  const scope = String(formData.get("scope") ?? "").trim();
  const documentVersion = String(formData.get("documentVersion") ?? "").trim();

  if (!clientId) return { error: "Клиент не указан." };
  if (!consentType || !documentVersion) {
    return { error: "Укажите тип согласия и версию документа." };
  }

  const { supabase, client } = await loadClient(clientId);
  if (!client) return { error: DENIED };

  try {
    await grantClientConsent(supabase, {
      organizationId: client.organization_id,
      clientId,
      consentType,
      scope,
      documentVersion,
    });
  } catch (err) {
    return { error: messageFor(err, "Не удалось выдать согласие.") };
  }

  revalidatePath(`/clients/${clientId}/consent`);
  revalidatePath("/consent");
  return { error: null };
}

export async function revokeConsent(
  _prev: ConsentState,
  formData: FormData
): Promise<ConsentState> {
  const clientId = String(formData.get("clientId") ?? "").trim();
  const consentType = String(formData.get("consentType") ?? "").trim();

  if (!clientId || !consentType) return { error: "Клиент или тип согласия не указан." };

  const { supabase, client } = await loadClient(clientId);
  if (!client) return { error: DENIED };

  try {
    await revokeClientConsent(supabase, {
      organizationId: client.organization_id,
      clientId,
      consentType,
    });
  } catch (err) {
    return { error: messageFor(err, "Не удалось отозвать согласие.") };
  }

  revalidatePath(`/clients/${clientId}/consent`);
  revalidatePath("/consent");
  return { error: null };
}
