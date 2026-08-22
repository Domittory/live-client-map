-- 0026: Relationship + RelationshipDynamic (ticket 50).
-- A relationship links two clients of the SAME organization; access to both
-- clients is enforced by RLS (is_client_accessible for client_a AND client_b).
-- Client-portal (non-member) users therefore never read relationship data.

create table public.relationships (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  client_a_id uuid not null references public.clients (id) on delete cascade,
  client_b_id uuid not null references public.clients (id) on delete cascade,
  relationship_type text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (client_a_id, client_b_id),
  check (client_a_id <> client_b_id)
);

create table public.relationship_dynamics (
  id uuid primary key default gen_random_uuid(),
  relationship_id uuid not null references public.relationships (id) on delete cascade,
  title text not null,
  description text,
  confidence_score integer check (confidence_score between 0 and 100),
  evidence_refs text[] not null default '{}',
  visibility text not null default 'internal' check (visibility in ('internal', 'sensitive', 'client_visible')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index relationships_org_idx on public.relationships (organization_id);
create index relationship_dynamics_rel_idx on public.relationship_dynamics (relationship_id);

alter table public.relationships enable row level security;
alter table public.relationship_dynamics enable row level security;

create policy "assigned read relationships" on public.relationships
  for select using (
    public.is_client_accessible(organization_id, client_a_id, false)
    and public.is_client_accessible(organization_id, client_b_id, false)
  );
create policy "assigned insert relationships" on public.relationships
  for insert with check (
    public.is_client_accessible(organization_id, client_a_id, true)
    and public.is_client_accessible(organization_id, client_b_id, true)
  );
create policy "assigned update relationships" on public.relationships
  for update using (
    public.is_client_accessible(organization_id, client_a_id, true)
    and public.is_client_accessible(organization_id, client_b_id, true)
  );

create policy "assigned read relationship dynamics" on public.relationship_dynamics
  for select using (exists (
    select 1 from public.relationships r
    where r.id = relationship_id
      and public.is_client_accessible(r.organization_id, r.client_a_id, false)
      and public.is_client_accessible(r.organization_id, r.client_b_id, false)
  ));
create policy "assigned insert relationship dynamics" on public.relationship_dynamics
  for insert with check (exists (
    select 1 from public.relationships r
    where r.id = relationship_id
      and public.is_client_accessible(r.organization_id, r.client_a_id, true)
      and public.is_client_accessible(r.organization_id, r.client_b_id, true)
  ));
create policy "assigned update relationship dynamics" on public.relationship_dynamics
  for update using (exists (
    select 1 from public.relationships r
    where r.id = relationship_id
      and public.is_client_accessible(r.organization_id, r.client_a_id, true)
      and public.is_client_accessible(r.organization_id, r.client_b_id, true)
  ));

grant select, insert, update on public.relationships to authenticated;
grant select, insert, update, delete on public.relationships to service_role;
grant select, insert, update on public.relationship_dynamics to authenticated;
grant select, insert, update, delete on public.relationship_dynamics to service_role;
