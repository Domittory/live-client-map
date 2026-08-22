-- 0014: DiagnosticSessionSummary + human review (ticket 23).

create table public.diagnostic_session_summaries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  client_id uuid not null references public.clients (id) on delete cascade,
  diagnostic_session_id uuid not null references public.diagnostic_sessions (id) on delete cascade,
  summary text,
  strongest_findings text[] not null default '{}',
  new_hypotheses text[] not null default '{}',
  confirmed_hypotheses text[] not null default '{}',
  contradicted_hypotheses text[] not null default '{}',
  priority_changes text[] not null default '{}',
  created_at timestamptz not null default now()
);

create index diagnostic_session_summaries_session_idx
  on public.diagnostic_session_summaries (diagnostic_session_id);

alter table public.diagnostic_session_summaries enable row level security;

create policy "assigned read summaries" on public.diagnostic_session_summaries
  for select using (public.is_client_accessible(organization_id, client_id, false));
create policy "assigned insert summaries" on public.diagnostic_session_summaries
  for insert with check (public.is_client_accessible(organization_id, client_id, true));
create policy "assigned update summaries" on public.diagnostic_session_summaries
  for update using (public.is_client_accessible(organization_id, client_id, true));

grant select, insert, update on public.diagnostic_session_summaries to authenticated;
grant select, insert, update, delete on public.diagnostic_session_summaries to service_role;
