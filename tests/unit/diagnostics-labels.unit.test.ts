import { describe, expect, it } from "vitest";
import {
  EVIDENCE_LEVEL_LABELS,
  EVIDENCE_LEVEL_MEANINGS,
  EPISTEMIC_TYPE_LABELS,
  INSUFFICIENT_DATA_LABEL,
  REVIEW_STATUS_LABELS,
  SESSION_TYPE_LABELS,
  SIGNAL_SOURCE_TYPES_UI,
  SOURCE_TYPE_LABELS,
  labelFor,
  reasonRequired,
  signalReadiness,
} from "@/lib/service/diagnostics-presentation";
import { EPISTEMIC_TYPES, SESSION_TYPES, SIGNAL_SOURCE_TYPES } from "@/lib/service/diagnostics";
import { EVIDENCE_LEVELS } from "@/lib/service/signal-interpretation";

/**
 * Ticket 10: the "not enough data" rule and the label coverage.
 *
 * These tests pin the rule that empty, AI-only, pending or rejected evidence is
 * never rendered as a conclusion, and that every database enum the diagnostics
 * screen can display has a Russian label (no raw token can reach the UI).
 */

const CONFIDENT_SIGNAL = {
  source_type: "kinesiology_test",
  raw_statement: "Мне безопасно быть главным",
  normalized_meaning: "Стресс вокруг доступа к позитивной возможности.",
  evidence_level: "L1_SINGLE_SIGNAL",
  review_status: "approved",
};

describe("signalReadiness", () => {
  it("shows the normalized meaning only for reviewed, non-AI evidence", () => {
    const result = signalReadiness(CONFIDENT_SIGNAL);
    expect(result.readiness).toBe("interpretation");
    expect(result.interpretation).toBe(CONFIDENT_SIGNAL.normalized_meaning);
    expect(result.reason).toBeNull();
  });

  it("renders an empty statement as insufficient data, never as a conclusion", () => {
    const result = signalReadiness({ ...CONFIDENT_SIGNAL, raw_statement: "   " });
    expect(result.readiness).toBe("insufficient");
    expect(result.interpretation).toBe(INSUFFICIENT_DATA_LABEL);
    expect(result.reason).toBeTruthy();
  });

  it("never promotes a pending Signal without an explicit review", () => {
    const result = signalReadiness({
      ...CONFIDENT_SIGNAL,
      review_status: "pending",
      normalized_meaning: "Вывод, который нельзя показывать",
    });
    expect(result.readiness).toBe("insufficient");
    expect(result.interpretation).toBe(INSUFFICIENT_DATA_LABEL);
    expect(result.interpretation).not.toContain("Вывод");
  });

  it("never promotes a rejected Signal", () => {
    const result = signalReadiness({ ...CONFIDENT_SIGNAL, review_status: "rejected" });
    expect(result.readiness).toBe("insufficient");
  });

  it("treats L0 AI-only evidence as insufficient even after approval (SPEC §3.5)", () => {
    const result = signalReadiness({
      ...CONFIDENT_SIGNAL,
      source_type: "ai_hypothesis",
      evidence_level: "L0_AI_ONLY",
      review_status: "approved",
    });
    expect(result.readiness).toBe("insufficient");
    expect(result.reason).toContain("L0");
  });

  it("renders a Signal without a normalized meaning as insufficient data", () => {
    const result = signalReadiness({ ...CONFIDENT_SIGNAL, normalized_meaning: "  " });
    expect(result.readiness).toBe("insufficient");
    expect(result.interpretation).toBe(INSUFFICIENT_DATA_LABEL);
  });
});

describe("review reason rule", () => {
  it("requires a reason for evidence-removing actions", () => {
    expect(reasonRequired("reject")).toBe(true);
    expect(reasonRequired("hide")).toBe(true);
  });

  it("keeps human confirmation available without a typed reason", () => {
    expect(reasonRequired("approve")).toBe(false);
    expect(reasonRequired("mark_sensitive")).toBe(false);
  });
});

describe("label coverage", () => {
  it("labels every session, source, epistemic and evidence enum in Russian", () => {
    for (const value of SESSION_TYPES) expect(SESSION_TYPE_LABELS[value]).toBeTruthy();
    for (const value of SIGNAL_SOURCE_TYPES) expect(SOURCE_TYPE_LABELS[value]).toBeTruthy();
    for (const value of EPISTEMIC_TYPES) expect(EPISTEMIC_TYPE_LABELS[value]).toBeTruthy();
    for (const value of EVIDENCE_LEVELS) expect(EVIDENCE_LEVEL_LABELS[value]).toBeTruthy();
    for (const value of EVIDENCE_LEVELS) expect(EVIDENCE_LEVEL_MEANINGS[value]).toBeTruthy();
    for (const value of ["pending", "approved", "rejected"]) {
      expect(REVIEW_STATUS_LABELS[value]).toBeTruthy();
    }
    // The UI dropdown mirrors the service enum exactly.
    expect(SIGNAL_SOURCE_TYPES_UI).toEqual(SIGNAL_SOURCE_TYPES);
  });

  it("never renders a raw database token for an unknown enum value", () => {
    expect(labelFor(SOURCE_TYPE_LABELS, "totally_new_source")).toBe("Неизвестное значение");
    expect(labelFor(SOURCE_TYPE_LABELS, null)).toBe("—");
    expect(labelFor(SOURCE_TYPE_LABELS, "client_report")).toBe("Рассказ клиента");
  });
});
