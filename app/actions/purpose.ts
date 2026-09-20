"use server";

import { revalidatePath } from "next/cache";
import { getClient } from "@/lib/service/clients";
import { ServiceError } from "@/lib/service/errors";
import {
  PURPOSE_SOURCE_SYSTEMS,
  createPurposeProfile,
  createPurposeSynthesis,
} from "@/lib/service/purpose";
import { createClient } from "@/lib/supabase/server";

export type PurposeActionState = { error: string | null };

/**
 * Client-context Purpose mutations (ticket 13, SPEC §8.20/§8.21).
 *
 * The purpose layer is entered manually: there is no automatic
 * purpose-detection algorithm in this product. The client is resolved through
 * RLS first, and the atomic RPCs revalidate tenant, assignment and write access
 * inside the database while appending the audit row. The browser only supplies
 * the specialist's own text, the named source system and its visibility.
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

function list(formData: FormData, name: string): string[] {
  return String(formData.get(name) ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function isSourceSystem(value: string): value is (typeof PURPOSE_SOURCE_SYSTEMS)[number] {
  return (PURPOSE_SOURCE_SYSTEMS as readonly string[]).includes(value);
}

/**
 * Parse the raw source data textarea. The value must be a JSON object: the
 * profile keeps the original source payload untouched, and a malformed payload
 * is refused instead of being stored as an opaque string.
 */
function parseRawData(value: string): { ok: true; data: Record<string, unknown> } | { ok: false } {
  if (value.length === 0) return { ok: true, data: {} };
  try {
    const parsed: unknown = JSON.parse(value);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed))
      return { ok: false };
    return { ok: true, data: parsed as Record<string, unknown> };
  } catch {
    return { ok: false };
  }
}

export async function createPurposeProfileAction(
  _prev: PurposeActionState,
  formData: FormData
): Promise<PurposeActionState> {
  const clientId = field(formData, "clientId");
  if (!clientId) return { error: CLIENT_REQUIRED };

  const sourceSystem = field(formData, "sourceSystem");
  if (!isSourceSystem(sourceSystem)) return { error: "Выберите источник данных профиля." };

  const rawData = parseRawData(String(formData.get("rawData") ?? "").trim());
  if (!rawData.ok) {
    return { error: 'Исходные данные должны быть JSON-объектом (например: {"type": "..."}).' };
  }

  const loaded = await loadClient(clientId);
  if (!loaded) return { error: DENIED };

  try {
    await createPurposeProfile(loaded.supabase, loaded.client.organization_id, {
      clientId,
      sourceSystem,
      rawData: rawData.data,
      interpretation: optional(formData, "interpretation"),
      strengths: list(formData, "strengths"),
      potentialRoles: list(formData, "potentialRoles"),
      developmentDirections: list(formData, "developmentDirections"),
      confidence: numberOrNull(String(formData.get("confidence") ?? "").trim()),
      visibility: field(formData, "visibility") || "internal",
    });
  } catch (err) {
    return { error: messageFor(err, "Не удалось сохранить профиль предназначения.") };
  }

  revalidatePath(`/clients/${clientId}/purpose`);
  return { error: null };
}

function numberOrNull(value: string): number | null {
  if (value.length === 0) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function createPurposeSynthesisAction(
  _prev: PurposeActionState,
  formData: FormData
): Promise<PurposeActionState> {
  const clientId = field(formData, "clientId");
  if (!clientId) return { error: CLIENT_REQUIRED };

  const summary = optional(formData, "summary");
  if (!summary) return { error: "Заполните резюме синтеза." };

  const loaded = await loadClient(clientId);
  if (!loaded) return { error: DENIED };

  try {
    await createPurposeSynthesis(loaded.supabase, loaded.client.organization_id, {
      clientId,
      summary,
      crossSystemMatches: list(formData, "crossSystemMatches"),
      potentialConflicts: list(formData, "potentialConflicts"),
      recommendedDevelopmentVectors: list(formData, "recommendedDevelopmentVectors"),
    });
  } catch (err) {
    return { error: messageFor(err, "Не удалось сохранить синтез предназначения.") };
  }

  revalidatePath(`/clients/${clientId}/purpose`);
  return { error: null };
}
