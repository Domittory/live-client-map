"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { recordAudit } from "@/lib/service/audit";

export type ConsentState = { error: string | null };

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

export async function grantConsent(_prev: ConsentState, formData: FormData): Promise<ConsentState> {
  const clientId = String(formData.get("clientId") ?? "").trim();
  const type = String(formData.get("consentType") ?? "").trim();
  const scope = String(formData.get("scope") ?? "").trim();
  const docVersion = String(formData.get("documentVersion") ?? "").trim();

  if (!clientId || !type || !docVersion) {
    return { error: "Заполните client_id, тип и версию документа." };
  }

  const orgId = await currentOrgId();
  if (!orgId) return { error: "Организация не найдена." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("grant_consent", {
    p_org_id: orgId,
    p_client_id: clientId,
    p_consent_type: type,
    p_scope: scope,
    p_document_version: docVersion,
  });
  if (error) return { error: error.message };

  await recordAudit(supabase, {
    organizationId: orgId,
    entityType: "consent_record",
    entityId: clientId,
    action: "consent.granted",
    after: { consent_type: type, document_version: docVersion },
    reason: "consent granted",
  });

  revalidatePath("/consent");
  return { error: null };
}

export async function revokeConsent(
  _prev: ConsentState,
  formData: FormData
): Promise<ConsentState> {
  const clientId = String(formData.get("clientId") ?? "").trim();
  const type = String(formData.get("consentType") ?? "").trim();

  if (!clientId || !type) return { error: "Заполните client_id и тип." };

  const orgId = await currentOrgId();
  if (!orgId) return { error: "Организация не найдена." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("revoke_consent", {
    p_org_id: orgId,
    p_client_id: clientId,
    p_consent_type: type,
  });
  if (error) return { error: error.message };

  await recordAudit(supabase, {
    organizationId: orgId,
    entityType: "consent_record",
    entityId: clientId,
    action: "consent.revoked",
    after: { consent_type: type },
    reason: "consent revoked",
  });

  revalidatePath("/consent");
  return { error: null };
}
