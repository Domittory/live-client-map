import { describe, expect, it } from "vitest";
import {
  canBeEffective,
  collectMissingEvidence,
  completeFollowUpSchema,
  hasSufficientEvidence,
  listFollowUpsQuerySchema,
  reviewAssessmentSchema,
  scheduleFollowUpSchema,
  type FollowUpEvidence,
} from "@/lib/service/follow-ups";

const IDS = {
  organizationId: "a0000000-0000-4000-8000-000000000001",
  clientId: "a0000000-0000-4000-8000-000000000002",
  correctionId: "a0000000-0000-4000-8000-000000000003",
  followUpId: "a0000000-0000-4000-8000-000000000004",
};

const noEvidence: FollowUpEvidence = {
  hasRetest: false,
  hasBehavioralResult: false,
  observationCount: 0,
  measuredMarkerCount: 0,
};

describe("FollowUp schemas (ticket 41)", () => {
  it("accepts a valid schedule input", () => {
    expect(
      scheduleFollowUpSchema.parse({
        organizationId: IDS.organizationId,
        clientId: IDS.clientId,
        correctionId: IDS.correctionId,
        scheduledAt: "2026-09-01T10:00:00.000Z",
      })
    ).toBeDefined();
  });

  it("rejects unknown fields and invalid references on schedule", () => {
    expect(() =>
      scheduleFollowUpSchema.parse({
        organizationId: IDS.organizationId,
        clientId: IDS.clientId,
        correctionId: IDS.correctionId,
        scheduledAt: "2026-09-01T10:00:00.000Z",
        resultStatus: "effective",
      })
    ).toThrow();
    expect(() =>
      scheduleFollowUpSchema.parse({
        organizationId: "not-a-uuid",
        clientId: IDS.clientId,
        correctionId: IDS.correctionId,
        scheduledAt: "2026-09-01T10:00:00.000Z",
      })
    ).toThrow();
    expect(() =>
      scheduleFollowUpSchema.parse({
        organizationId: IDS.organizationId,
        clientId: IDS.clientId,
        correctionId: IDS.correctionId,
        scheduledAt: "next week",
      })
    ).toThrow();
  });

  it("requires at least one result or feedback field on complete", () => {
    expect(() => completeFollowUpSchema.parse({ followUpId: IDS.followUpId })).toThrow();
    expect(
      completeFollowUpSchema.parse({
        followUpId: IDS.followUpId,
        retestResult: { summary: "Стресс снизился" },
      })
    ).toBeDefined();
  });

  it("rejects unknown fields inside nested results (strict)", () => {
    expect(() =>
      completeFollowUpSchema.parse({
        followUpId: IDS.followUpId,
        retestResult: { summary: "ok", hacker: true },
      })
    ).toThrow();
    expect(() =>
      completeFollowUpSchema.parse({
        followUpId: IDS.followUpId,
        clientFeedback: { summary: "ok", perceived_effect: "amazing" },
      })
    ).toThrow();
  });

  it("rejects stress scores outside 0–100", () => {
    expect(() =>
      completeFollowUpSchema.parse({
        followUpId: IDS.followUpId,
        retestResult: { summary: "ok", stress_before: 101 },
      })
    ).toThrow();
    expect(() =>
      completeFollowUpSchema.parse({
        followUpId: IDS.followUpId,
        retestResult: { summary: "ok", stress_after: -1 },
      })
    ).toThrow();
  });

  it("validates the review decision and optional final status override", () => {
    expect(
      reviewAssessmentSchema.parse({ followUpId: IDS.followUpId, decision: "approve" })
    ).toBeDefined();
    expect(
      reviewAssessmentSchema.parse({
        followUpId: IDS.followUpId,
        decision: "approve",
        finalStatus: "partially_effective",
      })
    ).toBeDefined();
    expect(() =>
      reviewAssessmentSchema.parse({ followUpId: IDS.followUpId, decision: "maybe" })
    ).toThrow();
    expect(() =>
      reviewAssessmentSchema.parse({
        followUpId: IDS.followUpId,
        decision: "approve",
        finalStatus: "scheduled",
      })
    ).toThrow();
  });

  it("applies pagination defaults on list queries", () => {
    const parsed = listFollowUpsQuerySchema.parse({ organizationId: IDS.organizationId });
    expect(parsed.limit).toBeGreaterThan(0);
  });
});

describe("Follow-up evidence guard (ticket 41, SPEC §51.9)", () => {
  it("lists every missing evidence kind when nothing was collected", () => {
    expect(collectMissingEvidence(noEvidence)).toEqual([
      "retest_result",
      "behavioral_result",
      "observations",
      "behavioral_markers",
    ]);
  });

  it("reports no gaps when all evidence kinds are present", () => {
    expect(
      collectMissingEvidence({
        hasRetest: true,
        hasBehavioralResult: true,
        observationCount: 2,
        measuredMarkerCount: 1,
      })
    ).toEqual([]);
  });

  it("treats any single objective evidence source as sufficient", () => {
    expect(hasSufficientEvidence(noEvidence)).toBe(false);
    expect(hasSufficientEvidence({ ...noEvidence, hasRetest: true })).toBe(true);
    expect(hasSufficientEvidence({ ...noEvidence, hasBehavioralResult: true })).toBe(true);
    expect(hasSufficientEvidence({ ...noEvidence, observationCount: 1 })).toBe(true);
    expect(hasSufficientEvidence({ ...noEvidence, measuredMarkerCount: 1 })).toBe(true);
  });

  it("forbids effective without objective follow-up evidence", () => {
    expect(canBeEffective(noEvidence)).toBe(false);
    expect(canBeEffective({ ...noEvidence, hasRetest: true })).toBe(true);
  });
});
