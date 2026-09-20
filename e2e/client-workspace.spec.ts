import { expect, test } from "@playwright/test";
import {
  signInThroughLoginForm,
  workspaceNav,
  WorkspaceFixture,
  type TestWorkspace,
  type TestUser,
} from "./support/fixtures";

/**
 * Ticket 09 — client workspace and access management, exercised through the
 * browser against the isolated E2E instance. Every test builds its own tenant
 * (users, organization, client) so no test depends on pre-existing rows.
 */
test.describe.configure({ timeout: 120_000 });

test.describe("client workspace and access management", () => {
  let fixtures: WorkspaceFixture;

  test.beforeEach(() => {
    fixtures = new WorkspaceFixture();
  });

  test.afterEach(async () => {
    await fixtures.cleanup();
  });

  test("specialist opens the client workspace and navigates sections without typing a client id", async ({
    page,
  }) => {
    const { organizationId, clientId } = await fixtures.createWorkspace("Рабочий клиент");
    const specialist = await fixtures.createUser("specialist");
    await fixtures.addMember(organizationId, specialist);
    await fixtures.assign(clientId, specialist, "primary_specialist");

    await signInThroughLoginForm(page, specialist);

    await page.goto("/clients");
    await page.getByRole("link", { name: "Рабочий клиент", exact: true }).click();

    await expect(page).toHaveURL(new RegExp(`/clients/${clientId}$`));
    await expect(page.getByTestId("client-workspace-title")).toHaveText("Рабочий клиент");
    // No manual client-id entry anywhere in the workspace.
    await expect(page.getByRole("textbox", { name: /client_id/i })).toHaveCount(0);

    const nav = workspaceNav(page);
    await expect(nav.getByRole("link", { name: "Согласия", exact: true })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Доступ", exact: true })).toHaveCount(0);

    await nav.getByRole("link", { name: "Диагностика", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/clients/${clientId}/diagnostics$`));
    await expect(page.getByTestId("client-section-placeholder")).toBeVisible();

    await workspaceNav(page).getByRole("link", { name: "Ресурсы", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/clients/${clientId}/resources$`));

    await workspaceNav(page).getByRole("link", { name: "Обзор", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/clients/${clientId}$`));

    await workspaceNav(page).getByRole("link", { name: "Живая карта", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/clients/${clientId}/map$`));
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Рабочий клиент");

    await page.getByRole("link", { name: "← Обзор клиента" }).click();
    await expect(page).toHaveURL(new RegExp(`/clients/${clientId}$`));
  });

  test("owner grants an assignment in the client context and the user gains access", async ({
    browser,
  }) => {
    const { owner, organizationId, clientId } = await fixtures.createWorkspace("Клиент доступа");
    const grantee = await fixtures.createUser("grantee");
    await fixtures.addMember(organizationId, grantee);

    // Before the grant: safe denial with no client metadata.
    const deniedContext = await browser.newContext();
    const deniedPage = await deniedContext.newPage();
    await signInThroughLoginForm(deniedPage, grantee);
    const deniedResponse = await deniedPage.goto(`/clients/${clientId}`);
    expect(deniedResponse?.status()).toBe(404);
    await expect(deniedPage.getByRole("heading", { name: "Клиент недоступен" })).toBeVisible();
    await expect(deniedPage.getByText("Клиент доступа")).toHaveCount(0);
    await deniedContext.close();

    // Owner grants through the client-context UI (no id input).
    const ownerContext = await browser.newContext();
    const ownerPage = await ownerContext.newPage();
    await signInThroughLoginForm(ownerPage, owner);
    await ownerPage.goto(`/clients/${clientId}/access`);
    await expect(
      workspaceNav(ownerPage).getByRole("link", { name: "Доступ", exact: true })
    ).toHaveAttribute("aria-current", "page");
    await expect(ownerPage.getByRole("textbox", { name: /client_id/i })).toHaveCount(0);

    await ownerPage.getByLabel("Участник").selectOption(grantee.email);
    await ownerPage.getByLabel("Роль доступа").selectOption("secondary_specialist");
    await ownerPage.getByRole("button", { name: "Назначить" }).click();

    await expect(
      ownerPage.getByTestId("client-assignment-email").filter({ hasText: grantee.email })
    ).toBeVisible();
    await ownerContext.close();

    // The newly assigned user now opens the same workspace.
    const grantedContext = await browser.newContext();
    const grantedPage = await grantedContext.newPage();
    await signInThroughLoginForm(grantedPage, grantee);
    await grantedPage.goto(`/clients/${clientId}`);
    await expect(grantedPage.getByTestId("client-workspace-title")).toHaveText("Клиент доступа");
    await grantedContext.close();
  });

  test("revoking an assignment removes access on the next load", async ({ browser }) => {
    const { owner, organizationId, clientId } = await fixtures.createWorkspace("Клиент отзыва");
    const specialist = await fixtures.createUser("revokee");
    await fixtures.addMember(organizationId, specialist);
    await fixtures.assign(clientId, specialist, "primary_specialist");

    const userContext = await browser.newContext();
    const userPage = await userContext.newPage();
    await signInThroughLoginForm(userPage, specialist);
    await userPage.goto(`/clients/${clientId}`);
    await expect(userPage.getByTestId("client-workspace-title")).toHaveText("Клиент отзыва");

    const ownerContext = await browser.newContext();
    const ownerPage = await ownerContext.newPage();
    await signInThroughLoginForm(ownerPage, owner);
    await ownerPage.goto(`/clients/${clientId}/access`);

    const row = ownerPage
      .getByTestId("client-assignment-row")
      .filter({ hasText: specialist.email });
    await expect(row).toBeVisible();
    await row.getByRole("button", { name: "Отозвать" }).click();
    await expect(
      ownerPage.getByTestId("client-assignment-row").filter({ hasText: specialist.email })
    ).toHaveCount(0);
    await ownerContext.close();

    // Immediate loss: the very next request is denied, with no metadata.
    const reloaded = await userPage.reload();
    expect(reloaded?.status()).toBe(404);
    await expect(userPage.getByRole("heading", { name: "Клиент недоступен" })).toBeVisible();
    await expect(userPage.getByText("Клиент отзыва")).toHaveCount(0);
    await userContext.close();
  });

  test("unassigned and foreign users get the same neutral denial", async ({ browser }) => {
    const { organizationId, clientId } = await fixtures.createWorkspace("Секретный клиент");
    const unassigned = await fixtures.createUser("unassigned");
    await fixtures.addMember(organizationId, unassigned);

    // Owner of a different tenant: not a member of this organization at all.
    const foreign = await fixtures.createWorkspace("Чужой клиент");

    for (const user of [unassigned, foreign.owner] as TestUser[]) {
      const context = await browser.newContext();
      const page = await context.newPage();
      await signInThroughLoginForm(page, user);

      for (const path of [`/clients/${clientId}`, `/clients/${clientId}/access`]) {
        const response = await page.goto(path);
        expect(response?.status()).toBe(404);
        await expect(page.getByRole("heading", { name: "Клиент недоступен" })).toBeVisible();
        await expect(page.getByText("Секретный клиент")).toHaveCount(0);
      }

      await context.close();
    }
  });

  test("supervisor sees only assigned clients and no owner controls", async ({ page }) => {
    const assigned: TestWorkspace = await fixtures.createWorkspace("Назначенный клиент");
    const ownerClient = await fixtures.signIn(assigned.owner);
    const secondClientId = await fixtures.addClient(
      ownerClient,
      assigned.organizationId,
      "Второй клиент"
    );

    const supervisor = await fixtures.createUser("supervisor");
    await fixtures.addMember(assigned.organizationId, supervisor, "supervisor");
    await fixtures.assign(assigned.clientId, supervisor, "supervisor");

    await signInThroughLoginForm(page, supervisor);
    await page.goto("/clients");
    await expect(page.getByRole("link", { name: "Назначенный клиент", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Второй клиент", exact: true })).toHaveCount(0);

    await page.goto(`/clients/${assigned.clientId}`);
    const nav = workspaceNav(page);
    await expect(nav.getByRole("link", { name: "Обзор", exact: true })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Доступ", exact: true })).toHaveCount(0);
    await expect(nav.getByRole("link", { name: "Согласия", exact: true })).toHaveCount(0);
    await expect(nav.getByRole("link", { name: "Импорт", exact: true })).toHaveCount(0);
    await expect(nav.getByRole("link", { name: "Ревью модели", exact: true })).toHaveCount(0);

    // Direct navigation to an Owner/write section is denied, not rendered.
    await page.goto(`/clients/${assigned.clientId}/access`);
    await expect(page.getByTestId("client-section-denied")).toBeVisible();
    await expect(page.getByRole("button", { name: "Назначить" })).toHaveCount(0);

    await page.goto(`/clients/${assigned.clientId}/consent`);
    await expect(page.getByTestId("client-section-denied")).toBeVisible();

    // A client the supervisor is not assigned to stays a 404.
    const unassignedResponse = await page.goto(`/clients/${secondClientId}`);
    expect(unassignedResponse?.status()).toBe(404);
  });
});
