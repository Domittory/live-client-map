import { describe, expect, it } from "vitest";
import { createFromRecommendationSchema, updateCorrectionSchema } from "@/lib/service/corrections";

const validInput = {
  organizationId: "a0000000-0000-4000-8000-000000000001",
  clientId: "a0000000-0000-4000-8000-000000000002",
  recommendationId: "a0000000-0000-4000-8000-000000000003",
  title: "Работа с опорой",
  rationale: "Укрепить ресурс внутренней опоры",
  targets: [
    {
      targetType: "core_node" as const,
      targetId: "a0000000-0000-4000-8000-000000000004",
      role: "primary" as const,
      expectedEffect: "Снижение активации сценария",
    },
  ],
  expectedMarkers: [
    {
      marker: "Спокойствие перед начальником",
      lifeArea: "работа",
      expectedDirection: "increase" as const,
      measurementType: "subjective" as const,
      baselineValue: "3/10",
      targetValue: "6/10",
    },
  ],
};

describe("Correction schemas (ticket 39)", () => {
  it("accepts a valid create input", () => {
    expect(createFromRecommendationSchema.parse(validInput)).toBeDefined();
  });

  it("rejects an unsupported target role", () => {
    expect(() =>
      createFromRecommendationSchema.parse({
        ...validInput,
        targets: [
          { targetType: "theme", targetId: validInput.targets[0].targetId, role: "resource" },
        ],
      })
    ).toThrow();
  });

  it("rejects an unsupported target type", () => {
    expect(() =>
      createFromRecommendationSchema.parse({
        ...validInput,
        targets: [
          { targetType: "signal", targetId: validInput.targets[0].targetId, role: "primary" },
        ],
      })
    ).toThrow();
  });

  it("rejects an unsupported marker direction", () => {
    expect(() =>
      createFromRecommendationSchema.parse({
        ...validInput,
        expectedMarkers: [
          {
            ...validInput.expectedMarkers[0],
            expectedDirection: "up",
          },
        ],
      })
    ).toThrow();
  });

  it("requires at least one target", () => {
    expect(() =>
      createFromRecommendationSchema.parse({
        ...validInput,
        targets: [],
      })
    ).toThrow();
  });

  it("requires at least one expected marker", () => {
    expect(() =>
      createFromRecommendationSchema.parse({
        ...validInput,
        expectedMarkers: [],
      })
    ).toThrow();
  });

  it("rejects a missing title", () => {
    expect(() => createFromRecommendationSchema.parse({ ...validInput, title: "" })).toThrow();
  });

  it("accepts a valid update input", () => {
    expect(
      updateCorrectionSchema.parse({
        correctionId: "a0000000-0000-4000-8000-000000000005",
        status: "completed",
      })
    ).toBeDefined();
  });

  it("rejects an invalid status in update", () => {
    expect(() =>
      updateCorrectionSchema.parse({
        correctionId: "a0000000-0000-4000-8000-000000000005",
        status: "done",
      })
    ).toThrow();
  });
});
