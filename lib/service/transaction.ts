import type { SupabaseClient } from "@supabase/supabase-js";
import { ServiceError } from "./errors";

/**
 * Atomic business mutation contract (ticket 01, SPEC §44).
 *
 * The Supabase JS client has no multi-statement transaction primitive, so every
 * compound mutation runs inside one PostgreSQL RPC invoked via
 * `supabase.rpc(...)`. Inside that function the domain write, its child rows
 * and the AuditLog append commit or roll back together — the service layer must
 * never orchestrate a multi-call transaction client-side, because a failure
 * between two calls would leave committed business data without its audit row.
 *
 * Rules an atomic RPC obeys (see migration 0039):
 *   - `security definer` with `set search_path = public`;
 *   - EXECUTE revoked from public/anon and granted to the narrowest role set;
 *   - actor resolved from auth.uid(), tenant/assignment/consent checks applied;
 *   - AuditLog written through append_audit() in the same transaction.
 *
 * The public service input stays camel-case; the RPC argument payload uses
 * schema column names (p_snake_case) and is built by the service.
 */
export interface AtomicRpcMessages {
  /** Shown when the database denies the call: auth, tenant, assignment, consent. */
  forbidden: string;
  /** Shown for any other database failure. Never leaks the raw RPC error. */
  failure: string;
  /** Shown for a domain validation rejection (SQLSTATE 22023 / 23514). */
  validation?: string;
  /** Shown for a uniqueness/state conflict (SQLSTATE 23505). */
  conflict?: string;
}

/**
 * Run one atomic business mutation and translate its failure into a
 * `ServiceError`. A rejected RPC leaves no partial state to clean up: the whole
 * transaction rolled back, including its audit row.
 */
export async function runAtomicRpc<T>(
  client: SupabaseClient,
  rpcName: string,
  args: Record<string, unknown> | undefined,
  messages: AtomicRpcMessages
): Promise<T> {
  const { data, error } = await client.rpc(rpcName, args ?? {});
  if (error) {
    // 42501 = insufficient_privilege, raised by the tenant/assignment/consent
    // guards inside the RPC.
    if (error.code === "42501") {
      throw new ServiceError("FORBIDDEN", messages.forbidden);
    }
    if (error.code === "22023" || error.code === "23514") {
      throw new ServiceError("VALIDATION_ERROR", messages.validation ?? messages.failure);
    }
    if (error.code === "23505") {
      throw new ServiceError("CONFLICT", messages.conflict ?? messages.failure);
    }
    throw new ServiceError("INTERNAL_ERROR", messages.failure);
  }
  return data as T;
}
