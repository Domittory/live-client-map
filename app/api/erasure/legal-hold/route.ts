import { ServiceError, toErrorResponse } from "@/lib/service/errors";
import { setLegalHold } from "@/lib/service/erasure";
import { getServiceClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

/**
 * Set or clear the legal hold that defers erasure (ticket 58). Owner-only.
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

    const { clientId, hold } = (body ?? {}) as { clientId?: unknown; hold?: unknown };
    if (typeof clientId !== "string" || typeof hold !== "boolean") {
      throw new ServiceError("VALIDATION_ERROR", "clientId and hold (boolean) are required");
    }

    await setLegalHold(supabase, admin, clientId, hold);
    return Response.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
