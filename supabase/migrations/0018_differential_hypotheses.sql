-- 0018: DifferentialHypothesis + contradictions (ticket 26).

create table public.differential_hypotheses (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  client_id uuid not null references public.clients (id) on delete cascade,
  title text not null,
  description text,
  confidence_score integer check (confidence_score between 0 and 100),
  status text not null default 'hypothesis' check (status in ('hypothesis', 'active', 'rejected', 'archived')),
  evidence_for text[] not null default '{}',
  evidence_against text[] not null default '{}',
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index differential_hypotheses_client_idx on public.differential_hypotheses (client_id);

alter table public.differential_hypotheses enable row level security;

create policy "assigned read hypotheses" on public.differential_hypotheses
  for select using (public.is_client_accessible(organization_id, client_id, false));
create policy "assigned insert hypotheses" on public.differential_hypotheses
  for insert with check (public.is_client_accessible(organization_id, client_id, true));
create policy "assigned update hypotheses" on public.differential_hypotheses
  for update using (public.is_client_accessible(organization_id, client_id, true));

grant select, insert, update on public.differential_hypotheses to authenticated;
grant select, insert, update, delete on public.differential_hypotheses to service_role;
