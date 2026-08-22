import { describe, expect, it } from "vitest";
import { ServiceError } from "@/lib/service/errors";
import {
  createOrgMethodSchema,
  methodListQuerySchema,
  updateOrgMethodSchema,
} from "@/lib/service/interventions";
import { validate } from "@/lib/service/validation";

const ORG_ID = "123e4567-e89b-12d3-a456-426614174000";
const METHOD_ID = "223e4567-e89b-12d3-a456-426614174000";

describe("methodListQuerySchema", () => {
  it("applies defaults for an empty query", () => {
    const query = validate(methodListQuerySchema, {});
    expect(query.scope).toBe("all");
    expect(query.includeArchived).toBe(false);
    expect(query.limit).toBe(50);
  });

  it("coerces includeArchived from a query string", () => {
    const query = validate(methodListQuerySchema, { includeArchived: "true" });
    expect(query.includeArchived).toBe(true);
  });

  it("rejects an unknown scope", () => {
    expect(() => validate(methodListQuerySchema, { scope: "global" })).toThrow(ServiceError);
  });
});

describe("createOrgMethodSchema", () => {
  const base = { organizationId: ORG_ID, name: "Работа с опорой" };

  it("accepts a minimal org method", () => {
    const input = validate(createOrgMethodSchema, base);
    expect(input.contraindications).toEqual([]);
    expect(input.defaultFollowUpDays).toBeUndefined();
  });

  it("rejects unknown fields (strict)", () => {
    expect(() => validate(createOrgMethodSchema, { ...base, isSystem: true })).toThrow(
      ServiceError
    );
    expect(() => validate(createOrgMethodSchema, { ...base, archivedAt: null })).toThrow(
      ServiceError
    );
  });

  it("enforces the 1–365 range on defaultFollowUpDays", () => {
    for (const days of [0, 366, -1, 1.5]) {
      expect(() => validate(createOrgMethodSchema, { ...base, defaultFollowUpDays: days })).toThrow(
        ServiceError
      );
    }
    for (const days of [1, 365]) {
      expect(
        validate(createOrgMethodSchema, { ...base, defaultFollowUpDays: days }).defaultFollowUpDays
      ).toBe(days);
    }
  });
});

describe("updateOrgMethodSchema", () => {
  it("accepts a partial patch", () => {
    const input = validate(updateOrgMethodSchema, { methodId: METHOD_ID, name: "Новое имя" });
    expect(input.description).toBeUndefined();
  });

  it("allows clearing defaultFollowUpDays with null", () => {
    const input = validate(updateOrgMethodSchema, {
      methodId: METHOD_ID,
      defaultFollowUpDays: null,
    });
    expect(input.defaultFollowUpDays).toBeNull();
  });

  it("rejects unknown fields and out-of-range follow-up", () => {
    expect(() => validate(updateOrgMethodSchema, { methodId: METHOD_ID, isSystem: false })).toThrow(
      ServiceError
    );
    expect(() =>
      validate(updateOrgMethodSchema, { methodId: METHOD_ID, defaultFollowUpDays: 0 })
    ).toThrow(ServiceError);
  });
});
