import { FakeAiProvider, OpenAiResponsesProvider, type AiProvider } from "@/lib/ai/provider";
import { getServerEnv } from "@/lib/env";
import { toErrorResponse } from "@/lib/service/errors";
import { evaluateCorrection } from "@/lib/service/follow-ups";
import { createClient } from "@/lib/supabase/server";

/** Same provider resolution as app/api/ai/run/route.ts (ticket 32). */
function resolveProvider(): AiProvider {
  const env = getServerEnv();
  if (env.AI_PROVIDER === "openai" && env.OPENAI_API_KEY) {
    return new OpenAiResponsesProvider(env.OPENAI_API_KEY);
  }
  return new FakeAiProvider();
}

/** Run evaluateCorrection (ai.evaluate-correction.v1) for a completed follow-up. */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  try {
    const supabase = await createClient();
    const followUp = await evaluateCorrection(supabase, resolveProvider(), (await params).id);
    return Response.json(followUp);
  } catch (err) {
    return toErrorResponse(err);
  }
}
