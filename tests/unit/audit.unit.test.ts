import { describe, expect, it } from "vitest";
import { auditListQuerySchema, recordAuditSchema, sanitizeAuditPayload } from "@/lib/service/audit";
import { ServiceError } from "@/lib/service/errors";
import { validate } from "@/lib/service/validation";

const ORG_ID = "123e4567-e89b-12d3-a456-426614174000";

describe("sanitizeAuditPayload", () => {
  it("redacts secrets, tokens and passwords at any depth", () => {
    const payload = {
      email: "user@example.com",
      password: "hunter2",
      nested: { api_key: "abc", list: [{ refreshToken: "xyz" }] },
    };
    const clean = sanitizeAuditPayload(payload) as Record<string, unknown>;
    expect(clean.email).toBe("user@example.com");
    expect(clean.password).toBe("[redacted]");
    expect(JSON.stringify(clean)).not.toContain("hunter2");
    expect(JSON.stringify(clean)).not.toContain("abc");
    expect(JSON.stringify(clean)).not.toContain("xyz");
  });

  it("passes scalars and arrays through", () => {
    expect(sanitizeAuditPayload(null)).toBeNull();
    expect(sanitizeAuditPayload("text")).toBe("text");
    expect(sanitizeAuditPayload([1, 2])).toEqual([1, 2]);
  });
});

describe("recordAuditSchema", () => {
  it("accepts a minimal entry", () => {
    const input = validate(recordAuditSchema, {
      organizationId: ORG_ID,
      entityType: "diagnostic_domain",
      action: "diagnostic_domain.create",
    });
    expect(input.entityId).toBeUndefined();
  });

  it("rejects unknown fields", () => {
    expect(() =>
      validate(recordAuditSchema, {
        organizationId: ORG_ID,
        entityType: "x",
        action: "y",
        actorUserId: ORG_ID,
      })
    ).toThrow(ServiceError);
  });
});

describe("auditListQuerySchema", () => {
  it("requires organizationId and applies pagination defaults", () => {
    const query = validate(auditListQuerySchema, { organizationId: ORG_ID });
    expect(query.limit).toBe(50);
    expect(() => validate(auditListQuerySchema, {})).toThrow(ServiceError);
  });
});
