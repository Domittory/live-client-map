"use server";

import { revalidatePath } from "next/cache";
import { FakeAiProvider, OpenAiResponsesProvider, type AiProvider } from "@/lib/ai/provider";
import { getServerEnv } from "@/lib/env";
import { getClient } from "@/lib/service/clients";
import { ServiceError } from "@/lib/service/errors";
import {
  RECOMMENDATION_REVIEW_ACTIONS,
  generateClientRecommendations,
  reviewRecommendation,
  setRecommendationVisibility,
  type RecommendationReviewAction,
} from "@/lib/service/recommendations";
import { createClient } from "@/lib/supabase/server";

export type RecommendationsActionState = { error: string | null; message: string | null };

/**
 * Client-context Recommendation actions (ticket 13).
 *
 * Generation runs through the existing AI service, which persists every
 * proposal as an internal `draft` (migration 0042) — this action can never
 * approve or publish anything. Review and visibility are separate, explicit
 * human actions on exactly one Recommendation, and both are re-checked inside
 * the database (migration 0048): the browser is never the gate.
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

/** Same provider resolution as app/actions/import.ts (ticket 32). */
function resolveProvider(): AiProvider {
  const env = getServerEnv();
  if (env.AI_PROVIDER === "openai" && env.OPENAI_API_KEY) {
    return new OpenAiResponsesProvider(env.OPENAI_API_KEY);
  }
  return new FakeAiProvider();
}

const GENERATE_FAILURES: Array<{ needle: string; message: string }> = [
  {
    needle: "ai_analysis",
    message:
      "Нет действующего согласия на AI-анализ: сначала зафиксируйте согласие клиента в разделе «Согласия».",
  },
  {
    needle: "ontology",
    message: "Нет активной версии онтологии: AI-запуск невозможен до её активации.",
  },
  {
    needle: "disabled in production",
    message: "AI отключён в production до отдельного решения о провайдере и регионе данных.",
  },
];

function messageFor(err: unknown, fallback: string): string {
  if (err instanceof ServiceError) {
    if (err.code === "FORBIDDEN") {
      return "Недостаточно прав: нет права записи по этому клиенту.";
    }
    if (err.code === "VALIDATION_ERROR") {
      return "Проверьте заполненные поля и допустимые значения.";
    }
    if (err.code === "CONFLICT") {
      return "Решение уже принято человеком: повторное решение недоступно.";
    }
    if (err.code === "RATE_LIMITED") {
      return "Превышен лимит AI-запросов для организации: попробуйте позже.";
    }
    for (const failure of GENERATE_FAILURES) {
      if (err.message.includes(failure.needle)) return failure.message;
    }
  }
  return fallback;
}

function field(formData: FormData, name: string): string {
  return String(formData.get(name) ?? "").trim();
}

function isReviewAction(value: string): value is RecommendationReviewAction {
  return (RECOMMENDATION_REVIEW_ACTIONS as readonly string[]).includes(value);
}

export async function generateRecommendationsAction(
  _prev: RecommendationsActionState,
  formData: FormData
): Promise<RecommendationsActionState> {
  const clientId = field(formData, "clientId");
  if (!clientId) return { error: CLIENT_REQUIRED, message: null };

  const loaded = await loadClient(clientId);
  if (!loaded) return { error: DENIED, message: null };

  try {
    const ids = await generateClientRecommendations(loaded.supabase, resolveProvider(), {
      organizationId: loaded.client.organization_id,
      clientId,
    });
    revalidatePath(`/clients/${clientId}/recommendations`);
    if (ids.length === 0) {
      return {
        error: null,
        message:
          "AI не предложил новых рекомендаций: либо подтверждённых данных и рассчитанных оценок недостаточно (состояние «недостаточно данных», а не вывод), либо предложения по этим же данным уже сформированы ранее.",
      };
    }
    return {
      error: null,
      message: `AI предложил рекомендаций: ${ids.length}. Все они сохранены как черновики и ждут ревью человека.`,
    };
  } catch (err) {
    return {
      error: messageFor(err, "Не удалось сформировать рекомендации."),
      message: null,
    };
  }
}

export async function reviewRecommendationAction(
  _prev: RecommendationsActionState,
  formData: FormData
): Promise<RecommendationsActionState> {
  const clientId = field(formData, "clientId");
  const recommendationId = field(formData, "recommendationId");
  const decision = field(formData, "decision");
  const reason = field(formData, "reason");

  if (!clientId) return { error: CLIENT_REQUIRED, message: null };
  if (!recommendationId) return { error: "Рекомендация не указана.", message: null };
  if (!isReviewAction(decision)) return { error: "Неизвестное действие ревью.", message: null };
  if (decision === "reject" && !reason) {
    return { error: "Для отклонения рекомендации укажите причину.", message: null };
  }

  const loaded = await loadClient(clientId);
  if (!loaded) return { error: DENIED, message: null };

  try {
    await reviewRecommendation(loaded.supabase, loaded.client.organization_id, {
      id: recommendationId,
      decision,
      reason: reason || null,
    });
  } catch (err) {
    return {
      error: messageFor(err, "Не удалось выполнить решение по рекомендации."),
      message: null,
    };
  }

  revalidatePath(`/clients/${clientId}/recommendations`);
  return { error: null, message: null };
}

export async function setRecommendationVisibilityAction(
  _prev: RecommendationsActionState,
  formData: FormData
): Promise<RecommendationsActionState> {
  const clientId = field(formData, "clientId");
  const recommendationId = field(formData, "recommendationId");
  const visibility = field(formData, "visibility");
  const reason = field(formData, "reason");

  if (!clientId) return { error: CLIENT_REQUIRED, message: null };
  if (!recommendationId) return { error: "Рекомендация не указана.", message: null };
  if (visibility !== "internal" && visibility !== "client_visible") {
    return { error: "Неизвестное значение видимости.", message: null };
  }

  const loaded = await loadClient(clientId);
  if (!loaded) return { error: DENIED, message: null };

  try {
    await setRecommendationVisibility(loaded.supabase, loaded.client.organization_id, {
      id: recommendationId,
      visibility,
      reason: reason || null,
    });
  } catch (err) {
    if (err instanceof ServiceError && err.code === "VALIDATION_ERROR") {
      return {
        error:
          "Опубликовать клиенту можно только подтверждённую человеком рекомендацию без высокого риска.",
        message: null,
      };
    }
    if (err instanceof ServiceError && err.code === "FORBIDDEN") {
      return {
        error:
          "Публикация недоступна: нет права записи по клиенту или не выполнено условие (например, согласие клиента на портал).",
        message: null,
      };
    }
    return {
      error: messageFor(err, "Не удалось изменить видимость рекомендации."),
      message: null,
    };
  }

  revalidatePath(`/clients/${clientId}/recommendations`);
  return { error: null, message: null };
}
