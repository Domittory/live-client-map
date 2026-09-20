import { createHash, randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import {
  signInThroughLoginForm,
  workspaceNav,
  WorkspaceFixture,
  TEST_PASSWORD,
  type TestUser,
} from "./support/fixtures";
import { portalConfirmUrl, waitForPortalSignInLink } from "./support/portal";

/**
 * Ticket 22 — one reproducible browser-to-database production-readiness journey.
 *
 * It walks the real product workflow of one synthetic tenant end to end:
 * Owner onboarding → Specialist access → client creation → consent →
 * diagnostics + Signals → import → model review → Recommendations → Correction →
 * BehavioralMarker + ModelChange → FollowUp → snapshots/model-change comparison →
 * full archive download + contract validation → Client Portal feedback →
 * consent revocation → erasure.
 *
 * Rules this file follows deliberately:
 *   * every tenant is built inside the journey from synthetic (non-real) data,
 *     and nothing depends on rows another test or run left behind;
 *   * assertions use only visible UI, the HTTP contracts (`/api/exports`,
 *     `/api/reports/snapshot`, `/api/ai/run`), authorized persisted reads, RLS
 *     denial, the archive contract and audit evidence — never a private helper's
 *     return value and never query ordering;
 *   * the intellectual-correctness invariants stay explicit: evidence
 *     independence, L0 AI-only evidence staying pending, competing hypotheses
 *     coexisting without an automatic winner, the medical boundary and
 *     «недостаточно данных» wording instead of a conclusion.
 *
 * Runtime note for CI: this is one long serial journey (about two orders of
 * magnitude fewer fixtures than the per-feature specs). It is deliberately one
 * `test`, so the whole story is one artifact and one timeout.
 */
test.describe.configure({ timeout: 900_000 });

// --- Synthetic fixtures (never real personal data) ---------------------------

const RUN = randomUUID().slice(0, 8);
const ORG_NAME = `E2E Journey Org ${RUN}`;
const OWNER_EMAIL = `journey-owner-${RUN}@example.com`;
const CLIENT_NAME = `Синтетический клиент ${RUN}`;
const CLIENT_VISIBLE_NOTE = "Опубликованная заметка для клиента";
const PRIVATE_NOTE = "СЕКРЕТНАЯ ПРИВАТНАЯ ЗАМЕТКА СПЕЦИАЛИСТА";

const SESSION_TITLE = "Journey сессия 1";
const SESSION_RAW_INPUT = "Синтетический рассказ о стрессе вокруг публичности.";
const SIGNAL_ONE = "Мне можно быть главным";
const SIGNAL_TWO = "Мне можно говорить о своих желаниях";
const IMPORT_LINE_ONE = `Синтетическая строка импорта один ${RUN}`;
const IMPORT_LINE_TWO = `Синтетическая строка импорта два ${RUN}`;

const THEME_NAME = "Страх публичности";
const NODE_TITLE = "Страх оценки";
const SECOND_NODE_TITLE = "Объективная перегрузка";
const CONTRADICTION_SUMMARY = "Сигналы расходятся по источнику стресса";
const HYPOTHESIS_A = "A: прошлый негативный опыт";
const HYPOTHESIS_B = "B: объективно высокая нагрузка";

const RECOMMENDATION_TEXT = "Практика опоры перед публичным выступлением";
const MARKER_NAME = "Спокойное выступление";

const FEEDBACK_TITLE = "Как прошла неделя?";
const FEEDBACK_QUESTION = "Что изменилось за неделю?";
const FEEDBACK_ANSWER = "Стало спокойнее, сон лучше.";

/** The exact §11 `data` keys the archive contract requires. */
const ARCHIVE_COLLECTIONS = [
  "consent_records",
  "client_requests",
  "client_goals",
  "life_events",
  "triggers",
  "diagnostic_sessions",
  "diagnostic_session_summaries",
  "signals",
  "evidence_clusters",
  "themes",
  "core_nodes",
  "differential_hypotheses",
  "signal_theme_links",
  "theme_core_node_links",
  "core_node_relations",
  "trigger_activations",
  "resources",
  "development_targets",
  "purpose_profiles",
  "purpose_syntheses",
  "recommendations",
  "recommendation_targets",
  "corrections",
  "correction_targets",
  "correction_expected_markers",
  "observations",
  "behavioral_markers",
  "follow_ups",
  "model_changes",
  "psychological_snapshots",
  "medical_facts",
  "symptom_reports",
  "psychological_hypotheses",
  "relationships",
  "relationship_dynamics",
  "audit_events",
] as const;

// --- Archive contract helpers (independent of the assembler) -----------------

/** Deterministic JSON: object keys sorted recursively, `undefined` dropped. */
function canonicalStringify(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entry]) => entry !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, entry]) => [key, canonicalize(entry)])
    );
  }
  return value;
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

// --- Visible-UI helpers ------------------------------------------------------

async function openSection(page: Page, clientId: string, section: string): Promise<void> {
  await page.goto(`/clients/${clientId}/${section}`);
}

async function grantConsent(page: Page, clientId: string, consentType: string): Promise<void> {
  await openSection(page, clientId, "consent");
  await page.locator('select[name="consentType"]').selectOption(consentType);
  await page.locator('input[name="documentVersion"]').fill("1.0");
  await page.getByRole("button", { name: "Выдать" }).click();
  await expect(page.getByTestId(`client-consent-${consentType}`)).toContainText("действует");
}

async function revokeConsent(page: Page, clientId: string, consentType: string): Promise<void> {
  await openSection(page, clientId, "consent");
  const row = page.getByTestId(`client-consent-${consentType}`);
  await expect(row).toContainText("действует");
  await row.getByRole("button", { name: "Отозвать" }).click();
  await expect(page.getByTestId(`client-consent-${consentType}`)).toContainText("не выдано");
}

async function createSessionThroughUi(page: Page): Promise<void> {
  const form = page.getByTestId("diagnostic-session-form");
  await form.locator("[name=title]").fill(SESSION_TITLE);
  await form.getByLabel("Тип сессии", { exact: true }).selectOption("individual");
  await form.locator("[name=rawInput]").fill(SESSION_RAW_INPUT);
  await form.locator("[name=notes]").fill("Синтетическая заметка сессии");
  await form.getByRole("button", { name: "Создать сессию" }).click();
  await expect(
    page.getByTestId("diagnostic-session-title").filter({ hasText: SESSION_TITLE })
  ).toBeVisible();
}

async function addSignalThroughUi(page: Page, statement: string): Promise<void> {
  const form = page.getByTestId("signal-form");
  await form.getByLabel("Сессия", { exact: true }).selectOption({ label: SESSION_TITLE });
  await form.getByLabel("Источник", { exact: true }).selectOption("kinesiology_test");
  await form.getByLabel("Эпистемический тип", { exact: true }).selectOption("test_result");
  await form.locator("[name=rawStatement]").fill(statement);
  await form.getByLabel("Формулировка", { exact: true }).selectOption("positive");
  await form.getByLabel("Результат теста", { exact: true }).selectOption("stress");
  await form.locator("[name=normalizedMeaning]").fill("Стресс вокруг публичной роли.");
  await form.locator("[name=intensity]").fill("70");
  await form.locator("[name=confidence]").fill("60");
  await form.locator("[name=lifeAreas]").fill("работа");
  await form.locator("[name=tags]").fill("публичность");
  await form.getByLabel("Видимость", { exact: true }).selectOption("internal");
  await form.getByRole("button", { name: "Добавить сигнал" }).click();
  await expect(page.getByTestId("signal-statement").filter({ hasText: statement })).toBeVisible();
}

function card(page: Page, testId: string, text: string) {
  return page.getByTestId(testId).filter({ hasText: text });
}

/** Apply one explicit human review decision on a review card. */
async function decide(
  page: Page,
  cardLocator: ReturnType<typeof card>,
  formTestId: string,
  decision: "approve" | "reject",
  reason: string
): Promise<void> {
  const form = cardLocator.getByTestId(formTestId);
  await form.locator("select[name=decision]").selectOption(decision);
  await form.locator("input[name=reason]").fill(reason);
  await form.getByRole("button", { name: "Применить решение" }).click();
}

async function generateSnapshot(page: Page, clientId: string, reason: string): Promise<void> {
  await page.goto(`/snapshots?clientId=${clientId}`);
  await page.getByLabel("Причина генерации").fill(reason);
  await page.getByRole("button", { name: "Сгенерировать snapshot" }).click();
  await expect(page.getByText(/Snapshot создан:/)).toBeVisible({ timeout: 30_000 });
}

// --- The journey -------------------------------------------------------------

test("Owner → Specialist → Client Portal production-readiness journey", async ({
  browser,
  baseURL,
}) => {
  const appUrl = baseURL ?? "";
  const fixtures = new WorkspaceFixture();
  const admin = fixtures.serviceRoleClient();
  const openedContexts: Awaited<ReturnType<typeof browser.newContext>>[] = [];

  let organizationId: string | null = null;
  let ownerUserId: string | null = null;

  const newPage = async (): Promise<Page> => {
    const context = await browser.newContext();
    openedContexts.push(context);
    return context.newPage();
  };

  try {
    // =====================================================================
    // 1. Owner onboarding through the real signup form.
    //    Criterion: "Journey покрывает onboarding".
    // =====================================================================
    const ownerPage = await newPage();
    await ownerPage.goto("/signup");
    await ownerPage.getByLabel("Email").fill(OWNER_EMAIL);
    await ownerPage.getByLabel("Пароль").fill(TEST_PASSWORD);
    await ownerPage.getByLabel("Название организации").fill(ORG_NAME);
    await ownerPage.getByRole("button", { name: "Создать аккаунт" }).click();
    await ownerPage.waitForURL((url) => url.pathname === "/");

    await expect(ownerPage.getByText(`Организация: ${ORG_NAME}`)).toBeVisible();
    await expect(ownerPage.getByText(`Вы вошли как ${OWNER_EMAIL}`)).toBeVisible();

    // Authorized persisted read: the signup really created the tenant.
    const { data: orgRow, error: orgError } = await admin
      .from("organizations")
      .select("id, owner_user_id, name")
      .eq("name", ORG_NAME)
      .single();
    expect(orgError).toBeNull();
    organizationId = (orgRow as { id: string }).id;
    ownerUserId = (orgRow as { owner_user_id: string }).owner_user_id;
    expect(ownerUserId).toBeTruthy();

    const { data: memberRow } = await admin
      .from("organization_members")
      .select("role, status")
      .eq("organization_id", organizationId)
      .eq("user_id", ownerUserId)
      .single();
    expect(memberRow).toMatchObject({ role: "owner", status: "active" });

    // =====================================================================
    // 2. Client creation through the visible UI.
    //    Criterion: "Client creation".
    // =====================================================================
    await ownerPage.goto("/clients");
    await ownerPage.getByLabel("Отображаемое имя").fill(CLIENT_NAME);
    await ownerPage.getByRole("button", { name: "Создать" }).click();
    await ownerPage.waitForURL((url) => /\/clients\/[0-9a-f-]{36}$/.test(url.pathname));
    const clientId = new URL(ownerPage.url()).pathname.split("/").pop()!;
    await expect(ownerPage.getByTestId("client-workspace-title")).toHaveText(CLIENT_NAME);

    // The client carries no manual id entry anywhere in the workspace.
    await expect(ownerPage.getByRole("textbox", { name: /client_id/i })).toHaveCount(0);

    // Client notes through the real edit form: one private, one client-visible.
    await ownerPage.getByLabel("Профессия").fill("Синтетическая профессия");
    await ownerPage.getByLabel("Приватная заметка").fill(PRIVATE_NOTE);
    await ownerPage.getByLabel("Заметка клиенту").fill(CLIENT_VISIBLE_NOTE);
    await ownerPage.getByRole("button", { name: "Сохранить" }).click();
    await expect(ownerPage.getByText(`Приватная заметка: ${PRIVATE_NOTE}`)).toBeVisible();

    const { data: clientRow } = await admin
      .from("clients")
      .select("display_name, client_visible_notes, specialist_notes_private")
      .eq("id", clientId)
      .single();
    expect(clientRow).toMatchObject({
      display_name: CLIENT_NAME,
      client_visible_notes: CLIENT_VISIBLE_NOTE,
      specialist_notes_private: PRIVATE_NOTE,
    });

    // =====================================================================
    // 3. Consent through the real consent UI.
    //    Criterion: "consent". These four consents gate AI, snapshots, the
    //    full archive and the Client Portal respectively.
    // =====================================================================
    for (const consentType of [
      "data_storage",
      "ai_analysis",
      "sensitive_psychological_data",
      "client_portal",
    ]) {
      await grantConsent(ownerPage, clientId, consentType);
    }

    // Baseline snapshot v1, taken BEFORE any model transition, so the later
    // v1→v2 interval really contains the changes (and v2→v3 is empty).
    await generateSnapshot(ownerPage, clientId, "Версия до изменений модели");

    // =====================================================================
    // 4. Specialist access: the Owner grants the assignment in the client
    //    context, then the specialist really opens the workspace.
    //    Criterion: "Specialist access".
    // =====================================================================
    const specialist: TestUser = await fixtures.createUser("journey-specialist");
    await fixtures.addMember(organizationId, specialist);

    await openSection(ownerPage, clientId, "access");
    await expect(
      workspaceNav(ownerPage).getByRole("link", { name: "Доступ", exact: true })
    ).toHaveAttribute("aria-current", "page");
    await ownerPage.getByLabel("Участник").selectOption(specialist.email);
    await ownerPage.getByLabel("Роль доступа").selectOption("primary_specialist");
    await ownerPage.getByRole("button", { name: "Назначить" }).click();
    await expect(
      ownerPage.getByTestId("client-assignment-email").filter({ hasText: specialist.email })
    ).toBeVisible();

    const specialistPage = await newPage();
    await signInThroughLoginForm(specialistPage, specialist);
    await specialistPage.goto(`/clients/${clientId}`);
    await expect(specialistPage.getByTestId("client-workspace-title")).toHaveText(CLIENT_NAME);

    // The API identity used only to seed AI-proposal state through the real
    // product RPCs (the same contract the AI services call).
    const ownerApi = await fixtures.userClient({
      id: ownerUserId!,
      email: OWNER_EMAIL,
      password: TEST_PASSWORD,
    });

    // =====================================================================
    // 5. Diagnostic session + Signals through the UI.
    //    Criterion: "diagnostics, Signals". Two Signals from ONE session are
    //    created on purpose: step 7 asserts they are not independent evidence.
    // =====================================================================
    await openSection(specialistPage, clientId, "diagnostics");
    await createSessionThroughUi(specialistPage);
    await addSignalThroughUi(specialistPage, SIGNAL_ONE);
    await addSignalThroughUi(specialistPage, SIGNAL_TWO);

    for (const statement of [SIGNAL_ONE, SIGNAL_TWO]) {
      const row = specialistPage.getByTestId("signal-row").filter({ hasText: statement });
      await expect(row.getByTestId("signal-source")).toContainText("Кинезиологический тест");
      await expect(row.getByTestId("signal-review-status")).toContainText("Подтверждено человеком");
      await expect(row.getByTestId("signal-evidence-level")).toContainText("L1 — один сигнал");
      await expect(row.getByTestId("signal-lineage")).toContainText(SESSION_TITLE);
    }

    const { data: sessionRows } = await admin
      .from("diagnostic_sessions")
      .select("id, title")
      .eq("client_id", clientId)
      .eq("title", SESSION_TITLE);
    expect(sessionRows).toHaveLength(1);
    const sessionId = (sessionRows as { id: string }[])[0].id;

    const { data: signalRows } = await admin
      .from("signals")
      .select("id, raw_statement, evidence_level, review_status, diagnostic_session_id")
      .eq("client_id", clientId)
      .eq("diagnostic_session_id", sessionId);
    expect(signalRows).toHaveLength(2);
    const uiSignals = signalRows as {
      id: string;
      raw_statement: string;
      evidence_level: string;
      review_status: string;
    }[];
    // Evidence independence, machine level: two Signals in one session stay L1.
    expect(uiSignals.every((row) => row.evidence_level === "L1_SINGLE_SIGNAL")).toBe(true);
    expect(uiSignals.every((row) => row.review_status === "approved")).toBe(true);
    const signalOneId = uiSignals.find((row) => row.raw_statement === SIGNAL_ONE)!.id;
    const signalTwoId = uiSignals.find((row) => row.raw_statement === SIGNAL_TWO)!.id;

    // Audit evidence: browser writes are traceable to the acting specialist.
    const { data: sessionAudit } = await admin
      .from("audit_log")
      .select("action, actor_user_id")
      .eq("entity_id", sessionId)
      .eq("action", "session.created")
      .single();
    expect(sessionAudit).toMatchObject({ actor_user_id: specialist.id });

    // =====================================================================
    // 6. Import: preview, then a selective partial commit.
    //    Criterion: "import (preview + selective commit)". The committed
    //    Signal is AI-only (L0) and must stay pending.
    // =====================================================================
    await openSection(specialistPage, clientId, "import");
    const importForm = specialistPage.getByTestId("import-form");
    await importForm.locator("[name=format]").selectOption("plain_text");
    await importForm.locator("[name=content]").fill(`${IMPORT_LINE_ONE}\n${IMPORT_LINE_TWO}`);
    await importForm.getByTestId("import-preview-submit").click();
    await expect(specialistPage.getByTestId("import-report")).toBeVisible();
    await expect(specialistPage.getByTestId("import-count-total")).toContainText("Всего: 2");
    await expect(specialistPage.getByTestId("import-count-valid")).toContainText("Валидных: 2");
    await expect(specialistPage.getByTestId("import-count-committed")).toContainText(
      "Закоммичено: 0"
    );

    const importId = await specialistPage
      .getByTestId("import-report")
      .getAttribute("data-import-id");
    expect(importId).toBeTruthy();

    const firstRecord = specialistPage.locator(
      '[data-testid="import-record-row"][data-external-id="ai-1"]'
    );
    const secondRecord = specialistPage.locator(
      '[data-testid="import-record-row"][data-external-id="ai-2"]'
    );
    await firstRecord.getByTestId("import-candidate").check();
    await secondRecord.getByTestId("import-candidate").uncheck();
    await specialistPage.getByTestId("import-commit-submit").click();
    await expect(specialistPage.getByTestId("import-commit-message")).toContainText(
      "Закоммичено сигналов: 1"
    );

    const { data: importSessionRow } = await admin
      .from("imports")
      .select("diagnostic_session_id, status, counts")
      .eq("id", importId!)
      .single();
    const importSessionId = (importSessionRow as { diagnostic_session_id: string })
      .diagnostic_session_id;
    const { data: importedSignals } = await admin
      .from("signals")
      .select("id, raw_statement, evidence_level, review_status, source_type")
      .eq("diagnostic_session_id", importSessionId);
    expect(importedSignals).toHaveLength(1);
    expect(importedSignals![0]).toMatchObject({
      raw_statement: IMPORT_LINE_ONE,
      evidence_level: "L0_AI_ONLY",
      review_status: "pending",
    });

    // L0 + insufficient-data wording is visible in the UI, not a conclusion.
    await openSection(specialistPage, clientId, "diagnostics");
    const importedRow = specialistPage
      .getByTestId("signal-row")
      .filter({ hasText: IMPORT_LINE_ONE });
    await expect(importedRow.getByTestId("signal-review-status")).toContainText("Ожидает ревью");
    await expect(importedRow.getByTestId("signal-evidence-level")).toContainText("L0");
    await expect(importedRow.getByTestId("signal-review-status")).toContainText("Ожидает ревью");
    const { data: importedSignalRow } = await admin
      .from("signals")
      .select("id")
      .eq("diagnostic_session_id", importSessionId)
      .single();
    const importedSignalId = (importedSignalRow as { id: string }).id;
    await expect(
      specialistPage.getByTestId(`signal-interpretation-${importedSignalId}`)
    ).toContainText("недостаточно данных");

    const { data: importAudit } = await admin
      .from("audit_log")
      .select("action, actor_user_id")
      .eq("entity_id", importId!)
      .eq("action", "import.committed")
      .single();
    expect(importAudit).toMatchObject({ actor_user_id: specialist.id });

    // =====================================================================
    // 7. Model review through the UI: theme, core node, competing hypotheses.
    //    Criterion: "model review (themes/core nodes/competing hypotheses)"
    //    plus the evidence-independence and no-automatic-winner invariants.
    // =====================================================================
    const { data: themeIds, error: themeError } = await ownerApi.rpc("apply_ai_theme_proposals", {
      p_org_id: organizationId,
      p_client_id: clientId,
      p_proposals: [
        {
          action: "create",
          name: THEME_NAME,
          description: "AI-предложение темы",
          domain: "работа",
          confidence: 60,
        },
      ],
    });
    expect(themeError).toBeNull();
    const themeId = (themeIds as string[])[0];

    // Link the two confirmed Signals through the real product link path, which
    // recomputes the theme aggregates inside its transaction. Both Signals come
    // from ONE diagnostic session, so the theme must show 2 signals but only
    // 1 independent context.
    for (const [signalId, relevance] of [
      [signalOneId, 70],
      [signalTwoId, 65],
    ] as const) {
      const { error: linkError } = await ownerApi.rpc("link_theme_signal", {
        p_org_id: organizationId,
        p_theme_id: themeId,
        p_signal_id: signalId,
        p_relevance_score: relevance,
        p_link_rationale: "Связь подтверждена специалистом",
      });
      expect(linkError).toBeNull();
    }

    const { data: nodeIds, error: nodeError } = await ownerApi.rpc("apply_ai_core_node_proposals", {
      p_org_id: organizationId,
      p_client_id: clientId,
      p_proposals: [
        {
          action: "create",
          title: NODE_TITLE,
          hypothesis: "AI-гипотеза узла",
          root_domain: "работа",
          confidence: 55,
          theme_links: [themeId],
          rationale: "Связь AI",
        },
      ],
    });
    expect(nodeError).toBeNull();
    const nodeId = (nodeIds as string[])[0];

    const { data: secondNodeId, error: secondNodeError } = await ownerApi.rpc("create_core_node", {
      p_org_id: organizationId,
      p_client_id: clientId,
      p_title: SECOND_NODE_TITLE,
      p_hypothesis: "Конкурирующее объяснение нагрузки",
      p_root_domain: "работа",
      p_confidence_score: 45,
    });
    expect(secondNodeError).toBeNull();

    const { data: hypothesisIds, error: hypothesisError } = await ownerApi.rpc(
      "create_ai_hypotheses",
      {
        p_org_id: organizationId,
        p_client_id: clientId,
        p_hypotheses: [
          {
            title: HYPOTHESIS_A,
            description: "Конкурирующее объяснение A",
            confidence: 50,
            evidence_for: ["sig-for-A"],
            evidence_against: ["sig-against-A"],
          },
          {
            title: HYPOTHESIS_B,
            description: "Конкурирующее объяснение B",
            confidence: 50,
            evidence_for: ["sig-for-B"],
            evidence_against: ["sig-against-B"],
          },
        ],
      }
    );
    expect(hypothesisError).toBeNull();
    const [hypothesisA, hypothesisB] = hypothesisIds as string[];

    // A core-node contradiction between two nodes, strictly between v1 and v2.
    const { error: relationError } = await admin.from("core_node_relations").insert({
      organization_id: organizationId,
      client_id: clientId,
      from_core_node_id: nodeId,
      to_core_node_id: secondNodeId as string,
      relation_type: "contradicts",
      confidence: 60,
      evidence_summary: CONTRADICTION_SUMMARY,
    });
    expect(relationError).toBeNull();

    await openSection(specialistPage, clientId, "review");
    await expect(
      workspaceNav(specialistPage).getByRole("link", { name: "Ревью модели", exact: true })
    ).toHaveAttribute("aria-current", "page");
    await expect(specialistPage.getByTestId("review-policy-note")).toContainText(
      "до явного решения человека"
    );

    const themeCard = card(specialistPage, "review-theme", THEME_NAME);
    await expect(themeCard.getByTestId("review-theme-status")).toContainText(
      "Предложение AI, ожидает ревью"
    );
    await expect(themeCard.getByTestId("review-theme-signal-links")).toContainText(SIGNAL_ONE);
    await expect(themeCard.getByTestId("review-theme-signal-links")).toContainText(SIGNAL_TWO);
    // Evidence independence, visible: two confirmed Signals, ONE context.
    await expect(themeCard.getByTestId("review-theme-counts")).toContainText(
      "Подтверждённых сигналов: 2"
    );
    await expect(themeCard.getByTestId("review-theme-counts")).toContainText(
      "независимых контекстов: 1"
    );
    await expect(themeCard.getByTestId("data-limits")).toContainText("Предложение AI (L0)");

    const nodeCard = card(specialistPage, "review-core-node", NODE_TITLE);
    await expect(nodeCard.getByTestId("review-core-node-status")).toContainText("ожидает ревью");
    await expect(nodeCard.getByTestId("review-core-node-theme-links")).toContainText(THEME_NAME);

    const hypothesisACard = card(specialistPage, "review-hypothesis", HYPOTHESIS_A);
    const hypothesisBCard = card(specialistPage, "review-hypothesis", HYPOTHESIS_B);
    await expect(hypothesisACard.getByTestId("contradicting-evidence")).toContainText(
      "sig-against-A"
    );
    await expect(hypothesisBCard.getByTestId("contradicting-evidence")).toContainText(
      "sig-against-B"
    );
    await expect(specialistPage.getByTestId("review-hypotheses-note")).toContainText(
      "не выбирает победителя автоматически"
    );

    // Rendering the screen promoted nothing.
    const { data: themeBefore } = await admin
      .from("themes")
      .select("review_status")
      .eq("id", themeId)
      .single();
    expect(themeBefore).toMatchObject({ review_status: "pending" });
    const { data: hypothesesBefore } = await admin
      .from("differential_hypotheses")
      .select("id, status")
      .in("id", [hypothesisA, hypothesisB]);
    expect(
      (hypothesesBefore as { status: string }[]).every((row) => row.status === "hypothesis")
    ).toBe(true);

    await decide(specialistPage, themeCard, "theme-review-form", "approve", "Проверено на сессии");
    await expect(themeCard.getByTestId("review-theme-status")).toContainText(
      "Подтверждена человеком"
    );
    await decide(
      specialistPage,
      hypothesisACard,
      "hypothesis-review-form",
      "approve",
      "Подтверждено"
    );
    await expect(hypothesisACard.getByTestId("review-hypothesis-status")).toContainText(
      "Подтверждена человеком"
    );
    // Competing hypothesis B and its contradictions survive untouched.
    await expect(hypothesisBCard.getByTestId("review-hypothesis-status")).toContainText(
      "Гипотеза (не подтверждена человеком)"
    );
    await expect(hypothesisBCard.getByTestId("contradicting-evidence")).toContainText(
      "sig-against-B"
    );

    const { data: hypothesesAfter } = await admin
      .from("differential_hypotheses")
      .select("id, status, evidence_against")
      .in("id", [hypothesisA, hypothesisB]);
    const byId = new Map(
      (hypothesesAfter as { id: string; status: string; evidence_against: string[] }[]).map(
        (row) => [row.id, row]
      )
    );
    expect(byId.get(hypothesisA)?.status).toBe("active");
    expect(byId.get(hypothesisB)?.status).toBe("hypothesis");
    expect(byId.get(hypothesisB)?.evidence_against).toEqual(["sig-against-B"]);

    // =====================================================================
    // 8. Recommendations through the UI: AI draft, explicit human review,
    //    separate publication, and the L0 limit.
    //    Criterion: "Recommendations".
    // =====================================================================
    const { data: recommendationIds, error: recommendationError } = await ownerApi.rpc(
      "create_recommendations",
      {
        p_org_id: organizationId,
        p_client_id: clientId,
        p_payload: {
          client_request_id: null,
          items: [
            {
              proposed_correction: RECOMMENDATION_TEXT,
              rationale: "высокий rootness и unlock",
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
              scoring_model_version: "1.0.0",
              risk_notes: "низкий риск",
              missing_evidence: [],
              rank_rationale: "наибольший системный эффект для текущего запроса",
              human_review_required: false,
              targets: [
                {
                  target_type: null,
                  target_id: nodeId,
                  role: "primary",
                  expected_effect: "опора",
                },
              ],
            },
          ],
        },
      }
    );
    expect(recommendationError).toBeNull();
    const recommendationId = (recommendationIds as string[])[0];

    await openSection(specialistPage, clientId, "recommendations");
    await expect(specialistPage.getByTestId("recommendations-policy-note")).toContainText(
      "до явного решения человека"
    );
    const recommendationCard = card(specialistPage, "recommendation-card", RECOMMENDATION_TEXT);
    await expect(recommendationCard.getByTestId("recommendation-status")).toContainText(
      "Предложение AI, ожидает ревью"
    );
    await expect(recommendationCard.getByTestId("recommendation-limits")).toContainText(
      "Предложение AI (L0)"
    );
    await expect(recommendationCard.getByTestId("recommendation-visibility")).toContainText(
      "Внутренняя"
    );
    await expect(recommendationCard.getByTestId("recommendation-visibility-form")).toHaveCount(0);
    await expect(recommendationCard.getByTestId("recommendation-visibility-blocked")).toBeVisible();

    const reviewForm = recommendationCard.getByTestId("recommendation-review-form");
    await reviewForm.locator("select[name=decision]").selectOption("approve");
    await reviewForm.locator("input[name=reason]").fill("Проверено на сессии");
    await reviewForm.getByRole("button", { name: "Применить решение" }).click();
    await expect(recommendationCard.getByTestId("recommendation-status")).toContainText(
      "Подтверждена человеком"
    );

    const visibilityForm = recommendationCard.getByTestId("recommendation-visibility-form");
    await visibilityForm.locator("select[name=visibility]").selectOption("client_visible");
    await visibilityForm.locator("input[name=reason]").fill("Согласовано с клиентом");
    await visibilityForm.getByRole("button", { name: "Изменить видимость" }).click();
    await expect(recommendationCard.getByTestId("recommendation-visibility")).toContainText(
      "Опубликована в клиентском портале"
    );

    const { data: recommendationAfter } = await admin
      .from("recommendations")
      .select("status, visibility, reviewed_by")
      .eq("id", recommendationId)
      .single();
    expect(recommendationAfter).toMatchObject({
      status: "approved",
      visibility: "client_visible",
      reviewed_by: specialist.id,
    });

    // =====================================================================
    // 9. Correction created from the approved recommendation through the UI.
    //    Criterion: "Correction".
    // =====================================================================
    await specialistPage.goto(`/corrections/new?recommendationId=${recommendationId}`);
    await expect(specialistPage.getByRole("heading", { name: "Новая Correction" })).toBeVisible();
    await specialistPage
      .locator('textarea[name="clientVisibleSummary"]')
      .fill("Сводка для клиента: работа с опорой");
    await specialistPage.locator('input[name="contraindicationsAcknowledged"]').check();
    const markerRows = specialistPage.locator("[data-marker-row]");
    await markerRows.nth(0).locator('input[name="marker"]').fill(MARKER_NAME);
    await markerRows.nth(0).locator('input[name="lifeArea"]').fill("работа");
    await markerRows.nth(0).locator('input[name="baselineValue"]').fill("3");
    await markerRows.nth(0).locator('input[name="targetValue"]').fill("8");
    await markerRows.nth(1).locator('input[name="marker"]').fill("Снижение напряжения");
    await specialistPage.getByRole("button", { name: "Создать Correction" }).click();

    // The create action returns its state instead of redirecting, so wait for
    // the durable row rather than for a transient confirmation.
    await expect
      .poll(
        async () => {
          const { data } = await admin
            .from("corrections")
            .select("id")
            .eq("client_id", clientId)
            .eq("title", RECOMMENDATION_TEXT);
          return (data ?? []).length;
        },
        { timeout: 30_000 }
      )
      .toBe(1);

    const { data: correctionRow, error: correctionError } = await admin
      .from("corrections")
      .select("id, title, status, client_visible_summary")
      .eq("client_id", clientId)
      .eq("title", RECOMMENDATION_TEXT)
      .single();
    expect(correctionError).toBeNull();
    const correctionId = (correctionRow as { id: string }).id;
    expect(correctionRow).toMatchObject({
      status: "planned",
      client_visible_summary: "Сводка для клиента: работа с опорой",
    });

    await specialistPage.goto(`/corrections/${correctionId}`);
    await expect(specialistPage.getByRole("heading", { name: RECOMMENDATION_TEXT })).toBeVisible();
    await expect(specialistPage.getByText(`Статус: planned`)).toBeVisible();
    await expect(specialistPage.getByRole("heading", { name: "Expected markers" })).toBeVisible();
    await expect(specialistPage.getByText(MARKER_NAME)).toBeVisible();
    await expect(specialistPage.getByRole("link", { name: NODE_TITLE })).toBeVisible();

    // Move the correction to in_progress so follow-ups can be scheduled.
    const updateForm = specialistPage
      .locator("form")
      .filter({ has: specialistPage.getByRole("button", { name: "Обновить" }) });
    await updateForm.locator('select[name="status"]').selectOption("in_progress");
    await updateForm.getByRole("button", { name: "Обновить" }).click();
    await expect(specialistPage.getByText("Статус: in_progress")).toBeVisible();

    // =====================================================================
    // 10. BehavioralMarker created and measured through the UI.
    //     Criterion: "BehavioralMarker".
    // =====================================================================
    await specialistPage.goto(`/observations?clientId=${clientId}`);
    await expect(
      specialistPage.getByRole("heading", { name: "Observations и Behavioral markers" })
    ).toBeVisible();
    const markerForm = specialistPage
      .locator("form")
      .filter({ has: specialistPage.getByRole("button", { name: "Создать маркер" }) });
    await markerForm.locator('input[name="name"]').fill(MARKER_NAME);
    await markerForm.locator('input[name="lifeArea"]').fill("работа");
    await markerForm.locator('input[name="baselineValue"]').fill("3");
    await markerForm.locator('input[name="currentValue"]').fill("3");
    await markerForm.getByRole("button", { name: "Создать маркер" }).click();

    const markerItem = specialistPage.locator("li").filter({ hasText: MARKER_NAME }).first();
    await expect(markerItem).toContainText("baseline: 3");
    await expect(markerItem).toContainText("текущее: 3");
    await markerItem.locator('input[name="value"]').fill("7");
    await markerItem.locator('input[name="note"]').fill("Синтетическое измерение");
    await markerItem.getByRole("button", { name: "Записать" }).click();
    await expect(markerItem).toContainText("текущее: 7");

    const { data: markerRow } = await admin
      .from("behavioral_markers")
      .select("id, current_value")
      .eq("client_id", clientId)
      .eq("name", MARKER_NAME)
      .single();
    expect(markerRow).toMatchObject({ current_value: 7 });
    const { data: markerEntries } = await admin
      .from("behavioral_marker_entries")
      .select("value")
      .eq("marker_id", (markerRow as { id: string }).id);
    // The baseline entry plus the measured value recorded through the UI.
    expect((markerEntries as { value: number }[]).map((row) => row.value)).toContain(7);

    // =====================================================================
    // 11. FollowUp through the UI; its approved verdict records a ModelChange.
    //     Criterion: "FollowUp" and "model changes".
    // =====================================================================
    await specialistPage.goto(`/corrections/${correctionId}`);
    const scheduleForm = specialistPage
      .locator("form")
      .filter({ has: specialistPage.getByRole("button", { name: "Запланировать follow-up" }) });
    await scheduleForm
      .locator('input[name="scheduledAt"]')
      .fill(new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 16));
    scheduleForm.getByRole("button", { name: "Запланировать follow-up" }).click();
    await expect(specialistPage.getByText("Статус: scheduled")).toBeVisible();

    const completeForm = specialistPage.locator("form").filter({
      has: specialistPage.getByRole("button", { name: "Сохранить результаты follow-up" }),
    });
    await completeForm.locator('textarea[name="retestSummary"]').fill("Стресс снизился");
    await completeForm.locator('input[name="stressBefore"]').fill("80");
    await completeForm.locator('input[name="stressAfter"]').fill("40");
    await completeForm.locator('input[name="retestContexts"]').fill("работа, дом");
    await completeForm
      .locator('textarea[name="behavioralSummary"]')
      .fill("Выступил публично без избегания");
    await completeForm.locator('textarea[name="clientFeedbackSummary"]').fill("Стало спокойнее");
    await completeForm.locator('select[name="perceivedEffect"]').selectOption("positive");
    await completeForm
      .locator('textarea[name="specialistAssessmentSummary"]')
      .fill("Положительная динамика");
    await completeForm.getByRole("button", { name: "Сохранить результаты follow-up" }).click();
    await expect(specialistPage.getByText("Статус: completed")).toBeVisible();

    await specialistPage.getByRole("button", { name: "Оценить эффект (AI)" }).click();
    const assessmentHeading = specialistPage.locator("strong").filter({ hasText: "AI-оценка" });
    await expect(assessmentHeading).toBeVisible({ timeout: 30_000 });
    await specialistPage.getByRole("button", { name: "Подтвердить оценку" }).click();
    // The final verdict is a model transition, not just a form state.
    await expect(
      specialistPage.locator("strong").filter({ hasText: "AI-оценка (approved)" })
    ).toBeVisible({ timeout: 30_000 });

    const { data: modelChanges } = await admin
      .from("model_changes")
      .select("id, change_reason, entity_type")
      .eq("client_id", clientId);
    expect((modelChanges ?? []).length).toBeGreaterThanOrEqual(1);
    expect(
      (modelChanges as { change_reason: string }[]).some((row) =>
        row.change_reason.includes("Follow-up assessment approved")
      )
    ).toBe(true);

    // The overview renders the recorded model change, not an AI narrative.
    await specialistPage.goto(`/clients/${clientId}`);
    await expect(
      specialistPage.getByText("Follow-up assessment approved", { exact: false }).first()
    ).toBeVisible();

    // =====================================================================
    // 12. Snapshots and the version-bounded model-change comparison.
    //     Criterion: "snapshots" and "model changes". v2 contains the changes;
    //     v3 immediately after has none and says «недостаточно данных».
    // =====================================================================
    await generateSnapshot(ownerPage, clientId, "Версия после изменений модели");
    await ownerPage
      .getByRole("link", { name: /^v\d+ — / })
      .first()
      .click();
    const interval = ownerPage.getByTestId("model-interval");
    await expect(interval).toBeVisible();
    await expect(
      interval.getByTestId("interval-hypothesis").filter({ hasText: HYPOTHESIS_A })
    ).toBeVisible();
    await expect(
      interval.getByTestId("interval-hypothesis").filter({ hasText: HYPOTHESIS_B })
    ).toBeVisible();
    await expect(interval.getByTestId("interval-contradiction")).toContainText(
      CONTRADICTION_SUMMARY
    );
    const modelChangeItem = interval.getByTestId("interval-model-change");
    await expect(modelChangeItem).toContainText("Follow-up assessment approved");
    await expect(interval.getByTestId("interval-limits")).toContainText("не восстанавливается");
    const trailHref = await interval
      .getByTestId("evidence-trail-link")
      .first()
      .getAttribute("href");
    expect(trailHref).toContain(`/clients/${clientId}/evidence/`);

    // An empty interval is insufficient data, never a conclusion.
    await generateSnapshot(ownerPage, clientId, "Версия без изменений");
    await ownerPage
      .getByRole("link", { name: /^v\d+ — / })
      .first()
      .click();
    const emptyInterval = ownerPage.getByTestId("model-interval");
    await expect(emptyInterval.getByTestId("interval-no-hypotheses")).toBeVisible();
    await expect(emptyInterval.getByTestId("interval-no-contradictions")).toBeVisible();
    await expect(emptyInterval.getByTestId("interval-no-model-changes")).toBeVisible();
    await expect(emptyInterval.getByTestId("interval-limits")).toContainText("Недостаточно данных");

    const { data: snapshotVersions } = await admin
      .from("psychological_snapshots")
      .select("version")
      .eq("client_id", clientId)
      .order("version", { ascending: true });
    expect((snapshotVersions ?? []).length).toBeGreaterThanOrEqual(3);
    const firstSnapshotVersion = (snapshotVersions as { version: number }[])[0].version;

    // =====================================================================
    // 13. Medical boundary through the report HTTP contract (§13.14).
    //     Criterion: "medical boundaries".
    // =====================================================================
    const reportResponse = await ownerPage.request.get(
      `${appUrl}/api/reports/snapshot?clientId=${clientId}&snapshotVersion=${firstSnapshotVersion}&audience=specialist&format=markdown`
    );
    expect(reportResponse.status()).toBe(200);
    const reportBody = await reportResponse.text();
    expect(reportBody).toContain("не медицинский диагноз");
    expect(reportBody).toContain("не заменяют консультацию врача");

    // =====================================================================
    // 14. Full archive: request through the UI, download through the HTTP
    //     contract, validate the archive contract independently.
    //     Criterion: "Journey скачивает и валидирует full archive".
    // =====================================================================
    await openSection(ownerPage, clientId, "export");
    await expect(
      workspaceNav(ownerPage).getByRole("link", { name: "Экспорт", exact: true })
    ).toHaveAttribute("aria-current", "page");
    await expect(ownerPage.getByTestId("export-policy-note")).toContainText("30 дней");
    await ownerPage.getByTestId("export-request-submit").click();
    const availableRow = ownerPage.locator(
      '[data-testid="export-request-row"][data-status="available"]'
    );
    await expect(availableRow).toBeVisible({ timeout: 60_000 });
    const downloadHref = await ownerPage
      .getByTestId("export-download-link")
      .first()
      .getAttribute("href");
    expect(downloadHref).toBeTruthy();
    const downloadUrl = `${appUrl}${downloadHref}`;

    const downloadResponse = await ownerPage.request.get(downloadUrl);
    expect(downloadResponse.status()).toBe(200);
    const headers = downloadResponse.headers();
    expect(headers["content-type"]).toBe("application/vnd.live-client-map.client-archive+json");
    expect(headers["cache-control"]).toBe("no-store, private");
    const disposition = headers["content-disposition"] ?? "";
    expect(disposition).toContain("attachment;");
    expect(disposition).toMatch(/client_archive_[0-9a-f]{16}_[\dTZ.\-]+\.json/);
    // The filename is opaque: no client id, no client name.
    expect(disposition).not.toContain(clientId);
    expect(disposition).not.toContain(CLIENT_NAME);

    const rawArchive = await downloadResponse.text();
    const archive = JSON.parse(rawArchive) as {
      contract: string;
      version: string;
      export_id: string;
      generated_at: string;
      source_organization_id: string;
      subject_client_id: string;
      manifest: { record_counts: Record<string, number>; data_sha256: string; warnings: unknown[] };
      data: Record<string, unknown> & { client: Record<string, unknown> | null };
    };
    expect(archive.contract).toBe("live-client-map.client-archive");
    expect(archive.version).toBe("1.0");
    expect(archive.subject_client_id).toBe(clientId);
    expect(archive.source_organization_id).toBe(organizationId);
    expect(typeof archive.export_id).toBe("string");
    expect(Number.isNaN(Date.parse(archive.generated_at))).toBe(false);

    // Every required key is present; a missing category is [], never omitted.
    expect(archive.data.client).not.toBeNull();
    for (const collection of ARCHIVE_COLLECTIONS) {
      expect(Array.isArray(archive.data[collection]), `${collection} must be an array`).toBe(true);
    }
    const catalog = archive.data.reference_catalog as Record<string, unknown>;
    expect(catalog).toBeTruthy();
    for (const name of ["diagnostic_domains", "belief_templates", "intervention_methods"]) {
      expect(Array.isArray(catalog[name]), `reference_catalog.${name}`).toBe(true);
    }

    // record_counts mirror the serialized collections exactly.
    expect(Object.keys(archive.manifest.record_counts).sort()).toEqual(
      [...ARCHIVE_COLLECTIONS].sort()
    );
    for (const collection of ARCHIVE_COLLECTIONS) {
      expect(archive.manifest.record_counts[collection]).toBe(
        (archive.data[collection] as unknown[]).length
      );
    }

    // Lossless canonical form and a self-consistent checksum.
    expect(canonicalStringify(archive)).toBe(rawArchive);
    expect(archive.manifest.data_sha256).toBe(sha256(canonicalStringify(archive.data)));

    // The archive carries the journey's evidence and the client-visible note…
    expect(rawArchive).toContain(SIGNAL_ONE);
    expect(rawArchive).toContain(RECOMMENDATION_TEXT);
    expect(rawArchive).toContain(MARKER_NAME);
    expect(rawArchive).toContain(CLIENT_VISIBLE_NOTE);
    // …while the subject-client projection drops the private specialist note
    // (§11: the portable read model is not the private working copy).
    expect(archive.data.client).toMatchObject({ client_visible_notes: CLIENT_VISIBLE_NOTE });
    expect(archive.data.client).not.toHaveProperty("specialist_notes_private");
    expect(JSON.stringify(archive.data.client)).not.toContain(PRIVATE_NOTE);
    // Audit events never carry IP or user-agent (§11).
    expect(rawArchive).not.toContain("user_agent");
    expect(rawArchive).not.toContain("ip_address");

    // Audit evidence: request, completion and delivery are all traceable.
    const { data: exportAudit } = await admin
      .from("audit_log")
      .select("action, actor_user_id")
      .eq("entity_type", "client")
      .eq("entity_id", clientId)
      .in("action", ["export.requested", "export.completed", "export.downloaded"]);
    const auditActions = (exportAudit ?? []).map((row) => row.action);
    expect(auditActions).toContain("export.requested");
    expect(auditActions).toContain("export.completed");
    expect(auditActions).toContain("export.downloaded");
    expect((exportAudit ?? []).every((row) => row.actor_user_id === ownerUserId)).toBe(true);

    // Expiry maps to the same safe denial status, without changing the row.
    const secondRequest = await ownerPage.request.post(`${appUrl}/api/exports`, {
      data: {
        clientId,
        kind: "client_archive",
        audience: "owner",
        idempotencyKey: `journey-expiry-${randomUUID()}`,
      },
    });
    expect(secondRequest.status()).toBe(201);
    const secondTicket = (await secondRequest.json()) as { exportId: string; status: string };
    expect(secondTicket.status).toBe("available");
    const { error: backdateError } = await admin
      .from("export_requests")
      .update({ expires_at: new Date(Date.now() - 60_000).toISOString() })
      .eq("id", secondTicket.exportId);
    expect(backdateError).toBeNull();
    const expiredDownload = await ownerPage.request.get(
      `${appUrl}/api/exports/${secondTicket.exportId}/download`
    );
    expect(expiredDownload.status()).toBe(403);
    expect(await expiredDownload.json()).toMatchObject({
      error: { code: "FORBIDDEN" },
    });

    // =====================================================================
    // 15. Client Portal: invitation, published-only view, feedback.
    //     Criterion: "Journey … проходит Client Portal feedback".
    // =====================================================================
    await openSection(ownerPage, clientId, "feedback");
    const feedbackForm = ownerPage.getByTestId("feedback-form");
    await feedbackForm.getByTestId("feedback-title-input").fill(FEEDBACK_TITLE);
    await feedbackForm.getByTestId("feedback-question-label").first().fill(FEEDBACK_QUESTION);
    await feedbackForm.getByTestId("feedback-create-submit").click();
    const feedbackRow = ownerPage
      .getByTestId("feedback-form-row")
      .filter({ hasText: FEEDBACK_TITLE });
    await expect(feedbackRow).toHaveAttribute("data-form-status", "draft");
    await feedbackRow.getByTestId("feedback-send-submit").click();
    await expect(feedbackRow).toHaveAttribute("data-form-status", "sent");

    const portalEmail = `journey-portal-${randomUUID()}@example.com`;
    await openSection(ownerPage, clientId, "portal");
    await ownerPage.getByTestId("portal-invite-email").fill(portalEmail);
    await ownerPage.getByTestId("portal-invite-submit").click();
    await expect(
      ownerPage.getByTestId("portal-user-email").filter({ hasText: portalEmail })
    ).toBeVisible();
    const portalLink = await waitForPortalSignInLink(portalEmail);

    const portalPage = await newPage();
    await portalPage.goto(portalConfirmUrl(appUrl, portalLink));
    await expect(portalPage.getByTestId("portal-title")).toHaveText("Портал клиента");
    await expect(portalPage.getByTestId("portal-client-name")).toContainText(CLIENT_NAME);
    await expect(portalPage.getByTestId("portal-notes")).toHaveText(CLIENT_VISIBLE_NOTE);
    await expect(portalPage.getByTestId("portal-recommendation")).toContainText(
      RECOMMENDATION_TEXT
    );
    await expect(portalPage.getByTestId("portal-summary")).toContainText(
      "Сводка для клиента: работа с опорой"
    );
    const portalBody = (await portalPage.textContent("body")) ?? "";
    expect(portalBody).not.toContain(PRIVATE_NOTE);
    expect(portalBody).not.toContain("sig-against-A");

    const portalForm = portalPage
      .getByTestId("portal-feedback-form")
      .filter({ hasText: FEEDBACK_TITLE });
    await expect(portalForm).toBeVisible();
    await portalForm.getByTestId("portal-feedback-answer-q1").fill(FEEDBACK_ANSWER);
    await portalForm.getByTestId("portal-feedback-submit").click();
    await expect(
      portalPage.getByTestId("portal-feedback-form").filter({ hasText: FEEDBACK_TITLE })
    ).toHaveCount(0);
    await portalPage.reload();
    await expect(portalPage.getByTestId("portal-feedback-empty")).toBeVisible();

    // The client's answer lands as pending self-report evidence, never as a
    // confirmed conclusion.
    const { data: submittedForms } = await admin
      .from("client_feedback_forms")
      .select("id, status, answers")
      .eq("client_id", clientId)
      .eq("title", FEEDBACK_TITLE)
      .single();
    expect(submittedForms).toMatchObject({ status: "completed", answers: { q1: FEEDBACK_ANSWER } });
    const { data: feedbackSignals } = await admin
      .from("signals")
      .select("id, source_type, epistemic_type, evidence_level, review_status")
      .eq("client_id", clientId)
      .eq("source_type", "follow_up");
    expect(feedbackSignals).toHaveLength(1);
    expect(feedbackSignals![0]).toMatchObject({
      epistemic_type: "self_report",
      evidence_level: "L1_SINGLE_SIGNAL",
      review_status: "pending",
    });
    await openSection(ownerPage, clientId, "feedback");
    const finishedRow = ownerPage
      .getByTestId("feedback-form-row")
      .filter({ hasText: FEEDBACK_TITLE });
    await expect(finishedRow.getByTestId("feedback-form-status")).toContainText(
      "заполнена клиентом"
    );
    await expect(finishedRow.getByTestId("feedback-answer")).toContainText(FEEDBACK_ANSWER);

    // =====================================================================
    // 16. RLS / authorization denial, observed without and with HTTP.
    //     Criterion: "RLS denial".
    // =====================================================================
    const stranger: TestUser = await fixtures.createUser("journey-stranger");
    const strangerApi = await fixtures.userClient(stranger);
    const { error: strangerOrgError } = await strangerApi.rpc("create_organization", {
      org_name: `E2E Stranger Org ${RUN}`,
    });
    expect(strangerOrgError).toBeNull();

    const { data: strangerSignals } = await strangerApi
      .from("signals")
      .select("id")
      .eq("client_id", clientId);
    expect(strangerSignals ?? []).toHaveLength(0);
    const { data: strangerExports } = await strangerApi
      .from("export_requests")
      .select("id")
      .eq("client_id", clientId);
    expect(strangerExports ?? []).toHaveLength(0);

    const strangerPage = await newPage();
    await signInThroughLoginForm(strangerPage, stranger);
    const deniedResponse = await strangerPage.goto(`/clients/${clientId}`);
    expect(deniedResponse?.status()).toBe(404);
    await expect(strangerPage.getByRole("heading", { name: "Клиент недоступен" })).toBeVisible();
    await expect(strangerPage.getByText(CLIENT_NAME)).toHaveCount(0);
    const strangerDownload = await strangerPage.request.get(downloadUrl);
    expect(strangerDownload.status()).toBe(403);

    // =====================================================================
    // 17. Consent revocation: AI is blocked and an ALREADY PREPARED archive
    //     is refused, without changing its stored status.
    //     Criterion: "consent revocation".
    // =====================================================================
    await revokeConsent(ownerPage, clientId, "ai_analysis");
    const aiResponse = await ownerPage.request.post(`${appUrl}/api/ai/run`, {
      data: {
        functionId: "ai.ingest-signals.v1",
        organizationId,
        clientId,
        payload: {
          diagnostic_session_id: sessionId,
          raw_input: "Синтетический ввод после отзыва согласия",
          source_type: "client_report",
          input_format: "plain_text",
          language: "ru",
          known_life_areas: ["работа"],
        },
      },
    });
    expect(aiResponse.status()).toBe(422);
    expect(await aiResponse.json()).toMatchObject({ ok: false, status: "blocked_consent" });

    await revokeConsent(ownerPage, clientId, "data_storage");
    const revokedDownload = await ownerPage.request.get(downloadUrl);
    expect(revokedDownload.status()).toBe(403);
    expect(await revokedDownload.json()).toMatchObject({
      error: { code: "FORBIDDEN", message: expect.stringContaining("недоступен") },
    });
    const revokedRequest = await ownerPage.request.post(`${appUrl}/api/exports`, {
      data: {
        clientId,
        kind: "client_archive",
        audience: "owner",
        idempotencyKey: `journey-revoked-${randomUUID()}`,
      },
    });
    expect(revokedRequest.status()).toBe(403);

    // The artifact still exists — delivery, not storage, was revoked.
    const { data: stillAvailable } = await admin
      .from("export_requests")
      .select("status")
      .eq("id", downloadHref!.split("/")[3])
      .single();
    expect(stillAvailable).toMatchObject({ status: "available" });
    const { data: denialAudit } = await admin
      .from("audit_log")
      .select("action, reason")
      .eq("entity_type", "client")
      .eq("entity_id", clientId)
      .eq("action", "export.denied");
    expect((denialAudit ?? []).length).toBeGreaterThanOrEqual(1);

    // =====================================================================
    // 18. Erasure through the Owner UI, then audit anonymization.
    //     Criterion: "Journey … затем проверяет … erasure" + audit evidence.
    // =====================================================================
    await ownerPage.goto(`/clients/${clientId}`);
    ownerPage.on("dialog", (dialog) => void dialog.accept());
    await ownerPage.getByRole("button", { name: "Запросить полное удаление данных" }).click();

    // The server action revalidates the workspace, so the client disappears
    // while the form unmounts; wait for the durable deletion, then prove the
    // workspace itself is gone for the same Owner session.
    await expect
      .poll(
        async () => {
          const { data } = await admin.from("clients").select("id").eq("id", clientId);
          return (data ?? []).length;
        },
        { timeout: 60_000 }
      )
      .toBe(0);
    const afterErasure = await ownerPage.goto(`/clients/${clientId}`);
    expect(afterErasure?.status()).toBe(404);
    await expect(ownerPage.getByRole("heading", { name: "Клиент недоступен" })).toBeVisible();

    const { data: remainingClients } = await admin.from("clients").select("id").eq("id", clientId);
    expect(remainingClients).toHaveLength(0);
    const { data: remainingSignals } = await admin
      .from("signals")
      .select("id")
      .eq("client_id", clientId);
    expect(remainingSignals).toHaveLength(0);
    const { data: remainingRecommendations } = await admin
      .from("recommendations")
      .select("id")
      .eq("client_id", clientId);
    expect(remainingRecommendations).toHaveLength(0);
    const { data: remainingCorrections } = await admin
      .from("corrections")
      .select("id")
      .eq("client_id", clientId);
    expect(remainingCorrections).toHaveLength(0);

    const { data: erasureRows } = await admin
      .from("erasure_requests")
      .select("status, client_id")
      .eq("organization_id", organizationId);
    expect((erasureRows ?? []).length).toBeGreaterThanOrEqual(1);
    expect((erasureRows as { status: string }[]).some((row) => row.status === "completed")).toBe(
      true
    );

    // The audit trail survives anonymized: no entity id, no before/after data.
    const { data: erasedAudit } = await admin
      .from("audit_log")
      .select("entity_id, before_data, after_data, reason")
      .eq("organization_id", organizationId)
      .eq("reason", "[erased]");
    expect((erasedAudit ?? []).length).toBeGreaterThanOrEqual(1);
    expect(
      (erasedAudit as { entity_id: string | null; before_data: unknown }[]).every(
        (row) => row.entity_id === null
      )
    ).toBe(true);
    expect((erasedAudit as { before_data: unknown }[])[0].before_data).toEqual({ erased: true });
    const { data: completion } = await admin
      .from("audit_log")
      .select("action")
      .eq("organization_id", organizationId)
      .eq("action", "client.erasure_completed");
    expect((completion ?? []).length).toBeGreaterThanOrEqual(1);
  } finally {
    for (const context of openedContexts) {
      await context.close().catch(() => undefined);
    }
    await fixtures.cleanup().catch(() => undefined);
    if (organizationId) {
      await admin
        .from("organizations")
        .delete()
        .eq("id", organizationId)
        .then(undefined, () => undefined);
    }
    if (ownerUserId) {
      await admin.auth.admin.deleteUser(ownerUserId).catch(() => undefined);
    }
  }
});
