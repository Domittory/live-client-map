import { createHash, randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { ServiceError } from "@/lib/service/errors";
import { incrementCounter, observeHistogram } from "@/lib/telemetry";
import { uuid, validate } from "@/lib/service/validation";
import {
  AI_CONTRACTS,
  MODEL_CONFIG,
  REDACTION_VERSION,
  aiRequestEnvelopeSchema,
  aiResponseEnvelopeSchema,
} from "./contracts";
import { createInMemoryRateLimiter, type RateLimiter } from "./limiter";
import { safetyIdentifier, type AiProvider } from "./provider";
import { looksUnredacted, redactText, type RedactionInput } from "./redact";

/**
 * Safe AI gateway (ticket 32): every AI call goes through here — environment
 * gate, tenant/assignment check, consent gate, redaction, size/rate limits,
 * timeout/retry policy, strict contract validation and run telemetry.
 * The gateway never applies business mutations; results stay pending until
 * human review (docs/ai-contracts.md).
 */

export const AI_RUN_STATUSES = [
  "queued",
  "running",
  "succeeded",
  "needs_review",
  "blocked_environment",
  "blocked_consent",
  "redaction_failed",
  "provider_model_unavailable",
  "provider_timeout",
  "provider_rate_limited",
  "provider_error",
  "invalid_output",
  "safety_blocked",
  "cancelled",
] as const;

export type AiRunStatus = (typeof AI_RUN_STATUSES)[number];

const MAX_INPUT_CHARS = 100_000;
const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_ATTEMPTS = 3;
const RETRY_DELAYS_MS = [1_000, 4_000];

export const runAiInputSchema = z
  .object({
    functionId: z.enum(Object.keys(AI_CONTRACTS) as [string, ...string[]]),
    organizationId: uuid,
    clientId: uuid,
    payload: z.record(z.string(), z.unknown()),
    identifiers: z
      .object({
        persons: z.array(z.string().min(1).max(500)).max(100).optional(),
        organizations: z.array(z.string().min(1).max(500)).max(100).optional(),
        places: z.array(z.string().min(1).max(500)).max(100).optional(),
        dates: z.array(z.string().min(1).max(500)).max(100).optional(),
      })
      .strict()
      .optional(),
    scoringModelVersion: z.string().max(50).nullable().optional(),
    sourceSnapshotVersion: z.number().int().min(0).nullable().optional(),
  })
  .strict();

export type RunAiInput = z.infer<typeof runAiInputSchema>;

export type RunAiResult =
  | {
      ok: true;
      status: "succeeded" | "needs_review";
      runId: string;
      reused: boolean;
      result: Record<string, unknown> | null;
      warnings: string[];
    }
  | {
      ok: false;
      status: Exclude<AiRunStatus, "succeeded" | "needs_review" | "queued" | "running">;
      runId: string | null;
      retryable: boolean;
      error: string;
    };

export interface RunAiOptions {
  limiter?: RateLimiter;
  timeoutMs?: number;
  maxAttempts?: number;
  sleep?: (ms: number) => Promise<void>;
  /** Defaults to process.env.NODE_ENV / AI_PRODUCTION_ENABLED. */
  productionAiEnabled?: boolean;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const defaultLimiter = createInMemoryRateLimiter();

function sha256(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function idempotencyKey(parts: Record<string, unknown>): string {
  return sha256(parts);
}

interface RunRecord {
  organizationId: string;
  clientId: string;
  actorUserId: string;
  requestId: string;
  functionId: string;
  contractVersion: string;
  promptVersion: string;
  ontologyVersion: string;
  scoringModelVersion: string | null;
  inputHash: string;
}

async function persistRun(
  client: SupabaseClient,
  record: RunRecord,
  outcome: {
    status: AiRunStatus;
    outputHash?: string | null;
    errorCode?: string | null;
    retryable?: boolean | null;
    inputTokens?: number | null;
    outputTokens?: number | null;
    latencyMs?: number | null;
  }
): Promise<string> {
  const { data, error } = await client
    .from("ai_runs")
    .insert({
      organization_id: record.organizationId,
      client_id: record.clientId,
      actor_user_id: record.actorUserId,
      request_id: record.requestId,
      idempotency_key: idempotencyKey({
        organization: record.organizationId,
        client: record.clientId,
        function: record.functionId,
        inputHash: record.inputHash,
        contractVersion: record.contractVersion,
        promptVersion: record.promptVersion,
        modelSnapshot: MODEL_CONFIG.snapshot,
      }),
      function: record.functionId,
      contract_version: record.contractVersion,
      prompt_version: record.promptVersion,
      ontology_version: record.ontologyVersion,
      scoring_model_version: record.scoringModelVersion,
      provider: MODEL_CONFIG.provider,
      model_snapshot: MODEL_CONFIG.snapshot,
      reasoning_effort: MODEL_CONFIG.reasoningEffort,
      input_hash: record.inputHash,
      output_hash: outcome.outputHash ?? null,
      redaction_version: REDACTION_VERSION,
      status: outcome.status,
      error_code: outcome.errorCode ?? null,
      retryable: outcome.retryable ?? null,
      input_tokens: outcome.inputTokens ?? null,
      output_tokens: outcome.outputTokens ?? null,
      latency_ms: outcome.latencyMs ?? null,
    })
    .select("id")
    .single();
  if (error) throw new ServiceError("INTERNAL_ERROR", "Failed to persist AI run");
  incrementCounter("ai_run_total", "Total AI gateway runs by outcome status", {
    status: outcome.status,
  });
  return (data as { id: string }).id;
}

export async function runAiFunction(
  client: SupabaseClient,
  provider: AiProvider,
  rawInput: unknown,
  options: RunAiOptions = {}
): Promise<RunAiResult> {
  const input = validate(runAiInputSchema, rawInput);
  const contract = AI_CONTRACTS[input.functionId];

  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user) throw new ServiceError("UNAUTHORIZED", "Authentication required");

  // Payload is validated against the function contract before anything else.
  const payload = validate(contract.payloadSchema, input.payload) as Record<string, unknown>;

  // Tenant + assignment check (SPEC §6) before any data leaves the app.
  const { data: accessible } = await client.rpc("is_client_accessible", {
    p_org_id: input.organizationId,
    p_client_id: input.clientId,
    p_require_write: false,
  });
  if (!accessible) {
    throw new ServiceError("FORBIDDEN", "No access to this client");
  }

  // Version metadata: the active ontology version pins the run.
  const { data: ontology } = await client
    .from("ontology_versions")
    .select("version")
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!ontology) throw new ServiceError("CONFLICT", "No active ontology version");

  const scoringModelVersion = input.scoringModelVersion ?? null;

  const baseRecord = async (inputHash: string): Promise<RunRecord> => ({
    organizationId: input.organizationId,
    clientId: input.clientId,
    actorUserId: user.id,
    requestId: randomUUID(),
    functionId: input.functionId,
    contractVersion: contract.contractVersion,
    promptVersion: contract.promptVersion,
    ontologyVersion: (ontology as { version: string }).version,
    scoringModelVersion,
    inputHash,
  });

  // Environment gate (docs: production AI is off until a separate decision).
  const productionAiEnabled =
    options.productionAiEnabled ?? process.env.AI_PRODUCTION_ENABLED === "true";
  const isProduction = process.env.NODE_ENV === "production";
  const redactedInput = redactPayload(payload, input.identifiers);
  const inputHash = sha256(redactedInput);

  if (isProduction && !productionAiEnabled) {
    const record = await baseRecord(inputHash);
    const runId = await persistRun(client, record, {
      status: "blocked_environment",
      retryable: false,
    });
    return {
      ok: false,
      status: "blocked_environment",
      runId,
      retryable: false,
      error: "AI is disabled in production pending a provider/data-region decision",
    };
  }

  // Consent gate (ticket 13): no active ai_analysis consent — no provider call.
  const { data: consentOk } = await client.rpc("has_consent", {
    p_client_id: input.clientId,
    p_consent_type: "ai_analysis",
  });
  if (!consentOk) {
    const record = await baseRecord(inputHash);
    const runId = await persistRun(client, record, {
      status: "blocked_consent",
      retryable: false,
    });
    return {
      ok: false,
      status: "blocked_consent",
      runId,
      retryable: false,
      error: "Missing consent: ai_analysis",
    };
  }

  // Redaction failure gate: payload must not contain unredacted PII patterns.
  if (looksUnredacted(JSON.stringify(redactedInput))) {
    const record = await baseRecord(inputHash);
    const runId = await persistRun(client, record, {
      status: "redaction_failed",
      retryable: false,
    });
    return {
      ok: false,
      status: "redaction_failed",
      runId,
      retryable: false,
      error: "Payload still contains unredacted identifiers",
    };
  }

  const serialized = JSON.stringify(redactedInput);
  if (serialized.length > MAX_INPUT_CHARS) {
    throw new ServiceError("VALIDATION_ERROR", "Redacted input exceeds 100,000 characters");
  }

  const limiter = options.limiter ?? defaultLimiter;
  if (!limiter.acquire(input.organizationId)) {
    throw new ServiceError("RATE_LIMITED", "Organization AI rate limit exceeded");
  }

  const requestId = randomUUID();
  const record = await baseRecord(inputHash);
  record.requestId = requestId;

  const envelope = {
    contract_version: contract.contractVersion,
    request_id: requestId,
    organization_id: input.organizationId,
    client_id: input.clientId,
    language: "ru",
    ontology_version: record.ontologyVersion,
    scoring_model_version: scoringModelVersion,
    prompt_version: contract.promptVersion,
    source_snapshot_version: input.sourceSnapshotVersion ?? null,
    payload: redactedInput,
  };
  validate(aiRequestEnvelopeSchema, envelope);

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const sleep = options.sleep ?? defaultSleep;
  const startedAt = Date.now();

  try {
    // Idempotency: an identical successful call returns without a provider hit.
    const key = idempotencyKey({
      organization: input.organizationId,
      client: input.clientId,
      function: input.functionId,
      inputHash,
      contractVersion: contract.contractVersion,
      promptVersion: contract.promptVersion,
      modelSnapshot: MODEL_CONFIG.snapshot,
    });
    const { data: existing } = await client
      .from("ai_runs")
      .select("id, status")
      .eq("idempotency_key", key)
      .in("status", ["succeeded", "needs_review"])
      .maybeSingle();
    if (existing) {
      return {
        ok: true,
        status: (existing as { status: "succeeded" | "needs_review" }).status,
        runId: (existing as { id: string }).id,
        reused: true,
        result: null,
        warnings: [],
      };
    }

    let lastFailure: { kind: string; message: string; retryAfterMs?: number } | null = null;
    let usage: { inputTokens: number | null; outputTokens: number | null } = {
      inputTokens: null,
      outputTokens: null,
    };

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const response = await provider.complete({
        functionId: input.functionId,
        contractVersion: contract.contractVersion,
        promptVersion: contract.promptVersion,
        envelope,
        timeoutMs,
        safetyIdentifier: safetyIdentifier(user.id, record.inputHash),
      });

      if (response.ok) {
        usage = { inputTokens: response.inputTokens, outputTokens: response.outputTokens };
        const validated = validateAiOutput(
          contract.resultSchema,
          response.output,
          contract.contractVersion,
          requestId
        );
        if (!validated.ok) {
          const runId = await persistRun(client, record, {
            status: "invalid_output",
            outputHash: sha256(response.output ?? null),
            errorCode: validated.error,
            retryable: false,
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
            latencyMs: Date.now() - startedAt,
          });
          return {
            ok: false,
            status: "invalid_output",
            runId,
            retryable: false,
            error: "AI output failed contract validation",
          };
        }

        const status = validated.safety.review_required ? "needs_review" : "succeeded";
        const runId = await persistRun(client, record, {
          status,
          outputHash: sha256(validated.result),
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          latencyMs: Date.now() - startedAt,
        });
        return {
          ok: true,
          status,
          runId,
          reused: false,
          result: validated.result,
          warnings: validated.warnings,
        };
      }

      if (response.kind === "model_unavailable") {
        const runId = await persistRun(client, record, {
          status: "provider_model_unavailable",
          errorCode: response.message,
          retryable: false,
          latencyMs: Date.now() - startedAt,
        });
        return {
          ok: false,
          status: "provider_model_unavailable",
          runId,
          retryable: false,
          error: "Pinned model snapshot unavailable",
        };
      }
      if (response.kind === "refusal") {
        const runId = await persistRun(client, record, {
          status: "safety_blocked",
          errorCode: response.message,
          retryable: false,
          latencyMs: Date.now() - startedAt,
        });
        return {
          ok: false,
          status: "safety_blocked",
          runId,
          retryable: false,
          error: "Provider refused the request",
        };
      }

      // Retryable kinds: network, timeout, rate_limited, provider_error.
      lastFailure = response;
      if (attempt < maxAttempts) {
        const backoff = response.retryAfterMs ?? RETRY_DELAYS_MS[attempt - 1] ?? 4_000;
        const jitter = Math.floor(Math.random() * 250);
        await sleep(backoff + jitter);
      }
    }

    const statusByKind: Record<
      string,
      "provider_timeout" | "provider_rate_limited" | "provider_error"
    > = {
      timeout: "provider_timeout",
      rate_limited: "provider_rate_limited",
      network: "provider_error",
      provider_error: "provider_error",
    };
    const status = statusByKind[lastFailure?.kind ?? "provider_error"] ?? "provider_error";
    const runId = await persistRun(client, record, {
      status,
      errorCode: lastFailure?.message ?? "provider error",
      retryable: true,
      latencyMs: Date.now() - startedAt,
    });
    return { ok: false, status, runId, retryable: true, error: "AI provider call failed" };
  } finally {
    observeHistogram(
      "ai_call_duration_ms",
      "AI provider call duration including retries",
      [1000, 5000, 15000, 30000, 120000],
      Date.now() - startedAt
    );
    limiter.release(input.organizationId);
  }
}

function redactPayload(
  payload: Record<string, unknown>,
  identifiers: RedactionInput["identifiers"]
): Record<string, unknown> {
  // Identifiers are masked across the whole serialized payload; the mapping
  // stays in memory and is dropped when the call ends.
  const { text } = redactText({ text: JSON.stringify(payload), identifiers });
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new ServiceError("INTERNAL_ERROR", "Redaction corrupted the payload");
  }
}

function validateAiOutput(
  resultSchema: z.ZodType,
  output: unknown,
  contractVersion: string,
  requestId: string
):
  | {
      ok: true;
      result: Record<string, unknown>;
      warnings: string[];
      safety: { review_required: boolean; categories: string[]; rationale: string };
    }
  | { ok: false; error: string } {
  const envelope = aiResponseEnvelopeSchema.safeParse(output);
  if (!envelope.success) return { ok: false, error: "envelope_invalid" };
  if (
    envelope.data.contract_version !== contractVersion ||
    envelope.data.request_id !== requestId
  ) {
    return { ok: false, error: "envelope_mismatch" };
  }
  const result = resultSchema.safeParse(envelope.data.result);
  if (!result.success) return { ok: false, error: "result_invalid" };
  return {
    ok: true,
    result: result.data as Record<string, unknown>,
    warnings: envelope.data.warnings,
    safety: envelope.data.safety,
  };
}
