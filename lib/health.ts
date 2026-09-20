export type DatabaseStatus = "ok" | "unavailable";

export interface HealthStatus {
  status: "ok";
  service: string;
  version: string;
  build: string;
  database: DatabaseStatus;
}

export const SERVICE_NAME = "living-client-map";
export const SERVICE_VERSION = "0.1.0";

/**
 * Release identifier of the running build (ticket 02). A deployed release sets
 * RELEASE_ID to the exact commit it was built from; every other environment
 * reports "dev". The readiness contract exposes it so a harness can prove it is
 * talking to the intended instance instead of accepting any HTTP response on a
 * common port.
 */
export function getServiceBuild(env: Record<string, string | undefined> = process.env): string {
  const build = env.RELEASE_ID ?? "";
  return build.trim().length > 0 ? build.trim() : "dev";
}

export function getHealthStatus(
  database: DatabaseStatus = "unavailable",
  build: string = getServiceBuild()
): HealthStatus {
  return {
    status: "ok",
    service: SERVICE_NAME,
    version: SERVICE_VERSION,
    build,
    database,
  };
}

/**
 * Strict readiness-contract parser shared by smoke checks and the E2E harness.
 * Throws with a diagnostic instead of returning a partially valid payload, so a
 * foreign service that happens to answer on the port cannot pass as this app.
 */
export function parseHealthStatus(value: unknown): HealthStatus {
  if (value === null || typeof value !== "object") {
    throw new Error("readiness payload is not a JSON object");
  }

  const record = value as Record<string, unknown>;
  const { status, service, version, build, database } = record;

  if (status !== "ok") {
    throw new Error(`readiness status is ${JSON.stringify(status)}, expected "ok"`);
  }
  if (typeof service !== "string" || service.length === 0) {
    throw new Error("readiness payload is missing the service identity");
  }
  if (typeof version !== "string" || version.length === 0) {
    throw new Error("readiness payload is missing the version");
  }
  if (typeof build !== "string" || build.length === 0) {
    throw new Error("readiness payload is missing the build identifier");
  }
  if (database !== "ok" && database !== "unavailable") {
    throw new Error(
      `readiness payload has an invalid database status: ${JSON.stringify(database)}`
    );
  }

  return { status: "ok", service, version, build, database };
}
