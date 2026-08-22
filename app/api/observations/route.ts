import { ServiceError, toErrorResponse } from "@/lib/service/errors";
import { createObservation, listObservations } from "@/lib/service/observations";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request): Promise<Response> {
  try {
    const supabase = await createClient();
    const query = Object.fromEntries(new URL(request.url).searchParams);
    const page = await listObservations(supabase, query);
    return Response.json(page);
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const supabase = await createClient();
    const body: unknown = await request.json().catch(() => {
      throw new ServiceError("VALIDATION_ERROR", "Invalid JSON body");
    });
    const observation = await createObservation(supabase, body);
    return Response.json(observation, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
