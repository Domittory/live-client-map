import { describe, expect, it } from "vitest";
import { getHealthStatus, SERVICE_NAME, SERVICE_VERSION } from "@/lib/health";

describe("getHealthStatus", () => {
  it("reports the service as ready", () => {
    expect(getHealthStatus("ok")).toEqual({
      status: "ok",
      service: SERVICE_NAME,
      version: SERVICE_VERSION,
      database: "ok",
    });
  });

  it("defaults database to unavailable when not provided", () => {
    expect(getHealthStatus().database).toBe("unavailable");
  });

  it("exposes no business data or secrets", () => {
    const status = getHealthStatus();
    expect(Object.keys(status).sort()).toEqual(["database", "service", "status", "version"]);
  });
});
