import { describe, expect, it } from "vitest";
import { PURPOSE_SOURCE_SYSTEMS } from "@/lib/service/purpose";
import {
  INTERPRETIVE_SYSTEM_LIMIT,
  PURPOSE_SOURCE_SYSTEM_LABELS,
  PURPOSE_VISIBILITY_LABELS,
  purposeProfileLimits,
  purposeSynthesisLimits,
} from "@/lib/service/purpose-presentation";

/**
 * Ticket 13: label coverage and the limits rule for the Purpose screen.
 *
 * The purpose layer is entered manually (there is no automatic detection
 * algorithm), so these tests pin two things: every named source system has a
 * Russian label, and the interpretive-system limit plus the missing-data limits
 * are always rendered instead of silently dropping information.
 */

const PURPOSE_VISIBILITIES = ["internal", "sensitive", "client_visible"];

describe("purposeProfileLimits", () => {
  it("always states the interpretive-system limit for jyotish and human design", () => {
    const jyotish = purposeProfileLimits({
      sourceSystem: "jyotish",
      interpretation: "интерпретация",
      confidence: 60,
      strengths: ["сила"],
      developmentDirections: ["направление"],
    });
    expect(jyotish.hasConclusion).toBe(true);
    expect(jyotish.limits).toContain(INTERPRETIVE_SYSTEM_LIMIT);

    const humanDesign = purposeProfileLimits({
      sourceSystem: "human_design",
      interpretation: "интерпретация",
      confidence: 60,
      strengths: ["сила"],
      developmentDirections: [],
    });
    expect(humanDesign.limits).toContain(INTERPRETIVE_SYSTEM_LIMIT);
  });

  it("does not claim an interpretive limit for a specialist assessment", () => {
    const result = purposeProfileLimits({
      sourceSystem: "specialist_assessment",
      interpretation: "рабочая гипотеза",
      confidence: null,
      strengths: ["сила"],
      developmentDirections: [],
    });
    expect(result.limits).not.toContain(INTERPRETIVE_SYSTEM_LIMIT);
    expect(result.limits.join(" ")).toContain("Уверенность в источнике не указана");
  });

  it("treats an empty interpretation as no conclusion", () => {
    const result = purposeProfileLimits({
      sourceSystem: "client_self_report",
      interpretation: "   ",
      confidence: null,
      strengths: [],
      developmentDirections: [],
    });
    expect(result.hasConclusion).toBe(false);
    expect(result.limits.join(" ")).toContain("Интерпретация не заполнена");
    expect(result.limits.join(" ")).toContain(
      "Сильные стороны и направления развития не заполнены"
    );
  });
});

describe("purposeSynthesisLimits", () => {
  it("reports insufficient data when there is no source profile", () => {
    const result = purposeSynthesisLimits({
      sourceProfileCount: 0,
      summary: "вывод",
      crossSystemMatches: ["лидерство"],
      potentialConflicts: [],
      recommendedDevelopmentVectors: ["вектор"],
    });
    expect(result.hasEvidence).toBe(false);
    expect(result.limits.join(" ")).toContain("синтезу не на что опираться");
  });

  it("flags a synthesis based on fewer than two sources", () => {
    const result = purposeSynthesisLimits({
      sourceProfileCount: 1,
      summary: "вывод",
      crossSystemMatches: [],
      potentialConflicts: [],
      recommendedDevelopmentVectors: [],
    });
    expect(result.hasEvidence).toBe(true);
    expect(result.limits.join(" ")).toContain("менее чем на два источника");
    expect(result.limits.join(" ")).toContain("Совпадения и конфликты");
  });

  it("always carries the interpretive-system limit", () => {
    const result = purposeSynthesisLimits({
      sourceProfileCount: 2,
      summary: "вывод",
      crossSystemMatches: ["лидерство"],
      potentialConflicts: ["роль vs стратегия"],
      recommendedDevelopmentVectors: ["вектор"],
    });
    expect(result.hasEvidence).toBe(true);
    expect(result.limits).toEqual([INTERPRETIVE_SYSTEM_LIMIT]);
  });
});

describe("label coverage", () => {
  it("labels every purpose source system and visibility in Russian", () => {
    for (const value of PURPOSE_SOURCE_SYSTEMS) {
      expect(PURPOSE_SOURCE_SYSTEM_LABELS[value]).toBeTruthy();
    }
    for (const value of PURPOSE_VISIBILITIES) {
      expect(PURPOSE_VISIBILITY_LABELS[value]).toBeTruthy();
    }
  });
});
