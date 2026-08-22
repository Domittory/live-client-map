import { describe, expect, it } from "vitest";
import {
  computeTrend,
  createMarkerSchema,
  createObservationSchema,
  isValueInScale,
  recordMarkerValueSchema,
  updateMarkerSchema,
  updateObservationSchema,
} from "@/lib/service/observations";

const validObservation = {
  organizationId: "a0000000-0000-4000-8000-000000000001",
  clientId: "a0000000-0000-4000-8000-000000000002",
  sourceType: "specialist_observation" as const,
  description: "Клиент спокойнее говорит о работе",
  lifeAreas: ["работа"],
  valence: "positive" as const,
  intensity: 6,
  supportsImprovement: true,
  confidence: 70,
  visibility: "private" as const,
};

const validMarker = {
  organizationId: "a0000000-0000-4000-8000-000000000001",
  clientId: "a0000000-0000-4000-8000-000000000002",
  name: "Количество конфликтов в неделю",
  markerType: "frequency" as const,
  scaleMin: 0,
  scaleMax: 10,
  baselineValue: 5,
};

describe("Observation schemas (ticket 40)", () => {
  it("accepts a valid observation", () => {
    expect(createObservationSchema.parse(validObservation)).toBeDefined();
  });

  it("accepts an optional correction reference", () => {
    expect(
      createObservationSchema.parse({
        ...validObservation,
        correctionId: "a0000000-0000-4000-8000-000000000003",
      })
    ).toBeDefined();
  });

  it("rejects intensity outside 1–10", () => {
    expect(() => createObservationSchema.parse({ ...validObservation, intensity: 0 })).toThrow();
    expect(() => createObservationSchema.parse({ ...validObservation, intensity: 11 })).toThrow();
  });

  it("rejects non-integer intensity", () => {
    expect(() => createObservationSchema.parse({ ...validObservation, intensity: 5.5 })).toThrow();
  });

  it("rejects confidence outside 0–100", () => {
    expect(() => createObservationSchema.parse({ ...validObservation, confidence: -1 })).toThrow();
    expect(() => createObservationSchema.parse({ ...validObservation, confidence: 101 })).toThrow();
  });

  it("rejects an unsupported source_type", () => {
    expect(() =>
      createObservationSchema.parse({ ...validObservation, sourceType: "guess" })
    ).toThrow();
  });

  it("rejects an unsupported valence", () => {
    expect(() =>
      createObservationSchema.parse({ ...validObservation, valence: "mixed" })
    ).toThrow();
  });

  it("rejects an unsupported visibility", () => {
    expect(() =>
      createObservationSchema.parse({ ...validObservation, visibility: "public" })
    ).toThrow();
  });

  it("rejects non-boolean supports_improvement", () => {
    expect(() =>
      createObservationSchema.parse({ ...validObservation, supportsImprovement: "yes" })
    ).toThrow();
  });

  it("defaults visibility to private and lifeAreas to empty", () => {
    const rest: Record<string, unknown> = { ...validObservation };
    delete rest.lifeAreas;
    delete rest.visibility;
    const parsed = createObservationSchema.parse(rest);
    expect(parsed.visibility).toBe("private");
    expect(parsed.lifeAreas).toEqual([]);
  });

  it("accepts a valid observation update", () => {
    expect(
      updateObservationSchema.parse({
        observationId: "a0000000-0000-4000-8000-000000000004",
        visibility: "client_visible",
        intensity: 3,
      })
    ).toBeDefined();
  });
});

describe("BehavioralMarker schemas (ticket 40)", () => {
  it("accepts a valid marker with one link of each allowed type", () => {
    expect(
      createMarkerSchema.parse({
        ...validMarker,
        linkedCoreNodeId: "a0000000-0000-4000-8000-000000000005",
        linkedThemeId: "a0000000-0000-4000-8000-000000000006",
        linkedResourceId: "a0000000-0000-4000-8000-000000000007",
      })
    ).toBeDefined();
  });

  it("rejects scaleMin >= scaleMax", () => {
    expect(() =>
      createMarkerSchema.parse({ ...validMarker, scaleMin: 10, scaleMax: 10 })
    ).toThrow();
    expect(() => createMarkerSchema.parse({ ...validMarker, scaleMin: 8, scaleMax: 2 })).toThrow();
  });

  it("rejects an unsupported marker_type", () => {
    expect(() => createMarkerSchema.parse({ ...validMarker, markerType: "scale2" })).toThrow();
  });

  it("rejects an unsupported link field (one link per allowed type only)", () => {
    expect(() =>
      createMarkerSchema.parse({
        ...validMarker,
        linkedSignalId: "a0000000-0000-4000-8000-000000000008",
      })
    ).toThrow();
  });

  it("update schema has no baseline/current/trend fields (baseline immutability)", () => {
    const markerId = "a0000000-0000-4000-8000-000000000009";
    expect(() => updateMarkerSchema.parse({ markerId, baselineValue: 1 })).toThrow();
    expect(() => updateMarkerSchema.parse({ markerId, currentValue: 1 })).toThrow();
    expect(() => updateMarkerSchema.parse({ markerId, trend: "improving" })).toThrow();
    expect(updateMarkerSchema.parse({ markerId, name: "Новое имя" })).toBeDefined();
  });

  it("allows clearing a link with null in update", () => {
    expect(
      updateMarkerSchema.parse({
        markerId: "a0000000-0000-4000-8000-000000000009",
        linkedThemeId: null,
      })
    ).toBeDefined();
  });

  it("rejects a non-numeric marker value record", () => {
    expect(() =>
      recordMarkerValueSchema.parse({
        markerId: "a0000000-0000-4000-8000-000000000009",
        value: "high",
      })
    ).toThrow();
  });
});

describe("computeTrend (ticket 40)", () => {
  it("returns unknown when baseline or current is missing", () => {
    expect(computeTrend(null, 5, 0, 10)).toBe("unknown");
    expect(computeTrend(5, null, 0, 10)).toBe("unknown");
    expect(computeTrend(null, null, 0, 10)).toBe("unknown");
  });

  it("returns improving when current is above baseline beyond epsilon", () => {
    expect(computeTrend(7, 5, 0, 10)).toBe("improving");
  });

  it("returns worsening when current is below baseline beyond epsilon", () => {
    expect(computeTrend(2, 5, 0, 10)).toBe("worsening");
  });

  it("returns stable within 5% of the scale range", () => {
    expect(computeTrend(5.4, 5, 0, 10)).toBe("stable");
    expect(computeTrend(4.6, 5, 0, 10)).toBe("stable");
  });

  it("is deterministic regardless of previous values", () => {
    expect(computeTrend(7, 5, 0, 10)).toBe(computeTrend(7, 5, 0, 10));
  });
});

describe("isValueInScale (ticket 40)", () => {
  it("accepts boundary values", () => {
    expect(isValueInScale(0, 0, 10)).toBe(true);
    expect(isValueInScale(10, 0, 10)).toBe(true);
  });

  it("rejects values outside the scale", () => {
    expect(isValueInScale(-0.1, 0, 10)).toBe(false);
    expect(isValueInScale(10.1, 0, 10)).toBe(false);
  });
});
