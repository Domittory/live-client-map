import { ServiceError, toErrorResponse } from "@/lib/service/errors";
import { createOrgBeliefTemplate, listBeliefTemplates } from "@/lib/service/ontology";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request): Promise<Response> {
  try {
    const supabase = await createClient();
    const query = Object.fromEntries(new URL(request.url).searchParams);
    const page = await listBeliefTemplates(supabase, query);
    return Response.json(page);
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const supabase = await createClient();
    const body: unknown = await request.json().catch(() => {
      throw new ServiceError("VALIDATION_ERROR", "Invalid JSON body");
    });
    const template = await createOrgBeliefTemplate(supabase, body);
    return Response.json(template, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
