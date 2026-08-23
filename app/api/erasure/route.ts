import { ServiceError, toErrorResponse } from "@/lib/service/errors";
import { executeErasure, revokeDataStorage } from "@/lib/service/erasure";
import { getServiceClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

/**
 * Erasure entry points (ticket 58):
 * - POST { clientId, action: "execute" | "revoke" } — full hard delete, or
 *   revoke `data_storage` (initiates the procedure).
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  try {
    const supabase = await createClient();
    const admin = getServiceClient();
    const body: unknown = await request.json().catch(() => {
      throw new ServiceError("VALIDATION_ERROR", "Invalid JSON body");
    });

    const { clientId, action } = (body ?? {}) as { clientId?: unknown; action?: unknown };
    if (typeof clientId !== "string") {
      throw new ServiceError("VALIDATION_ERROR", "clientId is required");
    }

    if (action === "revoke") {
      const requestId = await revokeDataStorage(supabase, admin, clientId);
      return Response.json({ status: "requested", erasureRequestId: requestId });
    }
    if (action === undefined || action === "execute") {
      const result = await executeErasure(supabase, admin, clientId);
      return Response.json(result);
    }

    throw new ServiceError("VALIDATION_ERROR", "action must be 'execute' or 'revoke'");
  } catch (err) {
    return toErrorResponse(err);
  }
}
