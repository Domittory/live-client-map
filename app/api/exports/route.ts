import { ServiceError } from "@/lib/service/errors";
import { createExportRequest } from "@/lib/service/export-request";
import { createClient } from "@/lib/supabase/server";
import { toExportErrorResponse } from "./export-errors";

/**
 * Asynchronous export request (ticket 22, docs/data-exchange-contracts.md §10).
 *
 * `POST /api/exports` accepts `{ clientId, kind, audience, snapshotVersion?,
 * idempotencyKey }` and returns the ExportRequestTicket. The session is the
 * caller's own (`lib/supabase/server`), so `request_export()` runs with
 * `auth.uid()` set and re-asserts tenant, ClientAssignment, audience role and
 * consent inside its transaction — exactly the rules the later download repeats.
 *
 *   * 201 — a new request was claimed and (for the synchronous local path) is
 *           `available`;
 *   * 200 — an equivalent existing request was replayed unchanged.
 *
 * A refusal is a persisted, audited `denied` row in the database; the service
 * maps it to FORBIDDEN, so the response is the ordinary 403 contract.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  try {
    const supabase = await createClient();
    const body: unknown = await request.json().catch(() => {
      throw new ServiceError("VALIDATION_ERROR", "Invalid JSON body");
    });

    const ticket = await createExportRequest(supabase, body);
    return Response.json(ticket, { status: ticket.replayed ? 200 : 201 });
  } catch (err) {
    return toExportErrorResponse(err);
  }
}
