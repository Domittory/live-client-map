-- 0028: Correction + CorrectionTarget + CorrectionExpectedMarker (ticket 39).
-- Specialist turns an approved Recommendation into a planned intervention.
-- Expected markers are captured before the correction is completed.

create table public.corrections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  client_id uuid not null references public.clients (id) on delete cascade,
  recommendation_id uuid references public.recommendations (id) on delete set null,
  intervention_method_id uuid references public.intervention_methods (id) on delete set null,
  date date not null default current_date,
  title text not null,
  method_notes text,
  rationale text,
  expected_effect text,
  priority_score_before double precision,
  status text not null default 'planned' check (status in ('planned', 'in_progress', 'completed', 'cancelled', 'archived')),
  specialist_notes text,
  client_visible_summary text,
  contraindications_acknowledged boolean not null default false,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);

create table public.correction_targets (
  id uuid primary key default gen_random_uuid(),
  correction_id uuid not null references public.corrections (id) on delete cascade,
  target_type text not null check (target_type in ('core_node', 'theme', 'resource', 'client_request', 'development_target')),
  target_id uuid not null,
  role text not null check (role in ('primary', 'secondary', 'downstream', 'context')),
  expected_effect text,
  created_at timestamptz not null default now()
);

create table public.correction_expected_markers (
  id uuid primary key default gen_random_uuid(),
  correction_id uuid not null references public.corrections (id) on delete cascade,
  marker text not null,
  life_area text,
  expected_direction text not null check (expected_direction in ('increase', 'decrease', 'stable', 'observable_change')),
  measurement_type text not null check (measurement_type in ('scale', 'boolean', 'frequency', 'subjective', 'behavioral_count')),
  baseline_value text,
  target_value text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index corrections_client_idx on public.corrections (client_id);
create index corrections_recommendation_idx on public.corrections (recommendation_id);
create index correction_targets_correction_idx on public.correction_targets (correction_id);
create index correction_expected_markers_correction_idx on public.correction_expected_markers (correction_id);

alter table public.corrections enable row level security;
alter table public.correction_targets enable row level security;
alter table public.correction_expected_markers enable row level security;

create policy "assigned read corrections" on public.corrections
  for select using (public.is_client_accessible(organization_id, client_id, false));
create policy "assigned insert corrections" on public.corrections
  for insert with check (public.is_client_accessible(organization_id, client_id, true));
create policy "assigned update corrections" on public.corrections
  for update using (public.is_client_accessible(organization_id, client_id, true));

create policy "assigned read correction targets" on public.correction_targets
  for select using (exists (
    select 1 from public.corrections c
    where c.id = correction_id and public.is_client_accessible(c.organization_id, c.client_id, false)
  ));
create policy "assigned insert correction targets" on public.correction_targets
  for insert with check (exists (
    select 1 from public.corrections c
    where c.id = correction_id and public.is_client_accessible(c.organization_id, c.client_id, true)
  ));
create policy "assigned update correction targets" on public.correction_targets
  for update using (exists (
    select 1 from public.corrections c
    where c.id = correction_id and public.is_client_accessible(c.organization_id, c.client_id, true)
  ));

create policy "assigned read correction expected markers" on public.correction_expected_markers
  for select using (exists (
    select 1 from public.corrections c
    where c.id = correction_id and public.is_client_accessible(c.organization_id, c.client_id, false)
  ));
create policy "assigned insert correction expected markers" on public.correction_expected_markers
  for insert with check (exists (
    select 1 from public.corrections c
    where c.id = correction_id and public.is_client_accessible(c.organization_id, c.client_id, true)
  ));
create policy "assigned update correction expected markers" on public.correction_expected_markers
  for update using (exists (
    select 1 from public.corrections c
    where c.id = correction_id and public.is_client_accessible(c.organization_id, c.client_id, true)
  ));

-- Validates that a correction target references an existing entity owned by the
-- same organization and client. Keeps target integrity in the service layer.
create or replace function public.validate_correction_target(
  p_target_type text,
  p_target_id uuid,
  p_organization_id uuid,
  p_client_id uuid
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  case p_target_type
    when 'core_node' then
      return exists (
        select 1 from public.core_nodes
        where id = p_target_id and organization_id = p_organization_id and client_id = p_client_id
      );
    when 'theme' then
      return exists (
        select 1 from public.themes
        where id = p_target_id and organization_id = p_organization_id and client_id = p_client_id
      );
    when 'resource' then
      return exists (
        select 1 from public.resources
        where id = p_target_id and organization_id = p_organization_id and client_id = p_client_id
      );
    when 'client_request' then
      return exists (
        select 1 from public.client_requests
        where id = p_target_id and organization_id = p_organization_id and client_id = p_client_id
      );
    when 'development_target' then
      return exists (
        select 1 from public.development_targets
        where id = p_target_id and organization_id = p_organization_id and client_id = p_client_id
      );
    else
      return false;
  end case;
end;
$$;

grant execute on function public.validate_correction_target to authenticated, service_role;

grant select, insert, update on public.corrections to authenticated;
grant select, insert, update, delete on public.corrections to service_role;
grant select, insert, update on public.correction_targets to authenticated;
grant select, insert, update, delete on public.correction_targets to service_role;
grant select, insert, update on public.correction_expected_markers to authenticated;
grant select, insert, update, delete on public.correction_expected_markers to service_role;
