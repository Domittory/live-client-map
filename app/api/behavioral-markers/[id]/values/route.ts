import { ServiceError, toErrorResponse } from "@/lib/service/errors";
import { recordMarkerValue } from "@/lib/service/observations";
import { createClient } from "@/lib/supabase/server";

type RouteParams = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: RouteParams): Promise<Response> {
  try {
    const supabase = await createClient();
    const body: unknown = await request.json().catch(() => {
      throw new ServiceError("VALIDATION_ERROR", "Invalid JSON body");
    });
    const marker = await recordMarkerValue(supabase, {
      ...(body as Record<string, unknown>),
      markerId: (await params).id,
    });
    return Response.json(marker, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
