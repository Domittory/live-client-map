import { ServiceError, toErrorResponse } from "@/lib/service/errors";
import { reviewFollowUpAssessment } from "@/lib/service/follow-ups";
import { createClient } from "@/lib/supabase/server";

/** Human approval flow: approve or reject the pending AI assessment. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  try {
    const supabase = await createClient();
    const body: unknown = await request.json().catch(() => {
      throw new ServiceError("VALIDATION_ERROR", "Invalid JSON body");
    });
    const followUp = await reviewFollowUpAssessment(supabase, {
      ...(typeof body === "object" && body !== null ? body : {}),
      followUpId: (await params).id,
    });
    return Response.json(followUp);
  } catch (err) {
    return toErrorResponse(err);
  }
}
