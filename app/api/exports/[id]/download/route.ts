import { downloadExportArtifact, toExportDownloadResponse } from "@/lib/service/export-delivery";
import { createClient } from "@/lib/supabase/server";
import { toExportErrorResponse } from "../../export-errors";

/**
 * Re-authorized export download (ticket 22, docs §10.1).
 *
 * The Supabase client is built from the USER session, not the service role:
 * `claim_export_download()` answers "may THIS caller receive these bytes right
 * now?", and with a service-role client `auth.uid()` would be null and every
 * delivery would be denied. The service role is used only afterwards, inside
 * `downloadExportArtifact`, to read the private object and record the delivery.
 *
 * The response carries the exact stored media type, the opaque filename and
 * `Cache-Control: no-store, private`, so no proxy can keep serving bytes after
 * the authorization they were granted for has been revoked.
 *
 * Status mapping (`toExportErrorResponse`): 400 malformed id, 403 denied by
 * access/consent/expiry, 404 unknown or missing artifact, 409 expired mid-read,
 * 500 delivery failure.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  try {
    const supabase = await createClient();
    const { id } = await params;
    const payload = await downloadExportArtifact(supabase, id);
    return toExportDownloadResponse(payload);
  } catch (err) {
    return toExportErrorResponse(err);
  }
}
