import type { SupabaseClient } from "@supabase/supabase-js";
import { ServiceError } from "./errors";

/**
 * Transaction convention (ticket 10, SPEC §44).
 *
 * The Supabase JS client has no multi-statement transaction primitive, so every
 * transaction runs inside a Postgres function invoked via `supabase.rpc(...)`.
 *
 * Any `security definer` function MUST `set search_path = public;` and be
 * granted only the minimal privileges it needs. A service applies one
 * validated, approved result per RPC call; the app never orchestrates a
 * multi-call transaction client-side.
 */
export async function runRpc<T>(
  client: SupabaseClient,
  rpcName: string,
  args?: Record<string, unknown>
): Promise<T> {
  const { data, error } = await client.rpc(rpcName, args ?? {});
  if (error) {
    throw new ServiceError("DATABASE_UNAVAILABLE", "RPC failed", { rpcName });
  }
  return data as T;
}
