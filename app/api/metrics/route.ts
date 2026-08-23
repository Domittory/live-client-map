import { renderPrometheus } from "@/lib/telemetry";

/**
 * Prometheus text exposition endpoint (ticket 62). Aggregate counters/histograms
 * only — no labels carry client or organization identifiers. In production this
 * endpoint should be firewalled to the internal collector; it exposes no raw
 * psychological data.
 */
export async function GET(): Promise<Response> {
  return new Response(renderPrometheus(), {
    headers: {
      "content-type": "text/plain; version=0.0.4; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
