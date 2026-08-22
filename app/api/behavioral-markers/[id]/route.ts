import { ServiceError, toErrorResponse } from "@/lib/service/errors";
import { getMarker, updateMarker } from "@/lib/service/observations";
import { createClient } from "@/lib/supabase/server";

type RouteParams = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: RouteParams): Promise<Response> {
  try {
    const supabase = await createClient();
    const marker = await getMarker(supabase, (await params).id);
    return Response.json(marker);
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function PATCH(request: Request, { params }: RouteParams): Promise<Response> {
  try {
    const supabase = await createClient();
    const body: unknown = await request.json().catch(() => {
      throw new ServiceError("VALIDATION_ERROR", "Invalid JSON body");
    });
    const marker = await updateMarker(supabase, {
      ...(body as Record<string, unknown>),
      markerId: (await params).id,
    });
    return Response.json(marker);
  } catch (err) {
    return toErrorResponse(err);
  }
}
