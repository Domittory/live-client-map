import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { TEST_PASSWORD, WorkspaceFixture } from "./support/fixtures";
import { authConfirmUrl, waitForAuthLink } from "./support/mailpit";

/**
 * Password recovery browser coverage (ticket 17).
 *
 * The suite drives the real journey: request the reset link, capture it from
 * Mailpit, follow it, set a new password, and prove that the new credential
 * works while the old one no longer does. It also covers enumeration safety,
 * reused and tampered links, the absence of a form without a verified recovery
 * session, and the refusal of an open-redirect attempt after the update.
 */

const NEW_PASSWORD = "new-password-456";

let fixture: WorkspaceFixture;

test.beforeEach(() => {
  fixture = new WorkspaceFixture();
});

test.afterEach(async () => {
  await fixture.cleanup();
});

/** Submit the recovery request form and wait for the neutral confirmation. */
async function requestReset(page: Page, email: string): Promise<void> {
  await page.goto("/forgot-password");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Отправить ссылку" }).click();
  await expect(page.getByTestId("forgot-password-sent")).toBeVisible();
}

/** Fill and submit the password-update form. */
async function setNewPassword(page: Page, password: string): Promise<void> {
  await page.getByLabel("Новый пароль").fill(password);
  await page.getByLabel("Повторите пароль").fill(password);
  await page.getByTestId("reset-password-submit").click();
}

async function signInExpectSuccess(page: Page, email: string, password: string): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Пароль").fill(password);
  await page.getByRole("button", { name: "Войти" }).click();
  await page.waitForURL((url) => url.pathname === "/");
}

async function signInExpectFailure(page: Page, email: string, password: string): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Пароль").fill(password);
  await page.getByRole("button", { name: "Войти" }).click();
  await expect(page.locator("p.error")).toBeVisible();
  await expect(page).toHaveURL(/\/login/);
}

test("resets the password through the emailed link and signs in with the new credential", async ({
  page,
  browser,
  baseURL,
}) => {
  const appUrl = baseURL ?? "";
  const workspace = await fixture.createWorkspace();
  const email = workspace.owner.email;

  await requestReset(page, email);
  const link = await waitForAuthLink(email);

  // The callback verifies the recovery token before any form is shown.
  await page.goto(authConfirmUrl(appUrl, link, "recovery"));
  await expect(page).toHaveURL(/\/reset-password$/);
  await expect(page.getByTestId("reset-password-form")).toBeVisible();

  await setNewPassword(page, NEW_PASSWORD);
  await expect(page).toHaveURL(/\/$/);

  // The new credential signs in from a fresh browser context.
  const newContext = await browser.newContext();
  const newPage = await newContext.newPage();
  await signInExpectSuccess(newPage, email, NEW_PASSWORD);
  await newContext.close();

  // The old credential no longer works.
  const oldContext = await browser.newContext();
  const oldPage = await oldContext.newPage();
  await signInExpectFailure(oldPage, email, TEST_PASSWORD);
  await oldContext.close();

  // Recovery by itself grants nothing: the membership and portal state are
  // exactly what the fixture created.
  const admin = fixture.serviceRoleClient();
  const { count: members } = await admin
    .from("organization_members")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", workspace.organizationId);
  expect(members).toBe(1);
  const { count: portalUsers } = await admin
    .from("client_portal_users")
    .select("id", { count: "exact", head: true })
    .eq("client_id", workspace.clientId);
  expect(portalUsers).toBe(0);
});

test("does not reveal whether an account exists", async ({ page }) => {
  const workspace = await fixture.createWorkspace();

  await requestReset(page, workspace.owner.email);
  const known = await page.getByTestId("forgot-password-sent").textContent();

  await page.goto("/forgot-password");
  await page.getByLabel("Email").fill(`nobody-${randomUUID()}@example.com`);
  await page.getByRole("button", { name: "Отправить ссылку" }).click();
  await expect(page.getByTestId("forgot-password-sent")).toBeVisible();
  const unknown = await page.getByTestId("forgot-password-sent").textContent();

  expect(unknown).toBe(known);
});

test("rejects a reused reset link with a clear Russian message", async ({
  page,
  browser,
  baseURL,
}) => {
  const appUrl = baseURL ?? "";
  const workspace = await fixture.createWorkspace();
  const email = workspace.owner.email;

  await requestReset(page, email);
  const link = await waitForAuthLink(email);
  const confirmUrl = authConfirmUrl(appUrl, link, "recovery");

  await page.goto(confirmUrl);
  await expect(page).toHaveURL(/\/reset-password$/);
  await setNewPassword(page, NEW_PASSWORD);
  await expect(page).toHaveURL(/\/$/);

  const reuseContext = await browser.newContext();
  const reusePage = await reuseContext.newPage();
  await reusePage.goto(confirmUrl);
  await expect(reusePage).toHaveURL(/\/forgot-password\?error=link_invalid$/);
  await expect(reusePage.getByTestId("forgot-password-error")).toContainText("недействительна");
  await expect(reusePage.getByTestId("reset-password-form")).toHaveCount(0);
  await reuseContext.close();
});

test("rejects an expired or tampered reset link", async ({ page, baseURL }) => {
  const appUrl = baseURL ?? "";

  await page.goto(`${appUrl}/auth/confirm?token_hash=expired-or-tampered&type=recovery`);

  await expect(page).toHaveURL(/\/forgot-password\?error=link_invalid$/);
  await expect(page.getByTestId("forgot-password-error")).toContainText("недействительна");
  await expect(page.getByTestId("reset-password-form")).toHaveCount(0);
});

test("never shows the password form without a verified recovery session", async ({ page }) => {
  await page.goto("/reset-password");

  // The route is not public: without a session the middleware sends the
  // visitor to sign in instead of rendering a usable password form.
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByTestId("reset-password-form")).toHaveCount(0);
});

test("refuses to follow an external redirect after the password update", async ({
  page,
  baseURL,
}) => {
  const appUrl = baseURL ?? "";
  const workspace = await fixture.createWorkspace();
  const email = workspace.owner.email;

  await requestReset(page, email);
  const link = await waitForAuthLink(email);
  await page.goto(authConfirmUrl(appUrl, link, "recovery"));
  await expect(page).toHaveURL(/\/reset-password$/);

  // A hostile `next` must not survive into the post-update navigation.
  await page.goto("/reset-password?next=https%3A%2F%2Fevil.example%2Fpwned");
  await expect(page.getByTestId("reset-password-form")).toBeVisible();
  await setNewPassword(page, NEW_PASSWORD);
  await page.waitForURL((url) => url.pathname === "/");

  expect(page.url()).not.toContain("evil.example");
  expect(new URL(page.url()).origin).toBe(new URL(appUrl).origin);
});
