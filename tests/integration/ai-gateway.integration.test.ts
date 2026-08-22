import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { runAiFunction } from "@/lib/ai/gateway";
import { FakeAiProvider, type AiProvider } from "@/lib/ai/provider";
import { createInMemoryRateLimiter } from "@/lib/ai/limiter";

// Integration tests run against a local Supabase (ticket 01: Supabase CLI + Docker).
// They skip when the environment is not configured, so `pnpm test` stays green
// on a clean checkout without Docker. `.env.local` (created after `supabase start`)
// is loaded when present, so `pnpm test:integration` works without inline env.
try {
  process.loadEnvFile(".env.local");
} catch {
  // no .env.local — the test will skip
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const available = Boolean(url && serviceKey && anonKey);

const noSleep = async () => {};

async function setupClientWithConsent(withConsent: boolean) {
  const admin = createClient(url!, serviceKey!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const email = `ai-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const password = `test-${Math.random().toString(36).slice(2)}`;
  const { error: userError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  expect(userError).toBeNull();

  const client = createClient(url!, anonKey!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  await client.auth.signInWithPassword({ email, password });

  const { data: orgId, error: orgError } = await client.rpc("create_organization", {
    org_name: `AI Org ${Date.now()}`,
  });
  expect(orgError).toBeNull();

  const { data: clientId, error: clientError } = await client.rpc("create_client", {
    p_organization_id: orgId,
    p_display_name: "AI Test Client",
  });
  expect(clientError).toBeNull();

  if (withConsent) {
    const { error: consentError } = await client.rpc("grant_consent", {
      p_org_id: orgId,
      p_client_id: clientId,
      p_consent_type: "ai_analysis",
      p_scope: "diagnostics",
      p_document_version: "1.0",
    });
    expect(consentError).toBeNull();
  }

  return { admin, client, orgId: orgId as string, clientId: clientId as string };
}

const ingestPayload = {
  diagnostic_session_id: "123e4567-e89b-12d3-a456-426614174000",
  raw_input: "synthetic redacted input",
  source_type: "questionnaire",
  input_format: "plain_text",
  language: "ru",
  known_life_areas: [],
};

describe.skipIf(!available)("AI gateway (requires local Supabase)", () => {
  it("blocks the call without ai_analysis consent and never touches the provider", async () => {
    const { client, orgId, clientId } = await setupClientWithConsent(false);
    const provider = new FakeAiProvider();

    const result = await runAiFunction(
      client,
      provider,
      {
        functionId: "ai.ingest-signals.v1",
        organizationId: orgId,
        clientId,
        payload: ingestPayload,
      },
      { sleep: noSleep }
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe("blocked_consent");
    expect(provider.calls).toBe(0);

    const { data: run } = await client
      .from("ai_runs")
      .select("status, error_code")
      .eq("id", result.runId)
      .single();
    expect(run!.status).toBe("blocked_consent");
  });

  it("runs a consented call and persists version metadata + telemetry", async () => {
    const { client, orgId, clientId } = await setupClientWithConsent(true);
    const provider = new FakeAiProvider();

    const result = await runAiFunction(
      client,
      provider,
      {
        functionId: "ai.ingest-signals.v1",
        organizationId: orgId,
        clientId,
        payload: ingestPayload,
      },
      { sleep: noSleep }
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.status).toBe("succeeded");
      expect(result.result).toEqual({ signals: [] });
      expect(result.warnings).toContain("insufficient_data");
    }

    const { data: run } = await client.from("ai_runs").select("*").eq("id", result.runId!).single();
    expect(run!.function).toBe("ai.ingest-signals.v1");
    expect(run!.contract_version).toBe("1.0.0");
    expect(run!.prompt_version).toBe("prompt.ingest-signals.v1");
    expect(run!.ontology_version).toBe("1.0.0");
    expect(run!.provider).toBe("openai-dev");
    expect(run!.model_snapshot).toBe("gpt-5.5-2026-04-23");
    expect(run!.reasoning_effort).toBe("high");
    expect(run!.redaction_version).toBe("redaction.v1");
    expect(run!.input_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(run!.output_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(run!.status).toBe("succeeded");
  });

  it("rejects malformed output before any business mutation and does not retry", async () => {
    const { admin, client, orgId, clientId } = await setupClientWithConsent(true);
    const provider = new FakeAiProvider({ kind: "malformed" });

    const result = await runAiFunction(
      client,
      provider,
      {
        functionId: "ai.ingest-signals.v1",
        organizationId: orgId,
        clientId,
        payload: ingestPayload,
      },
      { sleep: noSleep }
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe("invalid_output");
    expect(provider.calls).toBe(1);

    const { data: run } = await admin
      .from("ai_runs")
      .select("status, retryable")
      .eq("id", result.runId!)
      .single();
    expect(run).toEqual({ status: "invalid_output", retryable: false });
  });

  it("rejects unknown fields in output (strict contract)", async () => {
    const { client, orgId, clientId } = await setupClientWithConsent(true);
    const provider = new FakeAiProvider({ kind: "unknown_fields" });

    const result = await runAiFunction(
      client,
      provider,
      {
        functionId: "ai.ingest-signals.v1",
        organizationId: orgId,
        clientId,
        payload: ingestPayload,
      },
      { sleep: noSleep }
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe("invalid_output");
  });

  it("retries timeouts with bounded attempts and ends in provider_timeout", async () => {
    const { client, orgId, clientId } = await setupClientWithConsent(true);
    const provider = new FakeAiProvider({ kind: "timeout", delayMs: 1 });

    const result = await runAiFunction(
      client,
      provider,
      {
        functionId: "ai.ingest-signals.v1",
        organizationId: orgId,
        clientId,
        payload: ingestPayload,
      },
      { sleep: noSleep, maxAttempts: 3 }
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe("provider_timeout");
    expect(provider.calls).toBe(3);
  });

  it("ends in provider_rate_limited after retries and honors no silent fallback", async () => {
    const { client, orgId, clientId } = await setupClientWithConsent(true);
    const provider = new FakeAiProvider({ kind: "rate_limited", retryAfterMs: 0 });

    const result = await runAiFunction(
      client,
      provider,
      {
        functionId: "ai.ingest-signals.v1",
        organizationId: orgId,
        clientId,
        payload: ingestPayload,
      },
      { sleep: noSleep, maxAttempts: 2 }
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe("provider_rate_limited");
    expect(provider.calls).toBe(2);

    provider.setBehavior({ kind: "unavailable" });
    const unavailable = await runAiFunction(
      client,
      provider,
      {
        functionId: "ai.cluster-evidence.v1",
        organizationId: orgId,
        clientId,
        payload: {
          diagnostic_session_id: ingestPayload.diagnostic_session_id,
          signals: [],
          existing_clusters: [],
        },
      },
      { sleep: noSleep }
    );
    expect(unavailable.ok).toBe(false);
    if (!unavailable.ok) expect(unavailable.status).toBe("provider_model_unavailable");
  });

  it("reuses a successful result for the same idempotency key", async () => {
    const { client, orgId, clientId } = await setupClientWithConsent(true);
    const provider = new FakeAiProvider();
    const input = {
      functionId: "ai.ingest-signals.v1",
      organizationId: orgId,
      clientId,
      payload: ingestPayload,
    };

    const first = await runAiFunction(client, provider, input, { sleep: noSleep });
    const second = await runAiFunction(client, provider, input, { sleep: noSleep });

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (second.ok) {
      expect(second.reused).toBe(true);
      expect(second.runId).toBe(first.ok ? first.runId : null);
    }
    expect(provider.calls).toBe(1);
  });

  it("marks safety-flagged results as needs_review", async () => {
    const { client, orgId, clientId } = await setupClientWithConsent(true);
    const reviewProvider: AiProvider = {
      providerKey: "fake",
      modelSnapshot: "fake-1",
      reasoningEffort: "none",
      async complete(call) {
        const envelope = call.envelope as { contract_version: string; request_id: string };
        return {
          ok: true as const,
          output: {
            contract_version: envelope.contract_version,
            request_id: envelope.request_id,
            result: { signals: [] },
            warnings: [],
            safety: {
              review_required: true,
              categories: ["sensitive_case"],
              rationale: "synthetic",
            },
          },
          inputTokens: 1,
          outputTokens: 1,
        };
      },
    };

    const result = await runAiFunction(
      client,
      reviewProvider,
      {
        functionId: "ai.ingest-signals.v1",
        organizationId: orgId,
        clientId,
        payload: ingestPayload,
      },
      { sleep: noSleep }
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.status).toBe("needs_review");

    const { data: run } = await client
      .from("ai_runs")
      .select("status")
      .eq("id", result.runId!)
      .single();
    expect(run!.status).toBe("needs_review");
  });

  it("enforces per-organization rate limits", async () => {
    const { client, orgId, clientId } = await setupClientWithConsent(true);
    const provider = new FakeAiProvider();
    const limiter = createInMemoryRateLimiter({ maxConcurrent: 100, maxPerMinute: 1 });
    const input = {
      functionId: "ai.ingest-signals.v1",
      organizationId: orgId,
      clientId,
      payload: ingestPayload,
    };

    await runAiFunction(client, provider, input, { sleep: noSleep, limiter });
    await expect(
      runAiFunction(
        client,
        provider,
        { ...input, payload: { ...ingestPayload, raw_input: "different input" } },
        { sleep: noSleep, limiter }
      )
    ).rejects.toMatchObject({ code: "RATE_LIMITED" });
  });
});
