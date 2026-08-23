import { ServiceError, toErrorResponse } from "@/lib/service/errors";
import { cancelFollowUp, completeFollowUp, getFollowUp } from "@/lib/service/follow-ups";
import { createClient } from "@/lib/supabase/server";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  try {
    const supabase = await createClient();
    const followUp = await getFollowUp(supabase, (await params).id);
    return Response.json(followUp);
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
    const followUp = await completeFollowUp(supabase, {
      ...(typeof body === "object" && body !== null ? body : {}),
      followUpId: (await params).id,
    });
    return Response.json(followUp);
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
    await cancelFollowUp(supabase, (await params).id);
    return new Response(null, { status: 204 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
