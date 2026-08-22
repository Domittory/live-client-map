-- 0017: CoreNode + ThemeCoreNodeLink (ticket 25).

create table public.core_nodes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  client_id uuid not null references public.clients (id) on delete cascade,
  title text not null,
  hypothesis text,
  root_domain text,
  strength_score integer check (strength_score between 0 and 100),
  confidence_score integer check (confidence_score between 0 and 100),
  impact_score integer check (impact_score between 0 and 100),
  activation_score integer check (activation_score between 0 and 100),
  rootness_score integer check (rootness_score between 0 and 100),
  client_relevance_score integer check (client_relevance_score between 0 and 100),
  readiness_score integer check (readiness_score between 0 and 100),
  unlock_score integer check (unlock_score between 0 and 100),
  risk_score integer check (risk_score between 0 and 100),
  evidence_count integer not null default 0,
  independent_evidence_count integer not null default 0,
  contexts_count integer not null default 0,
  status text not null default 'hypothesis' check (status in (
    'hypothesis', 'active', 'in_treatment', 'treated_unverified', 'weakened',
    'integrated', 'reactivated', 'contradicted', 'under_review', 'rejected', 'archived'
  )),
  trend text,
  visibility text not null default 'internal' check (visibility in ('internal', 'sensitive', 'client_visible')),
  created_by uuid references auth.users (id),
  last_confirmed_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_confirmed_at timestamptz,
  archived_at timestamptz
);

create table public.theme_core_node_links (
  id uuid primary key default gen_random_uuid(),
  theme_id uuid not null references public.themes (id) on delete cascade,
  core_node_id uuid not null references public.core_nodes (id) on delete cascade,
  relationship_type text not null,
  confidence integer check (confidence between 0 and 100),
  link_rationale text,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  unique (theme_id, core_node_id)
);

create index core_nodes_client_idx on public.core_nodes (client_id);
create index theme_core_node_links_node_idx on public.theme_core_node_links (core_node_id);

alter table public.core_nodes enable row level security;
alter table public.theme_core_node_links enable row level security;

create policy "assigned read core_nodes" on public.core_nodes
  for select using (public.is_client_accessible(organization_id, client_id, false));
create policy "assigned insert core_nodes" on public.core_nodes
  for insert with check (public.is_client_accessible(organization_id, client_id, true));
create policy "assigned update core_nodes" on public.core_nodes
  for update using (public.is_client_accessible(organization_id, client_id, true));

create policy "assigned read theme links" on public.theme_core_node_links
  for select using (exists (
    select 1 from public.core_nodes c
    where c.id = core_node_id and public.is_client_accessible(c.organization_id, c.client_id, false)
  ));
create policy "assigned insert theme links" on public.theme_core_node_links
  for insert with check (exists (
    select 1 from public.core_nodes c
    where c.id = core_node_id and public.is_client_accessible(c.organization_id, c.client_id, true)
  ));
create policy "assigned delete theme links" on public.theme_core_node_links
  for delete using (exists (
    select 1 from public.core_nodes c
    where c.id = core_node_id and public.is_client_accessible(c.organization_id, c.client_id, true)
  ));

grant select, insert, update on public.core_nodes to authenticated;
grant select, insert, update, delete on public.core_nodes to service_role;
grant select, insert, delete on public.theme_core_node_links to authenticated;
grant select, insert, update, delete on public.theme_core_node_links to service_role;
