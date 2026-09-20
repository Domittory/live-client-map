import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { WorkspaceFixture, signInThroughLoginForm, type TestWorkspace } from "./support/fixtures";
import {
  portalAccessToken,
  portalConfirmUrl,
  restClientForToken,
  waitForPortalSignInLink,
} from "./support/portal";

/**
 * Client Portal browser coverage (ticket 15).
 *
 * Every test builds its own tenant, invites a portal identity through the real
 * specialist UI, captures the single-use sign-in email from Mailpit and opens
 * it in a fresh browser context — exactly what a client does. The suite covers
 * the login link, reuse/expiry rejection, the published-only view, cross-client
 * denial, immediate access loss after revocation, and a direct RLS denial with
 * the portal session's own token.
 */

let fixture: WorkspaceFixture;

test.beforeEach(() => {
  fixture = new WorkspaceFixture();
});

test.afterEach(async () => {
  await fixture.cleanup();
});

/** Published content plus deliberate private/pending decoys for the projector. */
async function seedPublishedContent(workspace: TestWorkspace) {
  const owner = await fixture.signIn(workspace.owner);
  const { error } = await owner.rpc("grant_consent", {
    p_org_id: workspace.organizationId,
    p_client_id: workspace.clientId,
    p_consent_type: "client_portal",
    p_scope: "",
    p_document_version: "1.0",
  });
  if (error) throw new Error(`grant_consent failed: ${error.message}`);

  await owner
    .from("clients")
    .update({ client_visible_notes: "Опубликованная сводка для клиента" })
    .eq("id", workspace.clientId);
  await owner.from("development_targets").insert({
    organization_id: workspace.organizationId,
    client_id: workspace.clientId,
    name: "Цель: сон",
    status: "active",
  });
  await owner.from("recommendations").insert({
    organization_id: workspace.organizationId,
    client_id: workspace.clientId,
    proposed_correction: "Публичная рекомендация",
    status: "approved",
    visibility: "client_visible",
    final_priority_score: 75,
  });
  await owner.from("recommendations").insert({
    organization_id: workspace.organizationId,
    client_id: workspace.clientId,
    proposed_correction: "СЕКРЕТНАЯ ВНУТРЕННЯЯ РЕКОМЕНДАЦИЯ",
    rationale: "СЕКРЕТНОЕ ОБОСНОВАНИЕ",
    risk_notes: "СЕКРЕТНЫЙ РИСК",
    status: "approved",
    visibility: "internal",
  });
  await owner.from("recommendations").insert({
    organization_id: workspace.organizationId,
    client_id: workspace.clientId,
    proposed_correction: "ЧЕРНОВИК AI",
    status: "draft",
    visibility: "client_visible",
  });
  await owner.from("corrections").insert({
    organization_id: workspace.organizationId,
    client_id: workspace.clientId,
    title: "Итог работы",
    client_visible_summary: "Опубликованный итог работы",
    status: "completed",
  });
  await owner.from("differential_hypotheses").insert({
    organization_id: workspace.organizationId,
    client_id: workspace.clientId,
    title: "СЕКРЕТНАЯ ДИФФЕРЕНЦИАЛЬНАЯ ГИПОТЕЗА",
  });

  return owner;
}

/** Invite one portal identity through the specialist UI and return its link. */
async function invitePortal(page: Page, workspace: TestWorkspace, email: string): Promise<string> {
  await signInThroughLoginForm(page, workspace.owner);
  await page.goto(`/clients/${workspace.clientId}/portal`);
  await page.getByTestId("portal-invite-email").fill(email);
  await page.getByTestId("portal-invite-submit").click();
  await expect(page.getByTestId("portal-invite-sent")).toBeVisible();
  return waitForPortalSignInLink(email);
}

test("signs in through the time-limited link and shows only published content", async ({
  page,
  browser,
  baseURL,
}) => {
  const appUrl = baseURL ?? "";
  const workspace = await fixture.createWorkspace();
  await seedPublishedContent(workspace);

  const email = `portal-${randomUUID()}@example.com`;
  const link = await invitePortal(page, workspace, email);

  const portalContext = await browser.newContext();
  const portalPage = await portalContext.newPage();
  await portalPage.goto(portalConfirmUrl(appUrl, link));

  await expect(portalPage).toHaveURL(/\/portal$/);
  await expect(portalPage.getByTestId("portal-title")).toHaveText("Портал клиента");
  await expect(portalPage.getByTestId("portal-client-name")).toContainText("E2E клиент");
  await expect(portalPage.getByTestId("portal-notes")).toHaveText(
    "Опубликованная сводка для клиента"
  );
  await expect(portalPage.getByTestId("portal-target")).toContainText("Цель: сон");
  await expect(portalPage.getByTestId("portal-summary")).toContainText(
    "Опубликованный итог работы"
  );
  await expect(portalPage.getByTestId("portal-recommendation")).toContainText(
    "Публичная рекомендация"
  );

  const body = (await portalPage.textContent("body")) ?? "";
  expect(body).not.toContain("СЕКРЕТНАЯ ВНУТРЕННЯЯ РЕКОМЕНДАЦИЯ");
  expect(body).not.toContain("СЕКРЕТНОЕ ОБОСНОВАНИЕ");
  expect(body).not.toContain("СЕКРЕТНЫЙ РИСК");
  expect(body).not.toContain("ЧЕРНОВИК AI");
  expect(body).not.toContain("СЕКРЕТНАЯ ДИФФЕРЕНЦИАЛЬНАЯ ГИПОТЕЗА");

  await portalContext.close();
});

test("rejects a reused sign-in link with a clear Russian message", async ({
  page,
  browser,
  baseURL,
}) => {
  const appUrl = baseURL ?? "";
  const workspace = await fixture.createWorkspace();
  await seedPublishedContent(workspace);

  const email = `portal-reuse-${randomUUID()}@example.com`;
  const link = await invitePortal(page, workspace, email);
  const confirmUrl = portalConfirmUrl(appUrl, link);

  const firstContext = await browser.newContext();
  const firstPage = await firstContext.newPage();
  await firstPage.goto(confirmUrl);
  await expect(firstPage).toHaveURL(/\/portal$/);

  const secondContext = await browser.newContext();
  const secondPage = await secondContext.newPage();
  await secondPage.goto(confirmUrl);
  await expect(secondPage).toHaveURL(/\/portal\/login\?error=link_invalid$/);
  await expect(secondPage.getByTestId("portal-login-error")).toContainText("недействительна");
  await expect(secondPage.getByTestId("portal-login-session")).toHaveCount(0);

  await firstContext.close();
  await secondContext.close();
});

test("rejects an expired or tampered link", async ({ page, baseURL }) => {
  const appUrl = baseURL ?? "";

  await page.goto(`${appUrl}/auth/confirm?token_hash=expired-or-tampered&type=magiclink`);

  await expect(page).toHaveURL(/\/portal\/login\?error=link_invalid$/);
  await expect(page.getByTestId("portal-login-error")).toContainText("недействительна");
});

test("denies cross-client access", async ({ page, browser, baseURL }) => {
  const appUrl = baseURL ?? "";
  const workspace = await fixture.createWorkspace();
  const ownerClient = await seedPublishedContent(workspace);
  const otherClientId = await fixture.addClient(
    ownerClient,
    workspace.organizationId,
    "Другой клиент"
  );
  await ownerClient
    .from("clients")
    .update({ client_visible_notes: "СЕКРЕТ ДРУГОГО КЛИЕНТА" })
    .eq("id", otherClientId);

  const email = `portal-cross-${randomUUID()}@example.com`;
  const link = await invitePortal(page, workspace, email);

  const portalContext = await browser.newContext();
  const portalPage = await portalContext.newPage();
  await portalPage.goto(portalConfirmUrl(appUrl, link));
  await expect(portalPage.getByTestId("portal-notes")).toHaveText(
    "Опубликованная сводка для клиента"
  );

  const response = await portalPage.goto(`${appUrl}/portal/${otherClientId}`);
  expect(response?.status()).toBe(404);
  await expect(portalPage.getByText("СЕКРЕТ ДРУГОГО КЛИЕНТА")).toHaveCount(0);

  await portalContext.close();
});

test("loses access on the next request after revocation", async ({ page, browser, baseURL }) => {
  const appUrl = baseURL ?? "";
  const workspace = await fixture.createWorkspace();
  await seedPublishedContent(workspace);

  const email = `portal-revoke-${randomUUID()}@example.com`;
  const link = await invitePortal(page, workspace, email);

  const portalContext = await browser.newContext();
  const portalPage = await portalContext.newPage();
  await portalPage.goto(portalConfirmUrl(appUrl, link));
  await expect(portalPage.getByTestId("portal-title")).toBeVisible();

  // The specialist revokes through the real portal management UI.
  await page.goto(`/clients/${workspace.clientId}/portal`);
  const row = page.getByTestId("portal-user-row").filter({ hasText: email });
  await row.getByRole("button", { name: "Отозвать" }).click();
  // Wait for the server action to commit and the specialist list to update.
  await expect(row.getByText("отозван")).toBeVisible();

  // Same portal session, nothing else changed: the next request is denied.
  await portalPage.reload();
  await expect(portalPage.getByTestId("portal-denied")).toBeVisible();
  await expect(portalPage.getByTestId("portal-denied-message")).toContainText("отозван");

  await portalContext.close();
});

test("the portal browser session cannot read base domain tables", async ({
  page,
  browser,
  baseURL,
}) => {
  const appUrl = baseURL ?? "";
  const workspace = await fixture.createWorkspace();
  await seedPublishedContent(workspace);

  const email = `portal-rls-${randomUUID()}@example.com`;
  const link = await invitePortal(page, workspace, email);

  const portalContext = await browser.newContext();
  const portalPage = await portalContext.newPage();
  await portalPage.goto(portalConfirmUrl(appUrl, link));
  await expect(portalPage.getByTestId("portal-title")).toBeVisible();

  const token = await portalAccessToken(portalContext);
  const rest = restClientForToken(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    token
  );

  for (const table of [
    "signals",
    "themes",
    "core_nodes",
    "differential_hypotheses",
    "clients",
    "development_targets",
    "recommendations",
    "corrections",
    "audit_log",
  ]) {
    const { data } = await rest.from(table).select("id").limit(5);
    expect(data ?? [], `${table} must be denied to the portal session`).toHaveLength(0);
  }

  // Non-vacuous: the seeded private rows really exist in the client's tenant.
  const { count } = await fixture
    .serviceRoleClient()
    .from("differential_hypotheses")
    .select("id", { count: "exact", head: true })
    .eq("client_id", workspace.clientId);
  expect(count).toBeGreaterThan(0);

  await portalContext.close();
});
