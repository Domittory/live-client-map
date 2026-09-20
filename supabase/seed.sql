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

create trigger test_fault_client_assignments
  before insert on public.client_assignments
  for each row execute procedure test_support.inject_fault();

create trigger test_fault_audit_log
  before insert on public.audit_log
  for each row execute procedure test_support.inject_fault();
