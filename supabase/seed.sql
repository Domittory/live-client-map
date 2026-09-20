-- Seed data (ticket 10): intentionally empty — infrastructure only.
--
-- ---------------------------------------------------------------------------
-- Local-only fault injection for atomicity tests (ticket 01).
--
-- This file runs on `supabase start` and `supabase db reset` and is NEVER
-- applied by `supabase db push`, so none of the objects below exist in a
-- deployed environment. The schema is deliberately not exposed through
-- PostgREST: integration tests reach it with a direct Postgres connection, which
-- keeps local test support out of the API surface and out of generated types.
--
-- A test registers a fault by inserting a marker row for a table name; a
-- BEFORE INSERT trigger on that table then raises and the surrounding RPC
-- transaction must roll back completely.
-- ---------------------------------------------------------------------------

create schema if not exists test_support;

create table test_support.faults (
  id uuid primary key default gen_random_uuid(),
  -- Identifies the test connection that registered the fault, so clearing one
  -- suite's faults can never wipe a fault another parallel suite is using.
  owner text not null,
  point text not null,
  marker text not null,
  created_at timestamptz not null default now()
);

-- Raises when the written row relates to a registered fault marker. Matching is
-- a whole-row text search, so one helper works for every table: a fault on
-- client_assignments can match its user_id, a fault on audit_log can match a
-- display_name inside after_data. Markers are unique values, so a fault window
-- can never affect another test running in parallel.
create or replace function test_support.inject_fault()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row text;
begin
  v_row := to_jsonb(coalesce(new, old))::text;

  if exists (
    select 1
    from test_support.faults f
    where f.point = tg_table_name
      and position(f.marker in v_row) > 0
  ) then
    raise exception 'injected fault on % (%)', tg_table_name, tg_op
      using errcode = 'P0001';
  end if;

  return coalesce(new, old);
end;
$$;

-- Fault injection is attached to every table an atomic mutation writes to, so a
-- test can force a failure at the intermediate write (the domain row) and at the
-- final audit append. BEFORE INSERT OR UPDATE OR DELETE keeps the fault visible
-- for create, update and hard-delete paths — the erasure transaction needs the
-- DELETE coverage on `clients` and `ai_runs` to prove that a failure at the
-- irreversible stage rolls the anonymized audit back too.
do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'clients',
    'client_assignments',
    'consent_records',
    'organizations',
    'organization_members',
    'organization_invitations',
    'diagnostic_sessions',
    'signals',
    'evidence_clusters',
    'imports',
    'client_feedback_forms',
    -- Ticket 06: psychological model tables.
    'themes',
    'signal_theme_links',
    'core_nodes',
    'theme_core_node_links',
    'differential_hypotheses',
    'core_node_relations',
    'resources',
    'development_targets',
    'purpose_profiles',
    'purpose_syntheses',
    'recommendations',
    'recommendation_targets',
    'diagnostic_domains',
    'belief_templates',
    'intervention_methods',
    'model_changes',
    'psychological_snapshots',
    'model_explanations',
    -- Ticket 07: corrections, observations, follow-ups and reactivation.
    'corrections',
    'correction_targets',
    'correction_expected_markers',
    'observations',
    'behavioral_markers',
    'behavioral_marker_entries',
    'follow_ups',
    -- core_nodes is already covered by ticket 06 and is updated by the
    -- reactivation decision.
    'core_node_reactivations',
    'audit_log',
    -- Ticket 08: privileged and erasure flows. `erasure_requests` and
    -- `ai_runs` (deleted by the erasure purge) plus the access/safety controls.
    'erasure_requests',
    'ai_runs',
    'safety_reviews',
    'client_portal_users'
  ]
  loop
    execute format(
      'create trigger test_fault_%1$s before insert or update or delete on public.%1$I
         for each row execute procedure test_support.inject_fault()',
      v_table
    );
  end loop;
end;
$$;
