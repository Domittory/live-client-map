import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AiProvider, AiProviderCall, AiProviderResponse } from "@/lib/ai/provider";
import { importSignalsCsv, importSignalsJson, importText } from "@/lib/service/import";

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

function toCsv(rows: string[][]): string {
  return rows.map((r) => r.join(",")).join("\n");
}

describe.skipIf(!available)("import (tickets 53, 54)", () => {
  const admin = createClient(url!, serviceKey!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const createdUserIds: string[] = [];
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

  beforeAll(async () => {
    const owner = await createUser(`owner-${crypto.randomUUID()}@example.com`);
    const { data } = await owner.client.rpc("create_organization", { org_name: "Import Org" });
    orgId = data;

    specialist = await createUser(`spec-${crypto.randomUUID()}@example.com`);
    await admin.from("organization_members").insert({
      organization_id: orgId,
      user_id: specialist.id,
      role: "specialist",
      status: "active",
    });

    const { data: cid } = await specialist.client.rpc("create_client", {
      p_organization_id: orgId,
      p_display_name: "Import Client",
    });
    clientId = cid;

    await admin.from("consent_records").insert({
      organization_id: orgId,
      client_id: clientId,
      consent_type: "ai_analysis",
      document_version: "1.0",
    });
  });

  afterAll(async () => {
    for (const id of createdUserIds) {
      await admin.auth.admin.deleteUser(id);
    }
  });

  describe("ticket 53 — text import", () => {
    it("creates an import session and pending L0 signals", async () => {
      const provider = new StubProvider();
      provider.signals = [
        {
          candidate_key: "s1",
          raw_statement: "Мне трудно просить о помощи",
          statement_polarity: "negative",
          test_result: "not_tested",
          normalized_meaning: "трудность просить о помощи",
          inferred_opposite: null,
          confidence: 70,
          life_areas: [],
          tags: [],
          context: "",
          proposed_evidence_level: "L1_SINGLE_SIGNAL",
          rationale: "import",
        },
      ];

      const report = await importText(specialist.client, provider, {
        organizationId: orgId,
        clientId,
        inputFormat: "plain_text",
        content: "Мне трудно просить о помощи",
        idempotencyKey: "text-import-key-0001",
      });

      expect(report.status).toBe("awaiting_review");
      expect(report.import_id).toBeTruthy();

      const { data: session } = await specialist.client
        .from("diagnostic_sessions")
        .select("session_type, raw_input")
        .eq("id", report.diagnostic_session_id)
        .maybeSingle();
      expect(session?.session_type).toBe("import");
      expect(session?.raw_input).toBe("Мне трудно просить о помощи");

      const { data: signals } = await specialist.client
        .from("signals")
        .select("review_status, evidence_level")
        .eq("diagnostic_session_id", report.diagnostic_session_id);
      expect(signals?.length).toBe(1);
      expect(signals?.[0].review_status).toBe("pending");
      expect(signals?.[0].evidence_level).toBe("L0_AI_ONLY");
    });

    it("rejects empty content", async () => {
      const provider = new StubProvider();
      await expect(
        importText(specialist.client, provider, {
          organizationId: orgId,
          clientId,
          inputFormat: "plain_text",
          content: "   ",
          idempotencyKey: "text-import-key-0002",
        })
      ).rejects.toThrow();
    });

    it("is idempotent for the same key and content", async () => {
      const provider = new StubProvider();
      provider.signals = [];
      const first = await importText(specialist.client, provider, {
        organizationId: orgId,
        clientId,
        inputFormat: "markdown",
        content: "# Заметки",
        idempotencyKey: "text-import-key-0003",
      });
      const second = await importText(specialist.client, provider, {
        organizationId: orgId,
        clientId,
        inputFormat: "markdown",
        content: "# Заметки",
        idempotencyKey: "text-import-key-0003",
      });
      expect(second.import_id).toBe(first.import_id);
    });

    it("rejects a conflicting idempotency key with different content", async () => {
      const provider = new StubProvider();
      await expect(
        importText(specialist.client, provider, {
          organizationId: orgId,
          clientId,
          inputFormat: "markdown",
          content: "# Другой текст",
          idempotencyKey: "text-import-key-0003",
        })
      ).rejects.toThrow();
    });
  });

  describe("ticket 54 — structured import", () => {
    it("imports CSV with accepted and rejected records", async () => {
      const validRow = [
        "live-client-map.signals-csv/1.0",
        "row-1",
        "",
        "client_report",
        "",
        "self_report",
        "Мне трудно просить о помощи",
        "negative",
        "not_tested",
        "",
        "",
        "",
        "",
        "[]",
        "[]",
        "",
        "",
        "",
        "internal",
        "",
        "",
        "",
      ];
      const invalidRow = [
        "live-client-map.signals-csv/1.0",
        "row-2",
        "",
        "not_a_source_type",
        "",
        "self_report",
        "текст",
        "negative",
        "not_tested",
        "",
        "",
        "",
        "",
        "[]",
        "[]",
        "",
        "",
        "",
        "internal",
        "",
        "",
        "",
      ];
      const csv = toCsv([CSV_HEADER, validRow, invalidRow]);

      const report = await importSignalsCsv(specialist.client, {
        organizationId: orgId,
        clientId,
        content: csv,
        idempotencyKey: "csv-import-key-0001",
      });

      expect(report.counts.total).toBe(2);
      expect(report.counts.committed).toBe(1);
      expect(report.counts.invalid).toBe(1);

      const invalid = (report.records as { external_id: string; errors: unknown[] }[]).find(
        (r) => r.external_id === "row-2"
      );
      expect(invalid?.errors.length).toBeGreaterThan(0);

      const { data: signals } = await specialist.client
        .from("signals")
        .select("review_status, raw_statement")
        .eq("diagnostic_session_id", report.diagnostic_session_id);
      expect(signals?.length).toBe(1);
      expect(signals?.[0].review_status).toBe("pending");
      expect(signals?.[0].raw_statement).toBe("Мне трудно просить о помощи");
    });

    it("imports JSON and flags duplicate external_id", async () => {
      const record = {
        external_id: "json-1",
        source_session_ref: null,
        source_type: "client_report",
        source_ref: null,
        epistemic_type: "self_report",
        raw_statement: "утверждение",
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
      const content = JSON.stringify({
        contract: "live-client-map.signals-import",
        version: "1.0",
        records: [record, record],
      });

      const report = await importSignalsJson(specialist.client, {
        organizationId: orgId,
        clientId,
        content,
        idempotencyKey: "json-import-key-0001",
      });

      expect(report.counts.total).toBe(2);
      expect(report.counts.committed).toBe(1);
      expect(report.counts.duplicate).toBe(1);
    });

    it("is idempotent for structured import", async () => {
      const content = JSON.stringify({
        contract: "live-client-map.signals-import",
        version: "1.0",
        records: [
          {
            external_id: "idem-1",
            source_session_ref: null,
            source_type: "client_report",
            source_ref: null,
            epistemic_type: "self_report",
            raw_statement: "ещё утверждение",
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
          },
        ],
      });
      const first = await importSignalsJson(specialist.client, {
        organizationId: orgId,
        clientId,
        content,
        idempotencyKey: "json-import-key-0002",
      });
      const second = await importSignalsJson(specialist.client, {
        organizationId: orgId,
        clientId,
        content,
        idempotencyKey: "json-import-key-0002",
      });
      expect(second.import_id).toBe(first.import_id);
    });
  });
});
