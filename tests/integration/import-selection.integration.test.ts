import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AiProvider, AiProviderCall, AiProviderResponse } from "@/lib/ai/provider";
import {
  commitImportSelection,
  previewSignalsCsv,
  previewSignalsJson,
  previewTextImport,
} from "@/lib/service/import";
import { connectFaultInjection, type FaultInjection } from "./support/fault-injection";

try {
  process.loadEnvFile(".env.local");
} catch {
  // no .env.local — the suite will skip
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const available = Boolean(url && anonKey && serviceKey);

class StubProvider implements AiProvider {
  readonly providerKey = "stub";
  readonly modelSnapshot = "stub-1";
  readonly reasoningEffort = "none";
  signals: unknown[] = [];

  async complete(call: AiProviderCall): Promise<AiProviderResponse> {
    return {
      ok: true,
      output: {
        contract_version: call.contractVersion,
        request_id: (call.envelope as { request_id: string }).request_id,
        warnings: [],
        safety: { review_required: false, categories: [], rationale: "" },
        result: { signals: this.signals },
      },
      inputTokens: 1,
      outputTokens: 1,
    };
  }
}

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

function aiCandidate(rawStatement: string): Record<string, unknown> {
  return {
    candidate_key: `candidate-${rawStatement.length}-${Math.random().toString(36).slice(2, 8)}`,
    raw_statement: rawStatement,
    statement_polarity: "negative",
    test_result: "not_tested",
    normalized_meaning: "meaning",
    inferred_opposite: null,
    confidence: 70,
    life_areas: [],
    tags: [],
    context: "",
    proposed_evidence_level: "L1_SINGLE_SIGNAL",
    rationale: "stub",
  };
}

/**
 * Ticket 11 — the two-phase import workflow: preview stages the immutable
 * source, its DiagnosticSession and the validation report WITHOUT creating any
 * Signal; the commit phase turns only the explicitly selected candidates into
 * pending Signals in one transaction, is idempotent for the same selection and
 * rejects a conflicting one. A fault anywhere in the commit rolls every Signal
 * back.
 */
describe.skipIf(!available)("selective import commit (ticket 11)", () => {
  const admin = createClient(url!, serviceKey!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const createdUserIds: string[] = [];
  let faults: FaultInjection;
  let orgId: string;
  let clientId: string;
  let specialist: { id: string; client: SupabaseClient };
  let outsider: { id: string; client: SupabaseClient };

  function anonClient() {
    return createClient(url!, anonKey!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }

  async function createUser(email: string): Promise<{ id: string; client: SupabaseClient }> {
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password: "password123",
      email_confirm: true,
    });
    if (error) throw new Error(error.message);
    createdUserIds.push(data.user!.id);

    const client = anonClient();
    await client.auth.signInWithPassword({ email, password: "password123" });
    return { id: data.user!.id, client };
  }

  async function signalsOfSession(sessionId: string) {
    const { data } = await admin
      .from("signals")
      .select("id, review_status, raw_statement, diagnostic_session_id")
      .eq("diagnostic_session_id", sessionId);
    return data ?? [];
  }

  async function commitAudit(importId: string) {
    const { data } = await admin
      .from("audit_log")
      .select("action, after_data, actor_user_id")
      .eq("entity_id", importId)
      .eq("action", "import.committed");
    return data ?? [];
  }

  beforeAll(async () => {
    faults = await connectFaultInjection();

    const owner = await createUser(`select-owner-${crypto.randomUUID()}@example.com`);
    const { data: org } = await owner.client.rpc("create_organization", {
      org_name: "Selective Import Org",
    });
    orgId = org as string;

    specialist = await createUser(`select-spec-${crypto.randomUUID()}@example.com`);
    await admin.from("organization_members").insert({
      organization_id: orgId,
      user_id: specialist.id,
      role: "specialist",
      status: "active",
    });

    const { data: cid } = await specialist.client.rpc("create_client", {
      p_organization_id: orgId,
      p_display_name: "Selective Import Client",
    });
    clientId = cid as string;

    await admin.from("consent_records").insert({
      organization_id: orgId,
      client_id: clientId,
      consent_type: "ai_analysis",
      document_version: "1.0",
    });

    // Same organization, no ClientAssignment: RLS must deny every write.
    outsider = await createUser(`select-outsider-${crypto.randomUUID()}@example.com`);
    await admin.from("organization_members").insert({
      organization_id: orgId,
      user_id: outsider.id,
      role: "specialist",
      status: "active",
    });
  });

  afterAll(async () => {
    await faults?.clear();
    await faults?.close();
    for (const id of createdUserIds) {
      await admin.auth.admin.deleteUser(id);
    }
  });

  it("stages a CSV preview as session + import + report, and creates no Signals", async () => {
    const statement = `preview-${crypto.randomUUID()}`;
    const idempotencyKey = `preview-csv-${crypto.randomUUID()}`;
    const csv = toCsv([
      CSV_HEADER,
      csvRow("row-1", statement),
      csvRow("row-2", `${statement}-2`),
      invalidCsvRow("row-3"),
    ]);

    const report = await previewSignalsCsv(specialist.client, {
      organizationId: orgId,
      clientId,
      content: csv,
      idempotencyKey,
    });

    expect(report.status).toBe("awaiting_review");
    expect(report.counts.total).toBe(3);
    expect(report.counts.valid).toBe(2);
    expect(report.counts.invalid).toBe(1);
    expect(report.counts.committed).toBe(0);
    expect(report.signal_ids).toEqual([]);

    // The valid container created the immutable source and its session.
    const { data: session } = await admin
      .from("diagnostic_sessions")
      .select("session_type, raw_input")
      .eq("id", report.diagnostic_session_id)
      .single();
    expect(session?.session_type).toBe("import");
    expect(session?.raw_input).toBe(csv);

    // No Signal was created by the preview.
    expect(await signalsOfSession(report.diagnostic_session_id)).toEqual([]);

    // Every record is addressable and carries its status/errors.
    const valid = report.records.find((record) => record.external_id === "row-1");
    expect(valid?.status).toBe("valid");
    expect(valid?.statement).toBe(statement);
    const invalid = report.records.find((record) => record.external_id === "row-3");
    expect(invalid?.status).toBe("invalid");
    expect(invalid?.errors.length).toBeGreaterThan(0);

    // Replaying the same key/content returns the stored report.
    const replay = await previewSignalsCsv(specialist.client, {
      organizationId: orgId,
      clientId,
      content: csv,
      idempotencyKey,
    });
    expect(replay.import_id).toBe(report.import_id);
    expect(await signalsOfSession(report.diagnostic_session_id)).toEqual([]);

    // The same key with different content is a conflict.
    await expect(
      previewSignalsCsv(specialist.client, {
        organizationId: orgId,
        clientId,
        content: toCsv([CSV_HEADER, csvRow("other", "другое")]),
        idempotencyKey,
      })
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("commits only the selected candidates, records their lineage and audits once", async () => {
    const statement = `commit-${crypto.randomUUID()}`;
    const csv = toCsv([CSV_HEADER, csvRow("row-1", statement), csvRow("row-2", `${statement}-2`)]);

    const preview = await previewSignalsCsv(specialist.client, {
      organizationId: orgId,
      clientId,
      content: csv,
      idempotencyKey: `commit-csv-${crypto.randomUUID()}`,
    });

    const committed = await commitImportSelection(specialist.client, {
      organizationId: orgId,
      clientId,
      importId: preview.import_id,
      selectedExternalIds: ["row-1"],
    });

    expect(committed.status).toBe("completed");
    expect(committed.counts.committed).toBe(1);
    expect(committed.signal_ids).toHaveLength(1);
    expect(committed.diagnostic_session_id).toBe(preview.diagnostic_session_id);

    // Exactly the selected candidate became a pending Signal on that session.
    const signals = await signalsOfSession(preview.diagnostic_session_id);
    expect(signals).toHaveLength(1);
    expect(signals[0].id).toBe(committed.signal_ids[0]);
    expect(signals[0].review_status).toBe("pending");
    expect(signals[0].raw_statement).toBe(statement);

    // The stored report carries the generated signal id and the record status.
    const committedRecord = committed.records.find((record) => record.external_id === "row-1");
    expect(committedRecord?.status).toBe("committed");
    expect(committedRecord?.signal_id).toBe(committed.signal_ids[0]);
    const unselected = committed.records.find((record) => record.external_id === "row-2");
    expect(unselected?.status).toBe("valid");
    expect(unselected?.signal_id).toBeNull();

    // The audit row carries the actor and the authoritative count.
    const audit = await commitAudit(preview.import_id);
    expect(audit).toHaveLength(1);
    expect(audit[0].actor_user_id).toBe(specialist.id);
    expect((audit[0].after_data as { committed: number }).committed).toBe(1);

    // Idempotent replay: same result, no second Signal, no second audit row.
    const replay = await commitImportSelection(specialist.client, {
      organizationId: orgId,
      clientId,
      importId: preview.import_id,
      selectedExternalIds: ["row-1"],
    });
    expect(replay.import_id).toBe(committed.import_id);
    expect(replay.signal_ids).toEqual(committed.signal_ids);
    expect(await signalsOfSession(preview.diagnostic_session_id)).toHaveLength(1);
    expect(await commitAudit(preview.import_id)).toHaveLength(1);

    // A conflicting selection after a successful commit is rejected outright.
    await expect(
      commitImportSelection(specialist.client, {
        organizationId: orgId,
        clientId,
        importId: preview.import_id,
        selectedExternalIds: ["row-2"],
      })
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await signalsOfSession(preview.diagnostic_session_id)).toHaveLength(1);

    // An unknown candidate id is a validation error, not a silent no-op.
    await expect(
      commitImportSelection(specialist.client, {
        organizationId: orgId,
        clientId,
        importId: preview.import_id,
        selectedExternalIds: ["row-999"],
      })
    ).rejects.toThrow();
  });

  it("surfaces record warnings and commits the normalized candidate", async () => {
    const statement = `warn-${crypto.randomUUID()}`;
    const row = csvRow("warn-1", statement);
    // A quoted CSV cell keeps the embedded JSON commas inside one field.
    row[14] = '"[""a"",""a"",""b""]"';
    const csv = toCsv([CSV_HEADER, row]);

    const preview = await previewSignalsCsv(specialist.client, {
      organizationId: orgId,
      clientId,
      content: csv,
      idempotencyKey: `warn-csv-${crypto.randomUUID()}`,
    });

    expect(preview.counts.warning).toBe(1);
    const record = preview.records.find((entry) => entry.external_id === "warn-1");
    expect(record?.warnings.length).toBeGreaterThan(0);

    const committed = await commitImportSelection(specialist.client, {
      organizationId: orgId,
      clientId,
      importId: preview.import_id,
      selectedExternalIds: ["warn-1"],
    });
    const { data: signal } = await admin
      .from("signals")
      .select("tags, review_status")
      .eq("id", committed.signal_ids[0])
      .single();
    expect(signal?.tags).toEqual(["a", "b"]);
    expect(signal?.review_status).toBe("pending");
  });

  it("stages and selectively commits a JSON preview", async () => {
    const statement = `json-${crypto.randomUUID()}`;
    const content = JSON.stringify({
      contract: "live-client-map.signals-import",
      version: "1.0",
      records: [jsonRecord("json-1", statement), jsonRecord("json-2", `${statement}-2`)],
    });

    const preview = await previewSignalsJson(specialist.client, {
      organizationId: orgId,
      clientId,
      content,
      idempotencyKey: `json-${crypto.randomUUID()}`,
    });
    expect(preview.counts.valid).toBe(2);
    expect(await signalsOfSession(preview.diagnostic_session_id)).toEqual([]);

    const committed = await commitImportSelection(specialist.client, {
      organizationId: orgId,
      clientId,
      importId: preview.import_id,
      selectedExternalIds: ["json-2"],
    });
    expect(committed.signal_ids).toHaveLength(1);

    const { data: signal } = await admin
      .from("signals")
      .select("raw_statement, review_status, diagnostic_session_id")
      .eq("id", committed.signal_ids[0])
      .single();
    expect(signal?.raw_statement).toBe(`${statement}-2`);
    expect(signal?.review_status).toBe("pending");
    expect(signal?.diagnostic_session_id).toBe(preview.diagnostic_session_id);
    expect(await signalsOfSession(preview.diagnostic_session_id)).toHaveLength(1);
  });

  it("previews text without Signals and commits a selected AI candidate as pending L0", async () => {
    const statement = `text-${crypto.randomUUID()}`;
    const provider = new StubProvider();
    provider.signals = [aiCandidate(statement), aiCandidate(`${statement}-2`)];

    const preview = await previewTextImport(specialist.client, provider, {
      organizationId: orgId,
      clientId,
      inputFormat: "plain_text",
      content: `Текст для разбора ${statement}`,
      idempotencyKey: `text-${crypto.randomUUID()}`,
    });

    expect(preview.status).toBe("awaiting_review");
    expect(preview.counts.total).toBe(2);
    expect(preview.counts.committed).toBe(0);
    expect(await signalsOfSession(preview.diagnostic_session_id)).toEqual([]);

    const target = preview.records[0].external_id;
    const committed = await commitImportSelection(specialist.client, {
      organizationId: orgId,
      clientId,
      importId: preview.import_id,
      selectedExternalIds: [target],
    });

    const { data: signal } = await admin
      .from("signals")
      .select("review_status, evidence_level, source_type, diagnostic_session_id")
      .eq("id", committed.signal_ids[0])
      .single();
    expect(signal?.review_status).toBe("pending");
    expect(signal?.evidence_level).toBe("L0_AI_ONLY");
    expect(signal?.source_type).toBe("ai_hypothesis");
    expect(signal?.diagnostic_session_id).toBe(preview.diagnostic_session_id);
    expect(await signalsOfSession(preview.diagnostic_session_id)).toHaveLength(1);
  });

  it("rejects container errors without creating any import or session", async () => {
    const key = `container-${crypto.randomUUID()}`;
    await expect(
      previewSignalsCsv(specialist.client, {
        organizationId: orgId,
        clientId,
        content: "not,a,valid,header\n1,2,3,4",
        idempotencyKey: key,
      })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });

    const { data: imports } = await admin.from("imports").select("id").eq("idempotency_key", key);
    expect(imports).toEqual([]);

    const jsonKey = `container-json-${crypto.randomUUID()}`;
    await expect(
      previewSignalsJson(specialist.client, {
        organizationId: orgId,
        clientId,
        content: "{not json",
        idempotencyKey: jsonKey,
      })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    const { data: jsonImports } = await admin
      .from("imports")
      .select("id")
      .eq("idempotency_key", jsonKey);
    expect(jsonImports).toEqual([]);
  });

  it("leaves no partial Signals when the commit transaction fails", async (ctx) => {
    if (!faults.available) return ctx.skip();

    const marker = `commit-fault-${crypto.randomUUID()}`;
    const csv = toCsv([CSV_HEADER, csvRow("row-1", `${marker}-a`), csvRow("row-2", `${marker}-b`)]);

    const preview = await previewSignalsCsv(specialist.client, {
      organizationId: orgId,
      clientId,
      content: csv,
      idempotencyKey: `fault-csv-${crypto.randomUUID()}`,
    });
    expect(preview.counts.valid).toBe(2);

    // The fault fires on the first Signal insert, so the whole transaction —
    // including the second Signal, the report update and the audit row — must
    // roll back.
    await faults.register("signals", marker, specialist.id);
    try {
      await expect(
        commitImportSelection(specialist.client, {
          organizationId: orgId,
          clientId,
          importId: preview.import_id,
          selectedExternalIds: ["row-1", "row-2"],
        })
      ).rejects.toThrow();
    } finally {
      await faults.clear();
    }

    const { data: signals } = await admin
      .from("signals")
      .select("id")
      .like("raw_statement", `%${marker}%`);
    expect(signals).toEqual([]);

    const { data: importRow } = await admin
      .from("imports")
      .select("status, counts, report")
      .eq("id", preview.import_id)
      .single();
    expect(importRow?.status).toBe("awaiting_review");
    expect((importRow?.counts as { committed: number }).committed).toBe(0);
    // The report keeps the staged candidates, so the retry can commit them.
    expect((importRow?.report as { candidates: unknown[] }).candidates).toHaveLength(2);
    expect(await commitAudit(preview.import_id)).toHaveLength(0);

    // A retry after the fault succeeds and creates exactly the selected Signal.
    const retry = await commitImportSelection(specialist.client, {
      organizationId: orgId,
      clientId,
      importId: preview.import_id,
      selectedExternalIds: ["row-1", "row-2"],
    });
    expect(retry.signal_ids).toHaveLength(2);
  });

  it("denies commit to a member without a ClientAssignment", async () => {
    const statement = `deny-${crypto.randomUUID()}`;
    const preview = await previewSignalsCsv(specialist.client, {
      organizationId: orgId,
      clientId,
      content: toCsv([CSV_HEADER, csvRow("row-1", statement)]),
      idempotencyKey: `deny-csv-${crypto.randomUUID()}`,
    });

    await expect(
      commitImportSelection(outsider.client, {
        organizationId: orgId,
        clientId,
        importId: preview.import_id,
        selectedExternalIds: ["row-1"],
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    // The database denied it before any write, so nothing was created.
    expect(await signalsOfSession(preview.diagnostic_session_id)).toEqual([]);
    const { data: importRow } = await admin
      .from("imports")
      .select("status")
      .eq("id", preview.import_id)
      .single();
    expect(importRow?.status).toBe("awaiting_review");
  });
});
