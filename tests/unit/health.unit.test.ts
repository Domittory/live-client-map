import { describe, expect, it } from "vitest";
import {
  getHealthStatus,
  getServiceBuild,
  parseHealthStatus,
  SERVICE_NAME,
  SERVICE_VERSION,
} from "@/lib/health";

describe("getHealthStatus", () => {
  it("reports the service as ready", () => {
    expect(getHealthStatus("ok", "abc123")).toEqual({
      status: "ok",
      service: SERVICE_NAME,
      version: SERVICE_VERSION,
      build: "abc123",
      database: "ok",
    });
  });

  it("defaults database to unavailable when not provided", () => {
    expect(getHealthStatus().database).toBe("unavailable");
  });

  it("exposes no business data or secrets", () => {
    const status = getHealthStatus("ok", "abc123");
    expect(Object.keys(status).sort()).toEqual([
      "build",
      "database",
      "service",
      "status",
      "version",
    ]);
  });
});

describe("getServiceBuild", () => {
  it("reports the release identifier when the environment provides one", () => {
    expect(getServiceBuild({ RELEASE_ID: "  commit-sha  " })).toBe("commit-sha");
  });

  it("falls back to dev outside a release", () => {
    expect(getServiceBuild({})).toBe("dev");
    expect(getServiceBuild({ RELEASE_ID: "   " })).toBe("dev");
  });
});

describe("parseHealthStatus", () => {
  const valid = {
    status: "ok",
    service: SERVICE_NAME,
    version: SERVICE_VERSION,
    build: "abc123",
    database: "ok",
  };

  it("accepts a complete readiness payload", () => {
    expect(parseHealthStatus(valid)).toEqual(valid);
  });

  it("rejects a payload without a build identifier", () => {
    const { build, ...withoutBuild } = valid;
    void build;
    expect(() => parseHealthStatus(withoutBuild)).toThrow(/build identifier/);
  });

  it("rejects a foreign payload that only looks like readiness", () => {
    expect(() => parseHealthStatus({ status: "ok" })).toThrow(/service identity/);
    expect(() => parseHealthStatus("<html>not json</html>")).toThrow(/JSON object/);
  });
});
