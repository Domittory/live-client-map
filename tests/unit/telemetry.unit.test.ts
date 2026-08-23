import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ALERT_RULES,
  TELEMETRY_RETENTION_DAYS,
  incrementCounter,
  observeHistogram,
  redactTelemetry,
  renderPrometheus,
  resetMetrics,
  sanitizePath,
  withTelemetry,
} from "@/lib/telemetry";

describe("redactTelemetry", () => {
  it("redacts sensitive keys at any depth", () => {
    const clean = redactTelemetry({
      password: "hunter2",
      nested: { api_key: "sk-x", list: [{ refresh_token: "r" }] },
      ok: "kept",
    }) as Record<string, unknown>;
    expect(clean.password).toBe("[redacted]");
    expect(clean.ok).toBe("kept");
    expect(JSON.stringify(clean)).not.toContain("hunter2");
    expect(JSON.stringify(clean)).not.toContain("sk-x");
    expect(JSON.stringify(clean)).not.toContain('"r"');
  });

  it("passes scalars and non-sensitive values through", () => {
    expect(redactTelemetry("text")).toBe("text");
    expect(redactTelemetry(42)).toBe(42);
    expect(redactTelemetry(null)).toBeNull();
    expect(redactTelemetry({ name: "Иван", status: "ok" })).toEqual({
      name: "Иван",
      status: "ok",
    });
  });
});

describe("sanitizePath", () => {
  it("replaces UUID and numeric segments with a placeholder", () => {
    expect(
      sanitizePath("/api/behavioral-markers/123e4567-e89b-12d3-a456-426614174000/values")
    ).toBe("/api/behavioral-markers/<id>/values");
    expect(sanitizePath("/api/clients/42")).toBe("/api/clients/<id>");
  });

  it("leaves static paths unchanged", () => {
    expect(sanitizePath("/api/health")).toBe("/api/health");
  });
});

describe("metrics", () => {
  beforeEach(() => resetMetrics());

  it("renders labeled counters in Prometheus text format", () => {
    incrementCounter("ai_run_total", "AI runs", { status: "succeeded" });
    incrementCounter("ai_run_total", "AI runs", { status: "succeeded" });
    incrementCounter("ai_run_total", "AI runs", { status: "blocked_consent" });
    const out = renderPrometheus();
    expect(out).toContain("# TYPE ai_run_total counter");
    expect(out).toContain('ai_run_total{status="succeeded"} 2');
    expect(out).toContain('ai_run_total{status="blocked_consent"} 1');
  });

  it("renders histograms with buckets, sum and count", () => {
    observeHistogram("latency_ms", "latency", [100, 1000], 150);
    const out = renderPrometheus();
    expect(out).toContain('latency_ms_bucket{le="100"} 0');
    expect(out).toContain('latency_ms_bucket{le="1000"} 1');
    expect(out).toContain('latency_ms_bucket{le="+Inf"} 1');
    expect(out).toContain("latency_ms_sum 150");
    expect(out).toContain("latency_ms_count 1");
  });

  it("resetMetrics clears every metric", () => {
    incrementCounter("x_total", "x");
    resetMetrics();
    expect(renderPrometheus()).toBe("");
  });
});

describe("alerts", () => {
  it("every rule has owner, severity and response guidance", () => {
    expect(ALERT_RULES.length).toBeGreaterThan(0);
    for (const rule of ALERT_RULES) {
      expect(rule.owner).toBeTruthy();
      expect(["critical", "warning"]).toContain(rule.severity);
      expect(rule.trigger).toBeTruthy();
      expect(rule.guidance).toBeTruthy();
    }
  });

  it("telemetry retention is fixed by policy", () => {
    expect(TELEMETRY_RETENTION_DAYS).toBe(30);
  });
});

describe("withTelemetry (synthetic failure)", () => {
  beforeEach(() => resetMetrics());

  it("maps a thrown error to a safe response with a correlation id", async () => {
    const handler = withTelemetry(async () => {
      throw new Error("db password=hunter2");
    });
    const res = await handler(
      new Request("http://localhost/api/clients/123e4567-e89b-12d3-a456-426614174000")
    );
    expect(res.status).toBe(500);
    expect(res.headers.get("x-request-id")).toBeTruthy();
    const body = await res.json();
    expect(body.error.message).toBe("Internal server error");
    expect(JSON.stringify(body)).not.toContain("hunter2");
  });

  it("increments http_error_total and sanitizes the logged path", async () => {
    const handler = withTelemetry(async () => {
      throw new Error("boom");
    });
    await handler(new Request("http://localhost/api/clients/123e4567-e89b-12d3-a456-426614174000"));
    const out = renderPrometheus();
    expect(out).toContain("http_error_total");
    // The entity id must never appear in telemetry.
    expect(out).not.toContain("123e4567-e89b-12d3-a456-426614174000");
    expect(out).toContain('path="/api/clients/<id>"');
  });

  it("never writes raw error messages or secrets to the log", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const handler = withTelemetry(async () => {
        throw new Error("db password=hunter2");
      });
      await handler(new Request("http://localhost/api/test"));
      const logged = spy.mock.calls.map((call) => call.join(" ")).join("\n");
      expect(logged).toContain("Internal server error");
      expect(logged).not.toContain("hunter2");
    } finally {
      spy.mockRestore();
    }
  });
});
