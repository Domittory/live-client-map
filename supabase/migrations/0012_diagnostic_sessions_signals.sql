-- 0012: DiagnosticSession + manual Signal (ticket 20).

create table public.diagnostic_sessions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  client_id uuid not null references public.clients (id) on delete cascade,
  title text not null,
  session_type text not null check (session_type in ('individual', 'topic_test', 'follow_up_test', 'correction_check', 'import', 'baseline')),
  source_type text,
  raw_input text,
  input_format text,
  performed_at timestamptz,
  performed_by_user_id uuid references auth.users (id),
  ai_processing_status text not null default 'not_started' check (ai_processing_status in ('not_started', 'pending', 'processing', 'completed', 'failed')),
  human_review_status text not null default 'pending' check (human_review_status in ('pending', 'approved', 'rejected')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.signals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  client_id uuid not null references public.clients (id) on delete cascade,
  diagnostic_session_id uuid references public.diagnostic_sessions (id) on delete set null,
  source_type text not null check (source_type in (
    'kinesiology_test', 'client_report', 'specialist_observation', 'life_event',
    'questionnaire', 'partner_report', 'follow_up', 'imported_note', 'ai_hypothesis'
  )),
  source_ref_id uuid,
  epistemic_type text not null check (epistemic_type in ('fact', 'self_report', 'test_result', 'observation', 'interpretation', 'hypothesis')),
  raw_statement text not null,
  statement_polarity text check (statement_polarity in ('positive', 'negative', 'neutral', 'mixed', 'unknown')),
  test_result text check (test_result in ('stress', 'no_stress', 'unknown', 'not_tested')),
  normalized_meaning text,
  inferred_opposite text,
  intensity integer check (intensity between 0 and 100),
  confidence integer check (confidence between 0 and 100),
  life_areas text[] not null default '{}',
  tags text[] not null default '{}',
  context jsonb not null default '{}'::jsonb,
  time_scope text,
  evidence_level text not null default 'L1_SINGLE_SIGNAL' check (evidence_level in (
    'L0_AI_ONLY', 'L1_SINGLE_SIGNAL', 'L2_MULTIPLE_SIGNALS', 'L3_MULTI_CONTEXT',
    'L4_RETEST_CONFIRMED', 'L5_BEHAVIOR_CONFIRMED', 'L6_CORRECTION_RESPONSE_CONFIRMED',
    'L7_SPECIALIST_CONFIRMED_LONGITUDINAL'
  )),
  visibility text not null default 'internal' check (visibility in ('internal', 'sensitive', 'client_visible')),
  review_status text not null default 'approved' check (review_status in ('pending', 'approved', 'rejected')),
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);

create index diagnostic_sessions_client_idx on public.diagnostic_sessions (client_id);
create index signals_client_idx on public.signals (client_id);
create index signals_session_idx on public.signals (diagnostic_session_id);

alter table public.diagnostic_sessions enable row level security;
alter table public.signals enable row level security;

create policy "assigned read sessions" on public.diagnostic_sessions
  for select using (public.is_client_accessible(organization_id, client_id, false));
create policy "assigned insert sessions" on public.diagnostic_sessions
  for insert with check (public.is_client_accessible(organization_id, client_id, true));
create policy "assigned update sessions" on public.diagnostic_sessions
  for update using (public.is_client_accessible(organization_id, client_id, true));

create policy "assigned read signals" on public.signals
  for select using (public.is_client_accessible(organization_id, client_id, false));
create policy "assigned insert signals" on public.signals
  for insert with check (public.is_client_accessible(organization_id, client_id, true));
create policy "assigned update signals" on public.signals
  for update using (public.is_client_accessible(organization_id, client_id, true));

grant select, insert, update on public.diagnostic_sessions to authenticated;
grant select, insert, update, delete on public.diagnostic_sessions to service_role;
grant select, insert, update on public.signals to authenticated;
grant select, insert, update, delete on public.signals to service_role;
