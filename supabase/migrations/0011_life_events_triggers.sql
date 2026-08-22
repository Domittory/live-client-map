-- 0011: LifeEvent + Trigger (ticket 19). LifeEvent != Trigger.

create table public.life_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  client_id uuid not null references public.clients (id) on delete cascade,
  date date,
  title text not null,
  description text,
  event_type text,
  significance text,
  source_type text,
  visibility text not null default 'internal' check (visibility in ('internal', 'sensitive', 'client_visible')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.triggers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  client_id uuid not null references public.clients (id) on delete cascade,
  life_event_id uuid references public.life_events (id) on delete set null,
  title text not null,
  description text,
  life_areas text[] not null default '{}',
  intensity integer check (intensity between 0 and 100),
  occurred_at timestamptz,
  source_type text,
  visibility text not null default 'internal' check (visibility in ('internal', 'sensitive', 'client_visible')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index life_events_client_idx on public.life_events (client_id);
create index triggers_client_idx on public.triggers (client_id);

alter table public.life_events enable row level security;
alter table public.triggers enable row level security;

create policy "assigned read life_events" on public.life_events
  for select using (public.is_client_accessible(organization_id, client_id, false));
create policy "assigned insert life_events" on public.life_events
  for insert with check (public.is_client_accessible(organization_id, client_id, true));
create policy "assigned update life_events" on public.life_events
  for update using (public.is_client_accessible(organization_id, client_id, true));

create policy "assigned read triggers" on public.triggers
  for select using (public.is_client_accessible(organization_id, client_id, false));
create policy "assigned insert triggers" on public.triggers
  for insert with check (public.is_client_accessible(organization_id, client_id, true));
create policy "assigned update triggers" on public.triggers
  for update using (public.is_client_accessible(organization_id, client_id, true));

grant select, insert, update on public.life_events to authenticated;
grant select, insert, update, delete on public.life_events to service_role;
grant select, insert, update on public.triggers to authenticated;
grant select, insert, update, delete on public.triggers to service_role;
