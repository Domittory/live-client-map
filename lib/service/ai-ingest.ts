import type { SupabaseClient } from "@supabase/supabase-js";
import { runAiFunction } from "@/lib/ai/gateway";
import type { AiProvider } from "@/lib/ai/provider";
import { recordAudit } from "./audit";
import { ServiceError } from "./errors";

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
  const {
    data: { user },
  } = await client.auth.getUser();

  const createdIds: string[] = [];
  for (const signal of signals) {
    const { data, error } = await client
      .from("signals")
      .insert({
        organization_id: input.organizationId,
        client_id: input.clientId,
        diagnostic_session_id: input.diagnosticSessionId,
        source_type: "ai_hypothesis",
        epistemic_type: "hypothesis",
        raw_statement: signal.raw_statement,
        statement_polarity: signal.statement_polarity,
        test_result: signal.test_result,
        normalized_meaning: signal.normalized_meaning,
        inferred_opposite: signal.inferred_opposite,
        confidence: signal.confidence,
        life_areas: signal.life_areas,
        tags: signal.tags,
        evidence_level: "L0_AI_ONLY",
        review_status: "pending",
        created_by: user?.id ?? null,
      })
      .select("id")
      .single();
    if (error) throw new ServiceError("INTERNAL_ERROR", "Failed to persist AI signal");
    createdIds.push(data.id);
  }

  await recordAudit(client, {
    organizationId: input.organizationId,
    entityType: "diagnostic_session",
    entityId: input.diagnosticSessionId,
    action: "ai.ingest_signals",
    after: { created_signals: createdIds.length },
  });

  return createdIds;
}
