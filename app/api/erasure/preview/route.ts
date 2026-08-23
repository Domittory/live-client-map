import { ServiceError, toErrorResponse } from "@/lib/service/errors";
import { previewErasure } from "@/lib/service/erasure";
import { getServiceClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

/**
 * Owner-only preview of what a full erasure would remove (ticket 58).
 * Read-only: no state is changed.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  try {
    const supabase = await createClient();
    const admin = getServiceClient();
    const clientId = new URL(request.url).searchParams.get("clientId");
    if (!clientId) throw new ServiceError("VALIDATION_ERROR", "clientId is required");

    const preview = await previewErasure(supabase, admin, clientId);
    return Response.json(preview);
  } catch (err) {
    return toErrorResponse(err);
  }
}
