"use server";

import { revalidatePath } from "next/cache";
import { getClient } from "@/lib/service/clients";
import {
  createDevelopmentTarget,
  updateDevelopmentTarget,
} from "@/lib/service/development-targets";
import { ServiceError } from "@/lib/service/errors";
import { createResource, updateResource } from "@/lib/service/resources";
import { createClient } from "@/lib/supabase/server";

export type PositiveLayerActionState = { error: string | null };

/**
 * Client-context Resources and DevelopmentTargets mutations (ticket 13).
 *
 * The client is resolved through RLS first, so an unassigned or foreign caller
 * receives the same neutral denial as a missing client. Every mutation goes
 * through a guarded atomic RPC that revalidates tenant, assignment and write
 * access inside the database and appends the audit row with the authenticated
 * actor — the browser is never the gate and never supplies the actor.
 */

const DENIED = "Клиент недоступен или у вас нет прав.";
const CLIENT_REQUIRED = "Клиент не указан.";

async function loadClient(clientId: string) {
  if (!clientId) return null;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const client = await getClient(supabase, clientId);
  if (!client) return null;

  return { supabase, client };
}

function messageFor(err: unknown, fallback: string): string {
  if (err instanceof ServiceError) {
    if (err.code === "FORBIDDEN") {
      return "Недостаточно прав: нет права записи по этому клиенту.";
    }
    if (err.code === "VALIDATION_ERROR") {
      return "Проверьте заполненные поля и допустимые значения.";
    }
    if (err.code === "NOT_FOUND") {
      return "Запись не найдена или недоступна.";
    }
  }
  return fallback;
}

function field(formData: FormData, name: string): string {
  return String(formData.get(name) ?? "").trim();
}

function optional(formData: FormData, name: string): string | null {
  const value = field(formData, name);
  return value.length > 0 ? value : null;
}

function optionalNumber(formData: FormData, name: string): number | null {
  const value = optional(formData, name);
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function list(formData: FormData, name: string): string[] {
  return formData
    .getAll(name)
    .flatMap((entry) => String(entry).split(","))
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

export async function createResourceAction(
  _prev: PositiveLayerActionState,
  formData: FormData
): Promise<PositiveLayerActionState> {
  const clientId = field(formData, "clientId");
  if (!clientId) return { error: CLIENT_REQUIRED };

  const name = field(formData, "name");
  if (!name) return { error: "Укажите название ресурса." };

  const loaded = await loadClient(clientId);
  if (!loaded) return { error: DENIED };

  try {
    await createResource(loaded.supabase, loaded.client.organization_id, {
      clientId,
      name,
      description: optional(formData, "description"),
      domain: optional(formData, "domain"),
      strengthScore: optionalNumber(formData, "strengthScore"),
      confidenceScore: optionalNumber(formData, "confidenceScore"),
      evidenceSummary: optional(formData, "evidenceSummary"),
    });
  } catch (err) {
    return { error: messageFor(err, "Не удалось создать ресурс.") };
  }

  revalidatePath(`/clients/${clientId}/resources`);
  return { error: null };
}

export async function updateResourceAction(
  _prev: PositiveLayerActionState,
  formData: FormData
): Promise<PositiveLayerActionState> {
  const clientId = field(formData, "clientId");
  const resourceId = field(formData, "resourceId");
  if (!clientId) return { error: CLIENT_REQUIRED };
  if (!resourceId) return { error: "Ресурс не указан." };

  const evidenceSummary = optional(formData, "evidenceSummary");
  const strengthScore = optionalNumber(formData, "strengthScore");
  const confidenceScore = optionalNumber(formData, "confidenceScore");
  // The database enforces this too; the check here gives a readable message and
  // avoids a pointless round trip for a change the service would reject.
  if ((strengthScore !== null || confidenceScore !== null) && !evidenceSummary) {
    return { error: "Для изменения оценки ресурса нужны доказательства или причина." };
  }

  const loaded = await loadClient(clientId);
  if (!loaded) return { error: DENIED };

  try {
    await updateResource(loaded.supabase, loaded.client.organization_id, {
      id: resourceId,
      strengthScore,
      confidenceScore,
      evidenceSummary,
    });
  } catch (err) {
    return {
      error: messageFor(err, "Не удалось обновить ресурс: нужны доказательства или причина."),
    };
  }

  revalidatePath(`/clients/${clientId}/resources`);
  return { error: null };
}

export async function createDevelopmentTargetAction(
  _prev: PositiveLayerActionState,
  formData: FormData
): Promise<PositiveLayerActionState> {
  const clientId = field(formData, "clientId");
  if (!clientId) return { error: CLIENT_REQUIRED };

  const name = field(formData, "name");
  if (!name) return { error: "Укажите название цели развития." };

  const importance = field(formData, "importance") || "normal";

  const loaded = await loadClient(clientId);
  if (!loaded) return { error: DENIED };

  try {
    await createDevelopmentTarget(loaded.supabase, loaded.client.organization_id, {
      clientId,
      name,
      description: optional(formData, "description"),
      domain: optional(formData, "domain"),
      currentLevel: optionalNumber(formData, "currentLevel"),
      targetLevel: optionalNumber(formData, "targetLevel"),
      importance,
      linkedResources: list(formData, "linkedResources"),
      linkedCoreNodes: list(formData, "linkedCoreNodes"),
      successMarkers: list(formData, "successMarkers"),
    });
  } catch (err) {
    return { error: messageFor(err, "Не удалось создать цель развития.") };
  }

  revalidatePath(`/clients/${clientId}/resources`);
  return { error: null };
}

export async function updateDevelopmentTargetAction(
  _prev: PositiveLayerActionState,
  formData: FormData
): Promise<PositiveLayerActionState> {
  const clientId = field(formData, "clientId");
  const targetId = field(formData, "targetId");
  if (!clientId) return { error: CLIENT_REQUIRED };
  if (!targetId) return { error: "Цель развития не указана." };

  const name = field(formData, "name");
  if (!name) return { error: "Укажите название цели развития." };

  const reason = optional(formData, "reason");
  const currentLevel = optionalNumber(formData, "currentLevel");
  const targetLevel = optionalNumber(formData, "targetLevel");
  const status = field(formData, "status") || "active";
  if (!reason) {
    return { error: "Для изменения уровней или статуса цели укажите причину." };
  }

  const loaded = await loadClient(clientId);
  if (!loaded) return { error: DENIED };

  try {
    await updateDevelopmentTarget(loaded.supabase, loaded.client.organization_id, {
      id: targetId,
      name,
      description: optional(formData, "description"),
      domain: optional(formData, "domain"),
      currentLevel,
      targetLevel,
      importance: field(formData, "importance") || "normal",
      status,
      linkedResources: list(formData, "linkedResources"),
      linkedCoreNodes: list(formData, "linkedCoreNodes"),
      successMarkers: list(formData, "successMarkers"),
      reason,
    });
  } catch (err) {
    return { error: messageFor(err, "Не удалось обновить цель развития.") };
  }

  revalidatePath(`/clients/${clientId}/resources`);
  return { error: null };
}
