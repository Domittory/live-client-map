-- 0002: Auth + Organization + membership (ticket 11).
-- Platform tables and tenant isolation. No client data yet.

-- Profile: one row per auth user.
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  display_name text,
  avatar_url text,
  locale text not null default 'ru',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Auto-create a profile when a new auth user signs up.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, coalesce(new.email, ''))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Organizations (tenant boundary).
create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  owner_user_id uuid not null references auth.users (id),
  plan text not null default 'free' check (plan in ('free', 'pro', 'enterprise')),
  settings jsonb not null default '{}'::jsonb,
  status text not null default 'active' check (status in ('active', 'suspended', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Organization membership.
create table public.organization_members (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'specialist' check (role in ('owner', 'specialist', 'supervisor')),
  status text not null default 'active' check (status in ('invited', 'active', 'suspended')),
  invited_by uuid references auth.users (id),
  invited_at timestamptz,
  joined_at timestamptz not null default now(),
  suspended_at timestamptz,
  created_at timestamptz not null default now(),
  unique (organization_id, user_id)
);

-- Helper: is the current user an active member of an organization?
create or replace function public.is_org_member(org_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.organization_members m
    where m.organization_id = org_id
      and m.user_id = auth.uid()
      and m.status = 'active'
  );
$$;

-- Atomically create an organization and its Owner membership (single transaction).
-- SPEC §44: security definer + set search_path = public.
create or replace function public.create_organization(org_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_org_id uuid;
  v_slug text;
  v_base_slug text;
begin
  if v_user_id is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  v_base_slug := lower(trim(org_name));
  v_base_slug := regexp_replace(v_base_slug, '[^a-z0-9а-яё]+', '-', 'g');
  v_base_slug := trim(v_base_slug, '-');
  if v_base_slug = '' then
    v_base_slug := 'org';
  end if;

  v_slug := v_base_slug;
  if exists (select 1 from public.organizations where slug = v_slug) then
    v_slug := v_base_slug || '-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 6);
  end if;

  insert into public.organizations (name, slug, owner_user_id)
  values (org_name, v_slug, v_user_id)
  returning id into v_org_id;

  insert into public.organization_members (organization_id, user_id, role, status, joined_at)
  values (v_org_id, v_user_id, 'owner', 'active', now());

  return v_org_id;
end;
$$;

revoke all on function public.create_organization(text) from public;
grant execute on function public.create_organization(text) to authenticated;

-- Row level security: tenant isolation.
alter table public.profiles enable row level security;
alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;

create policy "profile is owner-only" on public.profiles
  for all using (id = auth.uid()) with check (id = auth.uid());

create policy "members can read their organization" on public.organizations
  for select using (public.is_org_member(id));

create policy "owner can update their organization" on public.organizations
  for update using (public.is_org_member(id) and owner_user_id = auth.uid());

create policy "members can read their own membership" on public.organization_members
  for select using (public.is_org_member(organization_id));

-- API roles need explicit table privileges; RLS governs which rows each role sees.
grant usage on schema public to anon, authenticated, service_role;

grant select on public.organizations to anon, authenticated;
grant update on public.organizations to authenticated;

grant select on public.organization_members to anon, authenticated;

grant select, insert, update on public.profiles to authenticated;

-- Future tables/functions created by the migration owner inherit these grants.
alter default privileges in schema public grant select on tables to anon, authenticated;
alter default privileges in schema public grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema public grant execute on functions to anon, authenticated;
alter default privileges in schema public grant usage, select on sequences to authenticated;
