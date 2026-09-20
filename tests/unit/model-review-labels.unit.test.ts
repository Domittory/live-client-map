import { describe, expect, it } from "vitest";
import { RELATION_TYPES } from "@/lib/service/relations";
import {
  CONTRADICTING_EVIDENCE_LABEL,
  CORE_NODE_STATUS_LABELS,
  HYPOTHESIS_STATUS_LABELS,
  RELATION_TYPE_LABELS,
  SUPPORTING_EVIDENCE_LABEL,
  THEME_REVIEW_STATUS_LABELS,
  conclusionLimits,
  isAiProposal,
  isReviewable,
} from "@/lib/service/model-review-presentation";

/**
 * Ticket 12: the "not enough data" rule and label coverage for the model review
 * screen.
 *
 * These tests pin the rule that a conclusion is never rendered without its
 * evidence trail and that every database state the review screen can display
 * has a Russian label (no raw token can reach the UI). They also pin the
 * human-in-the-loop states: an AI proposal is reviewable, a confirmed entity is
 * not silently re-decided.
 */

// The enum sets the database CHECK constraints allow, mirrored here so a new
// status without a label fails the test instead of leaking into the UI.
const CORE_NODE_STATUSES = [
  "hypothesis",
  "active",
  "in_treatment",
  "treated_unverified",
  "weakened",
  "integrated",
  "reactivated",
  "contradicted",
  "under_review",
  "rejected",
  "archived",
];
const HYPOTHESIS_STATUSES = ["hypothesis", "active", "rejected", "archived"];
const THEME_REVIEW_STATUSES = ["pending", "approved", "rejected"];

describe("conclusionLimits", () => {
  it("reports insufficient data when there is no supporting evidence", () => {
    const result = conclusionLimits({
      entityType: "core_node",
      state: "active",
      supportingCount: 0,
      contradictingCount: 0,
      hasThemeLinks: true,
    });
    expect(result.hasSupportingEvidence).toBe(false);
    expect(result.limits.join(" ")).toContain("Нет подтверждающих доказательств");
  });

  it("marks an unreviewed AI proposal as L0 and not independent evidence", () => {
    const result = conclusionLimits({
      entityType: "theme",
      state: "pending",
      supportingCount: 1,
      contradictingCount: 0,
      independentEvidenceCount: 1,
    });
    expect(result.hasSupportingEvidence).toBe(true);
    expect(result.limits.join(" ")).toContain("Предложение AI (L0)");
  });

  it("flags a rejected decision instead of presenting it as a conclusion", () => {
    const result = conclusionLimits({
      entityType: "differential_hypothesis",
      state: "rejected",
      supportingCount: 1,
      contradictingCount: 0,
    });
    expect(result.limits.join(" ")).toContain("Отклонено человеком");
  });

  it("lists contradicting evidence as a limit and never hides it", () => {
    const result = conclusionLimits({
      entityType: "differential_hypothesis",
      state: "active",
      supportingCount: 1,
      contradictingCount: 2,
    });
    expect(result.limits.join(" ")).toContain("Есть противоречащие доказательства");
  });

  it("flags a theme without independent contexts and a node without themes", () => {
    const theme = conclusionLimits({
      entityType: "theme",
      state: "approved",
      supportingCount: 2,
      contradictingCount: 0,
      independentEvidenceCount: 0,
    });
    expect(theme.limits.join(" ")).toContain("Нет независимых контекстов");

    const node = conclusionLimits({
      entityType: "core_node",
      state: "active",
      supportingCount: 1,
      contradictingCount: 0,
      hasThemeLinks: false,
    });
    expect(node.limits.join(" ")).toContain("Нет связанных тем");
  });

  it("adds no limit when the evidence is complete", () => {
    const result = conclusionLimits({
      entityType: "core_node",
      state: "active",
      supportingCount: 1,
      contradictingCount: 0,
      hasThemeLinks: true,
    });
    expect(result.hasSupportingEvidence).toBe(true);
    expect(result.limits).toEqual([]);
  });
});

describe("human-in-the-loop state rule", () => {
  it("treats pending AI states as proposals", () => {
    expect(isAiProposal("theme", "pending")).toBe(true);
    expect(isAiProposal("core_node", "under_review")).toBe(true);
    expect(isAiProposal("differential_hypothesis", "hypothesis")).toBe(true);
    expect(isAiProposal("theme", "approved")).toBe(false);
    expect(isAiProposal("core_node", "active")).toBe(false);
  });

  it("allows a review only while a human decision is still pending", () => {
    expect(isReviewable("theme", "pending")).toBe(true);
    expect(isReviewable("theme", "approved")).toBe(false);
    expect(isReviewable("core_node", "under_review")).toBe(true);
    expect(isReviewable("core_node", "hypothesis")).toBe(true);
    // A confirmed entity is never re-decided from the review screen.
    expect(isReviewable("core_node", "active")).toBe(false);
    expect(isReviewable("differential_hypothesis", "hypothesis")).toBe(true);
    expect(isReviewable("differential_hypothesis", "active")).toBe(false);
  });
});

describe("label coverage", () => {
  it("labels every model state in Russian", () => {
    for (const value of CORE_NODE_STATUSES) {
      expect(CORE_NODE_STATUS_LABELS[value]).toBeTruthy();
    }
    for (const value of HYPOTHESIS_STATUSES) {
      expect(HYPOTHESIS_STATUS_LABELS[value]).toBeTruthy();
    }
    for (const value of THEME_REVIEW_STATUSES) {
      expect(THEME_REVIEW_STATUS_LABELS[value]).toBeTruthy();
    }
    for (const value of RELATION_TYPES) {
      expect(RELATION_TYPE_LABELS[value]).toBeTruthy();
    }
  });

  it("keeps the evidence section labels explicit", () => {
    expect(SUPPORTING_EVIDENCE_LABEL).toContain("Подтверждающие");
    expect(CONTRADICTING_EVIDENCE_LABEL).toContain("Противоречащие");
  });
});
