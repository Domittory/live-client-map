import { Client as PgClient } from "pg";

/** Supabase local default; overridden by SUPABASE_DB_URL when set. */
export const DEFAULT_DB_URL = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

/**
 * Local-only fault injection (ticket 01) used by atomicity tests.
 *
 * `supabase/seed.sql` creates the `test_support` schema with a `faults` table and
 * attaches a BEFORE INSERT OR UPDATE trigger to every table atomic mutations
 * write to. Registering a `(point, marker)` row makes the next write to that
 * table fail when the written row contains `marker`, which aborts the whole RPC
 * transaction.
 *
 * Two properties keep this safe while integration files run in parallel:
 *   * every fault row carries the id of the connection that registered it, so
 *     `clear()` only removes its own rows;
 *   * markers are unique values, so a fault can only ever match the row it was
 *     created for — a leftover row is inert, never a cross-test failure.
 *
 * The schema is not exposed through PostgREST, hence the direct connection. When
 * it is missing (no local seed), `available` is false and fault cases skip.
 */
export interface FaultInjection {
  available: boolean;
  /** Fail the next write to `point` whose row contains `marker`. */
  register(point: string, marker: string): Promise<void>;
  /** Remove the faults registered by this helper instance. */
  clear(): Promise<void>;
  close(): Promise<void>;
}

export async function connectFaultInjection(
  dbUrl = process.env.SUPABASE_DB_URL ?? DEFAULT_DB_URL
): Promise<FaultInjection> {
  const owner = crypto.randomUUID();
  let pg: PgClient | null = null;
  let available = false;

  try {
    pg = new PgClient({ connectionString: dbUrl });
    await pg.connect();
    await pg.query("select 1 from test_support.faults limit 1");
    available = true;
  } catch {
    available = false;
    await pg?.end().catch(() => undefined);
    pg = null;
  }

  return {
    available,
    async register(point, marker) {
      await pg!.query(
        "insert into test_support.faults (owner, point, marker) values ($1, $2, $3)",
        [owner, point, marker]
      );
    },
    async clear() {
      await pg?.query("delete from test_support.faults where owner = $1", [owner]);
    },
    async close() {
      await pg?.end().catch(() => undefined);
    },
  };
}
