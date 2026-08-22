import { listAuditLog } from "@/lib/service/audit";
import { toErrorResponse } from "@/lib/service/errors";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request): Promise<Response> {
  try {
    const supabase = await createClient();
    const query = Object.fromEntries(new URL(request.url).searchParams);
    const page = await listAuditLog(supabase, query);
    return Response.json(page);
  } catch (err) {
    return toErrorResponse(err);
  }
}
