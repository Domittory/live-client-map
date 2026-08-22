import { createBrowserClient } from "@supabase/ssr";
import { getClientEnv } from "@/lib/env";

/** Browser-side Supabase client (anon key, cookie-based session). */
export function createClient() {
  const { NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY } = getClientEnv();
  return createBrowserClient(NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY);
}
