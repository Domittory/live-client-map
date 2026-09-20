"use server";

import { revalidatePath } from "next/cache";
import {
  createSession,
  createSignal,
  SESSION_TYPES,
  EPISTEMIC_TYPES,
  SIGNAL_SOURCE_TYPES,
} from "@/lib/service/diagnostics";
import { getClient } from "@/lib/service/clients";
import { ServiceError } from "@/lib/service/errors";
import { REVIEW_ACTIONS, reviewSignal, type ReviewAction } from "@/lib/service/review";
import { createClient } from "@/lib/supabase/server";
import { reasonRequired } from "@/lib/service/diagnostics-presentation";

export type DiagnosticsActionState = { error: string | null };

/**
 * Client-context diagnostics mutations (ticket 10).
 *
 * The client is resolved through RLS first, so an unassigned or foreign caller
 * receives the same neutral denial as a missing client. The organization comes
 * from the client row, and the atomic RPCs (`create_diagnostic_session`,
 * `create_signal`, `review_signal`) revalidate tenant, assignment and write
 * access inside the database — the browser is never the gate.
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
      return "Сигнал не найден или недоступен для ревью.";
    }
  }
  return fallback;
}

function optional(formData: FormData, name: string): string | null {
  const value = String(formData.get(name) ?? "").trim();
  return value.length > 0 ? value : null;
}

function optionalNumber(formData: FormData, name: string): number | null {
  const value = optional(formData, name);
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function list(formData: FormData, name: string): string[] {
  const raw = String(formData.get(name) ?? "");
  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function isSessionType(value: string): value is (typeof SESSION_TYPES)[number] {
  return (SESSION_TYPES as readonly string[]).includes(value);
}

function isSourceType(value: string): value is (typeof SIGNAL_SOURCE_TYPES)[number] {
  return (SIGNAL_SOURCE_TYPES as readonly string[]).includes(value);
}

function isEpistemicType(value: string): value is (typeof EPISTEMIC_TYPES)[number] {
  return (EPISTEMIC_TYPES as readonly string[]).includes(value);
}

function isReviewAction(value: string): value is ReviewAction {
  return (REVIEW_ACTIONS as readonly string[]).includes(value);
}

export async function createDiagnosticSessionAction(
  _prev: DiagnosticsActionState,
  formData: FormData
): Promise<DiagnosticsActionState> {
  const clientId = String(formData.get("clientId") ?? "").trim();
  if (!clientId) return { error: CLIENT_REQUIRED };

  const title = String(formData.get("title") ?? "").trim();
  const sessionType = String(formData.get("sessionType") ?? "").trim();
  if (!title) return { error: "Укажите название сессии." };
  if (!isSessionType(sessionType)) return { error: "Выберите тип сессии." };

  const loaded = await loadClient(clientId);
  if (!loaded) return { error: DENIED };

  try {
    await createSession(loaded.supabase, loaded.client.organization_id, {
      clientId,
      title,
      sessionType,
      rawInput: optional(formData, "rawInput"),
      notes: optional(formData, "notes"),
    });
  } catch (err) {
    return { error: messageFor(err, "Не удалось создать сессию.") };
  }

  revalidatePath(`/clients/${clientId}/diagnostics`);
  return { error: null };
}

export async function createSignalAction(
  _prev: DiagnosticsActionState,
  formData: FormData
): Promise<DiagnosticsActionState> {
  const clientId = String(formData.get("clientId") ?? "").trim();
  if (!clientId) return { error: CLIENT_REQUIRED };

  const sourceType = String(formData.get("sourceType") ?? "").trim();
  const epistemicType = String(formData.get("epistemicType") ?? "").trim();
  const rawStatement = String(formData.get("rawStatement") ?? "").trim();

  if (!isSourceType(sourceType)) return { error: "Выберите источник сигнала." };
  if (!isEpistemicType(epistemicType)) return { error: "Выберите эпистемический тип." };
  if (!rawStatement) return { error: "Укажите исходное утверждение сигнала." };

  const loaded = await loadClient(clientId);
  if (!loaded) return { error: DENIED };

  try {
    await createSignal(loaded.supabase, loaded.client.organization_id, {
      clientId,
      diagnosticSessionId: optional(formData, "diagnosticSessionId"),
      sourceType,
      epistemicType,
      rawStatement,
      statementPolarity: optional(formData, "statementPolarity"),
      testResult: optional(formData, "testResult"),
      normalizedMeaning: optional(formData, "normalizedMeaning"),
      intensity: optionalNumber(formData, "intensity"),
      confidence: optionalNumber(formData, "confidence"),
      lifeAreas: list(formData, "lifeAreas"),
      tags: list(formData, "tags"),
      visibility: optional(formData, "visibility") ?? "internal",
    });
  } catch (err) {
    return { error: messageFor(err, "Не удалось добавить сигнал.") };
  }

  revalidatePath(`/clients/${clientId}/diagnostics`);
  return { error: null };
}

export async function reviewSignalAction(
  _prev: DiagnosticsActionState,
  formData: FormData
): Promise<DiagnosticsActionState> {
  const clientId = String(formData.get("clientId") ?? "").trim();
  const signalId = String(formData.get("signalId") ?? "").trim();
  const action = String(formData.get("action") ?? "").trim();
  const reason = String(formData.get("reason") ?? "").trim();

  if (!clientId) return { error: CLIENT_REQUIRED };
  if (!signalId) return { error: "Сигнал не указан." };
  if (!isReviewAction(action)) return { error: "Неизвестное действие ревью." };
  // An evidence-removing decision is never anonymous: the reason is stored in
  // the audit row and the user must type it deliberately.
  if (reasonRequired(action) && !reason) {
    return { error: "Для отклонения или скрытия сигнала укажите причину." };
  }

  const loaded = await loadClient(clientId);
  if (!loaded) return { error: DENIED };

  // The signal must belong to this client: RLS already withholds foreign rows,
  // and this check keeps the workspace from reviewing another client's evidence.
  const { data: signal, error } = await loaded.supabase
    .from("signals")
    .select("id")
    .eq("id", signalId)
    .eq("client_id", clientId)
    .maybeSingle();
  if (error || !signal) return { error: "Сигнал не найден или недоступен для ревью." };

  try {
    await reviewSignal(
      loaded.supabase,
      loaded.client.organization_id,
      signalId,
      action,
      reason || undefined
    );
  } catch (err) {
    return { error: messageFor(err, "Не удалось выполнить действие ревью.") };
  }

  revalidatePath(`/clients/${clientId}/diagnostics`);
  return { error: null };
}
