import { describe, expect, it } from "vitest";
import { RESOURCE_REVIEW_STATUSES, RESOURCE_STATUSES } from "@/lib/service/resources";
import {
  DEVELOPMENT_TARGET_IMPORTANCE,
  DEVELOPMENT_TARGET_STATUSES,
} from "@/lib/service/development-targets";
import {
  DEVELOPMENT_TARGET_IMPORTANCE_LABELS,
  DEVELOPMENT_TARGET_STATUS_LABELS,
  RESOURCE_EVIDENCE_LABEL,
  RESOURCE_REVIEW_STATUS_LABELS,
  RESOURCE_STATUS_LABELS,
  RESOURCE_TREND_LABELS,
  RESOURCE_VISIBILITY_LABELS,
  developmentTargetLimits,
  resourceEvidence,
} from "@/lib/service/resources-presentation";

/**
 * Ticket 13: the "not enough data" rule and label coverage for the Resources and
 * DevelopmentTargets screen.
 *
 * These tests pin the rule that a Resource or a target is never rendered as a
 * confirmed conclusion without evidence and without its limits, and that every
 * database state the screen can display has a Russian label.
 */

// Mirrors the table CHECK constraints (migrations 0020/0021) so a new state
// without a label fails here instead of leaking a raw token into the UI.
const RESOURCE_TRENDS = ["strengthening", "stable", "weakening", "unknown"];
const RESOURCE_VISIBILITIES = ["internal", "sensitive", "client_visible"];

describe("resourceEvidence", () => {
  it("reports insufficient data when the resource carries no evidence", () => {
    const result = resourceEvidence({
      reviewStatus: "approved",
      strengthScore: null,
      confidenceScore: null,
      evidenceSummary: null,
      evidenceRefs: [],
    });
    expect(result.hasEvidence).toBe(false);
    expect(result.summary).toBeNull();
    expect(result.limits.join(" ")).toContain("Нет описания доказательств");
  });

  it("treats AI evidence refs as evidence and flags the L0 proposal limit", () => {
    const result = resourceEvidence({
      reviewStatus: "pending",
      strengthScore: 70,
      confidenceScore: 60,
      evidenceSummary: null,
      evidenceRefs: ["signal-1"],
    });
    expect(result.hasEvidence).toBe(true);
    expect(result.limits.join(" ")).toContain("Предложение AI (L0)");
    expect(result.limits.join(" ")).not.toContain("Нет описания доказательств");
  });

  it("flags a rejected resource and missing scores instead of hiding them", () => {
    const result = resourceEvidence({
      reviewStatus: "rejected",
      strengthScore: null,
      confidenceScore: 50,
      evidenceSummary: "наблюдение специалиста",
      evidenceRefs: [],
    });
    expect(result.summary).toBe("наблюдение специалиста");
    expect(result.limits.join(" ")).toContain("Отклонён человеком");
    expect(result.limits.join(" ")).toContain("Сила ресурса не оценена");
    expect(result.limits.join(" ")).not.toContain("Уверенность в ресурсе не оценена");
  });

  it("adds no limit when the evidence is complete", () => {
    const result = resourceEvidence({
      reviewStatus: "approved",
      strengthScore: 80,
      confidenceScore: 70,
      evidenceSummary: "подтверждено на сессии",
      evidenceRefs: [],
    });
    expect(result.hasEvidence).toBe(true);
    expect(result.limits).toEqual([]);
  });
});

describe("developmentTargetLimits", () => {
  it("flags a target without levels, markers and links", () => {
    const result = developmentTargetLimits({
      status: "active",
      currentLevel: null,
      targetLevel: null,
      successMarkers: [],
      linkedResources: [],
      linkedCoreNodes: [],
    });
    expect(result.hasEvidence).toBe(false);
    expect(result.limits.join(" ")).toContain("Уровни не заполнены");
    expect(result.limits.join(" ")).toContain("Маркеры успеха не заданы");
    expect(result.limits.join(" ")).toContain("Нет связей");
  });

  it("flags a target marked achieved without measured levels", () => {
    const result = developmentTargetLimits({
      status: "achieved",
      currentLevel: null,
      targetLevel: null,
      successMarkers: ["маркер"],
      linkedResources: ["resource-1"],
      linkedCoreNodes: [],
    });
    expect(result.hasEvidence).toBe(true);
    expect(result.limits.join(" ")).toContain("достигнутой без измеренных уровней");
  });

  it("adds no limit when the target is measurable and traceable", () => {
    const result = developmentTargetLimits({
      status: "active",
      currentLevel: 30,
      targetLevel: 70,
      successMarkers: ["маркер"],
      linkedResources: [],
      linkedCoreNodes: ["node-1"],
    });
    expect(result.hasEvidence).toBe(true);
    expect(result.limits).toEqual([]);
  });
});

describe("label coverage", () => {
  it("labels every resource and target state in Russian", () => {
    for (const value of RESOURCE_STATUSES) {
      expect(RESOURCE_STATUS_LABELS[value]).toBeTruthy();
    }
    for (const value of RESOURCE_REVIEW_STATUSES) {
      expect(RESOURCE_REVIEW_STATUS_LABELS[value]).toBeTruthy();
    }
    for (const value of RESOURCE_TRENDS) {
      expect(RESOURCE_TREND_LABELS[value]).toBeTruthy();
    }
    for (const value of RESOURCE_VISIBILITIES) {
      expect(RESOURCE_VISIBILITY_LABELS[value]).toBeTruthy();
    }
    for (const value of DEVELOPMENT_TARGET_STATUSES) {
      expect(DEVELOPMENT_TARGET_STATUS_LABELS[value]).toBeTruthy();
    }
    for (const value of DEVELOPMENT_TARGET_IMPORTANCE) {
      expect(DEVELOPMENT_TARGET_IMPORTANCE_LABELS[value]).toBeTruthy();
    }
  });

  it("keeps the evidence section label explicit", () => {
    expect(RESOURCE_EVIDENCE_LABEL).toContain("Доказательства");
  });
});
