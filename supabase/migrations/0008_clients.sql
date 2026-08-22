-- 0008: Client directory and profile (ticket 17).

create table public.clients (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  owner_user_id uuid not null references auth.users (id),
  first_name text,
  last_name text,
  display_name text,
  birth_date date,
  birth_time time,
  birth_place text,
  gender text,
  relationship_status text,
  occupation text,
  "current_role" text,
  children_info text,
  specialist_notes_private text,
  client_visible_notes text,
  status text not null default 'active' check (status in ('active', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);

create index clients_org_idx on public.clients (organization_id, status);

-- Complete the forward references left by tickets 12 and 13.
alter table public.client_assignments
  add constraint client_assignments_client_id_fkey
  foreign key (client_id) references public.clients (id) on delete cascade;

alter table public.consent_records
  add constraint consent_records_client_id_fkey
  foreign key (client_id) references public.clients (id) on delete cascade;

-- Atomically create a client and its primary_specialist assignment.
create or replace function public.create_client(
  p_organization_id uuid,
  p_display_name text,
  p_first_name text default null,
  p_last_name text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_client_id uuid;
begin
  if v_user_id is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if not public.is_org_member(p_organization_id) then
    raise exception 'not a member of this organization' using errcode = '42501';
  end if;

  insert into public.clients (organization_id, owner_user_id, display_name, first_name, last_name)
  values (p_organization_id, v_user_id, p_display_name, p_first_name, p_last_name)
  returning id into v_client_id;

  insert into public.client_assignments (client_id, user_id, access_role)
  values (v_client_id, v_user_id, 'primary_specialist');

  return v_client_id;
end;
$$;

-- RLS: read/write require assignment; create via RPC; archive via UPDATE.
alter table public.clients enable row level security;

create policy "assigned read client" on public.clients
  for select using (public.is_client_accessible(organization_id, id, false));

create policy "assigned update client" on public.clients
  for update using (public.is_client_accessible(organization_id, id, true));

-- Privileges.
grant select, update on public.clients to authenticated;
grant select, insert, update, delete on public.clients to service_role;
grant execute on function public.create_client(uuid, text, text, text) to authenticated, service_role;
