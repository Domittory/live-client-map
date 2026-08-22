-- 0004: ClientAssignment + reusable per-client access check (ticket 12).

-- `client_id` is a forward reference: the `clients` table (ticket 17) adds the
-- foreign key and the client-table RLS policies. Assignment carries no tenant
-- id itself; organization scoping flows through the client.

create table public.client_assignments (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  access_role text not null default 'read_only'
    check (access_role in ('primary_specialist', 'secondary_specialist', 'supervisor', 'read_only')),
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  unique (client_id, user_id)
);

-- Reusable authorization check (SPEC §6): organization membership AND an active
-- assignment with the required access level. The org Owner bypasses assignment.
create or replace function public.is_client_accessible(
  p_org_id uuid,
  p_client_id uuid,
  p_require_write boolean default false
)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select
    exists (
      select 1 from public.organizations o
      where o.id = p_org_id and o.owner_user_id = auth.uid()
    )
    or (
      public.is_org_member(p_org_id)
      and exists (
        select 1 from public.client_assignments a
        where a.client_id = p_client_id
          and a.user_id = auth.uid()
          and a.revoked_at is null
          and (
            not p_require_write
            or a.access_role in ('primary_specialist', 'secondary_specialist')
          )
      )
    );
$$;

-- Owner-managed grant/revoke (owner exception, SPEC §43). p_org_id is supplied
-- by the caller (the access UI knows the current organization).
create or replace function public.grant_client_assignment(
  p_org_id uuid,
  p_client_id uuid,
  p_user_id uuid,
  p_access_role text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.organizations where id = p_org_id and owner_user_id = auth.uid()
  ) then
    raise exception 'only the organization owner can manage assignments' using errcode = '42501';
  end if;

  insert into public.client_assignments (client_id, user_id, access_role)
  values (p_client_id, p_user_id, p_access_role)
  on conflict (client_id, user_id) do update
    set access_role = excluded.access_role, revoked_at = null;
end;
$$;

create or replace function public.revoke_client_assignment(
  p_org_id uuid,
  p_client_id uuid,
  p_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.organizations where id = p_org_id and owner_user_id = auth.uid()
  ) then
    raise exception 'only the organization owner can manage assignments' using errcode = '42501';
  end if;

  update public.client_assignments
  set revoked_at = now()
  where client_id = p_client_id and user_id = p_user_id and revoked_at is null;
end;
$$;

-- RLS: a user can read their own assignments.
alter table public.client_assignments enable row level security;

create policy "read own assignments" on public.client_assignments
  for select using (user_id = auth.uid());

-- Privileges.
grant select on public.client_assignments to anon, authenticated;
grant select, insert, update, delete on public.client_assignments to service_role;
grant select, insert, update, delete on public.organization_members to service_role;
grant select, insert, update, delete on public.organizations to service_role;
grant execute on function public.is_client_accessible(uuid, uuid, boolean) to anon, authenticated, service_role;
grant execute on function public.grant_client_assignment(uuid, uuid, uuid, text) to authenticated, service_role;
grant execute on function public.revoke_client_assignment(uuid, uuid, uuid) to authenticated, service_role;
