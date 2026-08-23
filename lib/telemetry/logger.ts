import { getCorrelationId } from "./context";
import { redactTelemetry } from "./redact";

/**
 * Structured JSON logger (ticket 62). One JSON object per line on stdout, so a
 * log collector can parse it. Every field is redacted before it is written, and
 * a request-scoped correlation id is attached when present. Operational
 * telemetry is intentionally separate from the business AuditLog (ticket 14).
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

export const SERVICE_NAME = "living-client-map";
export const SERVICE_VERSION = "0.1.0";

export interface LogFields {
  [key: string]: unknown;
}

export function emitLog(level: LogLevel, event: string, fields: LogFields = {}): void {
  const correlationId = getCorrelationId();
  const entry: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    level,
    service: SERVICE_NAME,
    version: SERVICE_VERSION,
    event,
    ...(correlationId ? { correlation_id: correlationId } : {}),
  };

  // Redacted fields are merged after the fixed envelope so a sensitive field can
  // never overwrite a trusted one (e.g. a payload key literally named "event").
  const safe = redactTelemetry(fields);
  Object.assign(entry, safe);

  const line = JSON.stringify(entry);
  if (level === "error") {
    console.error(line);
  } else if (level === "warn") {
    console.warn(line);
  } else if (level === "info") {
    console.log(line);
  }
  // "debug" is dropped: it is a no-op unless a debug flag is enabled.
}
