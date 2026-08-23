import { randomUUID } from "node:crypto";
import { ServiceError, toErrorResponse } from "@/lib/service/errors";
import { runWithCorrelationId } from "./context";
import { emitLog } from "./logger";
import { incrementCounter, observeHistogram } from "./metrics";
import { sanitizePath } from "./redact";

/**
 * Route-handler wrapper (ticket 62). Generates a fresh, safe correlation id per
 * request, runs the handler inside that telemetry context, records request
 * duration/status, and maps any thrown error to a safe JSON response. The
 * correlation id is returned in the `x-request-id` header so a support engineer
 * can join a user report to the structured logs. The logged path is sanitized so
 * entity ids never reach telemetry.
 */
export function withTelemetry(handler: (request: Request) => Promise<Response>) {
  return async (request: Request): Promise<Response> => {
    const correlationId = randomUUID();
    const method = request.method;
    const path = sanitizePath(new URL(request.url).pathname);
    const startedAt = Date.now();

    return runWithCorrelationId(correlationId, async () => {
      try {
        const response = await handler(request);
        const durationMs = Date.now() - startedAt;
        response.headers.set("x-request-id", correlationId);
        observeHistogram(
          "http_request_duration_ms",
          "HTTP request latency in milliseconds",
          [50, 200, 500, 1000, 5000],
          durationMs
        );
        incrementCounter("http_response_total", "HTTP responses by status class", {
          status_class: `${Math.floor(response.status / 100)}xx`,
          method,
          path,
        });
        return response;
      } catch (err) {
        const durationMs = Date.now() - startedAt;
        incrementCounter("http_error_total", "HTTP handler errors", { method, path });
        // Mirror toErrorResponse: log only a typed, safe error representation so
        // raw messages (which may contain secrets or prompts) never reach logs.
        emitLog("error", "http_handler_error", {
          method,
          path,
          error:
            err instanceof ServiceError
              ? { code: err.code, message: err.message }
              : { code: "INTERNAL_ERROR", message: "Internal server error" },
          duration_ms: durationMs,
        });
        const response = toErrorResponse(err);
        response.headers.set("x-request-id", correlationId);
        return response;
      }
    });
  };
}
