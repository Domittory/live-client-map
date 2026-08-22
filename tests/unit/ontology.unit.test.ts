import { describe, expect, it } from "vitest";
import { ServiceError } from "@/lib/service/errors";
import {
  beliefTemplateListQuerySchema,
  createOrgBeliefTemplateSchema,
  createOrgDomainSchema,
  domainListQuerySchema,
} from "@/lib/service/ontology";
import { validate } from "@/lib/service/validation";

const ORG_ID = "123e4567-e89b-12d3-a456-426614174000";
const DOMAIN_ID = "223e4567-e89b-12d3-a456-426614174000";

describe("domainListQuerySchema", () => {
  it("applies defaults for an empty query", () => {
    const query = validate(domainListQuerySchema, {});
    expect(query.scope).toBe("all");
    expect(query.limit).toBe(50);
  });

  it("rejects an unknown scope", () => {
    expect(() => validate(domainListQuerySchema, { scope: "global" })).toThrow(ServiceError);
  });
});

describe("createOrgDomainSchema", () => {
  it("accepts a minimal org domain", () => {
    const input = validate(createOrgDomainSchema, {
      organizationId: ORG_ID,
      slug: "family-money",
      name: "Деньги в семье",
    });
    expect(input.language).toBe("ru");
    expect(input.lifeAreas).toEqual([]);
  });

  it("rejects unknown fields and invalid slugs", () => {
    expect(() =>
      validate(createOrgDomainSchema, {
        organizationId: ORG_ID,
        slug: "ok-slug",
        name: "x",
        isSystem: true,
      })
    ).toThrow(ServiceError);
    expect(() =>
      validate(createOrgDomainSchema, { organizationId: ORG_ID, slug: "Bad Slug", name: "x" })
    ).toThrow(ServiceError);
  });

  it("enforces the 0–100 range on defaultPriority", () => {
    expect(() =>
      validate(createOrgDomainSchema, {
        organizationId: ORG_ID,
        slug: "s",
        name: "x",
        defaultPriority: 101,
      })
    ).toThrow(ServiceError);
  });
});

describe("createOrgBeliefTemplateSchema", () => {
  const base = {
    organizationId: ORG_ID,
    diagnosticDomainId: DOMAIN_ID,
    statement: "Мне безопасно быть заметным",
  };

  it("accepts a minimal template and defaults polarity to unknown", () => {
    const input = validate(createOrgBeliefTemplateSchema, base);
    expect(input.statementPolarity).toBe("unknown");
  });

  it("rejects an invalid polarity", () => {
    expect(() =>
      validate(createOrgBeliefTemplateSchema, { ...base, statementPolarity: "strong" })
    ).toThrow(ServiceError);
  });

  it("never accepts evidence fields: a template is not evidence (SPEC §8.35)", () => {
    for (const field of ["evidence_count", "confidence", "confidence_score", "contexts_count"]) {
      expect(() => validate(createOrgBeliefTemplateSchema, { ...base, [field]: 5 })).toThrow(
        ServiceError
      );
    }
  });
});

describe("beliefTemplateListQuerySchema", () => {
  it("filters by domain and polarity", () => {
    const query = validate(beliefTemplateListQuerySchema, {
      domainId: DOMAIN_ID,
      polarity: "positive",
    });
    expect(query.domainId).toBe(DOMAIN_ID);
    expect(query.polarity).toBe("positive");
  });
});
