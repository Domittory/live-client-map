-- 0016: Theme + SignalThemeLink (ticket 24).

create table public.themes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  client_id uuid not null references public.clients (id) on delete cascade,
  name text not null,
  description text,
  domain text,
  activity_score integer check (activity_score between 0 and 100),
  confidence_score integer check (confidence_score between 0 and 100),
  evidence_count integer not null default 0,
  independent_evidence_count integer not null default 0,
  contexts_count integer not null default 0,
  trend text,
  status text not null default 'active' check (status in ('active', 'archived')),
  visibility text not null default 'internal' check (visibility in ('internal', 'sensitive', 'client_visible')),
  first_seen_at timestamptz,
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);

create table public.signal_theme_links (
  id uuid primary key default gen_random_uuid(),
  signal_id uuid not null references public.signals (id) on delete cascade,
  theme_id uuid not null references public.themes (id) on delete cascade,
  relevance_score integer check (relevance_score between 0 and 100),
  link_rationale text,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  unique (signal_id, theme_id)
);

create index themes_client_idx on public.themes (client_id);
create index signal_theme_links_theme_idx on public.signal_theme_links (theme_id);

alter table public.themes enable row level security;
alter table public.signal_theme_links enable row level security;

create policy "assigned read themes" on public.themes
  for select using (public.is_client_accessible(organization_id, client_id, false));
create policy "assigned insert themes" on public.themes
  for insert with check (public.is_client_accessible(organization_id, client_id, true));
create policy "assigned update themes" on public.themes
  for update using (public.is_client_accessible(organization_id, client_id, true));

create policy "assigned read links" on public.signal_theme_links
  for select using (exists (
    select 1 from public.themes t
    where t.id = theme_id and public.is_client_accessible(t.organization_id, t.client_id, false)
  ));
create policy "assigned insert links" on public.signal_theme_links
  for insert with check (exists (
    select 1 from public.themes t
    where t.id = theme_id and public.is_client_accessible(t.organization_id, t.client_id, true)
  ));
create policy "assigned delete links" on public.signal_theme_links
  for delete using (exists (
    select 1 from public.themes t
    where t.id = theme_id and public.is_client_accessible(t.organization_id, t.client_id, true)
  ));

grant select, insert, update on public.themes to authenticated;
grant select, insert, update, delete on public.themes to service_role;
grant select, insert, delete on public.signal_theme_links to authenticated;
grant select, insert, update, delete on public.signal_theme_links to service_role;
