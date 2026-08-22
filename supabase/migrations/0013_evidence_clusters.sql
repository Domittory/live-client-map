-- 0013: EvidenceCluster + context engine (ticket 22).

create table public.evidence_clusters (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  client_id uuid not null references public.clients (id) on delete cascade,
  diagnostic_session_id uuid references public.diagnostic_sessions (id) on delete set null,
  semantic_topic text not null,
  context_key text not null,
  signals_count integer not null default 0,
  independent_weight integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index evidence_clusters_client_idx on public.evidence_clusters (client_id);

alter table public.evidence_clusters enable row level security;

create policy "assigned read clusters" on public.evidence_clusters
  for select using (public.is_client_accessible(organization_id, client_id, false));
create policy "assigned insert clusters" on public.evidence_clusters
  for insert with check (public.is_client_accessible(organization_id, client_id, true));
create policy "assigned update clusters" on public.evidence_clusters
  for update using (public.is_client_accessible(organization_id, client_id, true));

grant select, insert, update on public.evidence_clusters to authenticated;
grant select, insert, update, delete on public.evidence_clusters to service_role;
