-- 0031: CoreNodeReactivation proposals (ticket 42, SPEC §24).
-- A weakened CoreNode can return to reactivated only through a reviewable
-- proposal: the deterministic evaluator (lib/service/reactivation.ts) computes
-- a new activation_score from fresh eligible evidence (Signals with
-- evidence_level != L0_AI_ONLY inside the configured freshness window, plus
-- fresh TriggerActivations) using the versioned scoring configuration
-- (ticket 06/28). The proposal stores the config version and the full
-- calculation; a human approve applies weakened → reactivated, reject keeps
-- the node untouched. History is preserved: one row per proposal, never
-- overwritten; the partial unique index allows at most one pending proposal
-- per core node.

create table public.core_node_reactivations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  client_id uuid not null references public.clients (id) on delete cascade,
  core_node_id uuid not null references public.core_nodes (id) on delete cascade,
  scoring_model_version text not null,
  previous_activation_score integer check (previous_activation_score between 0 and 100),
  proposed_activation_score integer not null check (proposed_activation_score between 0 and 100),
  calculation jsonb not null,
  reason text not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_by uuid references auth.users (id),
  decided_by uuid references auth.users (id),
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index core_node_reactivations_node_idx on public.core_node_reactivations (core_node_id);
create index core_node_reactivations_client_idx on public.core_node_reactivations (client_id);
create unique index core_node_reactivations_pending_idx
  on public.core_node_reactivations (core_node_id) where status = 'pending';

alter table public.core_node_reactivations enable row level security;

create policy "assigned read reactivations" on public.core_node_reactivations
  for select using (public.is_client_accessible(organization_id, client_id, false));
create policy "assigned insert reactivations" on public.core_node_reactivations
  for insert with check (public.is_client_accessible(organization_id, client_id, true));
create policy "assigned update reactivations" on public.core_node_reactivations
  for update using (public.is_client_accessible(organization_id, client_id, true));

grant select, insert, update on public.core_node_reactivations to authenticated;
grant select, insert, update, delete on public.core_node_reactivations to service_role;
