"use server";

import { revalidatePath } from "next/cache";
import { getClient } from "@/lib/service/clients";
import { ServiceError } from "@/lib/service/errors";
import {
  createFeedbackForm,
  sendFeedbackForm,
  submitPortalFeedbackForm,
} from "@/lib/service/feedback-forms";
import { createClient } from "@/lib/supabase/server";

/**
 * Feedback form mutations (ticket 16).
 *
 * Two callers share this module:
 *   * the specialist, scoped by the client workspace — the client is resolved
 *     through RLS first, so an unassigned caller receives the same neutral
 *     denial as a missing client, and the atomic RPCs re-check write access;
 *   * the portal identity, which resolves through the signed-in session only.
 *     No `clientId` ever crosses the portal boundary: the atomic RPC derives
 *     the client from the form row and re-checks the active `client_portal`
 *     consent on every submission.
 */

export type FeedbackActionState = { error: string | null; sent: boolean; done: boolean };
export type PortalFeedbackActionState = { error: string | null; done: boolean };

const DENIED = "Клиент недоступен или у вас нет прав.";
const PORTAL_DENIED = "Форма недоступна: она уже отправлена, истекла или доступ отозван.";

function messageFor(err: unknown, fallback: string): string {
  if (err instanceof ServiceError) {
    if (err.code === "FORBIDDEN") {
      return "Недостаточно прав: нужен доступ на запись и действующее согласие по клиенту.";
    }
    if (err.code === "VALIDATION_ERROR") return "Проверьте заполненные поля формы.";
    if (err.code === "NOT_FOUND") return "Форма не найдена.";
    if (err.code === "CONFLICT") return "Форма уже отправлена или её срок истёк.";
  }
  return fallback;
}

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

/**
 * Parse the question builder payload. The browser sends one `questions` entry
 * per row as JSON; anything that is not a well-formed question is dropped, and
 * an empty result is rejected before the RPC so the user gets a clear message.
 */
function parseQuestions(formData: FormData): unknown[] {
  const raw = formData.getAll("questions").map(String);
  const questions: unknown[] = [];
  for (const entry of raw) {
    try {
      const parsed = JSON.parse(entry) as Record<string, unknown>;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) questions.push(parsed);
    } catch {
      // Ignore an unusable row; the schema still enforces at least one question
      // and the action reports the validation error honestly.
    }
  }
  return questions;
}

/** Answers arrive as one hidden `answersJson` object built from the form fields. */
function parseAnswers(formData: FormData): Record<string, unknown> | null {
  const raw = String(formData.get("answersJson") ?? "").trim();
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return null;
  }
  return null;
}

export async function createFeedbackFormAction(
  _prev: FeedbackActionState,
  formData: FormData
): Promise<FeedbackActionState> {
  const clientId = String(formData.get("clientId") ?? "").trim();
  const title = String(formData.get("title") ?? "").trim();
  if (!clientId) return { error: "Клиент не указан.", sent: false, done: false };
  if (!title) return { error: "Укажите название формы.", sent: false, done: false };

  const questions = parseQuestions(formData);
  if (questions.length === 0) {
    return { error: "Добавьте хотя бы один вопрос.", sent: false, done: false };
  }

  const loaded = await loadClient(clientId);
  if (!loaded) return { error: DENIED, sent: false, done: false };

  try {
    await createFeedbackForm(loaded.supabase, {
      organizationId: loaded.client.organization_id,
      clientId,
      title,
      questions,
    });
  } catch (err) {
    return { error: messageFor(err, "Не удалось создать форму."), sent: false, done: false };
  }

  revalidatePath(`/clients/${clientId}/feedback`);
  return { error: null, sent: false, done: true };
}

export async function sendFeedbackFormAction(
  _prev: FeedbackActionState,
  formData: FormData
): Promise<FeedbackActionState> {
  const clientId = String(formData.get("clientId") ?? "").trim();
  const formId = String(formData.get("formId") ?? "").trim();
  if (!clientId) return { error: "Клиент не указан.", sent: false, done: false };
  if (!formId) return { error: "Форма не указана.", sent: false, done: false };

  const loaded = await loadClient(clientId);
  if (!loaded) return { error: DENIED, sent: false, done: false };

  // The form must belong to this client: RLS withholds foreign rows, and this
  // check keeps one client's workspace from sending another client's form.
  const { data: form, error } = await loaded.supabase
    .from("client_feedback_forms")
    .select("id")
    .eq("id", formId)
    .eq("client_id", clientId)
    .maybeSingle();
  if (error || !form) return { error: "Форма не найдена.", sent: false, done: false };

  try {
    await sendFeedbackForm(loaded.supabase, { formId });
  } catch (err) {
    return { error: messageFor(err, "Не удалось отправить форму."), sent: false, done: false };
  }

  revalidatePath(`/clients/${clientId}/feedback`);
  return { error: null, sent: true, done: true };
}

/**
 * Portal submission. The portal identity is resolved from the session inside
 * the atomic RPC; the action only carries the form id and the answers.
 */
export async function submitPortalFeedbackFormAction(
  _prev: PortalFeedbackActionState,
  formData: FormData
): Promise<PortalFeedbackActionState> {
  const formId = String(formData.get("formId") ?? "").trim();
  if (!formId) return { error: PORTAL_DENIED, done: false };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Войдите заново по ссылке-приглашению.", done: false };

  const answers = parseAnswers(formData);
  if (!answers) return { error: "Ответьте на все обязательные вопросы.", done: false };

  try {
    await submitPortalFeedbackForm(supabase, { formId, answers });
  } catch (err) {
    if (err instanceof ServiceError && err.code === "VALIDATION_ERROR") {
      return { error: "Ответьте на все обязательные вопросы.", done: false };
    }
    return { error: PORTAL_DENIED, done: false };
  }

  revalidatePath("/portal");
  return { error: null, done: true };
}
