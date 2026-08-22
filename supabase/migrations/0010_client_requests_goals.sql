-- 0009: ClientRequest + ClientGoal (ticket 18).

create table public.client_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  client_id uuid not null references public.clients (id) on delete cascade,
  title text not null,
  description text,
  life_areas text[] not null default '{}',
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high', 'urgent')),
  status text not null default 'active' check (status in ('active', 'paused', 'completed', 'abandoned')),
  started_at timestamptz,
  completed_at timestamptz,
  success_criteria text,
  current_progress text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.client_goals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  client_id uuid not null references public.clients (id) on delete cascade,
  title text not null,
  description text,
  importance text not null default 'normal' check (importance in ('low', 'normal', 'high')),
  target_state text,
  status text not null default 'active' check (status in ('active', 'completed', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index client_requests_client_idx on public.client_requests (client_id);
create index client_goals_client_idx on public.client_goals (client_id);

-- RLS: read/write require per-client assignment (ticket 12).
alter table public.client_requests enable row level security;
alter table public.client_goals enable row level security;

create policy "assigned read requests" on public.client_requests
  for select using (public.is_client_accessible(organization_id, client_id, false));
create policy "assigned insert requests" on public.client_requests
  for insert with check (public.is_client_accessible(organization_id, client_id, true));
create policy "assigned update requests" on public.client_requests
  for update using (public.is_client_accessible(organization_id, client_id, true));

create policy "assigned read goals" on public.client_goals
  for select using (public.is_client_accessible(organization_id, client_id, false));
create policy "assigned insert goals" on public.client_goals
  for insert with check (public.is_client_accessible(organization_id, client_id, true));
create policy "assigned update goals" on public.client_goals
  for update using (public.is_client_accessible(organization_id, client_id, true));

-- Privileges.
grant select, insert, update on public.client_requests to authenticated;
grant select, insert, update, delete on public.client_requests to service_role;
grant select, insert, update on public.client_goals to authenticated;
grant select, insert, update, delete on public.client_goals to service_role;
