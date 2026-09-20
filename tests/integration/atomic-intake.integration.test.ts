import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AiProvider, AiProviderCall, AiProviderResponse } from "@/lib/ai/provider";
import { ingestSignals } from "@/lib/service/ai-ingest";
import { createSession, createSignal } from "@/lib/service/diagnostics";
import {
  createFeedbackForm,
  sendFeedbackForm,
  submitFeedbackForm,
} from "@/lib/service/feedback-forms";
import { importSignalsCsv } from "@/lib/service/import";
import { reviewSignal } from "@/lib/service/review";
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

function toCsv(rows: string[][]): string {
  return rows.map((row) => row.join(",")).join("\n");
}

/**
 * Ticket 05: DiagnosticSession, Signal, AI ingest, review, feedback and import
 * commits must be all-or-nothing, with their AuditLog row, through the public
 * service boundary.
 */
describe.skipIf(!available)("atomic intake, review and import (ticket 05)", () => {
  const admin = createClient(url!, serviceKey!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const createdUserIds: string[] = [];
  let faults: FaultInjection;
  let orgId: string;
  let clientId: string;
  let specialist: { id: string; client: SupabaseClient };

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

  /** Run `action` with a fault registered, expecting it to fail and roll back. */
  async function withFault(
    point: string,
    marker: string,
    action: () => PromiseLike<unknown>
  ): Promise<void> {
    await faults.register(point, marker);
    try {
      await expect(Promise.resolve(action())).rejects.toThrow();
    } finally {
      await faults.clear();
    }
  }

  /** Direct RPC calls resolve with {error}; the fault cases expect a rejection. */
  async function rpcOrThrow(
    call: PromiseLike<{ error: { message: string } | null }>
  ): Promise<unknown> {
    const { error } = await call;
    if (error) throw new Error(error.message);
    return undefined;
  }

  async function sessionsTitled(title: string): Promise<string[]> {
    const { data } = await admin.from("diagnostic_sessions").select("id").eq("title", title);
    return (data ?? []).map((row) => row.id);
  }

  async function signalsSaying(rawStatement: string): Promise<string[]> {
    const { data } = await admin.from("signals").select("id").eq("raw_statement", rawStatement);
    return (data ?? []).map((row) => row.id);
  }

  beforeAll(async () => {
    faults = await connectFaultInjection();

    const owner = await createUser(`intake-owner-${crypto.randomUUID()}@example.com`);
    const { data: org } = await owner.client.rpc("create_organization", {
      org_name: "Atomic Intake Org",
    });
    orgId = org as string;

    specialist = await createUser(`intake-spec-${crypto.randomUUID()}@example.com`);
    await admin.from("organization_members").insert({
      organization_id: orgId,
      user_id: specialist.id,
      role: "specialist",
      status: "active",
    });

    const { data: cid } = await specialist.client.rpc("create_client", {
      p_organization_id: orgId,
      p_display_name: "Atomic Intake Client",
    });
    clientId = cid as string;

    await admin.from("consent_records").insert({
      organization_id: orgId,
      client_id: clientId,
      consent_type: "ai_analysis",
      document_version: "1.0",
    });
  });

  afterAll(async () => {
    await faults?.clear();
    await faults?.close();
    for (const id of createdUserIds) {
      await admin.auth.admin.deleteUser(id);
    }
  });

  // -------------------------------------------------------------------------
  // DiagnosticSession
  // -------------------------------------------------------------------------

  it("commits a session with its audit row", async () => {
    const title = `session-${crypto.randomUUID()}`;

    const sessionId = await createSession(specialist.client, orgId, {
      clientId,
      title,
      sessionType: "individual",
    });

    expect(await sessionsTitled(title)).toEqual([sessionId]);
    const { data: audit } = await admin
      .from("audit_log")
      .select("id, action")
      .eq("entity_id", sessionId)
      .eq("action", "session.created");
    expect(audit).toHaveLength(1);
  });

  it("rolls back a session when the audit append fails", async (ctx) => {
    if (!faults.available) return ctx.skip();
    const title = `session-fault-${crypto.randomUUID()}`;

    await withFault("audit_log", specialist.id, () =>
      createSession(specialist.client, orgId, {
        clientId,
        title,
        sessionType: "individual",
      })
    );

    expect(await sessionsTitled(title)).toHaveLength(0);
  });

  it("creates a session and its signals in one transaction, or neither", async () => {
    const title = `session-batch-${crypto.randomUUID()}`;
    const statement = `batch-${crypto.randomUUID()}`;

    const { data, error } = await specialist.client.rpc("create_diagnostic_session", {
      p_org_id: orgId,
      p_client_id: clientId,
      p_title: title,
      p_session_type: "individual",
      p_source_type: null,
      p_raw_input: null,
      p_input_format: null,
      p_notes: null,
      p_signals: [
        {
          source_type: "specialist_observation",
          epistemic_type: "observation",
          raw_statement: statement,
        },
        {
          source_type: "client_report",
          epistemic_type: "self_report",
          raw_statement: `${statement}-2`,
        },
      ],
    });
    expect(error).toBeNull();
    expect((data as { signal_ids: string[] }).signal_ids).toHaveLength(2);

    if (faults.available) {
      // A failure while inserting the child rows must leave no session behind.
      const failingTitle = `session-batch-fault-${crypto.randomUUID()}`;
      await withFault("signals", statement, () =>
        rpcOrThrow(
          specialist.client.rpc("create_diagnostic_session", {
            p_org_id: orgId,
            p_client_id: clientId,
            p_title: failingTitle,
            p_session_type: "individual",
            p_source_type: null,
            p_raw_input: null,
            p_input_format: null,
            p_notes: null,
            p_signals: [
              {
                source_type: "specialist_observation",
                epistemic_type: "observation",
                raw_statement: statement,
              },
            ],
          })
        )
      );

      expect(await sessionsTitled(failingTitle)).toHaveLength(0);
      expect(await signalsSaying(statement)).toHaveLength(1);
      expect(await signalsSaying(`${statement}-2`)).toHaveLength(1);
    }
  });

  // -------------------------------------------------------------------------
  // Manual Signal
  // -------------------------------------------------------------------------

  it("commits a manual signal with its audit row", async () => {
    const statement = `manual-${crypto.randomUUID()}`;

    const signalId = await createSignal(specialist.client, orgId, {
      clientId,
      sourceType: "specialist_observation",
      epistemicType: "observation",
      rawStatement: statement,
    });

    const { data: signal } = await admin
      .from("signals")
      .select("review_status")
      .eq("id", signalId)
      .single();
    expect(signal?.review_status).toBe("approved");
    expect(await signalsSaying(statement)).toEqual([signalId]);
  });

  it("rolls back a manual signal when the audit append fails", async (ctx) => {
    if (!faults.available) return ctx.skip();
    const statement = `manual-fault-${crypto.randomUUID()}`;

    await withFault("audit_log", specialist.id, () =>
      createSignal(specialist.client, orgId, {
        clientId,
        sourceType: "specialist_observation",
        epistemicType: "observation",
        rawStatement: statement,
      })
    );

    expect(await signalsSaying(statement)).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // AI ingest
  // -------------------------------------------------------------------------

  it("ingests AI signals atomically as pending L0 evidence", async () => {
    const sessionId = await createSession(specialist.client, orgId, {
      clientId,
      title: `ai-${crypto.randomUUID()}`,
      sessionType: "individual",
    });
    const statement = `ai-${crypto.randomUUID()}`;

    const provider = new StubProvider();
    provider.signals = [
      {
        candidate_key: "s1",
        raw_statement: statement,
        statement_polarity: "positive",
        test_result: "stress",
        normalized_meaning: "meaning",
        inferred_opposite: null,
        confidence: 70,
        life_areas: [],
        tags: [],
        context: "",
        proposed_evidence_level: "L1_SINGLE_SIGNAL",
        rationale: "stub",
      },
      {
        candidate_key: "s2",
        raw_statement: `${statement}-2`,
        statement_polarity: "negative",
        test_result: "no_stress",
        normalized_meaning: "meaning",
        inferred_opposite: null,
        confidence: 60,
        life_areas: [],
        tags: [],
        context: "",
        proposed_evidence_level: "L1_SINGLE_SIGNAL",
        rationale: "stub",
      },
    ];

    const ids = await ingestSignals(specialist.client, provider, {
      organizationId: orgId,
      clientId,
      diagnosticSessionId: sessionId,
      rawInput: "raw",
      sourceType: "imported_note",
      inputFormat: "plain_text",
      knownLifeAreas: [],
    });
    expect(ids).toHaveLength(2);

    const { data: stored } = await admin
      .from("signals")
      .select("review_status, evidence_level")
      .in("id", ids);
    expect(stored).toHaveLength(2);
    expect(stored!.every((row) => row.review_status === "pending")).toBe(true);
    expect(stored!.every((row) => row.evidence_level === "L0_AI_ONLY")).toBe(true);

    if (faults.available) {
      // A fault during the batch leaves no signal of that batch behind — not even
      // the one written before the failing audit append.
      const faultStatement = `ai-fault-${crypto.randomUUID()}`;
      provider.signals = [
        {
          candidate_key: "f1",
          raw_statement: faultStatement,
          statement_polarity: "positive",
          test_result: "stress",
          normalized_meaning: "meaning",
          inferred_opposite: null,
          confidence: 70,
          life_areas: [],
          tags: [],
          context: "",
          proposed_evidence_level: "L1_SINGLE_SIGNAL",
          rationale: "stub",
        },
        {
          candidate_key: "f2",
          raw_statement: `${faultStatement}-2`,
          statement_polarity: "negative",
          test_result: "no_stress",
          normalized_meaning: "meaning",
          inferred_opposite: null,
          confidence: 60,
          life_areas: [],
          tags: [],
          context: "",
          proposed_evidence_level: "L1_SINGLE_SIGNAL",
          rationale: "stub",
        },
      ];

      await withFault("audit_log", specialist.id, () =>
        ingestSignals(specialist.client, provider, {
          organizationId: orgId,
          clientId,
          diagnosticSessionId: sessionId,
          rawInput: "raw",
          sourceType: "imported_note",
          inputFormat: "plain_text",
          knownLifeAreas: [],
        })
      );

      expect(await signalsSaying(faultStatement)).toHaveLength(0);
      expect(await signalsSaying(`${faultStatement}-2`)).toHaveLength(0);
    }
  });

  // -------------------------------------------------------------------------
  // Review decision
  // -------------------------------------------------------------------------

  it("applies a review decision with actor and reason, atomically", async () => {
    const statement = `review-${crypto.randomUUID()}`;
    const signalId = await createSignal(specialist.client, orgId, {
      clientId,
      sourceType: "specialist_observation",
      epistemicType: "observation",
      rawStatement: statement,
    });
    await admin.from("signals").update({ review_status: "pending" }).eq("id", signalId);

    await reviewSignal(specialist.client, orgId, signalId, "approve", "проверено специалистом");

    const { data: signal } = await admin
      .from("signals")
      .select("review_status")
      .eq("id", signalId)
      .single();
    expect(signal?.review_status).toBe("approved");

    const { data: audit } = await admin
      .from("audit_log")
      .select("action, reason, actor_user_id")
      .eq("entity_id", signalId)
      .eq("action", "review.approve");
    expect(audit).toHaveLength(1);
    expect(audit![0].reason).toBe("проверено специалистом");
    expect(audit![0].actor_user_id).toBe(specialist.id);
  });

  it("rolls back a review decision when the audit append fails", async (ctx) => {
    if (!faults.available) return ctx.skip();
    const statement = `review-fault-${crypto.randomUUID()}`;
    const signalId = await createSignal(specialist.client, orgId, {
      clientId,
      sourceType: "specialist_observation",
      epistemicType: "observation",
      rawStatement: statement,
    });
    await admin.from("signals").update({ review_status: "pending" }).eq("id", signalId);

    await withFault("audit_log", signalId, () =>
      reviewSignal(specialist.client, orgId, signalId, "approve", "should roll back")
    );

    const { data: signal } = await admin
      .from("signals")
      .select("review_status")
      .eq("id", signalId)
      .single();
    expect(signal?.review_status).toBe("pending");
  });

  // -------------------------------------------------------------------------
  // Feedback submission
  // -------------------------------------------------------------------------

  async function openForm(): Promise<string> {
    const formId = await createFeedbackForm(specialist.client, {
      organizationId: orgId,
      clientId,
      title: `form-${crypto.randomUUID()}`,
      questions: [{ key: "q1", label: "Как вы себя чувствуете?", type: "text", required: true }],
    });
    await sendFeedbackForm(specialist.client, { formId });
    return formId;
  }

  it("completes the form, creates the pending signal and audits, atomically", async () => {
    const formId = await openForm();
    const answer = `answer-${crypto.randomUUID()}`;

    const signalId = await submitFeedbackForm(specialist.client, {
      formId,
      answers: { q1: answer },
    });

    const { data: form } = await admin
      .from("client_feedback_forms")
      .select("status, completed_at")
      .eq("id", formId)
      .single();
    expect(form?.status).toBe("completed");
    expect(form?.completed_at).not.toBeNull();

    const { data: signal } = await admin
      .from("signals")
      .select("review_status, source_type")
      .eq("id", signalId)
      .single();
    expect(signal?.review_status).toBe("pending");
    expect(signal?.source_type).toBe("follow_up");
  });

  it("rolls back the whole submission when the audit append fails", async (ctx) => {
    if (!faults.available) return ctx.skip();
    const formId = await openForm();
    const before = await admin
      .from("signals")
      .select("id")
      .eq("client_id", clientId)
      .eq("source_type", "follow_up");

    await withFault("audit_log", formId, () =>
      submitFeedbackForm(specialist.client, { formId, answers: { q1: "rollback" } })
    );

    const { data: form } = await admin
      .from("client_feedback_forms")
      .select("status")
      .eq("id", formId)
      .single();
    expect(form?.status).toBe("sent");

    const after = await admin
      .from("signals")
      .select("id")
      .eq("client_id", clientId)
      .eq("source_type", "follow_up");
    expect(after.data?.length).toBe(before.data?.length);
  });

  // -------------------------------------------------------------------------
  // Import commit
  // -------------------------------------------------------------------------

  it("commits the whole selected import set, or nothing", async () => {
    const statement = `import-${crypto.randomUUID()}`;
    const idempotencyKey = `import-key-${crypto.randomUUID()}`;
    const csv = toCsv([CSV_HEADER, csvRow("row-1", statement)]);

    const report = await importSignalsCsv(specialist.client, {
      organizationId: orgId,
      clientId,
      content: csv,
      idempotencyKey,
    });

    expect(report.status).toBe("awaiting_review");
    expect(report.counts.committed).toBe(1);
    expect(await signalsSaying(statement)).toHaveLength(1);

    const { data: importRow } = await admin
      .from("imports")
      .select("id, status, counts")
      .eq("idempotency_key", idempotencyKey)
      .single();
    expect(importRow?.status).toBe("awaiting_review");

    // Idempotent replay: same operation key returns the stored report and writes
    // nothing new.
    const replay = await importSignalsCsv(specialist.client, {
      organizationId: orgId,
      clientId,
      content: csv,
      idempotencyKey,
    });
    expect(replay.import_id).toBe(report.import_id);
    expect(await signalsSaying(statement)).toHaveLength(1);

    if (faults.available) {
      const faultKey = `import-fault-${crypto.randomUUID()}`;
      const faultStatement = `import-fault-${crypto.randomUUID()}`;

      await withFault("signals", faultStatement, () =>
        importSignalsCsv(specialist.client, {
          organizationId: orgId,
          clientId,
          content: toCsv([CSV_HEADER, csvRow("row-1", faultStatement)]),
          idempotencyKey: faultKey,
        })
      );

      // No import row, no session and no signal survived the failed commit.
      const { data: failedImport } = await admin
        .from("imports")
        .select("id")
        .eq("idempotency_key", faultKey);
      expect(failedImport).toHaveLength(0);
      expect(await signalsSaying(faultStatement)).toHaveLength(0);
    }
  });
});
