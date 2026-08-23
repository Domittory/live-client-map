import { describe, expect, it } from "vitest";
import {
  erasureInputSchema,
  legalHoldInputSchema,
  opaqueClientRef,
  summarizeImpact,
} from "@/lib/service/erasure";

describe("opaqueClientRef (ticket 58)", () => {
  it("is deterministic, 16 hex chars, and never exposes the client id", () => {
    const clientId = "9f8e7d6c-5b4a-4938-8271-0a1b2c3d4e5f";
    const ref = opaqueClientRef(clientId);
    expect(ref).toBe(opaqueClientRef(clientId));
    expect(ref).toMatch(/^[0-9a-f]{16}$/);
    expect(ref).not.toContain(clientId);
  });

  it("differs across client ids", () => {
    expect(opaqueClientRef("2f8e7d6c-5b4a-4938-8271-0a1b2c3d4e5f")).not.toBe(
      opaqueClientRef("3f8e7d6c-5b4a-4938-8271-0a1b2c3d4e5f")
    );
  });
});

describe("summarizeImpact (ticket 58)", () => {
  it("handles empty input", () => {
    expect(summarizeImpact({})).toEqual({ impacted: {}, entityIds: [] });
  });

  it("counts rows per table", () => {
    const result = summarizeImpact({
      core_nodes: [{ id: "a" }, { id: "b" }],
      themes: [{ id: "c" }],
    });
    expect(result.impacted).toEqual({ core_nodes: 2, themes: 1 });
  });

  it("dedupes ids across tables and sorts them", () => {
    const result = summarizeImpact({
      core_nodes: [{ id: "b" }, { id: "a" }],
      themes: [{ id: "a" }, { id: "c" }],
    });
    expect(result.entityIds).toEqual(["a", "b", "c"]);
  });
});

describe("erasure schemas (ticket 58)", () => {
  it("accepts a valid erasure input and rejects unknown keys", () => {
    const id = "9f8e7d6c-5b4a-4938-8271-0a1b2c3d4e5f";
    expect(erasureInputSchema.safeParse({ clientId: id }).success).toBe(true);
    expect(erasureInputSchema.safeParse({ clientId: id, extra: true }).success).toBe(false);
    expect(erasureInputSchema.safeParse({ clientId: "not-a-uuid" }).success).toBe(false);
  });

  it("accepts a valid legal-hold input", () => {
    const id = "9f8e7d6c-5b4a-4938-8271-0a1b2c3d4e5f";
    expect(legalHoldInputSchema.safeParse({ clientId: id, hold: true }).success).toBe(true);
    expect(legalHoldInputSchema.safeParse({ clientId: id, hold: "yes" }).success).toBe(false);
  });
});
