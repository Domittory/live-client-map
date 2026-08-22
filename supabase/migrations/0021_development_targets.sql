-- 0021: DevelopmentTarget (ticket 30).

create table public.development_targets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  client_id uuid not null references public.clients (id) on delete cascade,
  name text not null,
  description text,
  domain text,
  current_level integer check (current_level between 0 and 100),
  target_level integer check (target_level between 0 and 100),
  importance text not null default 'normal' check (importance in ('low', 'normal', 'high')),
  status text not null default 'active' check (status in ('active', 'achieved', 'archived')),
  linked_resources uuid[] not null default '{}',
  linked_core_nodes uuid[] not null default '{}',
  success_markers text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index development_targets_client_idx on public.development_targets (client_id);

alter table public.development_targets enable row level security;

create policy "assigned read targets" on public.development_targets
  for select using (public.is_client_accessible(organization_id, client_id, false));
create policy "assigned insert targets" on public.development_targets
  for insert with check (public.is_client_accessible(organization_id, client_id, true));
create policy "assigned update targets" on public.development_targets
  for update using (public.is_client_accessible(organization_id, client_id, true));

grant select, insert, update on public.development_targets to authenticated;
grant select, insert, update, delete on public.development_targets to service_role;
