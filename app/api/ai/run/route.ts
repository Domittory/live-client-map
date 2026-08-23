import { runAiFunction } from "@/lib/ai/gateway";
import { FakeAiProvider, OpenAiResponsesProvider, type AiProvider } from "@/lib/ai/provider";
import { getServerEnv } from "@/lib/env";
import { ServiceError, toErrorResponse } from "@/lib/service/errors";
import { createClient } from "@/lib/supabase/server";
import { withTelemetry } from "@/lib/telemetry";

/**
 * The only server-side AI entry point (ticket 32). The provider secret is read
 * from server env here and never reaches the browser bundle.
 */
function resolveProvider(): AiProvider {
  const env = getServerEnv();
  if (env.AI_PROVIDER === "openai" && env.OPENAI_API_KEY) {
    return new OpenAiResponsesProvider(env.OPENAI_API_KEY);
  }
  return new FakeAiProvider();
}

async function handlePost(request: Request): Promise<Response> {
  try {
    const supabase = await createClient();
    const body: unknown = await request.json().catch(() => {
      throw new ServiceError("VALIDATION_ERROR", "Invalid JSON body");
    });
    const result = await runAiFunction(supabase, resolveProvider(), body);
    return Response.json(result, { status: result.ok ? 200 : 422 });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export const POST = withTelemetry(handlePost);
