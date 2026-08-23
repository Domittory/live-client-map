-- 0036: ModelExplanation (ticket 44, SPEC §26, §27 explainModelChanges).
-- After new diagnostics a specialist gets a cautious, human-reviewed
-- explanation of what changed in the model and why. The AI only writes the
-- narrative; the factual before/after values always come from ModelChange
-- records and snapshot diffs (lib/service/snapshots.ts), never from AI text.
--
-- Grounding: the service validates deterministically that every explanation
-- entry references an existing ModelChange id from the AI input and that every
-- evidence_ref points at real evidence rows; fabricated references mark the
-- explanation "rejected" (grounding_errors) and it can never be approved.
--
-- Lifecycle: pending (awaiting human review) → approved / rejected. Rows are
-- never deleted; review only flips status/decided_* (no content rewriting).

create table public.model_explanations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  client_id uuid not null references public.clients (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  -- "deterministic_guard" when insufficient data short-circuited the AI call.
  source text not null check (source in ('ai', 'deterministic_guard')),
  before_snapshot_id uuid references public.psychological_snapshots (id),
  after_snapshot_id uuid references public.psychological_snapshots (id),
  -- ai.explain-model-changes.v1 result entries (model_change_id, headline, …).
  explanations jsonb not null default '[]',
  -- The exact id sets the output was grounded against (re-checked on approve).
  grounding jsonb not null default '{}',
  -- Deterministic grounding violations (fabricated change/evidence refs).
  grounding_errors jsonb not null default '[]',
  -- Explicitly named data gaps (SPEC: недостаток данных называется явно).
  missing_evidence text[] not null default '{}',
  -- scoring/ontology/ai/prompt versions active at generation time.
  versions jsonb not null default '{}',
  run_id uuid references public.ai_runs (id),
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  decided_by uuid references auth.users (id),
  decided_at timestamptz
);

create index model_explanations_client_idx on public.model_explanations (client_id);

alter table public.model_explanations enable row level security;

create policy "assigned read model_explanations" on public.model_explanations
  for select using (public.is_client_accessible(organization_id, client_id, false));
create policy "assigned insert model_explanations" on public.model_explanations
  for insert with check (public.is_client_accessible(organization_id, client_id, true));
create policy "assigned review model_explanations" on public.model_explanations
  for update using (public.is_client_accessible(organization_id, client_id, true));

grant select, insert, update on public.model_explanations to authenticated;
grant select, insert, update, delete on public.model_explanations to service_role;
-- 0002 sets default privileges granting delete on new tables to authenticated;
-- explanations are never deleted, so revoke it explicitly.
revoke delete on public.model_explanations from authenticated;
