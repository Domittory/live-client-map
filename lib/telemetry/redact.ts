/**
 * Telemetry redaction (ticket 62). Structured logs and metrics must never carry
 * raw psychological data or secrets, so every field that reaches the logger is
 * sanitized first. Keys matching a sensitive pattern are replaced wholesale;
 * scalar values pass through; nested objects/arrays are walked to a fixed depth
 * to bound recursion.
 */

const SENSITIVE_KEY =
  /pass(word)?|secret|token|api[-_]?key|authorization|bearer|cookie|session|refresh[-_]?token|private[-_]?key|credential/i;

const MAX_DEPTH = 8;

const UUID = /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/g;

/**
 * Recursively redact sensitive keys. Never throws — on any failure it returns a
 * safe placeholder rather than the original (possibly sensitive) value.
 */
export function redactTelemetry(value: unknown, depth = 0): unknown {
  try {
    if (value === null || value === undefined) return value;
    if (typeof value !== "object") return value;
    if (depth > MAX_DEPTH) return "[max-depth]";

    if (Array.isArray(value)) {
      return value.map((item) => redactTelemetry(item, depth + 1));
    }

    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEY.test(key)) {
        out[key] = "[redacted]";
      } else {
        out[key] = redactTelemetry(entry, depth + 1);
      }
    }
    return out;
  } catch {
    return "[redacted]";
  }
}

/**
 * Sanitize a request path for logging: entity ids are UUIDs in this codebase,
 * so a raw path like `/api/behavioral-markers/<uuid>/values` would leak a client
 * identifier. Replace UUIDs and numeric segments with a placeholder so the route
 * shape stays visible without exposing any id.
 */
export function sanitizePath(path: string): string {
  return path
    .replace(UUID, "<id>")
    .replace(/\/\d+\//g, "/<id>/")
    .replace(/\/\d+$/g, "/<id>");
}
