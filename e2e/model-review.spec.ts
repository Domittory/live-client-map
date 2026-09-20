import { expect, test, type Page } from "@playwright/test";
import {
  signInThroughLoginForm,
  workspaceNav,
  WorkspaceFixture,
  type TestUser,
  type TestWorkspace,
} from "./support/fixtures";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Ticket 12 — client model review through the browser against the isolated E2E
 * instance.
 *
 * Every test builds its own tenant and seeds the AI-proposal states through the
 * real product RPCs, then drives the review screen as a specialist and observes
 * the database with the service-role client. The point is that a pending AI
 * proposal is never promoted by rendering the screen, that an explicit decision
 * persists together with its audit row, that confirming one competing
 * hypothesis leaves the others and their contradictions in place, and that the
 * database — not the UI — denies a caller without write access.
 */
test.describe.configure({ timeout: 120_000 });

const SIGNAL_STATEMENT = "Клиент избегает конфликта с руководителем";
const THEME_NAME = "Избегание конфликта";
const NODE_TITLE = "Страх авторитета";
const HYPOTHESIS_A = "A: поиск признания отца";
const HYPOTHESIS_B = "B: объективно токсичная среда";

interface SeededModel {
  themeId: string;
  nodeId: string;
  hypothesisA: string;
  hypothesisB: string;
}

/** Seed the AI-proposal states the review screen analyses, through real RPCs. */
async function seedModel(
  orgId: string,
  clientId: string,
  writer: SupabaseClient
): Promise<SeededModel> {
  const { data: signalId, error: signalError } = await writer.rpc("create_signal", {
    p_org_id: orgId,
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
    p_org_id: orgId,
    p_client_id: clientId,
    p_proposals: [
      {
        action: "create",
        name: THEME_NAME,
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
  const themeId = (themeIds as string[])[0];

  const { data: nodeIds, error: nodeError } = await writer.rpc("apply_ai_core_node_proposals", {
    p_org_id: orgId,
    p_client_id: clientId,
    p_proposals: [
      {
        action: "create",
        title: NODE_TITLE,
        hypothesis: "AI-гипотеза узла",
        root_domain: "работа",
        confidence: 55,
        theme_links: [themeId],
        rationale: "Связь предложена AI",
      },
    ],
  });
  if (nodeError) throw new Error(`apply_ai_core_node_proposals failed: ${nodeError.message}`);
  const nodeId = (nodeIds as string[])[0];

  const { data: hypothesisIds, error: hypothesisError } = await writer.rpc("create_ai_hypotheses", {
    p_org_id: orgId,
    p_client_id: clientId,
    p_hypotheses: [
      {
        title: HYPOTHESIS_A,
        description: "Конкурирующее объяснение A",
        confidence: 50,
        evidence_for: ["ref-for-A"],
        evidence_against: ["ref-against-A"],
      },
      {
        title: HYPOTHESIS_B,
        description: "Конкурирующее объяснение B",
        confidence: 50,
        evidence_for: ["ref-for-B"],
        evidence_against: ["ref-against-B"],
      },
    ],
  });
  if (hypothesisError) throw new Error(`create_ai_hypotheses failed: ${hypothesisError.message}`);

  const [hypothesisA, hypothesisB] = hypothesisIds as string[];
  return { themeId, nodeId, hypothesisA, hypothesisB };
}

async function openReview(page: Page, clientId: string): Promise<void> {
  await page.goto(`/clients/${clientId}/review`);
  await expect(
    workspaceNav(page).getByRole("link", { name: "Ревью модели", exact: true })
  ).toHaveAttribute("aria-current", "page");
}

/** Scope to one conclusion card by its visible title. */
function card(page: Page, testId: string, title: string) {
  return page.getByTestId(testId).filter({ hasText: title });
}

async function decide(
  page: Page,
  cardLocator: ReturnType<typeof card>,
  formTestId: string,
  decision: "approve" | "reject",
  reason?: string
): Promise<void> {
  const form = cardLocator.getByTestId(formTestId);
  await form.locator("select[name=decision]").selectOption(decision);
  if (reason !== undefined) {
    await form.locator("input[name=reason]").fill(reason);
  }
  await form.getByRole("button", { name: "Применить решение" }).click();
}

async function createReviewer(
  fixtures: WorkspaceFixture,
  workspace: TestWorkspace
): Promise<TestUser> {
  const specialist = await fixtures.createUser("reviewer");
  await fixtures.addMember(workspace.organizationId, specialist);
  await fixtures.assign(workspace.clientId, specialist, "primary_specialist");
  return specialist;
}

test.describe("client model review", () => {
  let fixtures: WorkspaceFixture;

  test.beforeEach(() => {
    fixtures = new WorkspaceFixture();
  });

  test.afterEach(async () => {
    await fixtures.cleanup();
  });

  test("specialist inspects evidence and confirms one competing hypothesis without deleting the others", async ({
    page,
  }) => {
    const workspace = await fixtures.createWorkspace("Клиент ревью модели");
    const specialist = await createReviewer(fixtures, workspace);
    const ownerClient = await fixtures.signIn(workspace.owner);
    const seeded = await seedModel(workspace.organizationId, workspace.clientId, ownerClient);

    await signInThroughLoginForm(page, specialist);
    await openReview(page, workspace.clientId);

    // The route carries the client: no manual id entry anywhere.
    await expect(page.getByRole("textbox", { name: /client_id/i })).toHaveCount(0);
    await expect(page.getByTestId("review-policy-note")).toContainText(
      "до явного решения человека"
    );

    // --- Theme with its Signal links -------------------------------------
    const themeCard = card(page, "review-theme", THEME_NAME);
    await expect(themeCard).toBeVisible();
    await expect(themeCard.getByTestId("review-theme-status")).toContainText(
      "Предложение AI, ожидает ревью"
    );
    await expect(themeCard.getByTestId("review-theme-signal-links")).toContainText(
      SIGNAL_STATEMENT
    );
    await expect(themeCard.getByTestId("supporting-evidence")).toContainText(SIGNAL_STATEMENT);
    await expect(themeCard.getByTestId("data-limits")).toContainText("Предложение AI (L0)");

    // --- CoreNode with its Theme links and traceable evidence ------------
    const nodeCard = card(page, "review-core-node", NODE_TITLE);
    await expect(nodeCard).toBeVisible();
    await expect(nodeCard.getByTestId("review-core-node-status")).toContainText(
      "Предложение AI, ожидает ревью"
    );
    await expect(nodeCard.getByTestId("review-core-node-theme-links")).toContainText(THEME_NAME);
    await expect(nodeCard.getByTestId("supporting-evidence")).toContainText(SIGNAL_STATEMENT);

    // --- Competing hypotheses, no automatic winner -----------------------
    const hypothesisACard = card(page, "review-hypothesis", HYPOTHESIS_A);
    const hypothesisBCard = card(page, "review-hypothesis", HYPOTHESIS_B);
    await expect(hypothesisACard).toBeVisible();
    await expect(hypothesisBCard).toBeVisible();
    await expect(hypothesisACard.getByTestId("supporting-evidence")).toContainText("ref-for-A");
    await expect(hypothesisACard.getByTestId("contradicting-evidence")).toContainText(
      "ref-against-A"
    );
    await expect(hypothesisBCard.getByTestId("contradicting-evidence")).toContainText(
      "ref-against-B"
    );
    await expect(page.getByTestId("review-hypotheses-note")).toContainText(
      "не выбирает победителя автоматически"
    );

    // Rendering the screen promoted nothing: every AI proposal is still pending.
    const admin = fixtures.serviceRoleClient();
    const before = await admin
      .from("themes")
      .select("review_status")
      .eq("id", seeded.themeId)
      .single();
    expect(before.data?.review_status).toBe("pending");
    const nodeBefore = await admin
      .from("core_nodes")
      .select("status")
      .eq("id", seeded.nodeId)
      .single();
    expect(nodeBefore.data?.status).toBe("under_review");
    const hypothesesBefore = await admin
      .from("differential_hypotheses")
      .select("id, status, evidence_against")
      .in("id", [seeded.hypothesisA, seeded.hypothesisB]);
    expect(hypothesesBefore.data?.every((row) => row.status === "hypothesis")).toBe(true);

    // --- Explicit approval of the AI theme -------------------------------
    await decide(page, themeCard, "theme-review-form", "approve", "Проверено на сессии");
    await expect(themeCard.getByTestId("review-theme-status")).toContainText(
      "Подтверждена человеком"
    );

    // --- Explicit approval of one competing hypothesis -------------------
    await decide(page, hypothesisACard, "hypothesis-review-form", "approve", "Подтверждено");
    await expect(hypothesisACard.getByTestId("review-hypothesis-status")).toContainText(
      "Подтверждена человеком"
    );

    // The competing hypothesis and its contradictions are untouched.
    await expect(hypothesisBCard.getByTestId("review-hypothesis-status")).toContainText(
      "Гипотеза (не подтверждена человеком)"
    );
    await expect(hypothesisBCard.getByTestId("contradicting-evidence")).toContainText(
      "ref-against-B"
    );

    // Persisted model state, observed with the service role.
    const themeAfter = await admin
      .from("themes")
      .select("review_status")
      .eq("id", seeded.themeId)
      .single();
    expect(themeAfter.data?.review_status).toBe("approved");

    const hypothesesAfter = await admin
      .from("differential_hypotheses")
      .select("id, status, evidence_against")
      .in("id", [seeded.hypothesisA, seeded.hypothesisB]);
    const byId = new Map((hypothesesAfter.data ?? []).map((row) => [row.id, row]));
    expect(byId.get(seeded.hypothesisA)?.status).toBe("active");
    expect(byId.get(seeded.hypothesisB)?.status).toBe("hypothesis");
    expect(byId.get(seeded.hypothesisB)?.evidence_against).toEqual(["ref-against-B"]);

    // Audit evidence carries the acting specialist and the decision.
    const { data: audit } = await admin
      .from("audit_log")
      .select("entity_id, action, actor_user_id, reason")
      .in("action", ["theme.approve", "hypothesis.approve"]);
    expect(
      audit?.some(
        (row) =>
          row.action === "theme.approve" &&
          row.entity_id === seeded.themeId &&
          row.actor_user_id === specialist.id &&
          row.reason === "Проверено на сессии"
      )
    ).toBe(true);
    expect(
      audit?.some(
        (row) =>
          row.action === "hypothesis.approve" &&
          row.entity_id === seeded.hypothesisA &&
          row.actor_user_id === specialist.id
      )
    ).toBe(true);
  });

  test("rejecting requires a reason and is recorded; the core node decision is explicit too", async ({
    page,
  }) => {
    const workspace = await fixtures.createWorkspace("Клиент отклонения");
    const specialist = await createReviewer(fixtures, workspace);
    const ownerClient = await fixtures.signIn(workspace.owner);
    const seeded = await seedModel(workspace.organizationId, workspace.clientId, ownerClient);

    await signInThroughLoginForm(page, specialist);
    await openReview(page, workspace.clientId);

    const admin = fixtures.serviceRoleClient();

    // Reject without a reason is refused client-side and nothing is persisted.
    const hypothesisBCard = card(page, "review-hypothesis", HYPOTHESIS_B);
    await decide(page, hypothesisBCard, "hypothesis-review-form", "reject");
    await expect(hypothesisBCard.getByTestId("hypothesis-review-form-error")).toContainText(
      "укажите причину"
    );
    const stillPending = await admin
      .from("differential_hypotheses")
      .select("status")
      .eq("id", seeded.hypothesisB)
      .single();
    expect(stillPending.data?.status).toBe("hypothesis");

    // A reason makes the rejection explicit and persisted.
    await decide(
      page,
      hypothesisBCard,
      "hypothesis-review-form",
      "reject",
      "Не подтвердилась в данных"
    );
    await expect(hypothesisBCard.getByTestId("review-hypothesis-status")).toContainText(
      "Отклонена человеком"
    );
    const rejected = await admin
      .from("differential_hypotheses")
      .select("status")
      .eq("id", seeded.hypothesisB)
      .single();
    expect(rejected.data?.status).toBe("rejected");

    const { data: audit } = await admin
      .from("audit_log")
      .select("action, actor_user_id, reason")
      .eq("entity_id", seeded.hypothesisB)
      .eq("action", "hypothesis.reject")
      .single();
    expect(audit?.actor_user_id).toBe(specialist.id);
    expect(audit?.reason).toBe("Не подтвердилась в данных");

    // The core node decision goes through the existing atomic status RPC.
    const nodeCard = card(page, "review-core-node", NODE_TITLE);
    await decide(page, nodeCard, "core-node-review-form", "reject");
    await expect(nodeCard.getByTestId("review-core-node-status")).toContainText(
      "Отклонён человеком"
    );
    const nodeAfter = await admin
      .from("core_nodes")
      .select("status")
      .eq("id", seeded.nodeId)
      .single();
    expect(nodeAfter.data?.status).toBe("rejected");
  });

  test("an unassigned member is denied and a read-only user sees no review controls", async ({
    browser,
  }) => {
    const workspace = await fixtures.createWorkspace("Закрытый клиент ревью");
    const ownerClient = await fixtures.signIn(workspace.owner);
    const seeded = await seedModel(workspace.organizationId, workspace.clientId, ownerClient);

    // Unassigned member: the neutral 404, no model metadata leaked.
    const unassigned = await fixtures.createUser("unassigned-reviewer");
    await fixtures.addMember(workspace.organizationId, unassigned);
    const unassignedContext = await browser.newContext();
    const unassignedPage = await unassignedContext.newPage();
    await signInThroughLoginForm(unassignedPage, unassigned);
    const response = await unassignedPage.goto(`/clients/${workspace.clientId}/review`);
    expect(response?.status()).toBe(404);
    await expect(unassignedPage.getByRole("heading", { name: "Клиент недоступен" })).toBeVisible();
    await expect(unassignedPage.getByText(THEME_NAME)).toHaveCount(0);
    await expect(unassignedPage.getByTestId("theme-review-form")).toHaveCount(0);
    await unassignedContext.close();

    // Read-only member: the section is denied and no decision control renders.
    const readOnly = await fixtures.createUser("readonly-reviewer");
    await fixtures.addMember(workspace.organizationId, readOnly, "supervisor");
    await fixtures.assign(workspace.clientId, readOnly, "read_only");
    const readOnlyContext = await browser.newContext();
    const readOnlyPage = await readOnlyContext.newPage();
    await signInThroughLoginForm(readOnlyPage, readOnly);
    await readOnlyPage.goto(`/clients/${workspace.clientId}/review`);
    await expect(readOnlyPage.getByTestId("client-section-denied")).toBeVisible();
    await expect(readOnlyPage.getByTestId("theme-review-form")).toHaveCount(0);
    await expect(readOnlyPage.getByTestId("hypothesis-review-form")).toHaveCount(0);
    await expect(readOnlyPage.getByTestId("core-node-review-form")).toHaveCount(0);

    // The database denies the write even if the UI is bypassed entirely.
    const readOnlyClient = await fixtures.userClient(readOnly);
    const { error } = await readOnlyClient.rpc("review_theme", {
      p_org_id: workspace.organizationId,
      p_theme_id: seeded.themeId,
      p_decision: "approve",
      p_reason: null,
    });
    expect(error?.code).toBe("42501");

    const { data: theme } = await fixtures
      .serviceRoleClient()
      .from("themes")
      .select("review_status")
      .eq("id", seeded.themeId)
      .single();
    expect(theme?.review_status).toBe("pending");

    await readOnlyContext.close();
  });
});
