"use server";

import { revalidatePath } from "next/cache";
import { getClient } from "@/lib/service/clients";
import { confirmCoreNode, rejectCoreNode } from "@/lib/service/core-nodes";
import { ServiceError } from "@/lib/service/errors";
import {
  HYPOTHESIS_REVIEW_ACTIONS,
  reviewHypothesis,
  type HypothesisReviewAction,
} from "@/lib/service/hypotheses";
import { THEME_REVIEW_ACTIONS, reviewTheme, type ThemeReviewAction } from "@/lib/service/themes";
import { createClient } from "@/lib/supabase/server";

export type ReviewActionState = { error: string | null };

/**
 * Client-context model review mutations (ticket 12).
 *
 * The client is resolved through RLS first, so an unassigned or foreign caller
 * receives the same neutral denial as a missing client. Every decision is an
 * explicit approve/reject on exactly one entity and goes through the atomic RPCs
 * (`review_theme`, `review_hypothesis`, `set_core_node_status`), which revalidate
 * tenant, assignment and write access inside the database and append the audit
 * row with the authenticated actor. The browser is never the gate and never the
 * source of the actor.
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
      return "Проверьте действие ревью и причину.";
    }
    if (err.code === "NOT_FOUND") {
      return "Сущность не найдена или недоступна для ревью.";
    }
    if (err.code === "CONFLICT") {
      return "Решение уже принято человеком: повторное решение недоступно.";
    }
  }
  return fallback;
}

function isThemeAction(value: string): value is ThemeReviewAction {
  return (THEME_REVIEW_ACTIONS as readonly string[]).includes(value);
}

function isHypothesisAction(value: string): value is HypothesisReviewAction {
  return (HYPOTHESIS_REVIEW_ACTIONS as readonly string[]).includes(value);
}

function field(formData: FormData, name: string): string {
  return String(formData.get(name) ?? "").trim();
}

/**
 * Verify that the entity belongs to the client before the RPC runs. RLS already
 * withholds foreign rows; this keeps the workspace from reviewing another
 * client's model through a forged hidden field.
 */
async function belongsToClient(
  supabase: Awaited<ReturnType<typeof createClient>>,
  table: "themes" | "differential_hypotheses" | "core_nodes",
  entityId: string,
  clientId: string
): Promise<boolean> {
  const { data, error } = await supabase
    .from(table)
    .select("id")
    .eq("id", entityId)
    .eq("client_id", clientId)
    .maybeSingle();
  return !error && Boolean(data);
}

export async function reviewThemeAction(
  _prev: ReviewActionState,
  formData: FormData
): Promise<ReviewActionState> {
  const clientId = field(formData, "clientId");
  const themeId = field(formData, "themeId");
  const decision = field(formData, "decision");
  const reason = field(formData, "reason");

  if (!clientId) return { error: CLIENT_REQUIRED };
  if (!themeId) return { error: "Тема не указана." };
  if (!isThemeAction(decision)) return { error: "Неизвестное действие ревью." };
  if (decision === "reject" && !reason) {
    return { error: "Для отклонения темы укажите причину." };
  }

  const loaded = await loadClient(clientId);
  if (!loaded) return { error: DENIED };
  if (!(await belongsToClient(loaded.supabase, "themes", themeId, clientId))) {
    return { error: "Тема не найдена или недоступна для ревью." };
  }

  try {
    await reviewTheme(
      loaded.supabase,
      loaded.client.organization_id,
      themeId,
      decision,
      reason || undefined
    );
  } catch (err) {
    return { error: messageFor(err, "Не удалось выполнить действие ревью.") };
  }

  revalidatePath(`/clients/${clientId}/review`);
  return { error: null };
}

export async function reviewHypothesisAction(
  _prev: ReviewActionState,
  formData: FormData
): Promise<ReviewActionState> {
  const clientId = field(formData, "clientId");
  const hypothesisId = field(formData, "hypothesisId");
  const decision = field(formData, "decision");
  const reason = field(formData, "reason");

  if (!clientId) return { error: CLIENT_REQUIRED };
  if (!hypothesisId) return { error: "Гипотеза не указана." };
  if (!isHypothesisAction(decision)) return { error: "Неизвестное действие ревью." };
  if (decision === "reject" && !reason) {
    return { error: "Для отклонения гипотезы укажите причину." };
  }

  const loaded = await loadClient(clientId);
  if (!loaded) return { error: DENIED };
  if (
    !(await belongsToClient(loaded.supabase, "differential_hypotheses", hypothesisId, clientId))
  ) {
    return { error: "Гипотеза не найдена или недоступна для ревью." };
  }

  try {
    await reviewHypothesis(
      loaded.supabase,
      loaded.client.organization_id,
      hypothesisId,
      decision,
      reason || undefined
    );
  } catch (err) {
    return { error: messageFor(err, "Не удалось выполнить действие ревью.") };
  }

  revalidatePath(`/clients/${clientId}/review`);
  return { error: null };
}

export async function reviewCoreNodeAction(
  _prev: ReviewActionState,
  formData: FormData
): Promise<ReviewActionState> {
  const clientId = field(formData, "clientId");
  const coreNodeId = field(formData, "coreNodeId");
  const decision = field(formData, "decision");

  if (!clientId) return { error: CLIENT_REQUIRED };
  if (!coreNodeId) return { error: "Узел не указан." };
  if (decision !== "approve" && decision !== "reject") {
    return { error: "Неизвестное действие ревью." };
  }

  const loaded = await loadClient(clientId);
  if (!loaded) return { error: DENIED };
  if (!(await belongsToClient(loaded.supabase, "core_nodes", coreNodeId, clientId))) {
    return { error: "Узел не найден или недоступен для ревью." };
  }

  try {
    if (decision === "approve") {
      await confirmCoreNode(loaded.supabase, loaded.client.organization_id, coreNodeId);
    } else {
      await rejectCoreNode(loaded.supabase, loaded.client.organization_id, coreNodeId);
    }
  } catch (err) {
    return { error: messageFor(err, "Не удалось выполнить действие ревью.") };
  }

  revalidatePath(`/clients/${clientId}/review`);
  return { error: null };
}
