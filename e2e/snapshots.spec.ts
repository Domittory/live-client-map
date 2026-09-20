import { expect, test, type Page } from "@playwright/test";
import { signInThroughLoginForm, WorkspaceFixture, type TestWorkspace } from "./support/fixtures";

/**
 * Ticket 14 — the model-change screen distinguishes two snapshot versions
 * through the browser against the isolated E2E instance.
 *
 * A version-bounded interval shows the DifferentialHypotheses and contradictions
 * created between the two versions, links each of them to its Evidence Trail and
 * names the limits of the data explicitly. The screen must not add a snapshot
 * category and must not present an empty interval as a conclusion.
 */
test.describe.configure({ timeout: 120_000 });

const HYPOTHESIS_TITLE = "Новая гипотеза между версиями";
const CONTRADICTION_SUMMARY = "Сигналы расходятся";
const NODE_A = "Узел A между версиями";
const NODE_B = "Узел B между версиями";

/** Consents the snapshot assembler re-checks inside its transaction. */
async function grantConsents(fixtures: WorkspaceFixture, workspace: TestWorkspace): Promise<void> {
  const ownerClient = await fixtures.signIn(workspace.owner);
  for (const consentType of ["data_storage", "sensitive_psychological_data"]) {
    const { error } = await ownerClient.rpc("grant_consent", {
      p_org_id: workspace.organizationId,
      p_client_id: workspace.clientId,
      p_consent_type: consentType,
      p_scope: "client",
      p_document_version: "1.0",
    });
    if (error) throw new Error(`grant_consent ${consentType}: ${error.message}`);
  }
}

/** Generate one snapshot through the real screen and wait for confirmation. */
async function generateSnapshot(page: Page, clientId: string, reason: string): Promise<void> {
  await page.goto(`/snapshots?clientId=${clientId}`);
  await page.getByLabel("Причина генерации").fill(reason);
  await page.getByRole("button", { name: "Сгенерировать snapshot" }).click();
  await expect(page.getByText(/Snapshot создан:/)).toBeVisible();
}

test.describe("snapshot-version model changes", () => {
  let fixtures: WorkspaceFixture;

  test.beforeEach(() => {
    fixtures = new WorkspaceFixture();
  });

  test.afterEach(async () => {
    await fixtures.cleanup();
  });

  test("links a version interval to its evidence trail and names insufficient data", async ({
    page,
  }) => {
    const workspace = await fixtures.createWorkspace("Клиент изменений модели");
    await grantConsents(fixtures, workspace);
    await signInThroughLoginForm(page, workspace.owner);

    await generateSnapshot(page, workspace.clientId, "Версия до изменений");

    // Model state created strictly between the two versions.
    const admin = fixtures.serviceRoleClient();
    const { data: nodes, error: nodeError } = await admin
      .from("core_nodes")
      .insert([
        {
          organization_id: workspace.organizationId,
          client_id: workspace.clientId,
          title: NODE_A,
          status: "active",
        },
        {
          organization_id: workspace.organizationId,
          client_id: workspace.clientId,
          title: NODE_B,
          status: "active",
        },
      ])
      .select("id, title");
    if (nodeError) throw new Error(nodeError.message);

    const { error: relationError } = await admin.from("core_node_relations").insert({
      organization_id: workspace.organizationId,
      client_id: workspace.clientId,
      from_core_node_id: nodes!.find((node) => node.title === NODE_A)!.id,
      to_core_node_id: nodes!.find((node) => node.title === NODE_B)!.id,
      relation_type: "contradicts",
      confidence: 60,
      evidence_summary: CONTRADICTION_SUMMARY,
    });
    if (relationError) throw new Error(relationError.message);

    const { error: hypothesisError } = await admin.from("differential_hypotheses").insert({
      organization_id: workspace.organizationId,
      client_id: workspace.clientId,
      title: HYPOTHESIS_TITLE,
      status: "hypothesis",
      confidence_score: 40,
      evidence_for: ["signal-for"],
      evidence_against: ["signal-against"],
    });
    if (hypothesisError) throw new Error(hypothesisError.message);

    await generateSnapshot(page, workspace.clientId, "Версия после изменений");

    // Compare the newest version with its predecessor.
    await page
      .getByRole("link", { name: /^v\d+ — / })
      .first()
      .click();
    const interval = page.getByTestId("model-interval");
    await expect(interval).toBeVisible();

    await expect(interval.getByTestId("interval-hypothesis")).toContainText(HYPOTHESIS_TITLE);
    await expect(interval.getByTestId("interval-contradiction")).toContainText(
      CONTRADICTION_SUMMARY
    );
    await expect(interval.getByTestId("interval-contradiction")).toContainText(NODE_A);

    // Every conclusion links to its Evidence Trail for this client.
    const trailHref = await interval
      .getByTestId("evidence-trail-link")
      .first()
      .getAttribute("href");
    expect(trailHref).toContain(`/clients/${workspace.clientId}/evidence/`);
    expect(trailHref).toMatch(/\/evidence\/(differential_hypothesis|core_node|theme)\//);

    // The limits are named, never hidden.
    await expect(interval.getByTestId("interval-limits")).toContainText("не восстанавливается");

    // An empty interval is shown as insufficient data, not as a conclusion.
    await generateSnapshot(page, workspace.clientId, "Версия без изменений");
    await page
      .getByRole("link", { name: /^v\d+ — / })
      .first()
      .click();
    const emptyInterval = page.getByTestId("model-interval");
    await expect(emptyInterval.getByTestId("interval-no-hypotheses")).toBeVisible();
    await expect(emptyInterval.getByTestId("interval-no-contradictions")).toBeVisible();
    await expect(emptyInterval.getByTestId("interval-no-model-changes")).toBeVisible();
    await expect(emptyInterval.getByTestId("interval-limits")).toContainText("Недостаточно данных");
  });
});
