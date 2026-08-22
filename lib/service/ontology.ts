import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Tables } from "@/lib/supabase/database.types";
import { recordAudit, withAudit } from "./audit";
import { ServiceError } from "./errors";
import { decodeCursor, encodeCursor, pageQuerySchema, toPage, type Page } from "./pagination";
import { uuid, validate } from "./validation";

export type DiagnosticDomain = Tables<"diagnostic_domains">;
export type BeliefTemplate = Tables<"belief_templates">;
export type OntologyVersion = Tables<"ontology_versions">;

export const statementPolaritySchema = z.enum([
  "positive",
  "negative",
  "neutral",
  "mixed",
  "unknown",
]);

const slugSchema = z
  .string()
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "slug must be lowercase kebab-case")
  .max(100);

const slugListSchema = z.array(z.string().trim().min(1).max(100)).max(50);

export const libraryScopeSchema = z.enum(["system", "organization", "all"]).default("all");

/** List/search/filter contract for the diagnostic library (ticket 16, step 3). */
export const domainListQuerySchema = pageQuerySchema.extend({
  q: z.string().trim().min(1).max(200).optional(),
  domainGroup: z.string().trim().min(1).max(100).optional(),
  lifeArea: z.string().trim().min(1).max(100).optional(),
  scope: libraryScopeSchema,
});

export const beliefTemplateListQuerySchema = pageQuerySchema.extend({
  q: z.string().trim().min(1).max(200).optional(),
  domainId: uuid.optional(),
  polarity: statementPolaritySchema.optional(),
  scope: libraryScopeSchema,
});

/** Organization override: extends the library inside the caller's tenant only. */
export const createOrgDomainSchema = z
  .object({
    organizationId: uuid,
    slug: slugSchema,
    name: z.string().trim().min(1).max(200),
    description: z.string().trim().min(1).max(2000).optional(),
    domainGroup: z.string().trim().min(1).max(100).optional(),
    lifeAreas: slugListSchema.default([]),
    defaultPriority: z.number().int().min(0).max(100).optional(),
    applicableContexts: slugListSchema.default([]),
    contraindicatedContexts: slugListSchema.default([]),
    language: z
      .string()
      .regex(/^[a-z]{2}$/)
      .default("ru"),
  })
  .strict();

/**
 * A template is a diagnostic prompt, never evidence (SPEC §8.35, §3.5).
 * The strict schema deliberately rejects any evidence/score fields
 * (evidence_count, confidence, ...) — those appear only on Signals
 * created by real testing.
 */
export const createOrgBeliefTemplateSchema = z
  .object({
    organizationId: uuid,
    diagnosticDomainId: uuid,
    code: z.string().trim().min(1).max(100).optional(),
    statement: z.string().trim().min(1).max(2000),
    statementPolarity: statementPolaritySchema.default("unknown"),
    defaultLifeAreas: slugListSchema.default([]),
    defaultTags: slugListSchema.default([]),
    interpretationHint: z.string().trim().min(1).max(2000).optional(),
    rootHypothesisHint: z.string().trim().min(1).max(2000).optional(),
    language: z
      .string()
      .regex(/^[a-z]{2}$/)
      .default("ru"),
  })
  .strict();

async function requireUserId(client: SupabaseClient): Promise<string> {
  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user) throw new ServiceError("UNAUTHORIZED", "Authentication required");
  return user.id;
}

async function requireActiveMembership(
  client: SupabaseClient,
  organizationId: string,
  userId: string
): Promise<void> {
  const { data } = await client
    .from("organization_members")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("user_id", userId)
    .eq("status", "active")
    .maybeSingle();
  if (!data) {
    throw new ServiceError("FORBIDDEN", "Not an active member of this organization");
  }
}

/** Current active ontology version; every library record is pinned to one. */
async function requireActiveOntologyVersion(client: SupabaseClient): Promise<OntologyVersion> {
  const { data } = await client
    .from("ontology_versions")
    .select("*")
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) {
    throw new ServiceError("CONFLICT", "No active ontology version");
  }
  return data as OntologyVersion;
}

export async function listDomains(
  client: SupabaseClient,
  rawQuery: unknown
): Promise<Page<DiagnosticDomain>> {
  const query = validate(domainListQuerySchema, rawQuery ?? {});

  let request = client
    .from("diagnostic_domains")
    .select("*")
    .is("archived_at", null)
    .order("id", { ascending: true })
    .limit(query.limit + 1);

  if (query.q) {
    const pattern = `%${query.q.replaceAll("%", "").replaceAll(",", " ")}%`;
    request = request.or(`name.ilike.${pattern},description.ilike.${pattern}`);
  }
  if (query.domainGroup) request = request.eq("domain_group", query.domainGroup);
  if (query.lifeArea) request = request.contains("life_areas", [query.lifeArea]);
  if (query.scope === "system") request = request.is("organization_id", null);
  if (query.scope === "organization") request = request.not("organization_id", "is", null);
  if (query.cursor) request = request.gt("id", decodeCursor(query.cursor));

  const { data, error } = await request;
  if (error) throw new ServiceError("INTERNAL_ERROR", "Failed to list domains");

  return toPage((data ?? []) as DiagnosticDomain[], query.limit, (last) => encodeCursor(last.id));
}

export async function listBeliefTemplates(
  client: SupabaseClient,
  rawQuery: unknown
): Promise<Page<BeliefTemplate>> {
  const query = validate(beliefTemplateListQuerySchema, rawQuery ?? {});

  let request = client
    .from("belief_templates")
    .select("*")
    .is("archived_at", null)
    .order("id", { ascending: true })
    .limit(query.limit + 1);

  if (query.q) {
    const pattern = `%${query.q.replaceAll("%", "").replaceAll(",", " ")}%`;
    request = request.ilike("statement", pattern);
  }
  if (query.domainId) request = request.eq("diagnostic_domain_id", query.domainId);
  if (query.polarity) request = request.eq("statement_polarity", query.polarity);
  if (query.scope === "system") request = request.is("organization_id", null);
  if (query.scope === "organization") request = request.not("organization_id", "is", null);
  if (query.cursor) request = request.gt("id", decodeCursor(query.cursor));

  const { data, error } = await request;
  if (error) throw new ServiceError("INTERNAL_ERROR", "Failed to list belief templates");

  return toPage((data ?? []) as BeliefTemplate[], query.limit, (last) => encodeCursor(last.id));
}

export async function createOrgDomain(
  client: SupabaseClient,
  rawInput: unknown
): Promise<DiagnosticDomain> {
  const input = validate(createOrgDomainSchema, rawInput);
  const userId = await requireUserId(client);
  await requireActiveMembership(client, input.organizationId, userId);
  const ontology = await requireActiveOntologyVersion(client);

  const { data, error } = await client
    .from("diagnostic_domains")
    .insert({
      organization_id: input.organizationId,
      ontology_version_id: ontology.id,
      slug: input.slug,
      name: input.name,
      description: input.description ?? null,
      domain_group: input.domainGroup ?? null,
      life_areas: input.lifeAreas,
      default_priority: input.defaultPriority ?? null,
      applicable_contexts: input.applicableContexts,
      contraindicated_contexts: input.contraindicatedContexts,
      language: input.language,
      is_system: false,
      created_by: userId,
    })
    .select()
    .single();

  if (error) {
    if (error.code === "23505") {
      throw new ServiceError("CONFLICT", "Domain slug already exists in this organization");
    }
    throw new ServiceError("INTERNAL_ERROR", "Failed to create domain");
  }
  await recordAudit(client, {
    organizationId: input.organizationId,
    entityType: "diagnostic_domain",
    entityId: (data as DiagnosticDomain).id,
    action: "diagnostic_domain.create",
    after: data,
  });
  return data as DiagnosticDomain;
}

export async function createOrgBeliefTemplate(
  client: SupabaseClient,
  rawInput: unknown
): Promise<BeliefTemplate> {
  const input = validate(createOrgBeliefTemplateSchema, rawInput);
  const userId = await requireUserId(client);
  await requireActiveMembership(client, input.organizationId, userId);
  const ontology = await requireActiveOntologyVersion(client);

  // Org templates attach only to system domains or to domains of the same org.
  const { data: domain } = await client
    .from("diagnostic_domains")
    .select("id, organization_id")
    .eq("id", input.diagnosticDomainId)
    .is("archived_at", null)
    .maybeSingle();
  if (!domain) throw new ServiceError("NOT_FOUND", "Diagnostic domain not found");
  if (domain.organization_id !== null && domain.organization_id !== input.organizationId) {
    throw new ServiceError("FORBIDDEN", "Domain belongs to another organization");
  }

  const { data, error } = await client
    .from("belief_templates")
    .insert({
      organization_id: input.organizationId,
      diagnostic_domain_id: input.diagnosticDomainId,
      ontology_version_id: ontology.id,
      code: input.code ?? null,
      statement: input.statement,
      statement_polarity: input.statementPolarity,
      default_life_areas: input.defaultLifeAreas,
      default_tags: input.defaultTags,
      interpretation_hint: input.interpretationHint ?? null,
      root_hypothesis_hint: input.rootHypothesisHint ?? null,
      language: input.language,
      is_system: false,
      created_by: userId,
    })
    .select()
    .single();

  if (error) throw new ServiceError("INTERNAL_ERROR", "Failed to create belief template");
  await recordAudit(client, {
    organizationId: input.organizationId,
    entityType: "belief_template",
    entityId: (data as BeliefTemplate).id,
    action: "belief_template.create",
    after: data,
  });
  return data as BeliefTemplate;
}

/** Soft delete (ticket 03): org records are archived, never hard-deleted here. */
export async function archiveOrgDomain(client: SupabaseClient, domainId: string): Promise<void> {
  const { data: domain } = await client
    .from("diagnostic_domains")
    .select("*")
    .eq("id", domainId)
    .eq("is_system", false)
    .is("archived_at", null)
    .maybeSingle();
  if (!domain) throw new ServiceError("NOT_FOUND", "Domain not found or not editable");

  const archivedAt = new Date().toISOString();
  await withAudit(
    client,
    {
      organizationId: domain.organization_id,
      entityType: "diagnostic_domain",
      entityId: domain.id,
      action: "diagnostic_domain.archive",
      before: domain,
      after: { ...domain, archived_at: archivedAt },
    },
    async () => {
      const { data, error } = await client
        .from("diagnostic_domains")
        .update({ archived_at: archivedAt })
        .eq("id", domainId)
        .eq("is_system", false)
        .is("archived_at", null)
        .select("id");
      if (error || !data || data.length === 0) {
        throw new ServiceError("NOT_FOUND", "Domain not found or not editable");
      }
    }
  );
}

export async function archiveOrgBeliefTemplate(
  client: SupabaseClient,
  templateId: string
): Promise<void> {
  const { data: template } = await client
    .from("belief_templates")
    .select("*")
    .eq("id", templateId)
    .eq("is_system", false)
    .is("archived_at", null)
    .maybeSingle();
  if (!template) throw new ServiceError("NOT_FOUND", "Belief template not found or not editable");

  const archivedAt = new Date().toISOString();
  await withAudit(
    client,
    {
      organizationId: template.organization_id,
      entityType: "belief_template",
      entityId: template.id,
      action: "belief_template.archive",
      before: template,
      after: { ...template, archived_at: archivedAt },
    },
    async () => {
      const { data, error } = await client
        .from("belief_templates")
        .update({ archived_at: archivedAt })
        .eq("id", templateId)
        .eq("is_system", false)
        .is("archived_at", null)
        .select("id");
      if (error || !data || data.length === 0) {
        throw new ServiceError("NOT_FOUND", "Belief template not found or not editable");
      }
    }
  );
}
