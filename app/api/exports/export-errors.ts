import { ServiceError, type ErrorCode } from "@/lib/service/errors";

/**
 * HTTP error mapping for the export contract (ticket 22, docs §10).
 *
 * The export services report stable machine codes (`ServiceError.code`) and
 * English diagnostic messages. The route must answer a browser in Russian
 * without echoing a provider, Postgres or storage message, so every code is
 * translated here and `details` are never forwarded. The `code` stays stable, so
 * a caller can branch on it while the human-readable `message` stays safe.
 *
 *   VALIDATION_ERROR  400 — malformed request/body
 *   UNAUTHORIZED      401 — no session
 *   FORBIDDEN         403 — denied by access, audience or consent, or the
 *                          artifact is past its retention window (`unavailable`)
 *   NOT_FOUND         404 — unknown export id, or a missing artifact object
 *   CONFLICT          409 — the request expired while the bytes were being read
 *   INTERNAL_ERROR    500 — generation/delivery failure; internals never leak
 */
export const EXPORT_ERROR_MESSAGES: Record<ErrorCode, string> = {
  VALIDATION_ERROR: "Некорректный запрос экспорта.",
  UNAUTHORIZED: "Требуется вход в систему.",
  FORBIDDEN: "Экспорт недоступен: нет действующего доступа или согласия.",
  NOT_FOUND: "Экспорт не найден или больше недоступен.",
  CONFLICT: "Экспорт больше недоступен для скачивания.",
  RATE_LIMITED: "Слишком много запросов. Повторите позже.",
  DATABASE_UNAVAILABLE: "Сервис временно недоступен.",
  INTERNAL_ERROR: "Не удалось выполнить операцию с экспортом.",
};

/** One safe JSON error response for the export routes. */
export function toExportErrorResponse(err: unknown): Response {
  if (err instanceof ServiceError) {
    return Response.json(
      { error: { code: err.code, message: EXPORT_ERROR_MESSAGES[err.code] } },
      { status: err.status }
    );
  }

  // Unknown failures are masked: the caller learns the category, never the
  // underlying storage/provider/Postgres message.
  return Response.json(
    { error: { code: "INTERNAL_ERROR", message: EXPORT_ERROR_MESSAGES.INTERNAL_ERROR } },
    { status: 500 }
  );
}
