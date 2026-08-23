-- 0032: ModelChange + PsychologicalSnapshot (ticket 43, SPEC §8.31, §8.32, §25).
-- ModelChange is separate from AuditLog: it records a meaningful change of the
-- psychological model itself (e.g. CoreNode weakened → reactivated, follow-up
-- verdict) with previous/new state, reason and evidence refs.
-- PsychologicalSnapshot is an immutable, versioned (per client) snapshot of the
-- whole model built by the deterministic assembler (lib/service/snapshots.ts):
-- no AI is used for assembly. Every snapshot stores the model_hash (sha256 of
-- the canonical model content) plus the scoring / ontology / AI model / prompt
-- versions it was generated with, so identical model state and versions always
-- produce an identical model_hash.
--
-- Immutability: snapshots and model changes are append-only. Authenticated
-- roles get SELECT/INSERT only — there are no UPDATE/DELETE policies or grants
-- and the service layer exposes no mutation functions for existing rows.
-- Version is monotonic per client (unique client_id + version).

create table public.model_changes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  client_id uuid not null references public.clients (id) on delete cascade,
  occurred_at timestamptz not null default now(),
  entity_type text not null,
  entity_id uuid not null,
  previous_state jsonb,
  new_state jsonb,
  change_reason text not null,
  evidence_refs uuid[] not null default '{}',
  created_at timestamptz not null default now()
);

create index model_changes_client_idx on public.model_changes (client_id);
create index model_changes_entity_idx on public.model_changes (entity_type, entity_id);

alter table public.model_changes enable row level security;

create policy "assigned read model_changes" on public.model_changes
  for select using (public.is_client_accessible(organization_id, client_id, false));
create policy "assigned insert model_changes" on public.model_changes
  for insert with check (public.is_client_accessible(organization_id, client_id, true));

grant select, insert on public.model_changes to authenticated;
grant select, insert, update, delete on public.model_changes to service_role;
-- 0002 sets default privileges granting update/delete on new tables to
-- authenticated; append-only tables must revoke them explicitly.
revoke update, delete on public.model_changes from authenticated;

create table public.psychological_snapshots (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  client_id uuid not null references public.clients (id) on delete cascade,
  version integer not null check (version >= 1),
  generated_at timestamptz not null default now(),
  generated_by uuid references auth.users (id),
  reason text not null,
  summary text not null default '',
  active_core_nodes jsonb not null default '[]',
  active_themes jsonb not null default '[]',
  resource_state jsonb not null default '[]',
  development_targets jsonb not null default '[]',
  weakened_nodes jsonb not null default '[]',
  reactivated_nodes jsonb not null default '[]',
  recent_triggers jsonb not null default '[]',
  recent_corrections jsonb not null default '[]',
  current_requests jsonb not null default '[]',
  recommendations jsonb not null default '[]',
  trend_summary text not null default '',
  risk_notes text not null default '',
  evidence_digest text not null default '',
  changes_since_previous jsonb,
  model_hash text not null,
  scoring_model_version text not null,
  ontology_version text not null,
  ai_model text not null,
  prompt_version text not null,
  created_at timestamptz not null default now(),
  unique (client_id, version)
);

create index psychological_snapshots_client_idx
  on public.psychological_snapshots (client_id, version desc);

alter table public.psychological_snapshots enable row level security;

create policy "assigned read snapshots" on public.psychological_snapshots
  for select using (public.is_client_accessible(organization_id, client_id, false));
create policy "assigned insert snapshots" on public.psychological_snapshots
  for insert with check (public.is_client_accessible(organization_id, client_id, true));

grant select, insert on public.psychological_snapshots to authenticated;
grant select, insert, update, delete on public.psychological_snapshots to service_role;
-- 0002 sets default privileges granting update/delete on new tables to
-- authenticated; append-only tables must revoke them explicitly.
revoke update, delete on public.psychological_snapshots from authenticated;
