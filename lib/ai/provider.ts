import { createHmac } from "node:crypto";

/**
 * Provider boundary (docs/ai-contracts.md): business services depend on the
 * AiProvider interface, never on a vendor SDK. Swapping OpenAI for another
 * provider must not change domain services or contracts.
 */

export interface AiProviderCall {
  functionId: string;
  contractVersion: string;
  promptVersion: string;
  /** Redacted request envelope (already consent/environment gated). */
  envelope: Record<string, unknown>;
  timeoutMs: number;
  /** HMAC of the internal user id; never the raw id. */
  safetyIdentifier: string;
}

export type AiProviderResponse =
  | {
      ok: true;
      /** Parsed provider JSON, not yet contract-validated. */
      output: unknown;
      inputTokens: number | null;
      outputTokens: number | null;
    }
  | {
      ok: false;
      kind:
        "network" | "timeout" | "rate_limited" | "model_unavailable" | "provider_error" | "refusal";
      retryAfterMs?: number;
      /** Safe message; never contains raw prompt/response. */
      message: string;
    };

export interface AiProvider {
  readonly providerKey: string;
  readonly modelSnapshot: string;
  readonly reasoningEffort: string;
  complete(call: AiProviderCall): Promise<AiProviderResponse>;
}

export function safetyIdentifier(userId: string, secret: string): string {
  return createHmac("sha256", secret).update(userId).digest("hex");
}

// --- OpenAI Responses API adapter (dev/test only) -----------------------------

export class OpenAiResponsesProvider implements AiProvider {
  readonly providerKey = "openai-dev";
  readonly modelSnapshot = "gpt-5.5-2026-04-23";
  readonly reasoningEffort = "high";

  constructor(private readonly apiKey: string) {}

  async complete(call: AiProviderCall): Promise<AiProviderResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), call.timeoutMs);
    try {
      const response = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: this.modelSnapshot,
          store: false,
          reasoning: { effort: this.reasoningEffort },
          safety_identifier: call.safetyIdentifier,
          input: JSON.stringify(call.envelope),
          text: { format: { type: "json_object" } },
        }),
        signal: controller.signal,
      });

      if (response.status === 404) {
        return { ok: false, kind: "model_unavailable", message: "model snapshot unavailable" };
      }
      if (response.status === 429 || response.status >= 500 || response.status === 408) {
        const retryAfter = Number(response.headers.get("retry-after"));
        return {
          ok: false,
          kind: response.status === 429 ? "rate_limited" : "provider_error",
          retryAfterMs: Number.isFinite(retryAfter) ? retryAfter * 1000 : undefined,
          message: `provider HTTP ${response.status}`,
        };
      }
      if (!response.ok) {
        return { ok: false, kind: "provider_error", message: `provider HTTP ${response.status}` };
      }

      const body = (await response.json()) as {
        output_text?: string;
        usage?: { input_tokens?: number; output_tokens?: number };
      };
      try {
        return {
          ok: true,
          output: JSON.parse(body.output_text ?? ""),
          inputTokens: body.usage?.input_tokens ?? null,
          outputTokens: body.usage?.output_tokens ?? null,
        };
      } catch {
        // Malformed JSON is surfaced as ok=true with unparseable output so the
        // gateway classifies it as invalid_output (not a provider failure).
        return {
          ok: true,
          output: { __malformed: true },
          inputTokens: body.usage?.input_tokens ?? null,
          outputTokens: body.usage?.output_tokens ?? null,
        };
      }
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        return { ok: false, kind: "timeout", message: "provider timeout" };
      }
      return { ok: false, kind: "network", message: "network failure" };
    } finally {
      clearTimeout(timer);
    }
  }
}

// --- Fake provider for development and tests -------------------------------------

export type FakeBehavior =
  | { kind: "ok" }
  | { kind: "malformed" }
  | { kind: "invalid_enum" }
  | { kind: "score_out_of_range" }
  | { kind: "unknown_fields" }
  | { kind: "timeout"; delayMs: number }
  | { kind: "rate_limited"; retryAfterMs?: number }
  | { kind: "unavailable" };

export class FakeAiProvider implements AiProvider {
  readonly providerKey = "fake";
  readonly modelSnapshot = "fake-1";
  readonly reasoningEffort = "none";

  calls = 0;

  constructor(private behavior: FakeBehavior = { kind: "ok" }) {}

  setBehavior(behavior: FakeBehavior): void {
    this.behavior = behavior;
  }

  async complete(call: AiProviderCall): Promise<AiProviderResponse> {
    this.calls += 1;
    const behavior = this.behavior;
    const envelope = call.envelope as { contract_version: string; request_id: string };

    const base = {
      contract_version: envelope.contract_version,
      request_id: envelope.request_id,
      warnings: ["insufficient_data"],
      safety: { review_required: false, categories: [], rationale: "" },
    };

    switch (behavior.kind) {
      case "ok":
        // Minimal contract-valid empty result per function.
        return {
          ok: true,
          output: { ...base, result: fakeResultFor(call.functionId) },
          inputTokens: 10,
          outputTokens: 5,
        };
      case "malformed":
        return { ok: true, output: "not json at all", inputTokens: 1, outputTokens: 1 };
      case "invalid_enum":
        return {
          ok: true,
          output: { ...base, warnings: ["not_a_warning"], result: {} },
          inputTokens: 1,
          outputTokens: 1,
        };
      case "score_out_of_range":
        return {
          ok: true,
          output: { ...base, result: fakeResultFor(call.functionId, 150) },
          inputTokens: 1,
          outputTokens: 1,
        };
      case "unknown_fields":
        return {
          ok: true,
          output: { ...base, result: fakeResultFor(call.functionId), hacker: true },
          inputTokens: 1,
          outputTokens: 1,
        };
      case "timeout":
        await new Promise((resolve) => setTimeout(resolve, behavior.delayMs));
        return { ok: false, kind: "timeout", message: "provider timeout" };
      case "rate_limited":
        return {
          ok: false,
          kind: "rate_limited",
          retryAfterMs: behavior.retryAfterMs,
          message: "provider HTTP 429",
        };
      case "unavailable":
        return { ok: false, kind: "model_unavailable", message: "model snapshot unavailable" };
    }
  }
}

function fakeResultFor(functionId: string, score?: number): Record<string, unknown> {
  // Empty results are valid and preferred over invented output (contract docs).
  const confidence = score ?? null;
  switch (functionId) {
    case "ai.ingest-signals.v1":
      return { signals: [] };
    case "ai.cluster-evidence.v1":
      return { clusters: [] };
    case "ai.classify-themes.v1":
      return { theme_proposals: [] };
    case "ai.update-core-nodes.v1":
      return { core_node_proposals: [] };
    case "ai.generate-differential-hypotheses.v1":
      return { hypotheses: [] };
    case "ai.detect-contradictions.v1":
      return { contradictions: [] };
    case "ai.evaluate-correction.v1":
      return {
        assessment: {
          proposed_result_status: "unclear",
          confidence,
          evidence_refs: [],
          context_changes: [],
          marker_changes: [],
          missing_evidence: [],
          proposed_core_node_status: null,
          rationale: "fake",
          follow_up_recommendation: "",
        },
      };
    case "ai.update-resources.v1":
      return { resource_proposals: [] };
    case "ai.generate-recommendations.v1":
      return { recommendations: [] };
    case "ai.generate-snapshot.v1":
      return {
        narrative: { summary: "", trend_summary: "", risk_notes: "", evidence_digest: "" },
        grouped_entity_refs: {
          active_core_nodes: [],
          active_themes: [],
          resources: [],
          development_targets: [],
          weakened_nodes: [],
          reactivated_nodes: [],
          recent_triggers: [],
          recent_corrections: [],
          recommendations: [],
        },
      };
    case "ai.explain-model-changes.v1":
      return { explanations: [] };
    default:
      return {};
  }
}
