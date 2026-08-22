import { describe, expect, it } from "vitest";
import { GET } from "@/app/api/health/route";

describe("GET /api/health", () => {
  it("returns HTTP 200 and reports readiness", async () => {
    const response = await GET();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");

    const body = await response.json();
    expect(body.status).toBe("ok");
    expect(body.service).toBe("living-client-map");
    expect(body.version).toBe("0.1.0");
    // No Supabase environment in this test, so the DB probe reports unavailable.
    expect(body.database).toBe("unavailable");
  });

  it("does not leak secrets", async () => {
    const response = await GET();
    const body = await response.json();
    expect(JSON.stringify(body)).not.toMatch(/service_role|secret|password/i);
  });
});
