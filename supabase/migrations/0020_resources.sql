-- 0020: Resource (ticket 29).

create table public.resources (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  client_id uuid not null references public.clients (id) on delete cascade,
  name text not null,
  description text,
  domain text,
  strength_score integer check (strength_score between 0 and 100),
  confidence_score integer check (confidence_score between 0 and 100),
  trend text,
  evidence_summary text,
  status text not null default 'active' check (status in ('active', 'archived')),
  visibility text not null default 'internal' check (visibility in ('internal', 'sensitive', 'client_visible')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index resources_client_idx on public.resources (client_id);

alter table public.resources enable row level security;

create policy "assigned read resources" on public.resources
  for select using (public.is_client_accessible(organization_id, client_id, false));
create policy "assigned insert resources" on public.resources
  for insert with check (public.is_client_accessible(organization_id, client_id, true));
create policy "assigned update resources" on public.resources
  for update using (public.is_client_accessible(organization_id, client_id, true));

grant select, insert, update on public.resources to authenticated;
grant select, insert, update, delete on public.resources to service_role;
