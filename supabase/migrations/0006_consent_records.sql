-- 0006: ConsentRecord + consent gates (ticket 13).

-- `organization_id` provides the tenant boundary (ticket 03); `client_id` is a
-- forward reference resolved by the `clients` table in ticket 17.

create table public.consent_records (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  client_id uuid not null,
  consent_type text not null check (consent_type in (
    'data_storage',
    'ai_analysis',
    'sensitive_psychological_data',
    'health_related_data',
    'supervisor_access',
    'client_portal',
    'anonymized_analytics',
    'relationship_analysis'
  )),
  scope text not null default '',
  document_version text not null,
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create index consent_records_lookup_idx
  on public.consent_records (client_id, consent_type, created_at desc);

-- Guard: is the latest consent record for (client, type) active (granted, not revoked)?
create or replace function public.has_consent(p_client_id uuid, p_consent_type text)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(
    (
      select (revoked_at is null)
      from public.consent_records
      where client_id = p_client_id and consent_type = p_consent_type
      order by created_at desc, id desc
      limit 1
    ),
    false
  );
$$;

-- Grant consent (appends a new versioned record; history is preserved).
create or replace function public.grant_consent(
  p_org_id uuid,
  p_client_id uuid,
  p_consent_type text,
  p_scope text,
  p_document_version text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if not public.is_client_accessible(p_org_id, p_client_id, true) then
    raise exception 'no write access to this client' using errcode = '42501';
  end if;

  insert into public.consent_records
    (organization_id, client_id, consent_type, scope, document_version, granted_at)
  values (p_org_id, p_client_id, p_consent_type, p_scope, p_document_version, now())
  returning id into v_id;

  return v_id;
end;
$$;

-- Revoke consent (marks the latest active record as revoked).
create or replace function public.revoke_consent(
  p_org_id uuid,
  p_client_id uuid,
  p_consent_type text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_client_accessible(p_org_id, p_client_id, true) then
    raise exception 'no write access to this client' using errcode = '42501';
  end if;

  update public.consent_records
  set revoked_at = now()
  where id = (
    select id from public.consent_records
    where client_id = p_client_id and consent_type = p_consent_type and revoked_at is null
    order by created_at desc, id desc
    limit 1
  );
end;
$$;

-- RLS: members of the organization can read its consent records.
alter table public.consent_records enable row level security;

create policy "org members read consent" on public.consent_records
  for select using (public.is_org_member(organization_id));

-- Privileges.
grant select on public.consent_records to authenticated;
grant select, insert, update, delete on public.consent_records to service_role;
grant execute on function public.has_consent(uuid, text) to authenticated, service_role;
grant execute on function public.grant_consent(uuid, uuid, text, text, text) to authenticated, service_role;
grant execute on function public.revoke_consent(uuid, uuid, text) to authenticated, service_role;
