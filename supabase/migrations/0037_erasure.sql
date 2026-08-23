-- 0037: Consent revocation and full data erasure (ticket 58).
--
-- Implements the ticket 05 policy (152-ФЗ): the Owner can revoke `data_storage`
-- and/or run a full hard delete of a client. Hard delete cascades from the
-- `clients` row (every client-scoped table already has `on delete cascade`);
-- the audit log is anonymized, not deleted; `legal_hold` defers erasure.
--
-- Two append-only guards must be opened for the erasure path only:
--   * audit_log_immutable() blocks UPDATE/DELETE on audit_log
--   * block_mutation()     blocks UPDATE/DELETE on ai_runs
-- Both are redefined to honour a transaction-local flag `app.data_erasure`
-- that only the SECURITY DEFINER erasure functions below set, so the tables
-- stay append-only for every other caller.

alter table public.clients
  add column legal_hold boolean not null default false;

-- `legal_hold` is an Owner-only control. The generic "assigned update client"
-- policy would let any specialist with write access flip it, so revoke that
-- column privilege from authenticated entirely; setLegalHold() writes it
-- through service_role after an is_org_owner check.
revoke update (legal_hold) on public.clients from authenticated;

-- One erasure request per client ever (idempotent state machine). client_id is
-- set null when the client is hard-deleted; client_ref is the durable handle.
create table public.erasure_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  client_id uuid references public.clients (id) on delete set null,
  client_ref text not null,
  status text not null default 'requested'
    check (status in ('requested', 'in_progress', 'completed', 'blocked', 'failed')),
  requested_by uuid not null references auth.users (id),
  requested_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  failed_at timestamptz,
  blocked_reason text,
  impacted_counts jsonb not null default '{}'::jsonb,
  backup_marker jsonb,
  created_at timestamptz not null default now(),
  unique (organization_id, client_ref)
);

create index erasure_requests_org_idx
  on public.erasure_requests (organization_id, created_at desc);

alter table public.erasure_requests enable row level security;

create policy "owner reads erasure requests" on public.erasure_requests
  for select to authenticated
  using (public.is_org_owner(organization_id));

grant select on public.erasure_requests to authenticated;
grant select, insert, update, delete on public.erasure_requests to service_role;

-- ---------------------------------------------------------------------------
-- audit_log: allow UPDATE only inside the erasure RPC.
-- ---------------------------------------------------------------------------
create or replace function public.audit_log_immutable()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'audit_log is append-only' using errcode = '42501';
  end if;

  if current_setting('app.data_erasure', true) = 'on' then
    return new;
  end if;

  raise exception 'audit_log is append-only' using errcode = '42501';
end;
$$;

-- Anonymize the audit trail for one client: strip the entity reference and any
-- personal payload, keep the fact of the action (action/created_at/actor).
-- Scoped by entity_id only (the client id plus its child-entity ids collected
-- before deletion); never an unqualified entity_type match, which would sweep
-- other clients' rows in the same organization.
create or replace function public.anonymize_client_audit(
  p_client_id uuid,
  p_entity_ids uuid[] default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated integer;
begin
  perform set_config('app.data_erasure', 'on', true);

  update public.audit_log
  set entity_id = null,
      before_data = '{"erased":true}'::jsonb,
      after_data  = '{"erased":true}'::jsonb,
      reason      = '[erased]',
      ip_address  = null,
      user_agent  = null
  where entity_id = p_client_id
     or entity_id = any(coalesce(p_entity_ids, '{}'::uuid[]));

  get diagnostics v_updated = row_count;
  return v_updated;
end;
$$;

revoke all on function public.anonymize_client_audit(uuid, uuid[]) from public;
grant execute on function public.anonymize_client_audit(uuid, uuid[]) to service_role;

-- ---------------------------------------------------------------------------
-- ai_runs: allow DELETE only inside the erasure RPC. ai_runs is client-scoped
-- telemetry with `on delete cascade`, so a naive client delete would cascade
-- into it and the append-only trigger would abort the whole erasure.
-- ---------------------------------------------------------------------------
create or replace function public.block_mutation()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_setting('app.data_erasure', true) = 'on' then
    return coalesce(new, old);
  end if;

  raise exception 'this table is append-only' using errcode = '42501';
end;
$$;

create or replace function public.purge_client_ai_runs(p_client_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n integer;
begin
  perform set_config('app.data_erasure', 'on', true);

  delete from public.ai_runs where client_id = p_client_id;

  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

revoke all on function public.purge_client_ai_runs(uuid) from public;
grant execute on function public.purge_client_ai_runs(uuid) to service_role;
