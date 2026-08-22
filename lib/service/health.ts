import { getServiceClient } from "@/lib/supabase/admin";
import type { DatabaseStatus } from "@/lib/health";

/**
 * DB availability probe. Returns "unavailable" (never throws) when the
 * environment is not configured or the database cannot be reached, so the
 * health endpoint stays available even if the DB is down.
 */
export async function checkDatabase(): Promise<DatabaseStatus> {
  let client;
  try {
    client = getServiceClient();
  } catch {
    return "unavailable";
  }

  try {
    await client.rpc("health_check");
    return "ok";
  } catch {
    return "unavailable";
  }
}
