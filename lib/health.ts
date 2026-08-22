export type DatabaseStatus = "ok" | "unavailable";

export interface HealthStatus {
  status: "ok";
  service: string;
  version: string;
  database: DatabaseStatus;
}

export const SERVICE_NAME = "living-client-map";
export const SERVICE_VERSION = "0.1.0";

export function getHealthStatus(database: DatabaseStatus = "unavailable"): HealthStatus {
  return {
    status: "ok",
    service: SERVICE_NAME,
    version: SERVICE_VERSION,
    database,
  };
}
