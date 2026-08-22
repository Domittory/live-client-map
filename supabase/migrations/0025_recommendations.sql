-- 0025: Recommendation + RecommendationTarget (ticket 37).
-- AI-created recommendations start as status 'draft' (pending human review);
-- risk >= 80 forces human_review_required and internal visibility (SPEC §20).

create table public.recommendations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  client_id uuid not null references public.clients (id) on delete cascade,
  client_request_id uuid references public.client_requests (id) on delete set null,
  proposed_correction text not null,
  rationale text,
  rootness_score integer check (rootness_score between 0 and 100),
  impact_score integer check (impact_score between 0 and 100),
  activation_score integer check (activation_score between 0 and 100),
  confidence_score integer check (confidence_score between 0 and 100),
  client_relevance_score integer check (client_relevance_score between 0 and 100),
  readiness_score integer check (readiness_score between 0 and 100),
  unlock_score integer check (unlock_score between 0 and 100),
  risk_score integer check (risk_score between 0 and 100),
  systemic_leverage_score double precision,
  final_priority_score double precision,
  scoring_model_version text,
  risk_notes text,
  missing_evidence text[] not null default '{}',
  rank_rationale text,
  status text not null default 'draft' check (status in ('draft', 'approved', 'rejected', 'archived')),
  human_review_required boolean not null default false,
  visibility text not null default 'internal' check (visibility in ('internal', 'client_visible')),
  reviewed_by uuid references auth.users (id),
  reviewed_at timestamptz,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.recommendation_targets (
  id uuid primary key default gen_random_uuid(),
  recommendation_id uuid not null references public.recommendations (id) on delete cascade,
  target_type text,
  target_id uuid not null,
  role text not null,
  expected_effect text,
  created_at timestamptz not null default now()
);

create index recommendations_client_idx on public.recommendations (client_id);
create index recommendation_targets_rec_idx on public.recommendation_targets (recommendation_id);

alter table public.recommendations enable row level security;
alter table public.recommendation_targets enable row level security;

create policy "assigned read recommendations" on public.recommendations
  for select using (public.is_client_accessible(organization_id, client_id, false));
create policy "assigned insert recommendations" on public.recommendations
  for insert with check (public.is_client_accessible(organization_id, client_id, true));
create policy "assigned update recommendations" on public.recommendations
  for update using (public.is_client_accessible(organization_id, client_id, true));

create policy "assigned read recommendation targets" on public.recommendation_targets
  for select using (exists (
    select 1 from public.recommendations r
    where r.id = recommendation_id and public.is_client_accessible(r.organization_id, r.client_id, false)
  ));
create policy "assigned insert recommendation targets" on public.recommendation_targets
  for insert with check (exists (
    select 1 from public.recommendations r
    where r.id = recommendation_id and public.is_client_accessible(r.organization_id, r.client_id, true)
  ));

grant select, insert, update on public.recommendations to authenticated;
grant select, insert, update, delete on public.recommendations to service_role;
grant select, insert on public.recommendation_targets to authenticated;
grant select, insert, update, delete on public.recommendation_targets to service_role;
