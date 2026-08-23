import { describe, expect, it } from "vitest";
import {
  computeScoreDiffs,
  explainModelChangesSchema,
  listModelExplanationsQuerySchema,
  reviewModelExplanationSchema,
  validateExplanationGrounding,
  type ExplanationEntry,
  type ExplanationGrounding,
} from "@/lib/service/explanations";
import { SNAPSHOT_CATEGORIES, type CategoryDiff, type SnapshotDiff } from "@/lib/service/snapshots";

const IDS = {
  clientId: "a0000000-0000-4000-8000-000000000001",
  changeId: "a0000000-0000-4000-8000-000000000002",
  otherChangeId: "a0000000-0000-4000-8000-000000000003",
  evidenceId: "a0000000-0000-4000-8000-000000000004",
  fabricatedChangeId: "a0000000-0000-4000-8000-000000000099",
  fabricatedEvidenceId: "a0000000-0000-4000-8000-000000000098",
  explanationId: "a0000000-0000-4000-8000-000000000005",
};

const GROUNDING: ExplanationGrounding = {
  model_change_ids: [IDS.changeId, IDS.otherChangeId],
  evidence_ids: [IDS.evidenceId],
};

function entry(overrides: Partial<ExplanationEntry> = {}): ExplanationEntry {
  return {
    model_change_id: IDS.changeId,
    headline: "Узел усилился",
    explanation: "Новые независимые сигналы.",
    evidence_refs: [IDS.evidenceId],
    score_breakdown_summary: "confidence 72 -> 88",
    uncertainty: "",
    missing_evidence: [],
    ...overrides,
  };
}

function emptyDiff(): SnapshotDiff {
  const empty: CategoryDiff = { added: [], removed: [], changed: [] };
  return Object.fromEntries(
    SNAPSHOT_CATEGORIES.map((category) => [category, { ...empty }])
  ) as SnapshotDiff;
}

describe("explainModelChanges schemas (ticket 44)", () => {
  it("accepts a valid client id and rejects unknown fields", () => {
    expect(explainModelChangesSchema.parse({ clientId: IDS.clientId })).toBeDefined();
    expect(() =>
      explainModelChangesSchema.parse({ clientId: IDS.clientId, hacker: true })
    ).toThrow();
    expect(() => explainModelChangesSchema.parse({ clientId: "nope" })).toThrow();
  });

  it("validates the review decision", () => {
    expect(
      reviewModelExplanationSchema.parse({ explanationId: IDS.explanationId, decision: "approve" })
    ).toBeDefined();
    expect(
      reviewModelExplanationSchema.parse({ explanationId: IDS.explanationId, decision: "reject" })
    ).toBeDefined();
    expect(() =>
      reviewModelExplanationSchema.parse({ explanationId: IDS.explanationId, decision: "maybe" })
    ).toThrow();
  });

  it("applies pagination defaults and status filter on list queries", () => {
    const parsed = listModelExplanationsQuerySchema.parse({
      organizationId: IDS.clientId,
      clientId: IDS.clientId,
      status: "pending",
    });
    expect(parsed.limit).toBeGreaterThan(0);
    expect(parsed.status).toBe("pending");
    expect(() =>
      listModelExplanationsQuerySchema.parse({
        organizationId: IDS.clientId,
        clientId: IDS.clientId,
        status: "archived",
      })
    ).toThrow();
  });
});

describe("grounding validation (ticket 44, fabricated-change rejection)", () => {
  it("accepts explanations that reference only real changes and evidence", () => {
    expect(validateExplanationGrounding([entry()], GROUNDING)).toEqual([]);
    expect(validateExplanationGrounding([], GROUNDING)).toEqual([]);
  });

  it("rejects a fabricated model_change_id", () => {
    const errors = validateExplanationGrounding(
      [entry({ model_change_id: IDS.fabricatedChangeId })],
      GROUNDING
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("fabricated model_change_id");
    expect(errors[0]).toContain(IDS.fabricatedChangeId);
  });

  it("rejects a fabricated evidence_ref on a real change", () => {
    const errors = validateExplanationGrounding(
      [entry({ evidence_refs: [IDS.evidenceId, IDS.fabricatedEvidenceId] })],
      GROUNDING
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("fabricated evidence_ref");
    expect(errors[0]).toContain(IDS.fabricatedEvidenceId);
  });

  it("rejects duplicate explanations of the same change", () => {
    const errors = validateExplanationGrounding([entry(), entry()], GROUNDING);
    expect(errors.some((error) => error.includes("duplicate model_change_id"))).toBe(true);
  });

  it("collects multiple violations deterministically sorted", () => {
    const errors = validateExplanationGrounding(
      [
        entry({ model_change_id: IDS.fabricatedChangeId }),
        entry({ evidence_refs: [IDS.fabricatedEvidenceId] }),
      ],
      GROUNDING
    );
    expect(errors).toHaveLength(2);
    expect([...errors].sort()).toEqual(errors);
  });
});

describe("computeScoreDiffs (ticket 44, before/after accuracy)", () => {
  it("computes integer deltas only for changed *_score fields", () => {
    const diff = emptyDiff();
    diff.active_core_nodes.changed = [
      {
        id: IDS.changeId,
        before: { id: IDS.changeId, title: "Node", confidence_score: 72, trend: "stable" },
        after: { id: IDS.changeId, title: "Node", confidence_score: 88, trend: "strengthening" },
      },
    ];
    expect(computeScoreDiffs(diff)).toEqual({
      [`active_core_nodes.${IDS.changeId}.confidence_score`]: 16,
    });
  });

  it("reports negative deltas and ignores non-score and unchanged fields", () => {
    const diff = emptyDiff();
    diff.resource_state.changed = [
      {
        id: IDS.changeId,
        before: { id: IDS.changeId, strength_score: 60, name: "Resource" },
        after: { id: IDS.changeId, strength_score: 45, name: "Resource renamed" },
      },
    ];
    expect(computeScoreDiffs(diff)).toEqual({
      [`resource_state.${IDS.changeId}.strength_score`]: -15,
    });
  });

  it("ignores added/removed entries and null scores", () => {
    const diff = emptyDiff();
    diff.active_themes.added = [IDS.changeId];
    diff.active_themes.changed = [
      {
        id: IDS.otherChangeId,
        before: { id: IDS.otherChangeId, activity_score: null },
        after: { id: IDS.otherChangeId, activity_score: 50 },
      },
    ];
    expect(computeScoreDiffs(diff)).toEqual({});
  });
});
