import { toErrorResponse } from "@/lib/service/errors";
import {
  evaluateCoreNodeReactivation,
  listCoreNodeReactivations,
} from "@/lib/service/reactivation";
import { createClient } from "@/lib/supabase/server";

/** List reactivation proposals for a core node (history). */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  try {
    const supabase = await createClient();
    const query = Object.fromEntries(new URL(request.url).searchParams);
    const page = await listCoreNodeReactivations(supabase, {
      ...query,
      coreNodeId: (await params).id,
    });
    return Response.json(page);
  } catch (err) {
    return toErrorResponse(err);
  }
}

/** Run the deterministic reactivation evaluation for a core node. */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  try {
    const supabase = await createClient();
    const result = await evaluateCoreNodeReactivation(supabase, {
      coreNodeId: (await params).id,
    });
    return Response.json(result, { status: result.proposal ? 201 : 200 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
