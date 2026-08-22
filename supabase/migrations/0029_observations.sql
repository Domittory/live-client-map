-- 0029: Observation + BehavioralMarker + BehavioralMarkerEntry (ticket 40).
-- Specialist records observations and measurable behavioral markers before and
-- after a Correction, giving evaluateCorrection data independent of AI hypotheses.
-- Marker baseline is set at creation and never overwritten; every current-value
-- change is appended to behavioral_marker_entries (history) and recomputes trend.

create table public.observations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  client_id uuid not null references public.clients (id) on delete cascade,
  correction_id uuid references public.corrections (id) on delete set null,
  date date not null default current_date,
  source_type text not null check (source_type in ('specialist_observation', 'client_report', 'measurement', 'external_report')),
  description text not null,
  life_areas text[] not null default '{}',
  valence text not null check (valence in ('positive', 'negative', 'neutral')),
  intensity integer not null check (intensity between 1 and 10),
  supports_improvement boolean not null default false,
  confidence integer not null check (confidence between 0 and 100),
  visibility text not null default 'private' check (visibility in ('private', 'client_visible')),
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.behavioral_markers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  client_id uuid not null references public.clients (id) on delete cascade,
  name text not null,
  description text,
  life_area text,
  marker_type text not null check (marker_type in ('scale', 'boolean', 'frequency', 'subjective', 'behavioral_count')),
  scale_min double precision not null default 0,
  scale_max double precision not null default 10,
  current_value double precision,
  baseline_value double precision,
  trend text not null default 'unknown' check (trend in ('improving', 'stable', 'worsening', 'unknown')),
  linked_core_node_id uuid references public.core_nodes (id) on delete set null,
  linked_theme_id uuid references public.themes (id) on delete set null,
  linked_resource_id uuid references public.resources (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (scale_min < scale_max)
);

create table public.behavioral_marker_entries (
  id uuid primary key default gen_random_uuid(),
  marker_id uuid not null references public.behavioral_markers (id) on delete cascade,
  value double precision not null,
  note text,
  recorded_by uuid references auth.users (id),
  recorded_at timestamptz not null default now()
);

create index observations_client_idx on public.observations (client_id);
create index observations_correction_idx on public.observations (correction_id);
create index behavioral_markers_client_idx on public.behavioral_markers (client_id);
create index behavioral_marker_entries_marker_idx on public.behavioral_marker_entries (marker_id);

alter table public.observations enable row level security;
alter table public.behavioral_markers enable row level security;
alter table public.behavioral_marker_entries enable row level security;

create policy "assigned read observations" on public.observations
  for select using (public.is_client_accessible(organization_id, client_id, false));
create policy "assigned insert observations" on public.observations
  for insert with check (public.is_client_accessible(organization_id, client_id, true));
create policy "assigned update observations" on public.observations
  for update using (public.is_client_accessible(organization_id, client_id, true));

create policy "assigned read behavioral markers" on public.behavioral_markers
  for select using (public.is_client_accessible(organization_id, client_id, false));
create policy "assigned insert behavioral markers" on public.behavioral_markers
  for insert with check (public.is_client_accessible(organization_id, client_id, true));
create policy "assigned update behavioral markers" on public.behavioral_markers
  for update using (public.is_client_accessible(organization_id, client_id, true));

create policy "assigned read behavioral marker entries" on public.behavioral_marker_entries
  for select using (exists (
    select 1 from public.behavioral_markers m
    where m.id = marker_id and public.is_client_accessible(m.organization_id, m.client_id, false)
  ));
create policy "assigned insert behavioral marker entries" on public.behavioral_marker_entries
  for insert with check (exists (
    select 1 from public.behavioral_markers m
    where m.id = marker_id and public.is_client_accessible(m.organization_id, m.client_id, true)
  ));

-- Validates that a behavioral marker evidence link references an existing entity
-- owned by the same organization and client. Keeps link integrity in the
-- service layer. Mirrors validate_correction_target from 0028.
create or replace function public.validate_behavioral_marker_link(
  p_link_type text,
  p_link_id uuid,
  p_organization_id uuid,
  p_client_id uuid
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  case p_link_type
    when 'core_node' then
      return exists (
        select 1 from public.core_nodes
        where id = p_link_id and organization_id = p_organization_id and client_id = p_client_id
      );
    when 'theme' then
      return exists (
        select 1 from public.themes
        where id = p_link_id and organization_id = p_organization_id and client_id = p_client_id
      );
    when 'resource' then
      return exists (
        select 1 from public.resources
        where id = p_link_id and organization_id = p_organization_id and client_id = p_client_id
      );
    else
      return false;
  end case;
end;
$$;

grant execute on function public.validate_behavioral_marker_link to authenticated, service_role;

grant select, insert, update on public.observations to authenticated;
grant select, insert, update, delete on public.observations to service_role;
grant select, insert, update on public.behavioral_markers to authenticated;
grant select, insert, update, delete on public.behavioral_markers to service_role;
grant select, insert on public.behavioral_marker_entries to authenticated;
grant select, insert, update, delete on public.behavioral_marker_entries to service_role;
