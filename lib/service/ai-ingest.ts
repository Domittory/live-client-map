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

interface AiSignal {
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
 * ingestSignals (ticket 33): run the raw session input through the safe AI
 * gateway and persist only pending, L0 evidence Signals. Raw statement is
 * preserved verbatim; the AI result never becomes independent evidence until
 * human review.
 */
export async function ingestSignals(
  client: SupabaseClient,
  provider: AiProvider,
  input: IngestSignalsInput
): Promise<string[]> {
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

  const signals = (result.result?.signals ?? []) as AiSignal[];
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
