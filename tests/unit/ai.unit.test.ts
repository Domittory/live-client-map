import { describe, expect, it } from "vitest";
import {
  AI_CONTRACTS,
  AI_FUNCTION_IDS,
  aiRequestEnvelopeSchema,
  aiResponseEnvelopeSchema,
} from "@/lib/ai/contracts";
import { createInMemoryRateLimiter } from "@/lib/ai/limiter";
import { looksUnredacted, redactText } from "@/lib/ai/redact";

const REQUEST_ID = "123e4567-e89b-12d3-a456-426614174000";

function validEnvelope(result: Record<string, unknown>) {
  return {
    contract_version: "1.0.0",
    request_id: REQUEST_ID,
    result,
    warnings: [],
    safety: { review_required: false, categories: [], rationale: "" },
  };
}

describe("AI contracts registry", () => {
  it("covers all 11 AI functions with separate versioned contracts", () => {
    expect(AI_FUNCTION_IDS).toHaveLength(11);
    for (const contract of Object.values(AI_CONTRACTS)) {
      expect(contract.contractVersion).toBe("1.0.0");
      expect(contract.promptVersion).toMatch(/^prompt\..+\.v1$/);
    }
  });

  it("rejects unknown fields, invalid enums and scores outside 0–100", () => {
    const ingest = AI_CONTRACTS["ai.ingest-signals.v1"];
    const signal = {
      candidate_key: "s1",
      raw_statement: "x",
      statement_polarity: "positive",
      test_result: "stress",
      normalized_meaning: "y",
      inferred_opposite: null,
      confidence: 80,
      life_areas: [],
      tags: [],
      context: "",
      proposed_evidence_level: "L1_SINGLE_SIGNAL",
      rationale: "r",
    };
    expect(ingest.resultSchema.safeParse({ signals: [signal] }).success).toBe(true);
    expect(
      ingest.resultSchema.safeParse({ signals: [{ ...signal, confidence: 150 }] }).success
    ).toBe(false);
    expect(
      ingest.resultSchema.safeParse({ signals: [{ ...signal, test_result: "maybe" }] }).success
    ).toBe(false);
    expect(
      ingest.resultSchema.safeParse({ signals: [{ ...signal, evidence_count: 3 }] }).success
    ).toBe(false);
    expect(ingest.resultSchema.safeParse({ signals: [], extra: 1 }).success).toBe(false);
  });

  it("response envelope rejects unknown warning codes and fields", () => {
    expect(aiResponseEnvelopeSchema.safeParse(validEnvelope({ signals: [] })).success).toBe(true);
    expect(
      aiResponseEnvelopeSchema.safeParse({
        ...validEnvelope({ signals: [] }),
        warnings: ["made_up"],
      }).success
    ).toBe(false);
    expect(
      aiResponseEnvelopeSchema.safeParse({ ...validEnvelope({}), injected: true }).success
    ).toBe(false);
  });

  it("request envelope is strict and requires version metadata", () => {
    const envelope = {
      contract_version: "1.0.0",
      request_id: REQUEST_ID,
      organization_id: REQUEST_ID,
      client_id: REQUEST_ID,
      ontology_version: "1.0.0",
      scoring_model_version: null,
      prompt_version: "prompt.x.v1",
      source_snapshot_version: null,
      payload: {},
    };
    expect(aiRequestEnvelopeSchema.safeParse(envelope).success).toBe(true);
    expect(aiRequestEnvelopeSchema.safeParse({ ...envelope, api_key: "sk-..." }).success).toBe(
      false
    );
  });
});

describe("redaction", () => {
  it("replaces identifiers with stable placeholders and keeps mapping in memory", () => {
    const { text, mapping } = redactText({
      text: "Иван Петров написал ivan@example.com 2020-05-17",
      identifiers: { persons: ["Иван Петров"] },
    });
    expect(text).toContain("PERSON_1");
    expect(text).not.toContain("Иван Петров");
    expect(text).not.toContain("ivan@example.com");
    expect(text).not.toContain("2020-05-17");
    expect(mapping.PERSON_1).toBe("Иван Петров");
  });

  it("detects unredacted PII", () => {
    expect(looksUnredacted("plain text")).toBe(false);
    expect(looksUnredacted("mail me at a@b.co")).toBe(true);
  });

  it("never mangles UUIDs, even with phone-like digit runs inside", () => {
    const uuid = "11ce376a-64fc-4421-b2fb-534242918276";
    const { text, mapping } = redactText({
      text: `change ${uuid} reason +7 (999) 123-45-67`,
    });
    expect(text).toContain(uuid);
    expect(text).not.toContain("123-45-67");
    expect(Object.values(mapping)).not.toContain(uuid);
    expect(looksUnredacted(text)).toBe(false);
  });
});

describe("rate limiter", () => {
  it("allows 2 concurrent calls per org and blocks the third", () => {
    const limiter = createInMemoryRateLimiter({ maxConcurrent: 2, maxPerMinute: 100 });
    expect(limiter.acquire("org")).toBe(true);
    expect(limiter.acquire("org")).toBe(true);
    expect(limiter.acquire("org")).toBe(false);
    limiter.release("org");
    expect(limiter.acquire("org")).toBe(true);
  });

  it("enforces the per-minute cap independently per org", () => {
    const limiter = createInMemoryRateLimiter({ maxConcurrent: 100, maxPerMinute: 2 });
    expect(limiter.acquire("a")).toBe(true);
    expect(limiter.acquire("a")).toBe(true);
    expect(limiter.acquire("a")).toBe(false);
    expect(limiter.acquire("b")).toBe(true);
  });
});
