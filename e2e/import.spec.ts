import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import {
  signInThroughLoginForm,
  workspaceNav,
  WorkspaceFixture,
  type TestUser,
} from "./support/fixtures";

/**
 * Ticket 11 — client-scoped import workflow through the browser.
 *
 * Every test builds its own tenant, drives the real two-phase forms (preview,
 * then commit a partial selection) and observes the database with the
 * service-role client: the point is that the preview stages the source and its
 * session WITHOUT Signals, the commit persists exactly the selected pending
 * Signals with their lineage and audit row, and the database — not the UI —
 * denies users without an assignment.
 */
test.describe.configure({ timeout: 180_000 });

const CSV_HEADER = [
  "contract_version",
  "external_id",
  "source_session_ref",
  "source_type",
  "source_ref",
  "epistemic_type",
  "raw_statement",
  "statement_polarity",
  "test_result",
  "normalized_meaning",
  "inferred_opposite",
  "intensity",
  "confidence",
  "life_areas_json",
  "tags_json",
  "context_json",
  "time_scope",
  "claimed_evidence_level",
  "visibility",
  "source_review_status",
  "source_created_at",
  "source_updated_at",
];

function csvRow(externalId: string, rawStatement: string): string[] {
  return [
    "live-client-map.signals-csv/1.0",
    externalId,
    "",
    "client_report",
    "",
    "self_report",
    rawStatement,
    "negative",
    "not_tested",
    "",
    "",
    "",
    "",
    "[]",
    "[]",
    "{}",
    "",
    "",
    "internal",
    "",
    "",
    "",
  ];
}

function invalidCsvRow(externalId: string): string[] {
  const row = csvRow(externalId, "невалидная запись");
  row[3] = "not_a_source_type";
  return row;
}

function toCsv(rows: string[][]): string {
  return rows.map((row) => row.join(",")).join("\n");
}

function jsonRecord(externalId: string, rawStatement: string): Record<string, unknown> {
  return {
    external_id: externalId,
    source_session_ref: null,
    source_type: "client_report",
    source_ref: null,
    epistemic_type: "self_report",
    raw_statement: rawStatement,
    statement_polarity: "unknown",
    test_result: "not_tested",
    normalized_meaning: null,
    inferred_opposite: null,
    intensity: null,
    confidence: null,
    life_areas: [],
    tags: [],
    context: null,
    time_scope: null,
    claimed_evidence_level: null,
    visibility: "internal",
    source_review_status: null,
    source_created_at: null,
    source_updated_at: null,
  };
}

async function openImport(page: Page, clientId: string): Promise<void> {
  await page.goto(`/clients/${clientId}/import`);
  await expect(
    workspaceNav(page).getByRole("link", { name: "Импорт", exact: true })
  ).toHaveAttribute("aria-current", "page");
}

/** Fill the preview form and wait for the validation report. */
async function preview(page: Page, format: string, content: string): Promise<void> {
  const form = page.getByTestId("import-form");
  await form.locator("[name=format]").selectOption(format);
  await form.locator("[name=content]").fill(content);
  await form.getByTestId("import-preview-submit").click();
  await expect(page.getByTestId("import-report")).toBeVisible();
}

function recordRow(page: Page, externalId: string) {
  return page.locator(`[data-testid="import-record-row"][data-external-id="${externalId}"]`);
}

/** Tenant with one assigned primary specialist and an active AI consent. */
async function setup(
  fixtures: WorkspaceFixture,
  label: string
): Promise<{ clientId: string; organizationId: string; specialist: TestUser }> {
  const workspace = await fixtures.createWorkspace(label);
  const specialist = await fixtures.createUser("import-specialist");
  await fixtures.addMember(workspace.organizationId, specialist);
  await fixtures.assign(workspace.clientId, specialist, "primary_specialist");
  await fixtures.serviceRoleClient().from("consent_records").insert({
    organization_id: workspace.organizationId,
    client_id: workspace.clientId,
    consent_type: "ai_analysis",
    document_version: "1.0",
  });
  return {
    clientId: workspace.clientId,
    organizationId: workspace.organizationId,
    specialist,
  };
}

test.describe("client import workflow", () => {
  let fixtures: WorkspaceFixture;

  test.beforeEach(() => {
    fixtures = new WorkspaceFixture();
  });

  test.afterEach(async () => {
    await fixtures.cleanup();
  });

  test("text import: preview creates the session without Signals, a partial commit creates one pending Signal with audit", async ({
    page,
  }) => {
    const { clientId, specialist } = await setup(fixtures, "Импорт текста");
    const line1 = `Клиент сообщает о стрессе ${randomUUID().slice(0, 8)}`;
    const line2 = `Клиент избегает конфликтов ${randomUUID().slice(0, 8)}`;

    await signInThroughLoginForm(page, specialist);
    await openImport(page, clientId);

    // The workspace route carries the client: no manual id entry.
    await expect(page.getByRole("textbox", { name: /client_id/i })).toHaveCount(0);

    await preview(page, "plain_text", `${line1}\n${line2}`);

    const admin = fixtures.serviceRoleClient();
    const importId = await page.getByTestId("import-report").getAttribute("data-import-id");
    expect(importId).toBeTruthy();
    await expect(page.getByTestId("import-count-total")).toContainText("Всего: 2");
    await expect(page.getByTestId("import-count-valid")).toContainText("Валидных: 2");
    await expect(page.getByTestId("import-count-committed")).toContainText("Закоммичено: 0");

    // Persisted preview: import + immutable source + session, but NO Signal.
    const { data: importRow } = await admin
      .from("imports")
      .select("id, status, diagnostic_session_id, counts, report")
      .eq("id", importId!)
      .single();
    expect(importRow?.status).toBe("awaiting_review");
    const sessionId = importRow!.diagnostic_session_id as string;
    const { data: session } = await admin
      .from("diagnostic_sessions")
      .select("session_type, raw_input")
      .eq("id", sessionId)
      .single();
    expect(session?.session_type).toBe("import");
    expect(session?.raw_input).toContain(line1);
    const { data: beforeCommit } = await admin
      .from("signals")
      .select("id")
      .eq("diagnostic_session_id", sessionId);
    expect(beforeCommit).toEqual([]);

    // Partial selection: only the first candidate is checked.
    await recordRow(page, "ai-1").getByTestId("import-candidate").check();
    await recordRow(page, "ai-2").getByTestId("import-candidate").uncheck();
    await page.getByTestId("import-commit-submit").click();
    await expect(page.getByTestId("import-commit-message")).toContainText(
      "Закоммичено сигналов: 1"
    );
    await expect(page.getByTestId("import-count-committed")).toContainText("Закоммичено: 1");
    await expect(recordRow(page, "ai-1").getByTestId("import-record-status")).toContainText(
      "Закоммичен"
    );

    // Persisted commit: exactly one pending Signal with the import lineage.
    const { data: signals } = await admin
      .from("signals")
      .select("id, review_status, evidence_level, diagnostic_session_id, raw_statement")
      .eq("diagnostic_session_id", sessionId);
    expect(signals).toHaveLength(1);
    expect(signals![0].review_status).toBe("pending");
    expect(signals![0].evidence_level).toBe("L0_AI_ONLY");
    expect(signals![0].raw_statement).toBe(line1);

    const { data: afterCommit } = await admin
      .from("imports")
      .select("status, counts")
      .eq("id", importId!)
      .single();
    expect(afterCommit?.status).toBe("completed");
    expect((afterCommit?.counts as { committed: number }).committed).toBe(1);

    const { data: audit } = await admin
      .from("audit_log")
      .select("action, actor_user_id")
      .eq("entity_id", importId!)
      .eq("action", "import.committed");
    expect(audit).toHaveLength(1);
    expect(audit![0].actor_user_id).toBe(specialist.id);
  });

  test("CSV import: record errors are visible before commit and only the selected row is committed", async ({
    page,
  }) => {
    const { clientId, specialist } = await setup(fixtures, "Импорт CSV");
    const statement1 = `csv-${randomUUID()}`;
    const statement2 = `csv-${randomUUID()}`;
    const csv = toCsv([
      CSV_HEADER,
      csvRow("row-1", statement1),
      csvRow("row-2", statement2),
      invalidCsvRow("row-3"),
    ]);

    await signInThroughLoginForm(page, specialist);
    await openImport(page, clientId);
    await preview(page, "signals_csv", csv);

    const admin = fixtures.serviceRoleClient();
    const importId = await page.getByTestId("import-report").getAttribute("data-import-id");

    await expect(page.getByTestId("import-count-total")).toContainText("Всего: 3");
    await expect(page.getByTestId("import-count-valid")).toContainText("Валидных: 2");
    await expect(page.getByTestId("import-count-invalid")).toContainText("С ошибками: 1");
    await expect(recordRow(page, "row-3").getByTestId("import-record-errors")).toBeVisible();
    await expect(recordRow(page, "row-3").getByTestId("import-candidate")).toBeDisabled();

    const { data: importRow } = await admin
      .from("imports")
      .select("diagnostic_session_id")
      .eq("id", importId!)
      .single();
    const sessionId = importRow!.diagnostic_session_id as string;
    expect(
      await admin.from("signals").select("id").eq("diagnostic_session_id", sessionId)
    ).toMatchObject({ data: [] });

    await recordRow(page, "row-1").getByTestId("import-candidate").check();
    await page.getByTestId("import-commit-submit").click();
    await expect(page.getByTestId("import-commit-message")).toContainText(
      "Закоммичено сигналов: 1"
    );

    const { data: signals } = await admin
      .from("signals")
      .select("raw_statement, review_status")
      .eq("diagnostic_session_id", sessionId);
    expect(signals).toHaveLength(1);
    expect(signals![0].raw_statement).toBe(statement1);
    expect(signals![0].review_status).toBe("pending");

    const { data: audit } = await admin
      .from("audit_log")
      .select("action, actor_user_id")
      .eq("entity_id", importId!)
      .eq("action", "import.committed");
    expect(audit).toHaveLength(1);
    expect(audit![0].actor_user_id).toBe(specialist.id);
  });

  test("JSON import: duplicates are reported and a partial selection commits one record", async ({
    page,
  }) => {
    const { clientId, specialist } = await setup(fixtures, "Импорт JSON");
    const statement1 = `json-${randomUUID()}`;
    const statement2 = `json-${randomUUID()}`;
    const content = JSON.stringify({
      contract: "live-client-map.signals-import",
      version: "1.0",
      records: [
        jsonRecord("json-1", statement1),
        jsonRecord("json-2", statement2),
        jsonRecord("json-2", statement2),
      ],
    });

    await signInThroughLoginForm(page, specialist);
    await openImport(page, clientId);
    await preview(page, "signals_json", content);

    const admin = fixtures.serviceRoleClient();
    const importId = await page.getByTestId("import-report").getAttribute("data-import-id");

    await expect(page.getByTestId("import-count-total")).toContainText("Всего: 3");
    await expect(page.getByTestId("import-count-valid")).toContainText("Валидных: 2");
    await expect(page.getByTestId("import-count-duplicate")).toContainText("Дубликатов: 1");

    const { data: importRow } = await admin
      .from("imports")
      .select("diagnostic_session_id")
      .eq("id", importId!)
      .single();
    const sessionId = importRow!.diagnostic_session_id as string;

    await page
      .locator('[data-testid="import-record-row"][data-external-id="json-2"][data-status="valid"]')
      .getByTestId("import-candidate")
      .check();
    await page.getByTestId("import-commit-submit").click();
    await expect(page.getByTestId("import-commit-message")).toContainText(
      "Закоммичено сигналов: 1"
    );

    const { data: signals } = await admin
      .from("signals")
      .select("raw_statement, review_status, diagnostic_session_id")
      .eq("diagnostic_session_id", sessionId);
    expect(signals).toHaveLength(1);
    expect(signals![0].raw_statement).toBe(statement2);
    expect(signals![0].review_status).toBe("pending");
    expect(signals![0].diagnostic_session_id).toBe(sessionId);

    const { data: audit } = await admin
      .from("audit_log")
      .select("action")
      .eq("entity_id", importId!)
      .eq("action", "import.committed");
    expect(audit).toHaveLength(1);
  });

  test("an unassigned member gets the neutral denial and the database rejects the commit RPC", async ({
    browser,
  }) => {
    const { clientId, organizationId, specialist } = await setup(fixtures, "Закрытый импорт");
    const admin = fixtures.serviceRoleClient();

    // The specialist stages a real import through the guarded RPCs first, so the
    // denial below is not vacuous.
    const specialistClient = await fixtures.signIn(specialist);
    const sessionId = randomUUID();
    const { data: started, error: beginError } = await specialistClient.rpc("begin_import", {
      p_org_id: organizationId,
      p_client_id: clientId,
      p_session_id: sessionId,
      p_input_format: "signals_csv",
      p_contract_version: "live-client-map.signals-csv/1.0",
      p_idempotency_key: `e2e-${randomUUID()}`,
      p_content_sha256: "0".repeat(64),
      p_title: "Секретный импорт",
      p_raw_content: "секретные данные",
    });
    expect(beginError).toBeNull();
    const importId = (started as { import_id: string }).import_id;

    await specialistClient.rpc("finalize_import", {
      p_org_id: organizationId,
      p_import_id: importId,
      p_counts: {
        total: 1,
        valid: 1,
        invalid: 0,
        duplicate: 0,
        warning: 0,
        accepted: 0,
        rejected_by_reviewer: 0,
        committed: 0,
      },
      p_report: {
        records: [
          {
            index: 1,
            external_id: "row-1",
            status: "valid",
            errors: [],
            warnings: [],
            signal_id: null,
          },
        ],
        candidates: [
          {
            external_id: "row-1",
            record_index: 0,
            payload: {
              source_type: "client_report",
              epistemic_type: "self_report",
              raw_statement: "Секретный импорт",
            },
          },
        ],
      },
      p_fatal_errors: [],
    });

    const unassigned = await fixtures.createUser("import-outsider");
    await fixtures.addMember(organizationId, unassigned);

    const context = await browser.newContext();
    const page = await context.newPage();
    await signInThroughLoginForm(page, unassigned);

    const response = await page.goto(`/clients/${clientId}/import`);
    expect(response?.status()).toBe(404);
    await expect(page.getByRole("heading", { name: "Клиент недоступен" })).toBeVisible();
    await expect(page.getByTestId("import-form")).toHaveCount(0);
    await expect(page.getByText("Секретный импорт")).toHaveCount(0);

    // RLS denial without the UI: the import is invisible and the commit RPC is
    // rejected before any write.
    const unassignedClient = await fixtures.userClient(unassigned);
    const { data: visibleImports } = await unassignedClient
      .from("imports")
      .select("id")
      .eq("id", importId);
    expect(visibleImports).toEqual([]);

    const { error: rpcError } = await unassignedClient.rpc("commit_import_selection", {
      p_org_id: organizationId,
      p_client_id: clientId,
      p_import_id: importId,
      p_selected: ["row-1"],
    });
    expect(rpcError?.code).toBe("42501");

    const { data: signals } = await admin
      .from("signals")
      .select("id")
      .eq("diagnostic_session_id", sessionId);
    expect(signals).toEqual([]);
    const { data: importRow } = await admin
      .from("imports")
      .select("status")
      .eq("id", importId)
      .single();
    expect(importRow?.status).toBe("awaiting_review");

    await context.close();
  });
});
