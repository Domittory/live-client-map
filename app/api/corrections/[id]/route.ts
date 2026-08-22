import { archiveCorrection, getCorrection, updateCorrection } from "@/lib/service/corrections";
import { ServiceError, toErrorResponse } from "@/lib/service/errors";
import { createClient } from "@/lib/supabase/server";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  try {
    const supabase = await createClient();
    const correction = await getCorrection(supabase, (await params).id);
    return Response.json(correction);
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  try {
    const supabase = await createClient();
    const body: unknown = await request.json().catch(() => {
      throw new ServiceError("VALIDATION_ERROR", "Invalid JSON body");
    });
    const correction = await updateCorrection(supabase, {
      ...(typeof body === "object" && body !== null ? body : {}),
      correctionId: (await params).id,
    });
    return Response.json(correction);
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  try {
    const supabase = await createClient();
    await archiveCorrection(supabase, (await params).id);
    return new Response(null, { status: 204 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
