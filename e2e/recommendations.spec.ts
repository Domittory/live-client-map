import { expect, test, type Page } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  WorkspaceFixture,
  signInThroughLoginForm,
  workspaceNav,
  type TestWorkspace,
} from "./support/fixtures";

/**
 * Ticket 13 — the positive layer of the client workspace through the browser:
 * Resources, DevelopmentTargets, Purpose and Recommendations.
 *
 * Every test builds its own tenant and seeds evidence through the real product
 * RPCs, then drives the screens as a specialist and observes the database with
 * the service-role client. The point is that a conclusion is never rendered
 * without its evidence and limits, that an AI Recommendation stays a draft until
 * an explicit human decision, that publishing is a separate specialist control,
 * and that the database — not the UI — denies a caller without write access.
 */
test.describe.configure({ timeout: 120_000 });

const SIGNAL_STATEMENT = "Клиент избегает конфликта с руководителем";
const NODE_TITLE = "Страх авторитета";
const RECOMMENDATION_TEXT = "Работа с внутренней опорой рядом с авторитетной фигурой";

interface SeededNode {
  nodeId: string;
  requestId: string;
}

/** Evidence → Theme → CoreNode through the real product RPCs. */
async function seedNodeWithEvidence(
  workspace: TestWorkspace,
  writer: SupabaseClient
): Promise<SeededNode> {
  const { organizationId, clientId } = workspace;

  const { data: requestId, error: requestError } = await writer
    .from("client_requests")
    .insert({ organization_id: organizationId, client_id: clientId, title: "Запрос на рост" })
    .select("id")
    .single();
  if (requestError) throw new Error(`client request seed failed: ${requestError.message}`);

  const { data: signalId, error: signalError } = await writer.rpc("create_signal", {
    p_org_id: organizationId,
    p_client_id: clientId,
    p_signal: {
      source_type: "client_report",
      epistemic_type: "self_report",
      raw_statement: SIGNAL_STATEMENT,
      evidence_level: "L1_SINGLE_SIGNAL",
    },
  });
  if (signalError) throw new Error(`create_signal failed: ${signalError.message}`);

  const { data: themeIds, error: themeError } = await writer.rpc("apply_ai_theme_proposals", {
    p_org_id: organizationId,
    p_client_id: clientId,
    p_proposals: [
      {
        action: "create",
        name: "Избегание конфликта",
        description: "AI-предложение темы",
        domain: "работа",
        confidence: 60,
        signal_links: [
          {
            signal_id: signalId as string,
            relevance_score: 70,
            link_rationale: "Связь предложена AI",
          },
        ],
      },
    ],
  });
  if (themeError) throw new Error(`apply_ai_theme_proposals failed: ${themeError.message}`);

  const { data: nodeId, error: nodeError } = await writer.rpc("create_core_node", {
    p_org_id: organizationId,
    p_client_id: clientId,
    p_title: NODE_TITLE,
    p_hypothesis: "рабочая гипотеза узла",
    p_root_domain: "работа",
    p_confidence_score: 55,
  });
  if (nodeError) throw new Error(`create_core_node failed: ${nodeError.message}`);

  const { error: linkError } = await writer.rpc("link_theme_core_node", {
    p_org_id: organizationId,
    p_core_node_id: nodeId as string,
    p_theme_id: (themeIds as string[])[0],
    p_relationship_type: "supports",
    p_confidence: 60,
    p_link_rationale: "Связь подтверждена специалистом",
  });
  if (linkError) throw new Error(`link_theme_core_node failed: ${linkError.message}`);

  return { nodeId: nodeId as string, requestId: requestId!.id as string };
}

/** A pending AI Recommendation, created through the same RPC the AI service uses. */
async function seedDraftRecommendation(
  workspace: TestWorkspace,
  writer: SupabaseClient,
  options: { nodeId?: string; requestId?: string | null; unranked?: boolean } = {}
): Promise<string> {
  const targets = options.nodeId
    ? [{ target_type: null, target_id: options.nodeId, role: "primary", expected_effect: "опора" }]
    : [];

  // `unranked` reproduces the AI answer for a client without a complete score
  // card: no scores at all, so the priority stays null instead of being invented.
  const scores = options.unranked
    ? {
        rootness_score: null,
        impact_score: null,
        activation_score: null,
        confidence_score: null,
        client_relevance_score: null,
        readiness_score: null,
        unlock_score: null,
        risk_score: null,
        systemic_leverage_score: null,
        final_priority_score: null,
      }
    : {
        rootness_score: 92,
        impact_score: 88,
        activation_score: 79,
        confidence_score: 83,
        client_relevance_score: 94,
        readiness_score: 70,
        unlock_score: 86,
        risk_score: 42,
        systemic_leverage_score: 80.6,
        final_priority_score: 79.2,
      };

  const { data, error } = await writer.rpc("create_recommendations", {
    p_org_id: workspace.organizationId,
    p_client_id: workspace.clientId,
    p_payload: {
      client_request_id: options.requestId ?? null,
      items: [
        {
          proposed_correction: RECOMMENDATION_TEXT,
          rationale: "высокий rootness и unlock",
          ...scores,
          scoring_model_version: "1.0.0",
          risk_notes: "низкий риск",
          missing_evidence: options.unranked ? ["недостаточно независимых контекстов"] : [],
          rank_rationale: "наибольший системный эффект для текущего запроса",
          human_review_required: false,
          targets,
        },
      ],
    },
  });
  if (error) throw new Error(`create_recommendations failed: ${error.message}`);
  return (data as string[])[0];
}

/** Consent rows the AI gateway and the Client Portal require. */
async function grantConsents(fixtures: WorkspaceFixture, workspace: TestWorkspace): Promise<void> {
  const { error } = await fixtures
    .serviceRoleClient()
    .from("consent_records")
    .insert([
      {
        organization_id: workspace.organizationId,
        client_id: workspace.clientId,
        consent_type: "ai_analysis",
        document_version: "1.0",
      },
      {
        organization_id: workspace.organizationId,
        client_id: workspace.clientId,
        consent_type: "client_portal",
        document_version: "1.0",
      },
    ]);
  if (error) throw new Error(`consent seed failed: ${error.message}`);
}

async function createSpecialist(
  fixtures: WorkspaceFixture,
  workspace: TestWorkspace
): Promise<{ id: string; email: string; password: string }> {
  const specialist = await fixtures.createUser("positive-layer");
  await fixtures.addMember(workspace.organizationId, specialist);
  await fixtures.assign(workspace.clientId, specialist, "primary_specialist");
  return specialist;
}

function card(page: Page, testId: string, text: string) {
  return page.getByTestId(testId).filter({ hasText: text });
}

test.describe("client resources, development targets and purpose", () => {
  let fixtures: WorkspaceFixture;

  test.beforeEach(() => {
    fixtures = new WorkspaceFixture();
  });

  test.afterEach(async () => {
    await fixtures.cleanup();
  });

  test("specialist creates and edits a resource and a development target in the client context", async ({
    page,
  }) => {
    const workspace = await fixtures.createWorkspace("Клиент ресурсов");
    const specialist = await createSpecialist(fixtures, workspace);
    const admin = fixtures.serviceRoleClient();

    await signInThroughLoginForm(page, specialist);
    await page.goto(`/clients/${workspace.clientId}/resources`);
    await expect(
      workspaceNav(page).getByRole("link", { name: "Ресурсы", exact: true })
    ).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("textbox", { name: /client_id/i })).toHaveCount(0);
    await expect(page.getByTestId("resources-policy-note")).toContainText("недостаточно данных");

    // --- Create a Resource ------------------------------------------------
    const resourceForm = page.getByTestId("resource-form");
    await resourceForm.locator("input[name=name]").fill("Внутренняя опора");
    await resourceForm.locator("textarea[name=evidenceSummary]").fill("устойчивость в конфликте");
    await resourceForm.getByRole("button", { name: "Создать ресурс" }).click();

    const resourceCard = card(page, "resource-card", "Внутренняя опора");
    await expect(resourceCard).toBeVisible();
    await expect(resourceCard.getByTestId("resource-review-status")).toContainText(
      "Подтверждён человеком"
    );
    await expect(resourceCard.getByTestId("resource-evidence")).toContainText(
      "устойчивость в конфликте"
    );

    // --- Editing a score requires evidence ---------------------------------
    const editForm = resourceCard.getByTestId("resource-edit-form");
    await editForm.locator("input[name=strengthScore]").fill("80");
    await editForm.locator("textarea[name=evidenceSummary]").fill("");
    await editForm.getByRole("button", { name: "Сохранить ресурс" }).click();
    await expect(resourceCard.getByTestId("resource-edit-form-error")).toContainText(
      "нужны доказательства или причина"
    );

    // The refused submit resets the form, so the score is entered again with
    // the evidence it requires.
    await editForm.locator("input[name=strengthScore]").fill("80");
    await editForm.locator("textarea[name=evidenceSummary]").fill("заметное укрепление границ");
    await editForm.getByRole("button", { name: "Сохранить ресурс" }).click();
    await expect(resourceCard.getByTestId("resource-strength")).toContainText("80");

    const { data: resource } = await admin
      .from("resources")
      .select("strength_score, evidence_summary")
      .eq("client_id", workspace.clientId)
      .eq("name", "Внутренняя опора")
      .single();
    expect(resource?.strength_score).toBe(80);
    expect(resource?.evidence_summary).toBe("заметное укрепление границ");

    // --- Create a DevelopmentTarget on the same positive-layer screen ------
    const targetForm = page.getByTestId("development-target-form");
    await targetForm.locator("input[name=name]").fill("Спокойная сила");
    await targetForm.locator("input[name=currentLevel]").fill("30");
    await targetForm.locator("input[name=targetLevel]").fill("70");
    await targetForm.locator("input[name=successMarkers]").fill("спокойно говорит с руководителем");
    await targetForm.getByRole("button", { name: "Создать цель" }).click();

    const targetCard = card(page, "development-target-card", "Спокойная сила");
    await expect(targetCard).toBeVisible();
    await expect(targetCard.getByTestId("development-target-levels")).toContainText("30 → 70");
    await expect(targetCard.getByTestId("development-target-markers")).toContainText(
      "спокойно говорит с руководителем"
    );
    // Without a link to a Resource or CoreNode the screen states that limit.
    await expect(targetCard.getByTestId("development-target-limits")).toContainText("Нет связей");

    // --- Editing progress requires a reason --------------------------------
    const targetEdit = targetCard.getByTestId("development-target-edit-form");
    await targetEdit.locator("input[name=currentLevel]").fill("45");
    await targetEdit.getByRole("button", { name: "Сохранить цель" }).click();
    await expect(targetCard.getByTestId("development-target-edit-form-error")).toContainText(
      "укажите причину"
    );

    await targetEdit.locator("input[name=currentLevel]").fill("45");
    await targetEdit.locator("input[name=reason]").fill("Подтверждено на сессии");
    await targetEdit.getByRole("button", { name: "Сохранить цель" }).click();
    await expect(targetCard.getByTestId("development-target-levels")).toContainText("45 → 70");

    const { data: target } = await admin
      .from("development_targets")
      .select("current_level, target_level")
      .eq("client_id", workspace.clientId)
      .eq("name", "Спокойная сила")
      .single();
    expect(target?.current_level).toBe(45);

    const { data: audit } = await admin
      .from("audit_log")
      .select("action, actor_user_id, reason")
      .in("action", ["resource.updated", "development_target.updated"]);
    expect(audit?.some((row) => row.actor_user_id === specialist.id)).toBe(true);
  });

  test("specialist enters the purpose profile and synthesis manually and sees the limits", async ({
    page,
  }) => {
    const workspace = await fixtures.createWorkspace("Клиент предназначения");
    const specialist = await createSpecialist(fixtures, workspace);
    const admin = fixtures.serviceRoleClient();

    await signInThroughLoginForm(page, specialist);
    await page.goto(`/clients/${workspace.clientId}/purpose`);
    await expect(
      workspaceNav(page).getByRole("link", { name: "Цель и смысл", exact: true })
    ).toHaveAttribute("aria-current", "page");
    await expect(page.getByTestId("purpose-policy-note")).toContainText(
      "не определяется автоматически"
    );

    // --- Manual profile entry ---------------------------------------------
    const profileForm = page.getByTestId("purpose-profile-form");
    await profileForm.locator("select[name=sourceSystem]").selectOption("jyotish");
    await profileForm.locator("textarea[name=rawData]").fill('{"sun": "leo"}');
    await profileForm.locator("textarea[name=interpretation]").fill("ведущая роль через видимость");
    await profileForm.locator("input[name=strengths]").fill("видимость, ясность");
    await profileForm.locator("input[name=developmentDirections]").fill("спокойное лидерство");
    await profileForm.getByRole("button", { name: "Сохранить профиль" }).click();

    const profileCard = card(page, "purpose-profile", "Джйотиш");
    await expect(profileCard).toBeVisible();
    await expect(profileCard.getByTestId("purpose-profile-strengths")).toContainText("видимость");
    // The interpretive-system limit is always shown, never hidden.
    await expect(profileCard.getByTestId("purpose-profile-limits")).toContainText(
      "Интерпретационная система"
    );

    // --- Malformed source data is refused ---------------------------------
    const secondProfile = page.getByTestId("purpose-profile-form");
    await secondProfile.locator("textarea[name=rawData]").fill("не json");
    await secondProfile.getByRole("button", { name: "Сохранить профиль" }).click();
    await expect(page.getByTestId("purpose-profile-form-error")).toContainText("JSON-объектом");

    // --- Manual synthesis over the stored profiles -------------------------
    const synthesisForm = page.getByTestId("purpose-synthesis-form");
    await synthesisForm.locator("textarea[name=summary]").fill("совпадение по теме лидерства");
    await synthesisForm.locator("input[name=crossSystemMatches]").fill("лидерство");
    await synthesisForm.locator("input[name=potentialConflicts]").fill("роль vs стратегия");
    await synthesisForm.getByRole("button", { name: "Сохранить синтез" }).click();

    const synthesisCard = card(page, "purpose-synthesis", "совпадение по теме лидерства");
    await expect(synthesisCard).toBeVisible();
    await expect(synthesisCard.getByTestId("purpose-synthesis-sources")).toContainText("Джйотиш");
    await expect(synthesisCard.getByTestId("purpose-synthesis-conflicts")).toContainText(
      "роль vs стратегия"
    );
    await expect(synthesisCard.getByTestId("purpose-synthesis-limits")).toContainText(
      "Интерпретационная система"
    );

    const { data: profile } = await admin
      .from("purpose_profiles")
      .select("source_system, interpretation, strengths")
      .eq("client_id", workspace.clientId)
      .single();
    expect(profile?.source_system).toBe("jyotish");
    expect(profile?.strengths).toEqual(["видимость", "ясность"]);

    const { data: synthesis } = await admin
      .from("purpose_syntheses")
      .select("summary, cross_system_matches")
      .eq("client_id", workspace.clientId)
      .single();
    expect(synthesis?.summary).toBe("совпадение по теме лидерства");
  });
});

test.describe("client recommendations", () => {
  let fixtures: WorkspaceFixture;

  test.beforeEach(() => {
    fixtures = new WorkspaceFixture();
  });

  test.afterEach(async () => {
    await fixtures.cleanup();
  });

  test("full path from evidence to a reviewed and published recommendation", async ({ page }) => {
    const workspace = await fixtures.createWorkspace("Клиент рекомендаций");
    const specialist = await createSpecialist(fixtures, workspace);
    const ownerClient = await fixtures.signIn(workspace.owner);
    const admin = fixtures.serviceRoleClient();
    const seeded = await seedNodeWithEvidence(workspace, ownerClient);
    await grantConsents(fixtures, workspace);
    const recommendationId = await seedDraftRecommendation(workspace, ownerClient, {
      nodeId: seeded.nodeId,
      requestId: seeded.requestId,
    });

    await signInThroughLoginForm(page, specialist);
    await page.goto(`/clients/${workspace.clientId}/recommendations`);
    await expect(
      workspaceNav(page).getByRole("link", { name: "Рекомендации", exact: true })
    ).toHaveAttribute("aria-current", "page");
    await expect(page.getByTestId("recommendations-policy-note")).toContainText(
      "до явного решения человека"
    );

    // --- The AI draft with its ranking explanation and evidence ------------
    const cardLocator = card(page, "recommendation-card", RECOMMENDATION_TEXT);
    await expect(cardLocator).toBeVisible();
    await expect(cardLocator.getByTestId("recommendation-status")).toContainText(
      "Предложение AI, ожидает ревью"
    );
    await expect(cardLocator.getByTestId("recommendation-visibility")).toContainText("Внутренняя");
    await expect(cardLocator.getByTestId("recommendation-ranking")).toBeVisible();
    await expect(cardLocator.getByTestId("recommendation-ranking-total")).toContainText("79.2");
    await expect(cardLocator.getByTestId("recommendation-limits")).toContainText(
      "Предложение AI (L0)"
    );
    await expect(cardLocator.getByTestId("recommendation-target-supporting")).toContainText(
      SIGNAL_STATEMENT
    );
    // Private reasoning is visible to the specialist on this screen.
    await expect(cardLocator.getByTestId("recommendation-rationale")).toContainText("rootness");

    // A draft can never be published: no publish control before review.
    await expect(cardLocator.getByTestId("recommendation-visibility-form")).toHaveCount(0);
    await expect(cardLocator.getByTestId("recommendation-visibility-blocked")).toBeVisible();

    // Rendering the screen promoted nothing.
    const before = await admin
      .from("recommendations")
      .select("status, visibility")
      .eq("id", recommendationId)
      .single();
    expect(before.data?.status).toBe("draft");
    expect(before.data?.visibility).toBe("internal");

    // --- Explicit human review --------------------------------------------
    const reviewForm = cardLocator.getByTestId("recommendation-review-form");
    await reviewForm.locator("select[name=decision]").selectOption("approve");
    await reviewForm.locator("input[name=reason]").fill("Проверено на сессии");
    await reviewForm.getByRole("button", { name: "Применить решение" }).click();

    await expect(cardLocator.getByTestId("recommendation-status")).toContainText(
      "Подтверждена человеком"
    );
    await expect(cardLocator.getByTestId("recommendation-decided")).toBeVisible();
    await expect(cardLocator.getByTestId("recommendation-review-form")).toHaveCount(0);

    const reviewed = await admin
      .from("recommendations")
      .select("status, visibility, reviewed_by, reviewed_at")
      .eq("id", recommendationId)
      .single();
    expect(reviewed.data?.status).toBe("approved");
    expect(reviewed.data?.reviewed_by).toBe(specialist.id);
    expect(reviewed.data?.reviewed_at).toBeTruthy();

    // --- Specialist publishes to the client-visible projection -------------
    const visibilityForm = cardLocator.getByTestId("recommendation-visibility-form");
    await visibilityForm.locator("select[name=visibility]").selectOption("client_visible");
    await visibilityForm.locator("input[name=reason]").fill("Согласовано с клиентом");
    await visibilityForm.getByRole("button", { name: "Изменить видимость" }).click();

    await expect(cardLocator.getByTestId("recommendation-visibility")).toContainText(
      "Опубликована в клиентском портале"
    );

    const published = await admin
      .from("recommendations")
      .select("status, visibility")
      .eq("id", recommendationId)
      .single();
    expect(published.data?.visibility).toBe("client_visible");

    const { data: audit } = await admin
      .from("audit_log")
      .select("action, actor_user_id, reason")
      .eq("entity_id", recommendationId)
      .in("action", ["recommendation.approve", "recommendation.published"]);
    expect(
      audit?.some(
        (row) => row.action === "recommendation.approve" && row.reason === "Проверено на сессии"
      )
    ).toBe(true);
    expect(
      audit?.some(
        (row) =>
          row.action === "recommendation.published" && row.reason === "Согласовано с клиентом"
      )
    ).toBe(true);
  });

  test("generation without confirmed data and a recommendation without evidence stay insufficient data", async ({
    page,
  }) => {
    const workspace = await fixtures.createWorkspace("Клиент без данных");
    const specialist = await createSpecialist(fixtures, workspace);
    const ownerClient = await fixtures.signIn(workspace.owner);
    await grantConsents(fixtures, workspace);

    // A recommendation the AI created without any target and without a complete
    // score card: no evidence and no ranking input at all.
    await seedDraftRecommendation(workspace, ownerClient, { unranked: true });

    await signInThroughLoginForm(page, specialist);
    await page.goto(`/clients/${workspace.clientId}/recommendations`);

    // The generation path runs through the real service; the dev fake provider
    // proposes nothing, and the screen says so instead of inventing a result.
    await page.getByTestId("recommendation-generate-form").getByRole("button").click();
    await expect(page.getByTestId("recommendation-generate-message")).toContainText(
      "недостаточно данных"
    );

    const cardLocator = card(page, "recommendation-card", RECOMMENDATION_TEXT);
    await expect(cardLocator).toBeVisible();
    await expect(cardLocator.getByTestId("recommendation-ranking-insufficient")).toContainText(
      "недостаточно данных"
    );
    await expect(cardLocator.getByTestId("recommendation-no-targets")).toContainText(
      "не ссылается на цели"
    );
    await expect(cardLocator.getByTestId("recommendation-insufficient")).toContainText(
      "нет подтверждающих доказательств"
    );

    // Nothing was promoted by rendering or generating.
    const { data: rows } = await fixtures
      .serviceRoleClient()
      .from("recommendations")
      .select("status")
      .eq("client_id", workspace.clientId);
    expect(rows?.every((row) => row.status === "draft")).toBe(true);
  });

  test("unassigned, read-only and portal users are denied in the browser and in the database", async ({
    browser,
  }) => {
    const workspace = await fixtures.createWorkspace("Закрытый клиент рекомендаций");
    const ownerClient = await fixtures.signIn(workspace.owner);
    const admin = fixtures.serviceRoleClient();
    const seeded = await seedNodeWithEvidence(workspace, ownerClient);
    await grantConsents(fixtures, workspace);
    const recommendationId = await seedDraftRecommendation(workspace, ownerClient, {
      nodeId: seeded.nodeId,
      requestId: seeded.requestId,
    });
    const { data: resourceId } = await ownerClient.rpc("create_resource", {
      p_org_id: workspace.organizationId,
      p_client_id: workspace.clientId,
      p_name: "Закрытый ресурс",
      p_description: null,
      p_domain: null,
      p_strength_score: 50,
      p_confidence_score: 50,
      p_evidence_summary: "наблюдение",
    });

    // --- Unassigned member: the neutral denial, no metadata ---------------
    const unassigned = await fixtures.createUser("unassigned-positive");
    await fixtures.addMember(workspace.organizationId, unassigned);
    const unassignedContext = await browser.newContext();
    const unassignedPage = await unassignedContext.newPage();
    await signInThroughLoginForm(unassignedPage, unassigned);
    for (const section of ["resources", "purpose", "recommendations"]) {
      const response = await unassignedPage.goto(`/clients/${workspace.clientId}/${section}`);
      expect(response?.status()).toBe(404);
      await expect(
        unassignedPage.getByRole("heading", { name: "Клиент недоступен" })
      ).toBeVisible();
      await expect(unassignedPage.getByText(RECOMMENDATION_TEXT)).toHaveCount(0);
    }
    await unassignedContext.close();

    // --- Read-only member: read screens, no write controls ----------------
    const readOnly = await fixtures.createUser("readonly-positive");
    await fixtures.addMember(workspace.organizationId, readOnly, "supervisor");
    await fixtures.assign(workspace.clientId, readOnly, "read_only");
    const readOnlyContext = await browser.newContext();
    const readOnlyPage = await readOnlyContext.newPage();
    await signInThroughLoginForm(readOnlyPage, readOnly);

    await readOnlyPage.goto(`/clients/${workspace.clientId}/resources`);
    await expect(readOnlyPage.getByTestId("resources-read-only")).toBeVisible();
    await expect(readOnlyPage.getByTestId("resource-form")).toHaveCount(0);
    await expect(readOnlyPage.getByTestId("development-target-form")).toHaveCount(0);

    await readOnlyPage.goto(`/clients/${workspace.clientId}/purpose`);
    await expect(readOnlyPage.getByTestId("purpose-read-only")).toBeVisible();
    await expect(readOnlyPage.getByTestId("purpose-profile-form")).toHaveCount(0);

    await readOnlyPage.goto(`/clients/${workspace.clientId}/recommendations`);
    await expect(readOnlyPage.getByTestId("recommendations-read-only")).toBeVisible();
    await expect(readOnlyPage.getByTestId("recommendation-generate-form")).toHaveCount(0);
    await expect(readOnlyPage.getByTestId("recommendation-review-form")).toHaveCount(0);
    await expect(readOnlyPage.getByTestId("recommendation-visibility-form")).toHaveCount(0);

    // --- The database denies the writes even if the UI is bypassed ---------
    const readOnlyClient = await fixtures.userClient(readOnly);
    const review = await readOnlyClient.rpc("review_recommendation", {
      p_org_id: workspace.organizationId,
      p_recommendation_id: recommendationId,
      p_decision: "approve",
      p_reason: null,
    });
    expect(review.error?.code).toBe("42501");

    const visibility = await readOnlyClient.rpc("set_recommendation_visibility", {
      p_org_id: workspace.organizationId,
      p_recommendation_id: recommendationId,
      p_visibility: "client_visible",
      p_reason: null,
    });
    expect(visibility.error?.code).toBe("42501");

    const resource = await readOnlyClient.rpc("update_resource", {
      p_resource_id: resourceId as string,
      p_patch: { strength_score: 90 },
      p_reason: "обход интерфейса",
    });
    expect(resource.error?.code).toBe("42501");

    const { data: unchanged } = await admin
      .from("recommendations")
      .select("status, visibility")
      .eq("id", recommendationId)
      .single();
    expect(unchanged?.status).toBe("draft");
    expect(unchanged?.visibility).toBe("internal");
    await readOnlyContext.close();

    // --- A Client Portal identity is not an organization member -----------
    // The portal identity is seeded with the service role on purpose: the
    // portal user itself can never grant portal access (the database refuses it).
    const portalUser = await fixtures.createUser("portal-positive");
    const portalClient = await fixtures.userClient(portalUser);
    const selfGrant = await portalClient.rpc("create_portal_user", {
      p_client_id: workspace.clientId,
      p_email: portalUser.email,
    });
    expect(selfGrant.error?.code).toBe("42501");

    const { error: grantError } = await admin.from("client_portal_users").insert({
      client_id: workspace.clientId,
      email: portalUser.email,
      status: "active",
    });
    expect(grantError).toBeNull();

    const portalContext = await browser.newContext();
    const portalPage = await portalContext.newPage();
    await signInThroughLoginForm(portalPage, portalUser);
    const portalResponse = await portalPage.goto(`/clients/${workspace.clientId}/recommendations`);
    expect(portalResponse?.status()).toBe(404);
    await expect(portalPage.getByRole("heading", { name: "Клиент недоступен" })).toBeVisible();
    await expect(portalPage.getByText(RECOMMENDATION_TEXT)).toHaveCount(0);
    await expect(portalPage.getByTestId("recommendation-rationale")).toHaveCount(0);
    await portalContext.close();
  });
});
