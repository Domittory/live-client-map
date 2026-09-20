import type { SupabaseClient } from "@supabase/supabase-js";
import { runAiFunction } from "@/lib/ai/gateway";
import type { AiProvider } from "@/lib/ai/provider";
import { ServiceError } from "./errors";
import { runAtomicRpc } from "./transaction";

export interface IngestSignalsInput {
  organizationId: string;
  clientId: string;
  diagnosticSessionId: string;
  rawInput: string;
  sourceType: string;
  inputFormat: string;
  knownLifeAreas: string[];
}

/** One AI candidate as returned by ai.ingest-signals.v1. */
export interface ExtractedAiSignal {
  candidate_key: string;
  raw_statement: string;
  statement_polarity: string | null;
  test_result: string | null;
  normalized_meaning: string;
  inferred_opposite: string | null;
  confidence: number | null;
  life_areas: string[];
  tags: string[];
}

/**
 * Run the raw session input through the safe AI gateway and return the pending
 * L0 candidates WITHOUT persisting anything (ticket 11).
 *
 * The import preview needs the candidates to build its validation report and to
 * stage them for a later selective commit, but it must not create Signals. The
 * gateway itself performs the environment, consent, redaction, rate-limit and
 * contract checks, so extraction is exactly as guarded as a real ingest.
 */
export async function extractSignals(
  client: SupabaseClient,
  provider: AiProvider,
  input: IngestSignalsInput
): Promise<ExtractedAiSignal[]> {
  const result = await runAiFunction(client, provider, {
    functionId: "ai.ingest-signals.v1",
    organizationId: input.organizationId,
    clientId: input.clientId,
    payload: {
      diagnostic_session_id: input.diagnosticSessionId,
      raw_input: input.rawInput,
      source_type: input.sourceType,
      input_format: input.inputFormat,
      language: "ru",
      known_life_areas: input.knownLifeAreas,
    },
  });

  if (!result.ok) {
    throw new ServiceError("INTERNAL_ERROR", result.error);
  }

  return (result.result?.signals ?? []) as ExtractedAiSignal[];
}

/**
 * ingestSignals (ticket 33): extract the AI candidates and persist them as
 * pending, L0 evidence Signals in one atomic RPC. Raw statement is preserved
 * verbatim; the AI result never becomes independent evidence until human
 * review.
 */
export async function ingestSignals(
  client: SupabaseClient,
  provider: AiProvider,
  input: IngestSignalsInput
): Promise<string[]> {
  const signals = await extractSignals(client, provider, input);

  // Every pending L0 Signal and the audit row commit together (ticket 05): a
  // half-ingested AI result can never become evidence.
  return runAtomicRpc<string[]>(
    client,
    "ingest_signals",
    {
      p_org_id: input.organizationId,
      p_client_id: input.clientId,
      p_session_id: input.diagnosticSessionId,
      p_signals: signals.map((signal) => ({
        raw_statement: signal.raw_statement,
        statement_polarity: signal.statement_polarity,
        test_result: signal.test_result,
        normalized_meaning: signal.normalized_meaning,
        inferred_opposite: signal.inferred_opposite,
        confidence: signal.confidence,
        life_areas: signal.life_areas,
        tags: signal.tags,
      })),
    },
    {
      forbidden: "No write access to this client",
      failure: "Failed to persist AI signal",
      validation: "Invalid AI signal",
    }
  );
}
