-- 0030: FollowUp (ticket 41, SPEC §8.30).
-- Closes the correction loop with real post-intervention data: a specialist
-- schedules a follow-up, fills retest/behavioral results and feedback, then an
-- AI evaluation (ai.evaluate-correction.v1) produces a pending assessment that
-- a human must approve before result_status becomes final.
--
-- Field type decisions (contract allows jsonb or text):
--   retest_result / behavioral_result / client_feedback / specialist_assessment
--     are jsonb with strict zod schemas in lib/service/follow-ups.ts — keeping
--     structured summaries machine-readable for evaluateCorrection.
--   ai_assessment is jsonb holding the contract result of
--     ai.evaluate-correction.v1 PLUS approval workflow metadata
--     (approval_status pending/approved/rejected, run_id, decided_by/at).
--     It is stored in its own column, separate from client_feedback and
--     specialist_assessment (SPEC: AI assessment is not human feedback).
--
-- result_status lifecycle:
--   scheduled → completed (results filled) → effective / partially_effective /
--   ineffective / unclear (only after human approval of the AI assessment).
--   "effective" additionally requires objective follow-up evidence
--   (deterministic guard in the service layer, SPEC §51.9 / docs/ai-contracts.md).
--   "cancelled" marks a scheduled follow-up that will not happen.
--
-- History: multiple follow-ups per correction are allowed and never overwritten;
-- each evaluation/approval updates only its own row.

create table public.follow_ups (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  client_id uuid not null references public.clients (id) on delete cascade,
  correction_id uuid not null references public.corrections (id) on delete cascade,
  scheduled_at timestamptz not null,
  completed_at timestamptz,
  retest_result jsonb,
  behavioral_result jsonb,
  client_feedback jsonb,
  specialist_assessment jsonb,
  ai_assessment jsonb,
  result_status text not null default 'scheduled' check (
    result_status in (
      'scheduled', 'completed', 'cancelled',
      'effective', 'partially_effective', 'ineffective', 'unclear'
    )
  ),
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index follow_ups_correction_idx on public.follow_ups (correction_id);
create index follow_ups_client_idx on public.follow_ups (client_id);

alter table public.follow_ups enable row level security;

create policy "assigned read follow ups" on public.follow_ups
  for select using (public.is_client_accessible(organization_id, client_id, false));
create policy "assigned insert follow ups" on public.follow_ups
  for insert with check (public.is_client_accessible(organization_id, client_id, true));
create policy "assigned update follow ups" on public.follow_ups
  for update using (public.is_client_accessible(organization_id, client_id, true));

grant select, insert, update on public.follow_ups to authenticated;
grant select, insert, update, delete on public.follow_ups to service_role;
