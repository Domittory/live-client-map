import { describe, expect, it } from "vitest";
import {
  inviteMemberSchema,
  retentionSettingsSchema,
  setMemberStatusSchema,
  transferOwnershipSchema,
  updateMemberRoleSchema,
  updateOrgSettingsSchema,
} from "@/lib/service/admin";
import { ServiceError } from "@/lib/service/errors";
import { validate } from "@/lib/service/validation";

const ORG_ID = "123e4567-e89b-12d3-a456-426614174000";
const USER_ID = "223e4567-e89b-12d3-a456-426614174000";

describe("retentionSettingsSchema (ticket 05 policy)", () => {
  it("accepts values inside the policy bounds", () => {
    expect(validate(retentionSettingsSchema, { clientDataYears: 5, exportDays: 30 })).toEqual({
      clientDataYears: 5,
      exportDays: 30,
    });
  });

  it("rejects retention beyond the approved policy", () => {
    expect(() => validate(retentionSettingsSchema, { clientDataYears: 6, exportDays: 30 })).toThrow(
      ServiceError
    );
    expect(() => validate(retentionSettingsSchema, { clientDataYears: 5, exportDays: 31 })).toThrow(
      ServiceError
    );
    expect(() => validate(retentionSettingsSchema, { clientDataYears: 0, exportDays: 10 })).toThrow(
      ServiceError
    );
  });
});

describe("inviteMemberSchema", () => {
  it("accepts specialist/supervisor invitations only", () => {
    expect(() =>
      validate(inviteMemberSchema, {
        organizationId: ORG_ID,
        email: "a@example.com",
        role: "owner",
      })
    ).toThrow(ServiceError);
    expect(
      validate(inviteMemberSchema, {
        organizationId: ORG_ID,
        email: "a@example.com",
        role: "specialist",
      }).role
    ).toBe("specialist");
  });

  it("rejects invalid email and unknown fields", () => {
    expect(() =>
      validate(inviteMemberSchema, { organizationId: ORG_ID, email: "nope", role: "specialist" })
    ).toThrow(ServiceError);
    expect(() =>
      validate(inviteMemberSchema, {
        organizationId: ORG_ID,
        email: "a@b.c",
        role: "specialist",
        plan: "pro",
      })
    ).toThrow(ServiceError);
  });
});

describe("updateMemberRoleSchema / setMemberStatusSchema", () => {
  it("never allows the owner role through role change", () => {
    expect(() =>
      validate(updateMemberRoleSchema, { organizationId: ORG_ID, userId: USER_ID, role: "owner" })
    ).toThrow(ServiceError);
  });

  it("allows only active/suspended status transitions", () => {
    expect(() =>
      validate(setMemberStatusSchema, {
        organizationId: ORG_ID,
        userId: USER_ID,
        status: "invited",
      })
    ).toThrow(ServiceError);
  });
});

describe("transferOwnershipSchema / updateOrgSettingsSchema", () => {
  it("validates uuids", () => {
    expect(() =>
      validate(transferOwnershipSchema, { organizationId: ORG_ID, newOwnerId: "not-a-uuid" })
    ).toThrow(ServiceError);
  });

  it("rejects unknown settings fields", () => {
    expect(() =>
      validate(updateOrgSettingsSchema, { organizationId: ORG_ID, billingToken: "x" })
    ).toThrow(ServiceError);
  });
});
