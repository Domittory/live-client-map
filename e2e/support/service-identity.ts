import { parseHealthStatus, SERVICE_NAME, type HealthStatus } from "../../lib/health";

export interface ExpectedIdentity {
  service?: string;
  /** Per-run build id; when set, a mismatch means a different instance. */
  build?: string;
}

/** Fetch and strictly parse the readiness contract of `baseUrl`. */
export async function fetchHealth(baseUrl: string, timeoutMs = 10_000): Promise<HealthStatus> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(new URL("/api/health", baseUrl), { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`GET /api/health returned HTTP ${response.status}`);
    }
    return parseHealthStatus(await response.json());
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Assert that a readiness payload belongs to the expected application build.
 * Throws an actionable diagnostic — never silently accepts a look-alike service.
 */
export function assertServiceIdentity(health: HealthStatus, expected: ExpectedIdentity = {}): void {
  const expectedService = expected.service ?? SERVICE_NAME;

  if (health.service !== expectedService) {
    throw new Error(
      `Service identity mismatch: expected "${expectedService}", got "${health.service}" ` +
        `(version ${health.version}, build ${health.build}).`
    );
  }

  if (expected.build !== undefined && health.build !== expected.build) {
    throw new Error(
      `Build identity mismatch: expected "${expected.build}", got "${health.build}". ` +
        "The harness is talking to a different instance of the application."
    );
  }
}

/**
 * Human-readable description of whatever answers on a port, used when the
 * harness must explain why it refused to start. Best-effort: never throws.
 */
export async function describeOccupant(baseUrl: string, timeoutMs = 2_000): Promise<string> {
  try {
    const response = await fetch(new URL("/api/health", baseUrl), {
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await response.text();

    try {
      const body = JSON.parse(text) as Record<string, unknown>;
      const identity = [body.service, body.version, body.build].filter(
        (part) => typeof part === "string" && part.length > 0
      );
      if (identity.length > 0) {
        return `service "${identity.join('" version "')}" (HTTP ${response.status})`;
      }
    } catch {
      // not JSON — fall through to the generic description
    }

    return `an unidentified process answering HTTP ${response.status}`;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return `an unidentified process (${detail})`;
  }
}
