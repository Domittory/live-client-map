-- 0022: PurposeProfile + PurposeSynthesis (ticket 31).

create table public.purpose_profiles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  client_id uuid not null references public.clients (id) on delete cascade,
  source_system text not null check (source_system in ('jyotish', 'human_design', 'specialist_assessment', 'client_self_report', 'other')),
  raw_data jsonb not null default '{}'::jsonb,
  interpretation text,
  strengths text[] not null default '{}',
  potential_roles text[] not null default '{}',
  development_directions text[] not null default '{}',
  confidence integer check (confidence between 0 and 100),
  visibility text not null default 'internal' check (visibility in ('internal', 'sensitive', 'client_visible')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.purpose_syntheses (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  client_id uuid not null references public.clients (id) on delete cascade,
  summary text,
  cross_system_matches text[] not null default '{}',
  potential_conflicts text[] not null default '{}',
  recommended_development_vectors text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index purpose_profiles_client_idx on public.purpose_profiles (client_id);
create index purpose_syntheses_client_idx on public.purpose_syntheses (client_id);

alter table public.purpose_profiles enable row level security;
alter table public.purpose_syntheses enable row level security;

create policy "assigned read purpose profiles" on public.purpose_profiles
  for select using (public.is_client_accessible(organization_id, client_id, false));
create policy "assigned insert purpose profiles" on public.purpose_profiles
  for insert with check (public.is_client_accessible(organization_id, client_id, true));
create policy "assigned update purpose profiles" on public.purpose_profiles
  for update using (public.is_client_accessible(organization_id, client_id, true));

create policy "assigned read syntheses" on public.purpose_syntheses
  for select using (public.is_client_accessible(organization_id, client_id, false));
create policy "assigned insert syntheses" on public.purpose_syntheses
  for insert with check (public.is_client_accessible(organization_id, client_id, true));
create policy "assigned update syntheses" on public.purpose_syntheses
  for update using (public.is_client_accessible(organization_id, client_id, true));

grant select, insert, update on public.purpose_profiles to authenticated;
grant select, insert, update, delete on public.purpose_profiles to service_role;
grant select, insert, update on public.purpose_syntheses to authenticated;
grant select, insert, update, delete on public.purpose_syntheses to service_role;
