import { getHealthStatus } from "@/lib/health";
import { checkDatabase } from "@/lib/service/health";

export async function GET(): Promise<Response> {
  const database = await checkDatabase();
  return Response.json(getHealthStatus(database));
}
