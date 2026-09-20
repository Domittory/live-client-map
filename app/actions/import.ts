"use server";

import { revalidatePath } from "next/cache";
import {
  FakeAiProvider,
  FakeImportAiProvider,
  OpenAiResponsesProvider,
  type AiProvider,
} from "@/lib/ai/provider";
import { getServerEnv } from "@/lib/env";
import { getClient, type ClientRow } from "@/lib/service/clients";
import { ServiceError } from "@/lib/service/errors";
import {
  commitImportSelection,
  previewSignalsCsv,
  previewSignalsJson,
  previewTextImport,
  type ImportReport,
} from "@/lib/service/import";
import { createClient } from "@/lib/supabase/server";

/**
 * Client-context import mutations (ticket 11).
 *
 * The client is resolved through RLS first, so an unassigned or foreign caller
 * receives the same neutral denial as a missing client. The organization comes
 * from the client row and the atomic RPCs revalidate tenant, assignment and
 * write access inside the database — the browser is never the gate.
 *
 * Preview stages the source, its DiagnosticSession and the validation report
 * without creating a Signal. Commit turns ONLY the explicitly checked candidates
 * into pending Signals; human review stays the only way to confirm evidence.
 */

const DENIED = "Клиент недоступен или у вас нет прав.";
const CLIENT_REQUIRED = "Клиент не указан.";

/**
 * Supported formats. A "use server" module may only export async functions, so
 * this list stays internal; the UI keeps its own Russian label map.
 */
const IMPORT_FORMATS = [
  "plain_text",
  "markdown",
  "chatgpt_analysis",
  "signals_csv",
  "signals_json",
] as const;

export interface ImportPreviewState {
  error: string | null;
  report: ImportReport | null;
}

export interface ImportCommitState {
  error: string | null;
  report: ImportReport | null;
  message: string | null;
}

async function loadClient(clientId: string): Promise<{
  supabase: Awaited<ReturnType<typeof createClient>>;
  client: ClientRow;
} | null> {
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

/** Same provider resolution as app/api/ai/run/route.ts (ticket 32). */
function resolveProvider(): AiProvider {
  const env = getServerEnv();
  if (env.AI_PROVIDER === "openai" && env.OPENAI_API_KEY) {
    return new OpenAiResponsesProvider(env.OPENAI_API_KEY);
  }
  // Dev/E2E only: the plain fake returns no ingest candidates, which would make
  // the text preview impossible to exercise outside production AI. In a
  // production build the inert fake is kept instead: the environment gate
  // already disables AI there, and this guarantees a fake provider can never
  // fabricate evidence for a real client even if production AI were enabled.
  if (process.env.NODE_ENV === "production") return new FakeAiProvider();
  return new FakeImportAiProvider();
}

/** Container-level failure codes mapped to a safe, specific Russian message. */
const CONTAINER_ERROR_MESSAGES: Record<string, string> = {
  empty_content: "Текст пустой: добавьте содержимое для импорта.",
  size_limit_exceeded: "Содержимое превышает допустимый размер импорта.",
  missing_header: "CSV не соответствует контракту: неверный или отсутствующий header.",
  unsupported_version: "Версия контракта не поддерживается.",
  malformed_json: "JSON не разобран: проверьте синтаксис файла.",
  conflicting_idempotency_key:
    "Этот ключ идемпотентности уже использован с другим содержимым — загрузите файл заново.",
  conflicting_commit_selection:
    "Импорт уже закоммичен с другим набором кандидатов. Повторите загрузку с новым файлом.",
};

function messageFor(err: unknown, fallback: string): string {
  if (err instanceof ServiceError) {
    if (err.code === "FORBIDDEN") {
      return "Недостаточно прав: нет права записи по этому клиенту.";
    }
    if (err.code === "VALIDATION_ERROR" || err.code === "CONFLICT") {
      return CONTAINER_ERROR_MESSAGES[err.message] ?? fallback;
    }
    if (err.code === "NOT_FOUND") {
      return "Импорт не найден или недоступен.";
    }
  }
  return fallback;
}

function isImportFormat(value: string): value is (typeof IMPORT_FORMATS)[number] {
  return (IMPORT_FORMATS as readonly string[]).includes(value);
}

function optional(formData: FormData, name: string): string | null {
  const value = String(formData.get(name) ?? "").trim();
  return value.length > 0 ? value : null;
}

/** A missing client-side key falls back to a server-generated one. */
function idempotencyKey(formData: FormData): string {
  const provided = optional(formData, "idempotencyKey");
  if (provided && provided.length >= 16 && provided.length <= 128) return provided;
  return crypto.randomUUID();
}

export async function previewImportAction(
  _prev: ImportPreviewState,
  formData: FormData
): Promise<ImportPreviewState> {
  const clientId = String(formData.get("clientId") ?? "").trim();
  if (!clientId) return { error: CLIENT_REQUIRED, report: null };

  const format = String(formData.get("format") ?? "").trim();
  if (!isImportFormat(format)) return { error: "Выберите поддерживаемый формат.", report: null };

  const content = String(formData.get("content") ?? "");
  if (content.trim().length === 0) {
    return { error: "Добавьте содержимое для импорта.", report: null };
  }

  const loaded = await loadClient(clientId);
  if (!loaded) return { error: DENIED, report: null };

  const base = {
    organizationId: loaded.client.organization_id,
    clientId,
    content,
    title: optional(formData, "title"),
    idempotencyKey: idempotencyKey(formData),
  };

  try {
    let report: ImportReport;
    if (format === "signals_csv") {
      report = await previewSignalsCsv(loaded.supabase, base);
    } else if (format === "signals_json") {
      report = await previewSignalsJson(loaded.supabase, base);
    } else {
      report = await previewTextImport(loaded.supabase, resolveProvider(), {
        ...base,
        inputFormat: format,
      });
    }
    return { error: null, report };
  } catch (err) {
    return { error: messageFor(err, "Не удалось разобрать импорт."), report: null };
  }
}

export async function commitImportSelectionAction(
  _prev: ImportCommitState,
  formData: FormData
): Promise<ImportCommitState> {
  const clientId = String(formData.get("clientId") ?? "").trim();
  if (!clientId) return { error: CLIENT_REQUIRED, report: null, message: null };

  const importId = String(formData.get("importId") ?? "").trim();
  if (!importId) return { error: "Импорт не указан.", report: null, message: null };

  const selectedExternalIds = formData
    .getAll("selected")
    .map((value) => String(value))
    .filter((value) => value.length > 0);
  if (selectedExternalIds.length === 0) {
    return { error: "Выберите хотя бы одного кандидата для commit.", report: null, message: null };
  }

  const loaded = await loadClient(clientId);
  if (!loaded) return { error: DENIED, report: null, message: null };

  try {
    const report = await commitImportSelection(loaded.supabase, {
      organizationId: loaded.client.organization_id,
      clientId,
      importId,
      selectedExternalIds,
    });
    revalidatePath(`/clients/${clientId}/import`);
    revalidatePath(`/clients/${clientId}/diagnostics`);
    return {
      error: null,
      report,
      message: `Закоммичено сигналов: ${report.counts.committed ?? 0}. Они ожидают ревью.`,
    };
  } catch (err) {
    return {
      error: messageFor(err, "Не удалось закоммитить выбранные кандидаты."),
      report: null,
      message: null,
    };
  }
}
