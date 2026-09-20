import { describe, expect, it } from "vitest";
import {
  INSUFFICIENT_DATA_LABEL,
  evidenceTrailHref,
  intervalDataLimits,
} from "@/lib/service/model-change-presentation";

/**
 * Ticket 14: the model-change interval read model never states more than the
 * stored data supports. These tests pin the Evidence Trail routing (only the
 * entity types the Evidence Drawer supports get a link) and the exact
 * insufficient-data wording for every interval shape.
 */

describe("evidenceTrailHref", () => {
  const clientId = "a0000000-0000-4000-8000-000000000001";
  const entityId = "a0000000-0000-4000-8000-000000000002";

  it("links the entity types the Evidence Drawer supports", () => {
    expect(evidenceTrailHref(clientId, "core_node", entityId)).toBe(
      `/clients/${clientId}/evidence/core_node/${entityId}`
    );
    expect(evidenceTrailHref(clientId, "theme", entityId)).toBe(
      `/clients/${clientId}/evidence/theme/${entityId}`
    );
    expect(evidenceTrailHref(clientId, "differential_hypothesis", entityId)).toBe(
      `/clients/${clientId}/evidence/differential_hypothesis/${entityId}`
    );
  });

  it("returns null for entity types without an Evidence Trail", () => {
    expect(evidenceTrailHref(clientId, "follow_up", entityId)).toBeNull();
    expect(evidenceTrailHref(clientId, "behavioral_marker", entityId)).toBeNull();
    expect(evidenceTrailHref(clientId, "correction", entityId)).toBeNull();
  });
});

describe("intervalDataLimits", () => {
  it("names the missing previous version", () => {
    const limits = intervalDataLimits({
      from: null,
      changeCount: 0,
      hypothesisCount: 0,
      contradictionCount: 0,
      hypothesesWithContradictingEvidence: 0,
    });
    expect(limits).toHaveLength(1);
    expect(limits[0]).toContain(INSUFFICIENT_DATA_LABEL);
    expect(limits[0]).toContain("нет предыдущей версии");
  });

  it("states insufficient data explicitly for an empty interval", () => {
    const limits = intervalDataLimits({
      from: "2026-01-01T00:00:00.000Z",
      changeCount: 0,
      hypothesisCount: 0,
      contradictionCount: 0,
      hypothesesWithContradictingEvidence: 0,
    });
    expect(limits[0]).toContain(INSUFFICIENT_DATA_LABEL);
    expect(limits[0]).toContain("DifferentialHypotheses");
    // The non-fabrication guarantee is always named.
    expect(limits.join(" ")).toContain("задним числом не восстанавливается");
  });

  it("names each missing collection on a partially filled interval", () => {
    const limits = intervalDataLimits({
      from: "2026-01-01T00:00:00.000Z",
      changeCount: 1,
      hypothesisCount: 0,
      contradictionCount: 0,
      hypothesesWithContradictingEvidence: 0,
    });
    expect(limits.join(" ")).toContain("DifferentialHypotheses");
    expect(limits.join(" ")).toContain("противоречия");
    expect(limits.join(" ")).not.toContain("ModelChange не зафиксировано");
  });

  it("adds no missing-collection note when the interval is complete", () => {
    const limits = intervalDataLimits({
      from: "2026-01-01T00:00:00.000Z",
      changeCount: 1,
      hypothesisCount: 2,
      contradictionCount: 1,
      hypothesesWithContradictingEvidence: 0,
    });
    expect(limits).toHaveLength(1);
    expect(limits[0]).toContain("задним числом не восстанавливается");
  });

  it("flags that per-hypothesis contradicting evidence is not version-bounded", () => {
    const limits = intervalDataLimits({
      from: "2026-01-01T00:00:00.000Z",
      changeCount: 1,
      hypothesisCount: 1,
      contradictionCount: 1,
      hypothesesWithContradictingEvidence: 1,
    });
    expect(limits.join(" ")).toContain("не имеют собственной метки времени");
  });
});
