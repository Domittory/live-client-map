#!/usr/bin/env node
/**
 * RPC privilege + search_path gate (ticket 21, extending the ticket 60 audit).
 *
 * Every SECURITY DEFINER function in `public` runs with the migration owner's
 * privileges, so an over-broad EXECUTE grant is a privilege-escalation hole and
 * a missing `search_path` is a hijackable one. This gate re-checks four rules
 * against a live local database:
 *
 *   1. no function is granted to `anon` unless it is on the documented
 *      anonymous allowlist below;
 *   2. every SECURITY DEFINER function pins `search_path`;
 *   3. functions recognised as internal helpers are not granted to
 *      `authenticated` (a client role must never call a guard directly);
 *   4. the ticket-21 RPCs exist and are reachable by `authenticated`, so a
 *      migration that forgot to grant EXECUTE fails here instead of at runtime.
 *
 * The connection target comes from `SUPABASE_DB_URL` when set and otherwise
 * from `supabase/config.toml`, so the gate works in CI without extra secrets.
 * When the database is unreachable the gate EXITS 2 (could not run) — never 0,
 * so a CI job cannot silently skip it. Local runs can opt out with
 * `RPC_PERMISSION_CHECK=skip`.
 *
 * Exit codes: 0 = gate passed, 1 = blocking finding, 2 = the gate could not run.
 */
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { Client } from "pg";

/**
 * Functions `anon` may execute.
 *
 * `is_org_member`, `is_org_owner` and `is_client_accessible` are evaluated by
 * RLS policies that deliberately omit `to authenticated`, so an anonymous query
 * must be able to call them; each returns false when `auth.uid()` is null.
 * `health_check` is the unauthenticated liveness probe. The remaining three are
 * trigger functions: they raise when invoked directly and exist only for
 * trigger dispatch, so exposing EXECUTE is inert.
 */
const ANON_ALLOWED = new Set([
  "is_org_member",
  "is_org_owner",
  "is_client_accessible",
  "health_check",
  "handle_new_user",
  "block_mutation",
  "audit_log_immutable",
  "protect_org_owner_membership",
]);

/**
 * Prefixes/names of functions that must never be granted to `authenticated`.
 * `append_audit` is deliberately NOT in this list: it is the single audit write
 * path the service layer legitimately calls, and it pins the actor to
 * `auth.uid()` internally.
 */
const INTERNAL_PREFIXES = [
  "assert_",
  "require_",
  "insert_",
  "record_export_",
  "export_audience_allowed",
  "export_contract_version",
  "export_format_for_kind",
  "export_relationship_consent_withdrawn",
  "opaque_",
  "portal_client_id",
  "jsonb_",
  "recompute_theme_aggregates_internal",
  "validate_explanation_grounding",
  "erasure_impact_tables",
  "relationship_visible_evidence_refs",
  "request_status_transition_allowed",
  "goal_status_transition_allowed",
];

/** The RPCs ticket 21 introduced: they must exist and be callable. */
const TICKET_21_RPCS = [
  "create_life_event",
  "create_trigger",
  "create_relationship",
  "create_relationship_dynamic",
  "create_client_request",
  "change_request_status",
  "create_client_goal",
  "change_goal_status",
];

function fail(message) {
  console.error(`rpc permission gate: ${message}`);
  process.exit(2);
}

function databaseUrl() {
  if (process.env.SUPABASE_DB_URL) return process.env.SUPABASE_DB_URL;
  try {
    const config = readFileSync("supabase/config.toml", "utf8");
    const match = config.match(/^\[db\][\s\S]*?^port\s*=\s*(\d+)/m);
    const port = match ? match[1] : "54322";
    return `postgresql://postgres:postgres@127.0.0.1:${port}/postgres`;
  } catch {
    return "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
  }
}

/** ACL string (`{role=priv,...}` or null for the default PUBLIC grant). */
function grantees(acl) {
  if (acl == null) return ["PUBLIC"];
  const text = Array.isArray(acl) ? acl.join(",") : String(acl);
  return text
    .replace(/^\{|\}$/g, "")
    .split(",")
    .map((entry) => entry.split("=")[0] || "PUBLIC")
    .filter(Boolean);
}

function isInternal(name) {
  return INTERNAL_PREFIXES.some((prefix) =>
    prefix.endsWith("_") ? name.startsWith(prefix) : name === prefix
  );
}

/**
 * Run the four rules against a live database and return the findings. Exported
 * so the vitest integration suite exercises the same code the CI gate runs.
 */
export async function collectFindings(connectionString = databaseUrl()) {
  const client = new Client({ connectionString });
  await client.connect();

  let rows;
  try {
    const result = await client.query(
      `select p.proname,
              p.prosecdef,
              p.proconfig::text as config,
              p.proacl::text as acl
         from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
        order by p.proname`
    );
    rows = result.rows;
  } finally {
    await client.end().catch(() => undefined);
  }

  const findings = [];
  const names = new Set(rows.map((row) => row.proname));

  for (const row of rows) {
    const grants = grantees(row.acl);

    if (grants.includes("anon") && !ANON_ALLOWED.has(row.proname)) {
      findings.push(`anon may execute ${row.proname}() — not on the anonymous allowlist`);
    }

    if (row.prosecdef && !(row.config ?? "").includes("search_path")) {
      findings.push(`security definer function ${row.proname}() does not set search_path`);
    }

    if (grants.includes("authenticated") && isInternal(row.proname)) {
      findings.push(
        `internal helper ${row.proname}() is granted to authenticated — internal helpers must be revoked from every client role`
      );
    }
  }

  for (const rpc of TICKET_21_RPCS) {
    if (!names.has(rpc)) {
      findings.push(`ticket-21 RPC ${rpc}() is missing from the database`);
      continue;
    }
    const row = rows.find((candidate) => candidate.proname === rpc);
    if (!grantees(row.acl).includes("authenticated")) {
      findings.push(`ticket-21 RPC ${rpc}() is not executable by authenticated`);
    }
  }

  return { findings, functionCount: rows.length };
}

async function main() {
  if (process.env.RPC_PERMISSION_CHECK === "skip") {
    console.log("rpc permission gate: skipped by RPC_PERMISSION_CHECK=skip");
    return;
  }

  let outcome;
  try {
    outcome = await collectFindings();
  } catch (error) {
    fail(
      `cannot reach the local database (${error.message}). Run \`supabase start\` first, ` +
        "or set RPC_PERMISSION_CHECK=skip to skip locally (never in CI)."
    );
  }

  const { findings, functionCount } = outcome;

  if (findings.length > 0) {
    console.error(`rpc permission gate: ${findings.length} finding(s)`);
    for (const finding of findings) console.error(`  ${finding}`);
    process.exit(1);
  }

  console.log(
    `rpc permission gate: ${functionCount} public function(s) checked ` +
      `(${ANON_ALLOWED.size} anonymous exceptions, ${TICKET_21_RPCS.length} ticket-21 RPCs), 0 findings`
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => fail(error.stack ?? String(error)));
}
