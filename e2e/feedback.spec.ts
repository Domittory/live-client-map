import { randomUUID } from "node:crypto";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { WorkspaceFixture, signInThroughLoginForm, type TestWorkspace } from "./support/fixtures";
import {
  portalAccessToken,
  portalConfirmUrl,
  restClientForToken,
  waitForPortalSignInLink,
} from "./support/portal";

/**
 * Ticket 16 — the two-sided feedback flow in the browser.
 *
 * Every test builds its own tenant, drives the real specialist UI to author and
 * send a form, invites the client through the portal UI, captures the sign-in
 * email from Mailpit and fills the form in a fresh browser context. The
 * database is then observed with the service-role client: a browser submission
 * must really complete the form, create the pending `self_report` signal and
 * write the audit row, and it must never confirm model evidence.
 */

test.describe.configure({ timeout: 120_000 });

const FORM_TITLE = "Как вы себя чувствуете?";
const QUESTION_LABEL = "Что изменилось за неделю?";
const ANSWER = "Стало спокойнее, сон лучше.";

let fixture: WorkspaceFixture;

test.beforeEach(() => {
  fixture = new WorkspaceFixture();
});

test.afterEach(async () => {
  await fixture.cleanup();
});

/** Grant `client_portal` consent through the product RPC the consent UI calls. */
async function grantPortalConsent(workspace: TestWorkspace): Promise<void> {
  const owner = await fixture.signIn(workspace.owner);
  const { error } = await owner.rpc("grant_consent", {
    p_org_id: workspace.organizationId,
    p_client_id: workspace.clientId,
    p_consent_type: "client_portal",
    p_scope: "",
    p_document_version: "1.0",
  });
  if (error) throw new Error(`grant_consent failed: ${error.message}`);
}

/**
 * Author one form through the specialist UI.
 *
 * The assertions anchor on the persisted row (data-form-status), not on the
 * transient "created" message: the Server Action revalidates the path, so React
 * remounts the list with fresh server data and the local success state is gone
 * by the time the browser settles.
 */
async function createFormThroughUi(
  page: Page,
  clientId: string,
  title = FORM_TITLE
): Promise<void> {
  await page.goto(`/clients/${clientId}/feedback`);
  const form = page.getByTestId("feedback-form");
  await form.getByTestId("feedback-title-input").fill(title);
  await form.getByTestId("feedback-question-label").first().fill(QUESTION_LABEL);
  await form.getByTestId("feedback-create-submit").click();

  const row = page.getByTestId("feedback-form-row").filter({ hasText: title });
  await expect(row).toBeVisible();
  await expect(row).toHaveAttribute("data-form-status", "draft");
}

/** Author the form and send it to the client through the per-form action. */
async function sendFormThroughUi(page: Page, clientId: string, title = FORM_TITLE): Promise<void> {
  await createFormThroughUi(page, clientId, title);

  const row = page.getByTestId("feedback-form-row").filter({ hasText: title });
  await row.getByTestId("feedback-send-submit").click();
  await expect(row).toHaveAttribute("data-form-status", "sent");
  await expect(row.getByTestId("feedback-form-status")).toContainText("отправлена клиенту");
}

/**
 * Submit the visible portal form and wait for the durable outcome: the form
 * leaves the list. The transient "done" confirmation is not asserted because
 * the Server Action revalidates `/portal`, so the list is re-rendered from the
 * server and the local success state is unmounted with the submitted card.
 */
async function submitPortalFormThroughUi(page: Page, title: string, answer: string): Promise<void> {
  const form = page.getByTestId("portal-feedback-form").filter({ hasText: title });
  await form.getByTestId("portal-feedback-answer-q1").fill(answer);
  await form.getByTestId("portal-feedback-submit").click();
  await expect(page.getByTestId("portal-feedback-form").filter({ hasText: title })).toHaveCount(0);
}

/** The id of the one form with this title, read back with the service role. */
async function formIdByTitle(clientId: string, title: string): Promise<string> {
  const { data, error } = await fixture
    .serviceRoleClient()
    .from("client_feedback_forms")
    .select("id")
    .eq("client_id", clientId)
    .eq("title", title)
    .single();
  if (error) throw new Error(`form lookup failed: ${error.message}`);
  return data!.id as string;
}

/**
 * Invite the portal identity through the specialist portal UI and get its link.
 *
 * The assertion waits for the durable result (the identity appears in the
 * specialist's access list) rather than the transient "sent" node: the action
 * revalidates the page, so React re-renders the list with server data and the
 * local success state is gone by then.
 */
async function invitePortal(page: Page, workspace: TestWorkspace, email: string): Promise<string> {
  await signInThroughLoginForm(page, workspace.owner);
  await page.goto(`/clients/${workspace.clientId}/portal`);
  await page.getByTestId("portal-invite-email").fill(email);
  await page.getByTestId("portal-invite-submit").click();
  await expect(page.getByTestId("portal-user-email").filter({ hasText: email })).toBeVisible();
  return waitForPortalSignInLink(email);
}

/** Open the emailed link in its own context, as the client's browser would. */
async function openPortal(
  browser: { newContext: () => Promise<BrowserContext> },
  appUrl: string,
  link: string
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext();
  const portalPage = await context.newPage();
  await portalPage.goto(portalConfirmUrl(appUrl, link));
  await expect(portalPage.getByTestId("portal-title")).toBeVisible();
  return { context, page: portalPage };
}

test("specialist authors and sends a form, the client submits it and it lands as pending evidence", async ({
  page,
  browser,
  baseURL,
}) => {
  const appUrl = baseURL ?? "";
  const workspace = await fixture.createWorkspace("Клиент обратной связи");
  await grantPortalConsent(workspace);

  await signInThroughLoginForm(page, workspace.owner);
  await sendFormThroughUi(page, workspace.clientId);
  const formId = await formIdByTitle(workspace.clientId, FORM_TITLE);

  const email = `feedback-${randomUUID()}@example.com`;
  const link = await invitePortal(page, workspace, email);
  const { context, page: portalPage } = await openPortal(browser, appUrl, link);

  await expect(
    portalPage.getByTestId("portal-feedback-form").filter({ hasText: FORM_TITLE })
  ).toBeVisible();
  await submitPortalFormThroughUi(portalPage, FORM_TITLE, ANSWER);

  const admin = fixture.serviceRoleClient();
  const { data: form } = await admin
    .from("client_feedback_forms")
    .select("status, answers, completed_at")
    .eq("id", formId)
    .single();
  expect(form?.status).toBe("completed");
  expect(form?.completed_at).not.toBeNull();

  const { data: signals } = await admin
    .from("signals")
    .select("id, source_type, epistemic_type, evidence_level, review_status, context")
    .eq("client_id", workspace.clientId)
    .eq("source_type", "follow_up");
  expect(signals ?? []).toHaveLength(1);
  expect(signals![0].epistemic_type).toBe("self_report");
  expect(signals![0].evidence_level).toBe("L1_SINGLE_SIGNAL");
  expect(signals![0].review_status).toBe("pending");
  expect((signals![0].context as { feedback_form_id?: string })?.feedback_form_id).toBe(formId);

  const { data: auditRows } = await admin
    .from("audit_log")
    .select("action, after_data")
    .eq("entity_type", "client_feedback_form")
    .eq("entity_id", formId!);
  const submitRow = (auditRows ?? []).find((row) => row.action === "feedback_form.submit");
  expect(submitRow).toBeTruthy();
  expect((submitRow!.after_data as { signal_id?: string })?.signal_id).toBe(signals![0].id);

  // The submitted form disappears from the portal on the next render.
  await portalPage.reload();
  await expect(portalPage.getByTestId("portal-feedback-empty")).toBeVisible();

  // The specialist sees the finished form with the client's answers.
  await page.goto(`/clients/${workspace.clientId}/feedback`);
  const finished = page.getByTestId("feedback-form-row").filter({ hasText: FORM_TITLE });
  await expect(finished.getByTestId("feedback-form-status")).toContainText("заполнена клиентом");
  await expect(finished.getByTestId("feedback-answer")).toContainText(ANSWER);

  await context.close();
});

test("an expired form is neither listed nor submittable", async ({ page, browser, baseURL }) => {
  const appUrl = baseURL ?? "";
  const workspace = await fixture.createWorkspace("Клиент срока формы");
  await grantPortalConsent(workspace);

  await signInThroughLoginForm(page, workspace.owner);
  await sendFormThroughUi(page, workspace.clientId, "Просроченная форма E2E");
  const formId = await formIdByTitle(workspace.clientId, "Просроченная форма E2E");

  const admin = fixture.serviceRoleClient();
  const { error: expiryError } = await admin
    .from("client_feedback_forms")
    .update({ expires_at: new Date(Date.now() - 60_000).toISOString() })
    .eq("id", formId);
  if (expiryError) throw new Error(expiryError.message);

  const email = `feedback-expired-${randomUUID()}@example.com`;
  const link = await invitePortal(page, workspace, email);
  const { context, page: portalPage } = await openPortal(browser, appUrl, link);

  await expect(portalPage.getByTestId("portal-feedback-empty")).toBeVisible();
  await expect(portalPage.getByTestId("portal-feedback-form")).toHaveCount(0);

  // The same identity cannot push the expired form through the RPC either.
  const token = await portalAccessToken(context);
  const rest = restClientForToken(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    token
  );
  const { error } = await rest.rpc("submit_feedback_form", {
    p_form_id: formId,
    p_answers: { q1: "слишком поздно" },
  });
  expect(error).toBeTruthy();

  const { data: form } = await admin
    .from("client_feedback_forms")
    .select("status")
    .eq("id", formId)
    .single();
  expect(form?.status).toBe("sent");

  await context.close();
});

test("a submitted form cannot be reused by the portal or by a direct RPC call", async ({
  page,
  browser,
  baseURL,
}) => {
  const appUrl = baseURL ?? "";
  const workspace = await fixture.createWorkspace("Клиент повтора формы");
  await grantPortalConsent(workspace);

  await signInThroughLoginForm(page, workspace.owner);
  await sendFormThroughUi(page, workspace.clientId, "Форма без повтора E2E");
  const formId = await formIdByTitle(workspace.clientId, "Форма без повтора E2E");

  const email = `feedback-reuse-${randomUUID()}@example.com`;
  const link = await invitePortal(page, workspace, email);
  const { context, page: portalPage } = await openPortal(browser, appUrl, link);

  await submitPortalFormThroughUi(portalPage, "Форма без повтора E2E", "первый ответ");

  const token = await portalAccessToken(context);
  const rest = restClientForToken(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    token
  );
  const { error } = await rest.rpc("submit_feedback_form", {
    p_form_id: formId,
    p_answers: { q1: "второй ответ" },
  });
  expect(error).toBeTruthy();

  const admin = fixture.serviceRoleClient();
  const { data: form } = await admin
    .from("client_feedback_forms")
    .select("answers, status")
    .eq("id", formId)
    .single();
  expect(form?.status).toBe("completed");
  expect(form?.answers).toEqual({ q1: "первый ответ" });

  await portalPage.reload();
  await expect(portalPage.getByTestId("portal-feedback-empty")).toBeVisible();

  await context.close();
});

test("a portal identity cannot see or submit another client's form", async ({
  page,
  browser,
  baseURL,
}) => {
  const appUrl = baseURL ?? "";
  const workspace = await fixture.createWorkspace("Клиент A");
  await grantPortalConsent(workspace);

  await signInThroughLoginForm(page, workspace.owner);
  const ownerClient = await fixture.signIn(workspace.owner);
  await ownerClient.rpc("grant_consent", {
    p_org_id: workspace.organizationId,
    p_client_id: workspace.clientId,
    p_consent_type: "client_portal",
    p_scope: "",
    p_document_version: "1.0",
  });
  // A second client in the same organization, with its own form.
  const otherClientId = await fixture.addClient(ownerClient, workspace.organizationId, "Клиент B");
  await ownerClient.rpc("grant_consent", {
    p_org_id: workspace.organizationId,
    p_client_id: otherClientId,
    p_consent_type: "client_portal",
    p_scope: "",
    p_document_version: "1.0",
  });
  await sendFormThroughUi(page, otherClientId, "Чужая форма E2E");
  const foreignFormId = await formIdByTitle(otherClientId, "Чужая форма E2E");

  const email = `feedback-cross-${randomUUID()}@example.com`;
  const link = await invitePortal(page, workspace, email);
  const { context, page: portalPage } = await openPortal(browser, appUrl, link);

  await expect(portalPage.getByTestId("portal-feedback-empty")).toBeVisible();
  await expect(portalPage.getByTestId("portal-feedback-title")).toHaveCount(0);

  const token = await portalAccessToken(context);
  const rest = restClientForToken(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    token
  );
  const { error } = await rest.rpc("submit_feedback_form", {
    p_form_id: foreignFormId,
    p_answers: { q1: "чужой ответ" },
  });
  expect(error).toBeTruthy();

  const admin = fixture.serviceRoleClient();
  const { data: form } = await admin
    .from("client_feedback_forms")
    .select("status")
    .eq("id", foreignFormId)
    .single();
  expect(form?.status).toBe("sent");

  // The foreign form is real — the denial is not vacuous.
  const { count } = await admin
    .from("client_feedback_forms")
    .select("id", { count: "exact", head: true })
    .eq("client_id", otherClientId)
    .eq("status", "sent");
  expect(count).toBeGreaterThan(0);

  await context.close();
});

test("revoking the client_portal consent takes effect on the portal's next request", async ({
  page,
  browser,
  baseURL,
}) => {
  const appUrl = baseURL ?? "";
  const workspace = await fixture.createWorkspace("Клиент отзыва согласия");
  await grantPortalConsent(workspace);

  await signInThroughLoginForm(page, workspace.owner);
  await sendFormThroughUi(page, workspace.clientId, "Форма до отзыва E2E");
  const formId = await formIdByTitle(workspace.clientId, "Форма до отзыва E2E");

  const email = `feedback-revoke-${randomUUID()}-${randomUUID()}@example.com`;
  const link = await invitePortal(page, workspace, email);
  const { context, page: portalPage } = await openPortal(browser, appUrl, link);
  await expect(portalPage.getByTestId("portal-feedback-form")).toHaveCount(1);

  // The specialist revokes the consent through the real consent UI.
  await page.goto(`/clients/${workspace.clientId}/consent`);
  const consentRow = page.getByTestId("client-consent-client_portal");
  await consentRow.getByRole("button", { name: "Отозвать" }).click();
  await expect(consentRow).toContainText("не выдано");

  // Same portal session, nothing else changed: the next request is denied.
  await portalPage.reload();
  await expect(portalPage.getByTestId("portal-denied")).toBeVisible();
  await expect(portalPage.getByTestId("portal-feedback-form")).toHaveCount(0);

  // And the submission RPC is refused as well.
  const token = await portalAccessToken(context);
  const rest = restClientForToken(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    token
  );
  const { error } = await rest.rpc("submit_feedback_form", {
    p_form_id: formId,
    p_answers: { q1: "после отзыва" },
  });
  expect(error).toBeTruthy();

  const admin = fixture.serviceRoleClient();
  const { data: form } = await admin
    .from("client_feedback_forms")
    .select("status")
    .eq("id", formId)
    .single();
  expect(form?.status).toBe("sent");

  await context.close();
});
