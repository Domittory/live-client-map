import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AiProvider, AiProviderCall, AiProviderResponse } from "@/lib/ai/provider";
import { generateRecommendations } from "@/lib/service/ai-recommendations";
import { classifyThemes } from "@/lib/service/ai-cluster";
import { updateCoreNodes } from "@/lib/service/ai-model";
import {
  archiveCoreNode,
  confirmCoreNode,
  createCoreNode,
  linkTheme,
  rejectCoreNode,
} from "@/lib/service/core-nodes";
import { createDevelopmentTarget } from "@/lib/service/development-targets";
import { createSignal } from "@/lib/service/diagnostics";
import { explainModelChanges, reviewModelExplanation } from "@/lib/service/explanations";
import { addContradiction, createHypothesis } from "@/lib/service/hypotheses";
import { archiveOrgMethod, createOrgMethod, updateOrgMethod } from "@/lib/service/interventions";
import { recordModelChange } from "@/lib/service/model-changes";
import { archiveOrgDomain, createOrgDomain } from "@/lib/service/ontology";
import { createPurposeProfile, createPurposeSynthesis } from "@/lib/service/purpose";
import { confirmCausalRelation, createRelation } from "@/lib/service/relations";
import { createResource, updateResource } from "@/lib/service/resources";
import { generateSnapshot } from "@/lib/service/snapshots";
import { createTheme, linkSignal, unlinkSignal } from "@/lib/service/themes";
import { connectFaultInjection, type FaultInjection } from "./support/fault-injection";

try {
  process.loadEnvFile(".env.local");
} catch {
  // no .env.local — the suite will skip
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const available = Boolean(url && anonKey && serviceKey);

class StubProvider implements AiProvider {
  readonly providerKey = "stub";
  readonly modelSnapshot = "stub-1";
  readonly reasoningEffort = "none";
  results: Record<string, unknown> = {};

  async complete(call: AiProviderCall): Promise<AiProviderResponse> {
    const result = this.results[call.functionId] ?? {};
    return {
      ok: true,
      output: {
        contract_version: call.contractVersion,
        request_id: (call.envelope as { request_id: string }).request_id,
        warnings: [],
        safety: { review_required: false, categories: [], rationale: "" },
        result,
      },
      inputTokens: 1,
      outputTokens: 1,
    };
  }
}

/**
 * Ticket 06: every compound mutation of the psychological model must commit the
 * entity, its child links, its evidence trail, the optional ModelChange row and
 * the AuditLog row in one transaction — or roll all of them back.
 *
 * Faults are injected through the local-only `test_support` schema created by
 * supabase/seed.sql (never present in a deployed database, never exposed through
 * PostgREST). When that support is missing the fault cases are skipped.
 */
describe.skipIf(!available)("atomic psychological model mutations (ticket 06)", () => {
  const admin = createClient(url!, serviceKey!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const createdUserIds: string[] = [];
  let faults: FaultInjection;
  let orgId: string;
  let clientId: string;
  let specialist: { id: string; client: SupabaseClient };

  function anonClient() {
    return createClient(url!, anonKey!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }

  async function createUser(email: string): Promise<{ id: string; client: SupabaseClient }> {
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password: "password123",
      email_confirm: true,
    });
    if (error) throw new Error(error.message);
    createdUserIds.push(data.user!.id);

    const client = anonClient();
    await client.auth.signInWithPassword({ email, password: "password123" });
    return { id: data.user!.id, client };
  }

  /** Run `action` with a fault registered, expecting it to fail and roll back. */
  async function withFault(
    point: string,
    marker: string,
    action: () => PromiseLike<unknown>
  ): Promise<void> {
    await faults.register(point, marker);
    try {
      await expect(Promise.resolve(action())).rejects.toThrow();
    } finally {
      await faults.clear();
    }
  }

  async function grantConsent(type: string, targetClientId = clientId): Promise<void> {
    const { error } = await specialist.client.rpc("grant_consent", {
      p_org_id: orgId,
      p_client_id: targetClientId,
      p_consent_type: type,
      p_scope: "client",
      p_document_version: "1.0",
    });
    if (error) throw new Error(`grant_consent ${type}: ${error.message}`);
  }

  /** Fresh client with every consent the model writes need. */
  async function createReadyClient(): Promise<string> {
    const { data, error } = await specialist.client.rpc("create_client", {
      p_organization_id: orgId,
      p_display_name: `Model client ${crypto.randomUUID()}`,
    });
    if (error) throw new Error(error.message);
    const id = data as string;
    await grantConsent("data_storage", id);
    await grantConsent("sensitive_psychological_data", id);
    await grantConsent("ai_analysis", id);
    return id;
  }

  async function auditRows(entityType: string, entityId?: string, action?: string) {
    let query = admin
      .from("audit_log")
      .select("id, action, actor_user_id")
      .eq("entity_type", entityType);
    if (entityId) query = query.eq("entity_id", entityId);
    if (action) query = query.eq("action", action);
    const { data } = await query;
    return data ?? [];
  }

  async function themeById(themeId: string) {
    const { data } = await admin
      .from("themes")
      .select("id, evidence_count, independent_evidence_count, contexts_count")
      .eq("id", themeId)
      .maybeSingle();
    return data;
  }

  beforeAll(async () => {
    faults = await connectFaultInjection();

    const owner = await createUser(`model-owner-${crypto.randomUUID()}@example.com`);
    const { data: org } = await owner.client.rpc("create_organization", {
      org_name: "Atomic Model Org",
    });
    orgId = org as string;

    specialist = await createUser(`model-spec-${crypto.randomUUID()}@example.com`);
    await admin.from("organization_members").insert({
      organization_id: orgId,
      user_id: specialist.id,
      role: "specialist",
      status: "active",
    });

    const { data: cid } = await specialist.client.rpc("create_client", {
      p_organization_id: orgId,
      p_display_name: "Atomic Model Client",
    });
    clientId = cid as string;

    await grantConsent("data_storage");
    await grantConsent("sensitive_psychological_data");
    await grantConsent("ai_analysis");
  });

  afterAll(async () => {
    await faults?.clear();
    await faults?.close();
    for (const id of createdUserIds) {
      await admin.auth.admin.deleteUser(id);
    }
  });

  // -------------------------------------------------------------------------
  // Themes
  // -------------------------------------------------------------------------

  it("commits a theme with its audit row", async () => {
    const name = `theme-${crypto.randomUUID()}`;

    const themeId = await createTheme(specialist.client, orgId, { clientId, name });

    const theme = await themeById(themeId);
    expect(theme?.id).toBe(themeId);
    const audit = await auditRows("theme", themeId, "theme.created");
    expect(audit).toHaveLength(1);
    expect(audit[0].actor_user_id).toBe(specialist.id);
  });

  it("rolls the theme back when the audit append fails", async (ctx) => {
    if (!faults.available) return ctx.skip();
    const name = `theme-fault-${crypto.randomUUID()}`;

    await withFault("audit_log", specialist.id, () =>
      createTheme(specialist.client, orgId, { clientId, name })
    );

    const { data } = await admin.from("themes").select("id").eq("name", name);
    expect(data ?? []).toHaveLength(0);
    const { data: audit } = await admin
      .from("audit_log")
      .select("id")
      .eq("after_data->>name", name);
    expect(audit ?? []).toHaveLength(0);
  });

  it("links a signal, recomputes the aggregates and audits in one transaction", async () => {
    const themeId = await createTheme(specialist.client, orgId, {
      clientId,
      name: `link-${crypto.randomUUID()}`,
    });
    const signalId = await createSignal(specialist.client, orgId, {
      clientId,
      sourceType: "client_report",
      epistemicType: "self_report",
      rawStatement: `signal-${crypto.randomUUID()}`,
    });

    await linkSignal(specialist.client, orgId, { themeId, signalId, relevanceScore: 90 });

    const theme = await themeById(themeId);
    expect(theme?.evidence_count).toBe(1);
    expect(theme?.independent_evidence_count).toBe(1);
    const audit = await auditRows("signal_theme_link", themeId, "theme.signal_linked");
    expect(audit).toHaveLength(1);
    // The audit row is written before the aggregate update, so a rollback would
    // leave neither — both are covered by the same transaction.
    const { data: links } = await admin
      .from("signal_theme_links")
      .select("id")
      .eq("theme_id", themeId)
      .eq("signal_id", signalId);
    expect(links).toHaveLength(1);
  });

  it("rolls the link and the recomputed aggregates back when the link insert fails", async (ctx) => {
    if (!faults.available) return ctx.skip();
    const themeId = await createTheme(specialist.client, orgId, {
      clientId,
      name: `link-fault-${crypto.randomUUID()}`,
    });
    const signalId = await createSignal(specialist.client, orgId, {
      clientId,
      sourceType: "client_report",
      epistemicType: "self_report",
      rawStatement: `signal-${crypto.randomUUID()}`,
    });

    await withFault("signal_theme_links", signalId, () =>
      linkSignal(specialist.client, orgId, { themeId, signalId })
    );

    const { data: links } = await admin
      .from("signal_theme_links")
      .select("id")
      .eq("theme_id", themeId);
    expect(links ?? []).toHaveLength(0);
    const theme = await themeById(themeId);
    expect(theme?.evidence_count).toBe(0);
    expect(await auditRows("signal_theme_link", themeId, "theme.signal_linked")).toHaveLength(0);
  });

  it("rolls an unlink back when the audit append fails", async (ctx) => {
    if (!faults.available) return ctx.skip();
    const themeId = await createTheme(specialist.client, orgId, {
      clientId,
      name: `unlink-${crypto.randomUUID()}`,
    });
    const signalId = await createSignal(specialist.client, orgId, {
      clientId,
      sourceType: "client_report",
      epistemicType: "self_report",
      rawStatement: `signal-${crypto.randomUUID()}`,
    });
    await linkSignal(specialist.client, orgId, { themeId, signalId });

    await withFault("audit_log", specialist.id, () =>
      unlinkSignal(specialist.client, orgId, themeId, signalId)
    );

    const { data: links } = await admin
      .from("signal_theme_links")
      .select("id")
      .eq("theme_id", themeId)
      .eq("signal_id", signalId);
    expect(links).toHaveLength(1);
    const theme = await themeById(themeId);
    expect(theme?.evidence_count).toBe(1);
  });

  // -------------------------------------------------------------------------
  // CoreNodes
  // -------------------------------------------------------------------------

  it("creates a core node and its audit row, or neither", async (ctx) => {
    const title = `node-${crypto.randomUUID()}`;
    const nodeId = await createCoreNode(specialist.client, orgId, {
      clientId,
      title,
      confidenceScore: 60,
    });

    const { data: node } = await admin
      .from("core_nodes")
      .select("status, confidence_score, created_by, last_confirmed_at")
      .eq("id", nodeId)
      .maybeSingle();
    expect(node?.status).toBe("hypothesis");
    expect(node?.confidence_score).toBe(60);
    expect(node?.created_by).toBe(specialist.id);
    expect(node?.last_confirmed_at).toBeNull();
    expect(await auditRows("core_node", nodeId, "core_node.created")).toHaveLength(1);

    if (!faults.available) return ctx.skip();
    const failedTitle = `node-fault-${crypto.randomUUID()}`;
    await withFault("audit_log", specialist.id, () =>
      createCoreNode(specialist.client, orgId, { clientId, title: failedTitle })
    );
    const { data: missing } = await admin.from("core_nodes").select("id").eq("title", failedTitle);
    expect(missing ?? []).toHaveLength(0);
  });

  it("confirming a node records the actor atomically; rejecting leaves no links or confidence change", async () => {
    const title = `node-confirm-${crypto.randomUUID()}`;
    const themeId = await createTheme(specialist.client, orgId, {
      clientId,
      name: `theme-${crypto.randomUUID()}`,
    });
    const nodeId = await createCoreNode(specialist.client, orgId, {
      clientId,
      title,
      confidenceScore: 45,
    });
    await linkTheme(specialist.client, orgId, {
      coreNodeId: nodeId,
      themeId,
      relationshipType: "supports",
    });

    await confirmCoreNode(specialist.client, orgId, nodeId);
    const { data: confirmed } = await admin
      .from("core_nodes")
      .select("status, last_confirmed_by, last_confirmed_at")
      .eq("id", nodeId)
      .maybeSingle();
    expect(confirmed?.status).toBe("active");
    expect(confirmed?.last_confirmed_by).toBe(specialist.id);
    expect(confirmed?.last_confirmed_at).not.toBeNull();
    expect(await auditRows("core_node", nodeId, "core_node.active")).toHaveLength(1);

    // Rejecting a different node must not touch its confidence or create links.
    const rejectedId = await createCoreNode(specialist.client, orgId, {
      clientId,
      title: `node-reject-${crypto.randomUUID()}`,
      confidenceScore: 70,
    });
    await rejectCoreNode(specialist.client, orgId, rejectedId);

    const { data: rejected } = await admin
      .from("core_nodes")
      .select("status, confidence_score")
      .eq("id", rejectedId)
      .maybeSingle();
    expect(rejected?.status).toBe("rejected");
    expect(rejected?.confidence_score).toBe(70);
    const { data: links } = await admin
      .from("theme_core_node_links")
      .select("id")
      .eq("core_node_id", rejectedId);
    expect(links ?? []).toHaveLength(0);
    expect(await auditRows("core_node", rejectedId, "core_node.rejected")).toHaveLength(1);
  });

  it("archive sets archived_at and its audit row, or neither", async (ctx) => {
    const nodeId = await createCoreNode(specialist.client, orgId, {
      clientId,
      title: `node-archive-${crypto.randomUUID()}`,
    });
    await archiveCoreNode(specialist.client, orgId, nodeId);
    const { data: archived } = await admin
      .from("core_nodes")
      .select("status, archived_at")
      .eq("id", nodeId)
      .maybeSingle();
    expect(archived?.status).toBe("archived");
    expect(archived?.archived_at).not.toBeNull();

    if (!faults.available) return ctx.skip();
    const failingId = await createCoreNode(specialist.client, orgId, {
      clientId,
      title: `node-archive-fault-${crypto.randomUUID()}`,
    });
    await withFault("audit_log", specialist.id, () =>
      archiveCoreNode(specialist.client, orgId, failingId)
    );
    const { data: untouched } = await admin
      .from("core_nodes")
      .select("status, archived_at")
      .eq("id", failingId)
      .maybeSingle();
    expect(untouched?.status).toBe("hypothesis");
    expect(untouched?.archived_at).toBeNull();
  });

  // -------------------------------------------------------------------------
  // DifferentialHypotheses
  // -------------------------------------------------------------------------

  it("commits a hypothesis and rolls it back when its audit append fails", async (ctx) => {
    const title = `hypo-${crypto.randomUUID()}`;
    const hypothesisId = await createHypothesis(specialist.client, orgId, { clientId, title });
    expect(
      await auditRows("differential_hypothesis", hypothesisId, "hypothesis.created")
    ).toHaveLength(1);

    if (!faults.available) return ctx.skip();
    const failingTitle = `hypo-fault-${crypto.randomUUID()}`;
    await withFault("audit_log", specialist.id, () =>
      createHypothesis(specialist.client, orgId, { clientId, title: failingTitle })
    );
    const { data } = await admin
      .from("differential_hypotheses")
      .select("id")
      .eq("title", failingTitle);
    expect(data ?? []).toHaveLength(0);
  });

  it("lowers confidence and audits a contradiction atomically", async (ctx) => {
    const hypothesisId = await createHypothesis(specialist.client, orgId, {
      clientId,
      title: `hypo-contradiction-${crypto.randomUUID()}`,
      confidenceScore: 60,
    });

    await addContradiction(specialist.client, orgId, hypothesisId, "signal-1");
    const { data: afterFirst } = await admin
      .from("differential_hypotheses")
      .select("confidence_score, evidence_against")
      .eq("id", hypothesisId)
      .maybeSingle();
    expect(afterFirst?.confidence_score).toBe(50);
    expect(afterFirst?.evidence_against).toEqual(["signal-1"]);

    if (!faults.available) return ctx.skip();
    await withFault("audit_log", specialist.id, () =>
      addContradiction(specialist.client, orgId, hypothesisId, "signal-2")
    );
    const { data: afterFault } = await admin
      .from("differential_hypotheses")
      .select("confidence_score, evidence_against")
      .eq("id", hypothesisId)
      .maybeSingle();
    // The contradiction and the confidence drop rolled back together.
    expect(afterFault?.confidence_score).toBe(50);
    expect(afterFault?.evidence_against).toEqual(["signal-1"]);
  });

  // -------------------------------------------------------------------------
  // Relations
  // -------------------------------------------------------------------------

  it("creates a relation with its audit row, or rolls both back", async (ctx) => {
    const from = await createCoreNode(specialist.client, orgId, {
      clientId,
      title: `rel-a-${crypto.randomUUID()}`,
    });
    const to = await createCoreNode(specialist.client, orgId, {
      clientId,
      title: `rel-b-${crypto.randomUUID()}`,
    });

    const relationId = await createRelation(specialist.client, orgId, {
      clientId,
      fromCoreNodeId: from,
      toCoreNodeId: to,
      relationType: "may_contribute_to",
      strength: 50,
    });
    expect(await auditRows("core_node_relation", relationId, "relation.created")).toHaveLength(1);

    if (!faults.available) return ctx.skip();
    const otherFrom = await createCoreNode(specialist.client, orgId, {
      clientId,
      title: `rel-c-${crypto.randomUUID()}`,
    });
    await withFault("core_node_relations", otherFrom, () =>
      createRelation(specialist.client, orgId, {
        clientId,
        fromCoreNodeId: otherFrom,
        toCoreNodeId: to,
        relationType: "reinforces",
      })
    );
    const { data: relations } = await admin
      .from("core_node_relations")
      .select("id")
      .eq("from_core_node_id", otherFrom);
    expect(relations ?? []).toHaveLength(0);
  });

  it("requires an explicit reason for causes_confirmed and rolls the type change back on a failed audit", async (ctx) => {
    const from = await createCoreNode(specialist.client, orgId, {
      clientId,
      title: `causal-a-${crypto.randomUUID()}`,
    });
    const to = await createCoreNode(specialist.client, orgId, {
      clientId,
      title: `causal-b-${crypto.randomUUID()}`,
    });
    const relationId = await createRelation(specialist.client, orgId, {
      clientId,
      fromCoreNodeId: from,
      toCoreNodeId: to,
      relationType: "associated_with",
    });

    await expect(
      confirmCausalRelation(specialist.client, orgId, relationId, "   ")
    ).rejects.toThrow();

    if (!faults.available) return ctx.skip();
    await withFault("audit_log", specialist.id, () =>
      confirmCausalRelation(specialist.client, orgId, relationId, "подтверждено специалистом")
    );
    const { data: afterFault } = await admin
      .from("core_node_relations")
      .select("relation_type")
      .eq("id", relationId)
      .maybeSingle();
    expect(afterFault?.relation_type).toBe("associated_with");

    await confirmCausalRelation(specialist.client, orgId, relationId, "подтверждено специалистом");
    const { data: confirmed } = await admin
      .from("core_node_relations")
      .select("relation_type")
      .eq("id", relationId)
      .maybeSingle();
    expect(confirmed?.relation_type).toBe("causes_confirmed");
    const audit = await auditRows("core_node_relation", relationId, "relation.causes_confirmed");
    expect(audit).toHaveLength(1);
  });

  // -------------------------------------------------------------------------
  // Resources, development targets, purpose
  // -------------------------------------------------------------------------

  it("commits a resource and rolls a failed score update back", async (ctx) => {
    const name = `resource-${crypto.randomUUID()}`;
    const resourceId = await createResource(specialist.client, orgId, {
      clientId,
      name,
      strengthScore: 70,
    });
    expect(await auditRows("resource", resourceId, "resource.created")).toHaveLength(1);

    if (!faults.available) return ctx.skip();
    await withFault("audit_log", specialist.id, () =>
      updateResource(specialist.client, orgId, {
        id: resourceId,
        strengthScore: 85,
        evidenceSummary: "заметное укрепление",
      })
    );
    const { data: afterFault } = await admin
      .from("resources")
      .select("strength_score")
      .eq("id", resourceId)
      .maybeSingle();
    expect(afterFault?.strength_score).toBe(70);

    await updateResource(specialist.client, orgId, {
      id: resourceId,
      strengthScore: 85,
      evidenceSummary: "заметное укрепление",
    });
    const { data: updated } = await admin
      .from("resources")
      .select("strength_score")
      .eq("id", resourceId)
      .maybeSingle();
    expect(updated?.strength_score).toBe(85);
    expect(await auditRows("resource", resourceId, "resource.updated")).toHaveLength(1);
  });

  it("commits a development target and its audit row together", async (ctx) => {
    const name = `target-${crypto.randomUUID()}`;
    const targetId = await createDevelopmentTarget(specialist.client, orgId, {
      clientId,
      name,
      currentLevel: 30,
      targetLevel: 70,
      successMarkers: ["marker"],
    });
    const { data: target } = await admin
      .from("development_targets")
      .select("name, current_level, success_markers")
      .eq("id", targetId)
      .maybeSingle();
    expect(target?.name).toBe(name);
    expect(target?.current_level).toBe(30);
    expect(target?.success_markers).toEqual(["marker"]);
    expect(
      await auditRows("development_target", targetId, "development_target.created")
    ).toHaveLength(1);

    if (!faults.available) return ctx.skip();
    const failingName = `target-fault-${crypto.randomUUID()}`;
    await withFault("audit_log", specialist.id, () =>
      createDevelopmentTarget(specialist.client, orgId, { clientId, name: failingName })
    );
    const { data } = await admin.from("development_targets").select("id").eq("name", failingName);
    expect(data ?? []).toHaveLength(0);
  });

  it("commits purpose profile and synthesis with their audit rows", async () => {
    const profileId = await createPurposeProfile(specialist.client, orgId, {
      clientId,
      sourceSystem: "human_design",
      rawData: { type: "Projector" },
    });
    expect(await auditRows("purpose_profile", profileId, "purpose_profile.created")).toHaveLength(
      1
    );

    const synthesisId = await createPurposeSynthesis(specialist.client, orgId, {
      clientId,
      summary: "synthesis",
    });
    expect(
      await auditRows("purpose_synthesis", synthesisId, "purpose_synthesis.created")
    ).toHaveLength(1);
  });

  // -------------------------------------------------------------------------
  // Catalogues
  // -------------------------------------------------------------------------

  it("commits an org method and rolls a failed update or archive back", async (ctx) => {
    const name = `method-${crypto.randomUUID()}`;
    const method = await createOrgMethod(specialist.client, {
      organizationId: orgId,
      name,
      contraindications: ["острое состояние"],
    });
    expect(
      await auditRows("intervention_method", method.id, "intervention_method.create")
    ).toHaveLength(1);

    if (!faults.available) return ctx.skip();
    await withFault("audit_log", specialist.id, () =>
      updateOrgMethod(specialist.client, {
        methodId: method.id,
        name: `${name} v2`,
      })
    );
    const { data: afterFault } = await admin
      .from("intervention_methods")
      .select("name")
      .eq("id", method.id)
      .maybeSingle();
    expect(afterFault?.name).toBe(name);

    await withFault("audit_log", specialist.id, () =>
      archiveOrgMethod(specialist.client, method.id)
    );
    const { data: notArchived } = await admin
      .from("intervention_methods")
      .select("archived_at")
      .eq("id", method.id)
      .maybeSingle();
    expect(notArchived?.archived_at).toBeNull();
  });

  it("commits an org domain and rolls it back when the audit append fails", async (ctx) => {
    const slug = `org-domain-${crypto.randomUUID().slice(0, 8)}`;
    const domain = await createOrgDomain(specialist.client, {
      organizationId: orgId,
      slug,
      name: "Домен модели",
    });
    expect(domain.slug).toBe(slug);
    expect(
      await auditRows("diagnostic_domain", domain.id, "diagnostic_domain.create")
    ).toHaveLength(1);

    await archiveOrgDomain(specialist.client, domain.id);
    const { data: archived } = await admin
      .from("diagnostic_domains")
      .select("archived_at")
      .eq("id", domain.id)
      .maybeSingle();
    expect(archived?.archived_at).not.toBeNull();

    if (!faults.available) return ctx.skip();
    const failingSlug = `org-domain-fault-${crypto.randomUUID().slice(0, 8)}`;
    await withFault("audit_log", specialist.id, () =>
      createOrgDomain(specialist.client, {
        organizationId: orgId,
        slug: failingSlug,
        name: "Домен-фолт",
      })
    );
    const { data } = await admin.from("diagnostic_domains").select("id").eq("slug", failingSlug);
    expect(data ?? []).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // Model history: ModelChange, snapshot, explanation
  // -------------------------------------------------------------------------

  it("records a ModelChange with its audit row, or neither", async (ctx) => {
    const nodeId = await createCoreNode(specialist.client, orgId, {
      clientId,
      title: `change-node-${crypto.randomUUID()}`,
    });

    if (!faults.available) return ctx.skip();
    // A failure while writing the ModelChange row itself leaves no audit row.
    const failingReason = `change-fault-${crypto.randomUUID()}`;
    await withFault("model_changes", failingReason, () =>
      recordModelChange(specialist.client, {
        organizationId: orgId,
        clientId,
        entityType: "core_node",
        entityId: nodeId,
        previousState: { confidence_score: 10 },
        newState: { confidence_score: 20 },
        changeReason: failingReason,
        evidenceRefs: [],
      })
    );
    const { data: missing } = await admin
      .from("model_changes")
      .select("id")
      .eq("change_reason", failingReason);
    expect(missing ?? []).toHaveLength(0);

    // A failure on the audit append rolls the ModelChange row back.
    const auditFaultReason = `change-audit-fault-${crypto.randomUUID()}`;
    await withFault("audit_log", specialist.id, () =>
      recordModelChange(specialist.client, {
        organizationId: orgId,
        clientId,
        entityType: "core_node",
        entityId: nodeId,
        previousState: { confidence_score: 10 },
        newState: { confidence_score: 20 },
        changeReason: auditFaultReason,
        evidenceRefs: [],
      })
    );
    const { data: afterAuditFault } = await admin
      .from("model_changes")
      .select("id")
      .eq("change_reason", auditFaultReason);
    expect(afterAuditFault ?? []).toHaveLength(0);

    const change = await recordModelChange(specialist.client, {
      organizationId: orgId,
      clientId,
      entityType: "core_node",
      entityId: nodeId,
      previousState: { confidence_score: 10 },
      newState: { confidence_score: 20 },
      changeReason: `change-ok-${crypto.randomUUID()}`,
      evidenceRefs: [],
    });
    expect(change.new_state).toEqual({ confidence_score: 20 });
    const { data: audits } = await admin
      .from("audit_log")
      .select("id")
      .eq("entity_type", "model_change")
      .eq("action", "model_change.record");
    expect((audits ?? []).length).toBeGreaterThanOrEqual(1);
  });

  it("commits a snapshot with its audit row, or neither", async (ctx) => {
    const reason = `snapshot-${crypto.randomUUID()}`;
    const snapshot = await generateSnapshot(specialist.client, { clientId, reason });
    expect(snapshot.reason).toBe(reason);
    expect(snapshot.version).toBeGreaterThanOrEqual(1);
    const { data: audits } = await admin
      .from("audit_log")
      .select("id, reason")
      .eq("entity_type", "psychological_snapshot")
      .eq("action", "snapshot.generate")
      .eq("reason", reason);
    expect(audits).toHaveLength(1);

    if (!faults.available) return ctx.skip();
    const auditFaultReason = `snapshot-audit-fault-${crypto.randomUUID()}`;
    await withFault("audit_log", specialist.id, () =>
      generateSnapshot(specialist.client, { clientId, reason: auditFaultReason })
    );
    const { data: rolledBack } = await admin
      .from("psychological_snapshots")
      .select("id")
      .eq("client_id", clientId)
      .eq("reason", auditFaultReason);
    expect(rolledBack ?? []).toHaveLength(0);

    const rowFaultReason = `snapshot-row-fault-${crypto.randomUUID()}`;
    await withFault("psychological_snapshots", rowFaultReason, () =>
      generateSnapshot(specialist.client, { clientId, reason: rowFaultReason })
    );
    const { data: noRow } = await admin
      .from("psychological_snapshots")
      .select("id")
      .eq("client_id", clientId)
      .eq("reason", rowFaultReason);
    expect(noRow ?? []).toHaveLength(0);
    const { data: noAudit } = await admin
      .from("audit_log")
      .select("id")
      .eq("reason", rowFaultReason);
    expect(noAudit ?? []).toHaveLength(0);
  });

  it("stores an AI explanation as pending and rolls it back when its audit append fails", async (ctx) => {
    const readyClientId = await createReadyClient();

    const provider = new StubProvider();
    const explanation = await explainModelChanges(specialist.client, provider, {
      clientId: readyClientId,
    });
    // No snapshots for a fresh client → the deterministic guard names the gaps.
    expect(explanation.source).toBe("deterministic_guard");
    expect(explanation.status).toBe("pending");
    expect(explanation.missing_evidence).toContain("snapshots");

    if (!faults.available) return ctx.skip();
    await withFault("audit_log", specialist.id, () =>
      explainModelChanges(specialist.client, provider, { clientId: readyClientId })
    );
    const { data: rows } = await admin
      .from("model_explanations")
      .select("id, status")
      .eq("client_id", readyClientId);
    // Only the first (committed) explanation exists.
    expect(rows ?? []).toHaveLength(1);
    expect(rows?.[0].status).toBe("pending");
  });

  it("reviews a pending explanation atomically and a failed audit leaves it pending", async () => {
    const readyClientId = await createReadyClient();
    const provider = new StubProvider();
    const explanation = await explainModelChanges(specialist.client, provider, {
      clientId: readyClientId,
    });
    expect(explanation.status).toBe("pending");

    // Rejecting never touches the model: no CoreNode/relation rows change.
    const before = await admin
      .from("core_nodes")
      .select("id, status, confidence_score")
      .eq("client_id", readyClientId);

    if (faults.available) {
      await withFault("audit_log", specialist.id, () =>
        reviewModelExplanation(specialist.client, {
          explanationId: explanation.id,
          decision: "reject",
        })
      );
      const { data: stillPending } = await admin
        .from("model_explanations")
        .select("status")
        .eq("id", explanation.id)
        .maybeSingle();
      expect(stillPending?.status).toBe("pending");
    }

    const rejected = await reviewModelExplanation(specialist.client, {
      explanationId: explanation.id,
      decision: "reject",
    });
    expect(rejected.status).toBe("rejected");
    expect(rejected.decided_by).toBe(specialist.id);
    const { data: audits } = await admin
      .from("audit_log")
      .select("id")
      .eq("entity_type", "model_explanation")
      .eq("entity_id", explanation.id)
      .eq("action", "model_explanation.reject");
    expect(audits).toHaveLength(1);

    const after = await admin
      .from("core_nodes")
      .select("id, status, confidence_score")
      .eq("client_id", readyClientId);
    expect(after.data).toEqual(before.data);
  });

  // -------------------------------------------------------------------------
  // AI recommendations (parent + child links)
  // -------------------------------------------------------------------------

  function recommendationProvider(targetRef: string, proposed: string) {
    const provider = new StubProvider();
    provider.results["ai.generate-recommendations.v1"] = {
      recommendations: [
        {
          candidate_key: "rec1",
          proposed_correction: proposed,
          rationale: "rationale",
          target_refs: [{ ref: targetRef, role: "primary", expected_effect: "effect" }],
          score_card_ref: targetRef,
          risk_notes: "notes",
          human_review_required: false,
          missing_evidence: [],
          rank_rationale: "rank",
        },
      ],
    };
    return provider;
  }

  function recommendationInput(targetRef: string, risk: number) {
    return {
      organizationId: orgId,
      clientId,
      clientRequestId: null,
      activeClientRequest: "",
      approvedEntities: [],
      resources: [],
      developmentTargets: [],
      scoreCards: [
        {
          ref: targetRef,
          inputs: {
            rootnessScore: 50,
            impactScore: 50,
            activationScore: 50,
            confidenceScore: 50,
            clientRelevanceScore: 50,
            readinessScore: 50,
            unlockScore: 50,
            riskScore: risk,
          },
        },
      ],
      risks: [],
      priorCorrections: [],
      allowedInterventionMethods: [],
    };
  }

  it("keeps AI recommendations as internal drafts and applies the risk gate", async () => {
    const targetRef = crypto.randomUUID();
    const proposed = `rec-${crypto.randomUUID()}`;

    const ids = await generateRecommendations(
      specialist.client,
      recommendationProvider(targetRef, proposed),
      recommendationInput(targetRef, 85)
    );

    expect(ids).toHaveLength(1);
    const { data: recommendation } = await admin
      .from("recommendations")
      .select("status, visibility, human_review_required")
      .eq("id", ids[0])
      .maybeSingle();
    expect(recommendation?.status).toBe("draft");
    expect(recommendation?.visibility).toBe("internal");
    // risk_score >= 80 forces human review even though the model said false.
    expect(recommendation?.human_review_required).toBe(true);

    const { data: targets } = await admin
      .from("recommendation_targets")
      .select("target_id")
      .eq("recommendation_id", ids[0]);
    expect(targets).toHaveLength(1);

    const { data: audits } = await admin
      .from("audit_log")
      .select("id")
      .eq("entity_type", "client")
      .eq("action", "ai.generate_recommendations");
    expect((audits ?? []).length).toBeGreaterThanOrEqual(1);
  });

  it("rolls the parent recommendation back when a child target link fails", async (ctx) => {
    if (!faults.available) return ctx.skip();
    const targetRef = crypto.randomUUID();
    const proposed = `rec-fault-${crypto.randomUUID()}`;

    await withFault("recommendation_targets", targetRef, () =>
      generateRecommendations(
        specialist.client,
        recommendationProvider(targetRef, proposed),
        recommendationInput(targetRef, 40)
      )
    );

    const { data: rows } = await admin
      .from("recommendations")
      .select("id")
      .eq("client_id", clientId)
      .eq("proposed_correction", proposed);
    expect(rows ?? []).toHaveLength(0);
  });

  it("rolls the whole AI recommendation batch back when the audit append fails", async (ctx) => {
    if (!faults.available) return ctx.skip();
    const targetRef = crypto.randomUUID();
    const proposed = `rec-audit-fault-${crypto.randomUUID()}`;

    await withFault("audit_log", specialist.id, () =>
      generateRecommendations(
        specialist.client,
        recommendationProvider(targetRef, proposed),
        recommendationInput(targetRef, 40)
      )
    );

    const { data: rows } = await admin
      .from("recommendations")
      .select("id")
      .eq("client_id", clientId)
      .eq("proposed_correction", proposed);
    expect(rows ?? []).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // Human-in-the-loop: AI proposals stay pending
  // -------------------------------------------------------------------------

  it("never lets an AI core node proposal overwrite a confirmed node", async () => {
    const confirmedId = await createCoreNode(specialist.client, orgId, {
      clientId,
      title: `confirmed-${crypto.randomUUID()}`,
    });
    await confirmCoreNode(specialist.client, orgId, confirmedId);

    const provider = new StubProvider();
    provider.results["ai.update-core-nodes.v1"] = {
      core_node_proposals: [
        {
          candidate_key: "n1",
          action: "create",
          existing_core_node_id: null,
          title: `ai-node-${crypto.randomUUID()}`,
          hypothesis: "ai",
          root_domain: null,
          proposed_status: "under_review",
          theme_links: [],
          evidence_refs: [],
          contradictions_considered: [],
          confidence: 70,
          rationale: "ai",
        },
        {
          candidate_key: "n2",
          action: "update",
          existing_core_node_id: confirmedId,
          title: "overwritten",
          hypothesis: "ai",
          root_domain: null,
          proposed_status: "under_review",
          theme_links: [],
          evidence_refs: [],
          contradictions_considered: [],
          confidence: 99,
          rationale: "ai",
        },
      ],
    };

    const touched = await updateCoreNodes(specialist.client, provider, {
      organizationId: orgId,
      clientId,
      approvedThemes: [],
      themeLinks: [],
      existingCoreNodes: [],
      contradictions: [],
      deterministicScoreInputs: {},
      currentClientRequestSummary: "",
    });

    // Only the create proposal is applied; the confirmed node is never returned
    // and stays untouched.
    expect(touched).toHaveLength(1);
    const { data: created } = await admin
      .from("core_nodes")
      .select("status, evidence_count, confidence_score")
      .eq("id", touched[0])
      .maybeSingle();
    expect(created?.status).toBe("under_review");
    expect(created?.evidence_count).toBe(0);

    const { data: confirmed } = await admin
      .from("core_nodes")
      .select("title, status, confidence_score")
      .eq("id", confirmedId)
      .maybeSingle();
    expect(confirmed?.status).toBe("active");
    expect(confirmed?.title).not.toBe("overwritten");
  });

  // -------------------------------------------------------------------------
  // AI proposal batches
  // -------------------------------------------------------------------------

  it("keeps AI core node proposals pending and rolls the whole batch back on a failed audit", async (ctx) => {
    const title = `ai-batch-${crypto.randomUUID()}`;
    const provider = new StubProvider();
    provider.results["ai.update-core-nodes.v1"] = {
      core_node_proposals: [
        {
          candidate_key: "n1",
          action: "create",
          existing_core_node_id: null,
          title,
          hypothesis: "ai",
          root_domain: null,
          proposed_status: "under_review",
          theme_links: [],
          evidence_refs: [],
          contradictions_considered: [],
          confidence: 70,
          rationale: "ai",
        },
      ],
    };

    if (!faults.available) return ctx.skip();
    await withFault("audit_log", specialist.id, () =>
      updateCoreNodes(specialist.client, provider, {
        organizationId: orgId,
        clientId,
        approvedThemes: [],
        themeLinks: [],
        existingCoreNodes: [],
        contradictions: [],
        deterministicScoreInputs: {},
        currentClientRequestSummary: `first-${crypto.randomUUID()}`,
      })
    );
    const { data: missing } = await admin.from("core_nodes").select("id").eq("title", title);
    expect(missing ?? []).toHaveLength(0);

    const ids = await updateCoreNodes(specialist.client, provider, {
      organizationId: orgId,
      clientId,
      approvedThemes: [],
      themeLinks: [],
      existingCoreNodes: [],
      contradictions: [],
      deterministicScoreInputs: {},
      currentClientRequestSummary: `second-${crypto.randomUUID()}`,
    });
    expect(ids).toHaveLength(1);
    const { data: node } = await admin
      .from("core_nodes")
      .select("status, evidence_count, independent_evidence_count")
      .eq("id", ids[0])
      .maybeSingle();
    expect(node?.status).toBe("under_review");
    expect(node?.evidence_count).toBe(0);
    expect(node?.independent_evidence_count).toBe(0);
  });

  it("rolls an AI-created theme back when one of its signal links fails", async (ctx) => {
    const name = `ai-theme-${crypto.randomUUID()}`;
    const signalId = await createSignal(specialist.client, orgId, {
      clientId,
      sourceType: "client_report",
      epistemicType: "self_report",
      rawStatement: `signal-${crypto.randomUUID()}`,
    });

    const provider = new StubProvider();
    provider.results["ai.classify-themes.v1"] = {
      theme_proposals: [
        {
          candidate_key: "t1",
          action: "create",
          existing_theme_id: null,
          name,
          description: "ai",
          domain: null,
          confidence: 60,
          signal_links: [{ signal_id: signalId, relevance_score: 80, link_rationale: "ai" }],
          rationale: "ai",
        },
      ],
    };

    if (!faults.available) return ctx.skip();
    await withFault("signal_theme_links", signalId, () =>
      classifyThemes(specialist.client, provider, {
        organizationId: orgId,
        clientId,
        reviewedSignals: [],
        evidenceClusters: [],
        existingThemes: [],
        currentModelSummary: `first-${crypto.randomUUID()}`,
      })
    );
    const { data: missing } = await admin.from("themes").select("id").eq("name", name);
    expect(missing ?? []).toHaveLength(0);

    const themeIds = await classifyThemes(specialist.client, provider, {
      organizationId: orgId,
      clientId,
      reviewedSignals: [],
      evidenceClusters: [],
      existingThemes: [],
      currentModelSummary: `second-${crypto.randomUUID()}`,
    });
    expect(themeIds).toHaveLength(1);
    const { data: theme } = await admin
      .from("themes")
      .select("review_status")
      .eq("id", themeIds[0])
      .maybeSingle();
    // AI-created themes stay pending human review.
    expect(theme?.review_status).toBe("pending");
  });

  // -------------------------------------------------------------------------
  // Tenant / assignment / consent inside the transaction
  // -------------------------------------------------------------------------

  it("checks tenant, assignment and consent inside the RPC boundary", async () => {
    const name = `tenant-${crypto.randomUUID()}`;

    // An active member without a ClientAssignment cannot write model rows.
    const unassigned = await createUser(`model-unassigned-${crypto.randomUUID()}@example.com`);
    await admin.from("organization_members").insert({
      organization_id: orgId,
      user_id: unassigned.id,
      role: "specialist",
      status: "active",
    });
    await expect(createTheme(unassigned.client, orgId, { clientId, name })).rejects.toThrow();
    const { data: denied } = await admin.from("themes").select("id").eq("name", name);
    expect(denied ?? []).toHaveLength(0);

    // Cross-tenant: an owner of another organization must not reach this client
    // (the owner exception in is_client_accessible does not check the tenant).
    const outsider = await createUser(`model-outsider-${crypto.randomUUID()}@example.com`);
    const { data: otherOrg } = await outsider.client.rpc("create_organization", {
      org_name: `Other Model Org ${crypto.randomUUID()}`,
    });
    const crossName = `tenant-cross-${crypto.randomUUID()}`;
    await expect(
      createTheme(outsider.client, otherOrg as string, { clientId, name: crossName })
    ).rejects.toThrow();
    const { data: crossDenied } = await admin.from("themes").select("id").eq("name", crossName);
    expect(crossDenied ?? []).toHaveLength(0);

    // Consent is asserted inside create_snapshot, not only in the service.
    const { data: bareClient, error: bareError } = await specialist.client.rpc("create_client", {
      p_organization_id: orgId,
      p_display_name: `No-consent client ${crypto.randomUUID()}`,
    });
    if (bareError) throw new Error(bareError.message);
    const { error: consentError } = await specialist.client.rpc("create_snapshot", {
      p_org_id: orgId,
      p_client_id: bareClient as string,
      p_reason: "no-consent",
      p_payload: {
        summary: "",
        active_core_nodes: [],
        active_themes: [],
        resource_state: [],
        development_targets: [],
        weakened_nodes: [],
        reactivated_nodes: [],
        recent_triggers: [],
        recent_corrections: [],
        current_requests: [],
        recommendations: [],
        trend_summary: "",
        risk_notes: "",
        evidence_digest: "",
        changes_since_previous: null,
        model_hash: "0".repeat(64),
        scoring_model_version: "1.0.0",
        ontology_version: "1.0.0",
        ai_model: "stub",
        prompt_version: "stub",
      },
    });
    expect(consentError).not.toBeNull();
    const { data: snapshots } = await admin
      .from("psychological_snapshots")
      .select("id")
      .eq("client_id", bareClient as string);
    expect(snapshots ?? []).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // Least privilege
  // -------------------------------------------------------------------------

  it("keeps the new RPCs unavailable to anonymous callers", async () => {
    const anon = anonClient();
    const { error } = await anon.rpc("create_theme", {
      p_org_id: orgId,
      p_client_id: clientId,
      p_name: `anon-${crypto.randomUUID()}`,
    });
    expect(error).not.toBeNull();
  });
});
