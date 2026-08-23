import { ServiceError, toErrorResponse } from "@/lib/service/errors";
import { listFollowUps, scheduleFollowUp } from "@/lib/service/follow-ups";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request): Promise<Response> {
  try {
    const supabase = await createClient();
    const query = Object.fromEntries(new URL(request.url).searchParams);
    const page = await listFollowUps(supabase, query);
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
    const followUp = await scheduleFollowUp(supabase, body);
    return Response.json(followUp, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
