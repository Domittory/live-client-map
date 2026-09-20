import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ServiceError } from "@/lib/service/errors";
import { addContradiction, reviewHypothesis } from "@/lib/service/hypotheses";
import { getModelReview } from "@/lib/service/model-review";
import { reviewTheme } from "@/lib/service/themes";

try {
  process.loadEnvFile(".env.local");
} catch {
  // no .env.local — the suite will skip
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const available = Boolean(url && anonKey && serviceKey);

/**
 * Ticket 12: the model review read model and the human review writes.
 *
 * These tests exercise the real database: AI proposals stay pending until an
 * explicit approve/reject, every decision writes its audit row with the actor,
 * and confirming one competing hypothesis never removes the others or their
 * contradicting evidence. A read-only or unassigned caller is denied by the
 * database, not by the service.
 */
describe.skipIf(!available)("model review + human decisions (ticket 12)", () => {
  const admin = createClient(url!, serviceKey!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const createdUserIds: string[] = [];
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

  async function createSignal(statement: string): Promise<string> {
    const { data, error } = await specialist.client.rpc("create_signal", {
      p_org_id: orgId,
      p_client_id: clientId,
      p_signal: {
        source_type: "client_report",
        epistemic_type: "self_report",
        raw_statement: statement,
        evidence_level: "L1_SINGLE_SIGNAL",
      },
    });
    if (error) throw new Error(error.message);
    return data as string;
  }

  async function createAiTheme(name: string, signalIds: string[] = []): Promise<string> {
    const { data, error } = await specialist.client.rpc("apply_ai_theme_proposals", {
      p_org_id: orgId,
      p_client_id: clientId,
      p_proposals: [
        {
          action: "create",
          name,
          description: "AI-предложение темы",
          domain: "работа",
          confidence: 60,
          signal_links: signalIds.map((signalId) => ({
            signal_id: signalId,
            relevance_score: 70,
            link_rationale: "Связь предложена AI",
          })),
        },
      ],
    });
    if (error) throw new Error(error.message);
    return (data as string[])[0];
  }

  async function createAiCoreNode(title: string, themeIds: string[] = []): Promise<string> {
    const { data, error } = await specialist.client.rpc("apply_ai_core_node_proposals", {
      p_org_id: orgId,
      p_client_id: clientId,
      p_proposals: [
        {
          action: "create",
          title,
          hypothesis: "AI-гипотеза узла",
          root_domain: "работа",
          confidence: 55,
          theme_links: themeIds,
          rationale: "Связь предложена AI",
        },
      ],
    });
    if (error) throw new Error(error.message);
    return (data as string[])[0];
  }

  async function createAiHypotheses(titles: string[]): Promise<string[]> {
    const { data, error } = await specialist.client.rpc("create_ai_hypotheses", {
      p_org_id: orgId,
      p_client_id: clientId,
      p_hypotheses: titles.map((title) => ({
        title,
        description: "Конкурирующее объяснение",
        confidence: 50,
        evidence_for: ["signal-for-1"],
        evidence_against: ["signal-against-1"],
      })),
    });
    if (error) throw new Error(error.message);
    return data as string[];
  }

  beforeAll(async () => {
    const owner = await createUser(`owner-${crypto.randomUUID()}@example.com`);
    const { data } = await owner.client.rpc("create_organization", { org_name: "Review Org" });
    orgId = data;

    specialist = await createUser(`spec-${crypto.randomUUID()}@example.com`);
    await admin.from("organization_members").insert({
      organization_id: orgId,
      user_id: specialist.id,
      role: "specialist",
      status: "active",
    });

    const { data: cid } = await specialist.client.rpc("create_client", {
      p_organization_id: orgId,
      p_display_name: "Review Client",
    });
    clientId = cid;
  });

  afterAll(async () => {
    for (const id of createdUserIds) {
      await admin.auth.admin.deleteUser(id);
    }
  });

  it("shows themes with signal links, nodes with theme links and every competing hypothesis", async () => {
    const signalId = await createSignal("Мне трудно отказывать руководителю");
    const themeId = await createAiTheme("Ответственность за других", [signalId]);
    const nodeId = await createAiCoreNode("Страх авторитета", [themeId]);
    const [first, second] = await createAiHypotheses([
      "A: поиск признания отца",
      "B: объективно токсичная среда",
    ]);

    const review = await getModelReview(specialist.client, {
      organizationId: orgId,
      clientId,
    });

    const theme = review.themes.find((entry) => entry.id === themeId);
    expect(theme).toBeTruthy();
    expect(theme!.reviewStatus).toBe("pending");
    expect(theme!.signalLinks.map((link) => link.signalId)).toContain(signalId);
    expect(theme!.trail.isAiProposed).toBe(true);
    expect(theme!.trail.supporting.map((item) => item.label)).toContain(
      "Мне трудно отказывать руководителю"
    );

    const node = review.coreNodes.find((entry) => entry.id === nodeId);
    expect(node).toBeTruthy();
    expect(node!.status).toBe("under_review");
    expect(node!.themeLinks.map((link) => link.themeId)).toContain(themeId);
    expect(node!.themeLinks[0].themeName).toBe("Ответственность за других");

    const hypothesisIds = review.hypotheses.map((entry) => entry.id);
    expect(hypothesisIds).toContain(first);
    expect(hypothesisIds).toContain(second);
    const hypothesis = review.hypotheses.find((entry) => entry.id === first)!;
    expect(hypothesis.status).toBe("hypothesis");
    expect(hypothesis.trail.supporting.map((item) => item.label)).toContain("signal-for-1");
    expect(hypothesis.trail.contradicting.map((item) => item.label)).toContain("signal-against-1");
  });

  it("renders a conclusion without evidence as insufficient data, never bare", async () => {
    const { data } = await specialist.client
      .from("themes")
      .insert({
        organization_id: orgId,
        client_id: clientId,
        name: "Пустая тема",
        review_status: "approved",
      })
      .select("id")
      .single();
    const themeId = data!.id as string;

    const review = await getModelReview(specialist.client, { organizationId: orgId, clientId });
    const theme = review.themes.find((entry) => entry.id === themeId)!;
    expect(theme.trail.hasSupportingEvidence).toBe(false);
    expect(theme.trail.supporting).toHaveLength(0);
    expect(theme.trail.limits.join(" ")).toContain("Нет подтверждающих доказательств");
  });

  it("approves a pending AI theme atomically with an audit row and never reviews it twice", async () => {
    const themeId = await createAiTheme("AI-тема для подтверждения");

    await reviewTheme(specialist.client, orgId, themeId, "approve", "Проверено на сессии");

    const { data: theme } = await specialist.client
      .from("themes")
      .select("review_status")
      .eq("id", themeId)
      .maybeSingle();
    expect(theme?.review_status).toBe("approved");

    const { data: audit } = await admin
      .from("audit_log")
      .select("action, actor_user_id, before_data, after_data, reason")
      .eq("entity_id", themeId)
      .eq("action", "theme.approve")
      .single();
    expect(audit?.actor_user_id).toBe(specialist.id);
    expect(audit?.before_data).toMatchObject({ review_status: "pending" });
    expect(audit?.after_data).toMatchObject({ review_status: "approved" });
    expect(audit?.reason).toBe("Проверено на сессии");

    // A confirmed entity is not re-decided by a repeated review call.
    await expect(
      reviewTheme(specialist.client, orgId, themeId, "reject", "передумал")
    ).rejects.toMatchObject({ code: "CONFLICT" });
    const { data: unchanged } = await specialist.client
      .from("themes")
      .select("review_status")
      .eq("id", themeId)
      .maybeSingle();
    expect(unchanged?.review_status).toBe("approved");
  });

  it("requires a reason to reject a theme and records it in the audit row", async () => {
    const themeId = await createAiTheme("AI-тема для отклонения");

    await expect(reviewTheme(specialist.client, orgId, themeId, "reject")).rejects.toBeInstanceOf(
      ServiceError
    );

    await reviewTheme(specialist.client, orgId, themeId, "reject", "Нет подтверждений в данных");

    const { data: theme } = await specialist.client
      .from("themes")
      .select("review_status")
      .eq("id", themeId)
      .maybeSingle();
    expect(theme?.review_status).toBe("rejected");

    const { data: audit } = await admin
      .from("audit_log")
      .select("action, reason")
      .eq("entity_id", themeId)
      .eq("action", "theme.reject")
      .single();
    expect(audit?.reason).toBe("Нет подтверждений в данных");
  });

  it("confirming one competing hypothesis keeps the others and their contradictions", async () => {
    const [first, second] = await createAiHypotheses([
      "A: конкурирующая гипотеза",
      "B: конкурирующая гипотеза",
    ]);
    await addContradiction(specialist.client, orgId, second, "signal-against-second");

    await reviewHypothesis(specialist.client, orgId, first, "approve", "Подтверждено специалистом");

    const { data: confirmed } = await specialist.client
      .from("differential_hypotheses")
      .select("status")
      .eq("id", first)
      .maybeSingle();
    expect(confirmed?.status).toBe("active");

    const { data: stillCompeting } = await specialist.client
      .from("differential_hypotheses")
      .select("status, evidence_for, evidence_against, confidence_score")
      .eq("id", second)
      .maybeSingle();
    expect(stillCompeting?.status).toBe("hypothesis");
    expect(stillCompeting?.evidence_against).toContain("signal-against-second");
    expect(stillCompeting?.confidence_score).toBe(40);

    const { data: audit } = await admin
      .from("audit_log")
      .select("action, actor_user_id, before_data, after_data, reason")
      .eq("entity_id", first)
      .eq("action", "hypothesis.approve")
      .single();
    expect(audit?.actor_user_id).toBe(specialist.id);
    expect(audit?.before_data).toMatchObject({ status: "hypothesis" });
    expect(audit?.after_data).toMatchObject({ status: "active" });
    expect(audit?.reason).toBe("Подтверждено специалистом");
  });

  it("requires a reason to reject a hypothesis", async () => {
    const [hypothesisId] = await createAiHypotheses(["C: гипотеза для отклонения"]);

    await expect(
      reviewHypothesis(specialist.client, orgId, hypothesisId, "reject")
    ).rejects.toBeInstanceOf(ServiceError);

    await reviewHypothesis(specialist.client, orgId, hypothesisId, "reject", "Не подтвердилась");

    const { data: hypothesis } = await specialist.client
      .from("differential_hypotheses")
      .select("status")
      .eq("id", hypothesisId)
      .maybeSingle();
    expect(hypothesis?.status).toBe("rejected");
  });

  it("does not create a review when the write is denied: read-only and unassigned", async () => {
    const themeId = await createAiTheme("AI-тема для проверки прав");
    const [hypothesisId] = await createAiHypotheses(["Гипотеза для проверки прав"]);

    const readOnly = await createUser(`readonly-${crypto.randomUUID()}@example.com`);
    await admin.from("organization_members").insert({
      organization_id: orgId,
      user_id: readOnly.id,
      role: "supervisor",
      status: "active",
    });
    await admin.from("client_assignments").insert({
      client_id: clientId,
      user_id: readOnly.id,
      access_role: "read_only",
    });

    const unassigned = await createUser(`unassigned-${crypto.randomUUID()}@example.com`);
    await admin.from("organization_members").insert({
      organization_id: orgId,
      user_id: unassigned.id,
      role: "specialist",
      status: "active",
    });

    // Read-only may read the model...
    const readOnlyReview = await getModelReview(readOnly.client, {
      organizationId: orgId,
      clientId,
    });
    expect(readOnlyReview.themes.some((theme) => theme.id === themeId)).toBe(true);

    // ...but the database denies the decision for both roles.
    await expect(reviewTheme(readOnly.client, orgId, themeId, "approve")).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(reviewTheme(unassigned.client, orgId, themeId, "approve")).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(
      reviewHypothesis(unassigned.client, orgId, hypothesisId, "approve")
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    const { data: theme } = await specialist.client
      .from("themes")
      .select("review_status")
      .eq("id", themeId)
      .maybeSingle();
    expect(theme?.review_status).toBe("pending");

    // An unassigned member sees no model at all.
    const unassignedReview = await getModelReview(unassigned.client, {
      organizationId: orgId,
      clientId,
    });
    expect(unassignedReview.themes).toHaveLength(0);
    expect(unassignedReview.coreNodes).toHaveLength(0);
    expect(unassignedReview.hypotheses).toHaveLength(0);
  });
});
