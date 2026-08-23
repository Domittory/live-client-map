import { ServiceError, toErrorResponse } from "@/lib/service/errors";
import { exportSnapshotReportMarkdown, exportSnapshotReportPdf } from "@/lib/service/report";
import { createClient } from "@/lib/supabase/server";

/**
 * Snapshot report download (ticket 56, §13).
 *
 * Query: clientId, snapshotVersion, audience (specialist|client), format
 * (markdown|pdf). `snapshotVersion` is always an exact version — resolving
 * "latest" is the UI's job (§13), so a link that is saved or shared keeps
 * pointing at the same immutable snapshot.
 *
 * Reports are never cached: authorization, consent and visibility are checked
 * per request, and a cached copy would outlive a revoked consent.
 */

// node:fs is used to read the embedded font, so this must not run on the edge.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function fileHeaders(contentType: string, filename: string): HeadersInit {
  return {
    "Content-Type": contentType,
    "Content-Disposition": `attachment; filename="${filename}"`,
    "Cache-Control": "no-store, private",
  };
}

export async function GET(request: Request): Promise<Response> {
  try {
    const supabase = await createClient();
    const { format, ...query } = Object.fromEntries(new URL(request.url).searchParams);

    if (format !== "markdown" && format !== "pdf") {
      throw new ServiceError("VALIDATION_ERROR", "format must be 'markdown' or 'pdf'");
    }

    if (format === "markdown") {
      const report = await exportSnapshotReportMarkdown(supabase, query);
      return new Response(report.content, {
        headers: fileHeaders("text/markdown; charset=utf-8", report.filename),
      });
    }

    const report = await exportSnapshotReportPdf(supabase, query);
    return new Response(Buffer.from(report.bytes), {
      headers: fileHeaders("application/pdf", report.filename),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
