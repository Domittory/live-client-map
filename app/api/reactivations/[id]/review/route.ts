import { ServiceError, toErrorResponse } from "@/lib/service/errors";
import { reviewCoreNodeReactivation } from "@/lib/service/reactivation";
import { createClient } from "@/lib/supabase/server";

/** Human approval flow: approve or reject a pending reactivation proposal. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  try {
    const supabase = await createClient();
    const body: unknown = await request.json().catch(() => {
      throw new ServiceError("VALIDATION_ERROR", "Invalid JSON body");
    });
    const proposal = await reviewCoreNodeReactivation(supabase, {
      ...(typeof body === "object" && body !== null ? body : {}),
      reactivationId: (await params).id,
    });
    return Response.json(proposal);
  } catch (err) {
    return toErrorResponse(err);
  }
}
