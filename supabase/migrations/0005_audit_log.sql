-- 0005: AuditLog (ticket 14).
-- Append-only audit trail (SPEC §8.33): records actor, action, entity,
-- before/after and timestamp for significant platform and business mutations.
-- Distinct from ModelChange: it tracks who did what, not model evolution.

create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  actor_user_id uuid not null references auth.users (id),
  entity_type text not null,
  entity_id uuid,
  action text not null,
  before_data jsonb,
  after_data jsonb,
  reason text,
  ip_address text,
  user_agent text,
  created_at timestamptz not null default now()
);

create index audit_log_org_created_idx
  on public.audit_log (organization_id, created_at desc);

-- Single write path. security definer so audit inserts work even for tables
-- the caller cannot write directly; the caller must be an active org member,
-- and the recorded actor is always the real caller (never spoofed).
-- Payload redaction (secrets, tokens) happens in the service layer
-- (lib/service/audit.ts) before this function is invoked.
create or replace function public.append_audit(
  p_organization_id uuid,
  p_entity_type text,
  p_entity_id uuid,
  p_action text,
  p_before jsonb default null,
  p_after jsonb default null,
  p_reason text default null,
  p_ip_address text default null,
  p_user_agent text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_id uuid;
begin
  if v_actor is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if not public.is_org_member(p_organization_id) then
    raise exception 'not a member of this organization' using errcode = '42501';
  end if;

  insert into public.audit_log (
    organization_id, actor_user_id, entity_type, entity_id, action,
    before_data, after_data, reason, ip_address, user_agent
  )
  values (
    p_organization_id, v_actor, p_entity_type, p_entity_id, p_action,
    p_before, p_after, p_reason, p_ip_address, p_user_agent
  )
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.append_audit(uuid, text, uuid, text, jsonb, jsonb, text, text, text) from public;
grant execute on function public.append_audit(uuid, text, uuid, text, jsonb, jsonb, text, text, text) to authenticated;

-- Append-only: no one (not even service_role) updates or deletes audit rows.
create or replace function public.audit_log_immutable()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'audit_log is append-only' using errcode = '42501';
end;
$$;

create trigger audit_log_no_update
  before update or delete on public.audit_log
  for each row execute procedure public.audit_log_immutable();

-- Row level security: only the organization Owner reads the audit log
-- (SPEC: Owner audit viewer). Nobody inserts directly — only append_audit().
alter table public.audit_log enable row level security;

create policy "owner reads own organization audit log" on public.audit_log
  for select to authenticated
  using (
    exists (
      select 1 from public.organizations o
      where o.id = organization_id and o.owner_user_id = auth.uid()
    )
  );

-- Table privileges; RLS above still constrains which rows each role touches.
-- No insert/update/delete for authenticated: writes go through append_audit().
grant select on public.audit_log to authenticated;
grant select, insert on public.audit_log to service_role;
