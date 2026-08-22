import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getClientEnv, getServerEnv } from "@/lib/env";

/**
 * Privileged service-role client (server-only, bypasses RLS).
 * Use only for server-side operations like the DB health check.
 * Throws if the required environment is not configured.
 */
export function getServiceClient(): SupabaseClient {
  const { NEXT_PUBLIC_SUPABASE_URL } = getClientEnv();
  const { SUPABASE_SERVICE_ROLE_KEY } = getServerEnv();
  return createClient(NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
