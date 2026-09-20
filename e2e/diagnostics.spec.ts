import { expect, test, type Page } from "@playwright/test";
import {
  signInThroughLoginForm,
  workspaceNav,
  WorkspaceFixture,
  type TestWorkspace,
} from "./support/fixtures";

/**
 * Ticket 10 — client-scoped diagnostics, exercised through the browser against
 * the isolated E2E instance. Every test builds its own tenant, drives the real
 * forms, and then observes the database with the service-role client: the point
 * is that a browser write really persists (with its audit row) and that the
 * database — not the UI — denies users without an assignment.
 */
test.describe.configure({ timeout: 120_000 });

const SESSION_TITLE = "E2E сессия 1";
const RAW_INPUT = "Клиент сообщает о стрессе вокруг ответственности.";
const SIGNAL_STATEMENT = "Мне безопасно быть главным";
const SIGNAL_MEANING = "Стресс вокруг доступа к позитивной возможности.";

async function openDiagnostics(page: Page, clientId: string): Promise<void> {
  await page.goto(`/clients/${clientId}/diagnostics`);
  await expect(
    workspaceNav(page).getByRole("link", { name: "Диагностика", exact: true })
  ).toHaveAttribute("aria-current", "page");
}

async function createSessionThroughUi(page: Page): Promise<void> {
  const form = page.getByTestId("diagnostic-session-form");
  await form.locator("[name=title]").fill(SESSION_TITLE);
  await form.getByLabel("Тип сессии", { exact: true }).selectOption("individual");
  await form.locator("[name=rawInput]").fill(RAW_INPUT);
  await form.locator("[name=notes]").fill("Заметка E2E");
  await form.getByRole("button", { name: "Создать сессию" }).click();
  await expect(
    page.getByTestId("diagnostic-session-title").filter({ hasText: SESSION_TITLE })
  ).toBeVisible();
}

async function addSignalThroughUi(page: Page): Promise<void> {
  const form = page.getByTestId("signal-form");
  await form.getByLabel("Сессия", { exact: true }).selectOption({ label: SESSION_TITLE });
  await form.getByLabel("Источник", { exact: true }).selectOption("kinesiology_test");
  await form.getByLabel("Эпистемический тип", { exact: true }).selectOption("test_result");
  await form.locator("[name=rawStatement]").fill(SIGNAL_STATEMENT);
  await form.getByLabel("Формулировка", { exact: true }).selectOption("positive");
  await form.getByLabel("Результат теста", { exact: true }).selectOption("stress");
  await form.locator("[name=normalizedMeaning]").fill(SIGNAL_MEANING);
  await form.locator("[name=intensity]").fill("70");
  await form.locator("[name=confidence]").fill("60");
  await form.locator("[name=lifeAreas]").fill("работа, отношения");
  await form.locator("[name=tags]").fill("ответственность");
  await form.getByLabel("Видимость", { exact: true }).selectOption("internal");
  await form.getByRole("button", { name: "Добавить сигнал" }).click();
  await expect(
    page.getByTestId("signal-statement").filter({ hasText: SIGNAL_STATEMENT })
  ).toBeVisible();
}

test.describe("client diagnostics and signals", () => {
  let fixtures: WorkspaceFixture;

  test.beforeEach(() => {
    fixtures = new WorkspaceFixture();
  });

  test.afterEach(async () => {
    await fixtures.cleanup();
  });

  test("specialist creates a session and a signal through the browser and both persist with audit rows", async ({
    page,
  }) => {
    const { organizationId, clientId } = await fixtures.createWorkspace("Клиент диагностики");
    const specialist = await fixtures.createUser("diagnost");
    await fixtures.addMember(organizationId, specialist);
    await fixtures.assign(clientId, specialist, "primary_specialist");

    await signInThroughLoginForm(page, specialist);
    await openDiagnostics(page, clientId);

    // The workspace route carries the client: no manual id entry.
    await expect(page.getByRole("textbox", { name: /client_id/i })).toHaveCount(0);

    await createSessionThroughUi(page);
    await addSignalThroughUi(page);

    // The Signal row shows source, epistemic type, review status, evidence level
    // and its lineage, all in Russian.
    const row = page.getByTestId("signal-row").filter({ hasText: SIGNAL_STATEMENT });
    await expect(row.getByTestId("signal-source")).toContainText("Кинезиологический тест");
    await expect(row.getByTestId("signal-epistemic")).toContainText("Результат теста");
    await expect(row.getByTestId("signal-review-status")).toContainText("Подтверждено человеком");
    await expect(row.getByTestId("signal-evidence-level")).toContainText("L1 — один сигнал");
    await expect(row.getByTestId("signal-lineage")).toContainText(SESSION_TITLE);
    await expect(row.getByTestId("signal-review-status")).toBeVisible();

    // Persisted state, observed with the service role (browser-to-database).
    const admin = fixtures.serviceRoleClient();
    const { data: sessions } = await admin
      .from("diagnostic_sessions")
      .select("id, title, session_type, raw_input, notes")
      .eq("client_id", clientId);
    expect(sessions).toHaveLength(1);
    expect(sessions?.[0].title).toBe(SESSION_TITLE);
    expect(sessions?.[0].session_type).toBe("individual");
    expect(sessions?.[0].raw_input).toBe(RAW_INPUT);
    const sessionId = sessions![0].id as string;

    const { data: signals } = await admin
      .from("signals")
      .select(
        "id, diagnostic_session_id, source_type, epistemic_type, raw_statement, normalized_meaning, intensity, confidence, life_areas, tags, review_status, evidence_level, visibility, created_by"
      )
      .eq("client_id", clientId);
    expect(signals).toHaveLength(1);
    const signal = signals![0];
    expect(signal.diagnostic_session_id).toBe(sessionId);
    expect(signal.source_type).toBe("kinesiology_test");
    expect(signal.epistemic_type).toBe("test_result");
    expect(signal.raw_statement).toBe(SIGNAL_STATEMENT);
    expect(signal.normalized_meaning).toBe(SIGNAL_MEANING);
    expect(signal.intensity).toBe(70);
    expect(signal.confidence).toBe(60);
    expect(signal.life_areas).toEqual(["работа", "отношения"]);
    expect(signal.tags).toEqual(["ответственность"]);
    expect(signal.evidence_level).toBe("L1_SINGLE_SIGNAL");
    expect(signal.visibility).toBe("internal");
    expect(signal.created_by).toBe(specialist.id);

    // Audit evidence: the browser write is traceable to the actor.
    const { data: audit } = await admin
      .from("audit_log")
      .select("entity_type, entity_id, action, actor_user_id")
      .eq("organization_id", organizationId)
      .in("action", ["session.created", "signal.created"]);
    expect(
      audit?.some((entry) => entry.action === "session.created" && entry.entity_id === sessionId)
    ).toBe(true);
    expect(
      audit?.some((entry) => entry.action === "signal.created" && entry.entity_id === signal.id)
    ).toBe(true);
    expect(audit?.every((entry) => entry.actor_user_id === specialist.id)).toBe(true);
  });

  test("pending AI evidence is shown as insufficient data and only an explicit review with a reason changes it", async ({
    page,
  }) => {
    const { organizationId, clientId } = await fixtures.createWorkspace("Клиент ревью");
    const specialist = await fixtures.createUser("reviewer");
    await fixtures.addMember(organizationId, specialist);
    await fixtures.assign(clientId, specialist, "primary_specialist");

    // A pending, AI-only Signal: the state the UI must never promote silently.
    const admin = fixtures.serviceRoleClient();
    const { data: pending, error } = await admin
      .from("signals")
      .insert({
        organization_id: organizationId,
        client_id: clientId,
        source_type: "ai_hypothesis",
        epistemic_type: "hypothesis",
        raw_statement: "Возможно, клиент избегает ответственности",
        evidence_level: "L0_AI_ONLY",
        review_status: "pending",
      })
      .select("id")
      .single();
    expect(error).toBeNull();
    const pendingId = pending!.id as string;

    await signInThroughLoginForm(page, specialist);
    await openDiagnostics(page, clientId);

    const row = page.getByTestId("signal-row").filter({ hasText: "избегает ответственности" });
    await expect(row.getByTestId("signal-review-status")).toContainText("Ожидает ревью");
    await expect(row.getByTestId("signal-evidence-level")).toContainText("L0");
    await expect(page.getByTestId(`signal-interpretation-${pendingId}`)).toContainText(
      "недостаточно данных"
    );
    await expect(page.getByTestId(`signal-insufficient-${pendingId}`)).toContainText(
      "AI-гипотеза не является доказательством самой себя"
    );

    // The row is still pending: nothing was promoted by the panel's own render.
    const reviewForm = row.getByTestId("signal-review-form");
    await reviewForm.getByLabel("Действие ревью").selectOption("reject");
    await reviewForm.getByRole("button", { name: "Применить ревью" }).click();
    await expect(reviewForm.getByTestId("signal-review-error")).toContainText("укажите причину");
    const { data: stillPending } = await admin
      .from("signals")
      .select("review_status")
      .eq("id", pendingId)
      .single();
    expect(stillPending?.review_status).toBe("pending");

    // An explicit approval with a reason is the only way the status changes.
    await reviewForm.getByLabel("Действие ревью").selectOption("approve");
    await reviewForm
      .getByLabel("Причина (обязательна для отклонения и скрытия)")
      .fill("Проверено специалистом на сессии");
    await reviewForm.getByRole("button", { name: "Применить ревью" }).click();
    await expect(row.getByTestId("signal-review-status")).toContainText("Подтверждено человеком");

    const { data: reviewed } = await admin
      .from("signals")
      .select("review_status, source_type")
      .eq("id", pendingId)
      .single();
    expect(reviewed?.review_status).toBe("approved");

    // The audit row carries the actor, the before/after state and the reason.
    const { data: audit } = await admin
      .from("audit_log")
      .select("action, actor_user_id, before_data, after_data, reason")
      .eq("entity_id", pendingId)
      .eq("action", "review.approve")
      .single();
    expect(audit?.actor_user_id).toBe(specialist.id);
    expect(audit?.before_data).toMatchObject({ review_status: "pending" });
    expect(audit?.after_data).toMatchObject({ review_status: "approved" });
    expect(audit?.reason).toBe("Проверено специалистом на сессии");
  });

  test("an unassigned member gets the neutral denial and the database denies the write", async ({
    browser,
  }) => {
    const { organizationId, clientId } = await fixtures.createWorkspace("Закрытый клиент");
    const specialist = await fixtures.createUser("owner-specialist");
    await fixtures.addMember(organizationId, specialist);
    await fixtures.assign(clientId, specialist, "primary_specialist");

    // The specialist creates real evidence first, so the denial is not vacuous.
    const ownerClient = await fixtures.signIn(specialist);
    const { data: sessionId } = await ownerClient.rpc("create_diagnostic_session", {
      p_org_id: organizationId,
      p_client_id: clientId,
      p_title: "Приватная сессия",
      p_session_type: "individual",
      p_source_type: null,
      p_raw_input: "Секретные данные",
      p_input_format: null,
      p_notes: null,
      p_signals: [],
    });
    expect(sessionId).toBeTruthy();

    const unassigned = await fixtures.createUser("unassigned-viewer");
    await fixtures.addMember(organizationId, unassigned);

    const context = await browser.newContext();
    const page = await context.newPage();
    await signInThroughLoginForm(page, unassigned);

    const response = await page.goto(`/clients/${clientId}/diagnostics`);
    expect(response?.status()).toBe(404);
    await expect(page.getByRole("heading", { name: "Клиент недоступен" })).toBeVisible();
    await expect(page.getByText("Приватная сессия")).toHaveCount(0);
    await expect(page.getByText("Секретные данные")).toHaveCount(0);
    await expect(page.getByTestId("diagnostic-session-form")).toHaveCount(0);

    // RLS denial without the UI: a direct read returns nothing, and a direct
    // write is rejected by the database.
    const unassignedClient = await fixtures.userClient(unassigned);
    const { data: sessions } = await unassignedClient
      .from("diagnostic_sessions")
      .select("id")
      .eq("client_id", clientId);
    expect(sessions).toEqual([]);

    const { data: forged } = await unassignedClient
      .from("signals")
      .insert({
        organization_id: organizationId,
        client_id: clientId,
        source_type: "client_report",
        epistemic_type: "self_report",
        raw_statement: "Обход RLS",
      })
      .select("id");
    expect(forged).toBeNull();

    const { error: rpcError } = await unassignedClient.rpc("create_signal", {
      p_org_id: organizationId,
      p_client_id: clientId,
      p_signal: {
        source_type: "client_report",
        epistemic_type: "self_report",
        raw_statement: "Обход RLS через RPC",
      },
    });
    expect(rpcError?.code).toBe("42501");

    await context.close();
  });

  test("a read-only supervisor sees diagnostics without write controls", async ({ page }) => {
    const workspace: TestWorkspace = await fixtures.createWorkspace("Клиент супервизора");
    const supervisor = await fixtures.createUser("readonly-supervisor");
    await fixtures.addMember(workspace.organizationId, supervisor, "supervisor");
    await fixtures.assign(workspace.clientId, supervisor, "read_only");

    const ownerClient = await fixtures.signIn(workspace.owner);
    await ownerClient.rpc("create_diagnostic_session", {
      p_org_id: workspace.organizationId,
      p_client_id: workspace.clientId,
      p_title: "Существующая сессия",
      p_session_type: "individual",
      p_source_type: null,
      p_raw_input: "Данные для чтения",
      p_input_format: null,
      p_notes: null,
      p_signals: [],
    });

    await signInThroughLoginForm(page, supervisor);
    await openDiagnostics(page, workspace.clientId);

    // Read-only sees the evidence...
    await expect(
      page.getByTestId("diagnostic-session-title").filter({ hasText: "Существующая сессия" })
    ).toBeVisible();
    // ...but no control it cannot use.
    await expect(page.getByTestId("diagnostic-session-form")).toHaveCount(0);
    await expect(page.getByTestId("signal-form")).toHaveCount(0);
    await expect(page.getByTestId("signal-review-form").locator("select[name=action]")).toHaveCount(
      0
    );
    await expect(page.getByTestId("diagnostics-read-only")).toBeVisible();

    // The database denies the same write even if the UI is bypassed.
    const { error } = await (
      await fixtures.userClient(supervisor)
    ).rpc("create_diagnostic_session", {
      p_org_id: workspace.organizationId,
      p_client_id: workspace.clientId,
      p_title: "Обход UI",
      p_session_type: "individual",
      p_source_type: null,
      p_raw_input: null,
      p_input_format: null,
      p_notes: null,
      p_signals: [],
    });
    expect(error?.code).toBe("42501");
  });
});
