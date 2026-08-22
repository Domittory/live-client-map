-- 0027: Import staging + report (tickets 53, 54).
-- Every import creates a DiagnosticSession (session_type=import) and a row here
-- carrying idempotency, content checksum, status and the validation report.

create table public.imports (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  client_id uuid not null references public.clients (id) on delete cascade,
  diagnostic_session_id uuid references public.diagnostic_sessions (id) on delete set null,
  input_format text not null,
  contract_version text not null,
  idempotency_key text not null,
  content_sha256 text not null,
  status text not null default 'validating' check (status in (
    'validating', 'parsing', 'awaiting_review', 'committing', 'completed', 'failed'
  )),
  counts jsonb not null default '{}'::jsonb,
  report jsonb not null default '{}'::jsonb,
  fatal_errors jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, client_id, contract_version, idempotency_key)
);

create index imports_client_idx on public.imports (client_id);
create index imports_idempotency_idx on public.imports (organization_id, client_id, contract_version, idempotency_key);

alter table public.imports enable row level security;

create policy "assigned read imports" on public.imports
  for select using (public.is_client_accessible(organization_id, client_id, false));
create policy "assigned insert imports" on public.imports
  for insert with check (public.is_client_accessible(organization_id, client_id, true));
create policy "assigned update imports" on public.imports
  for update using (public.is_client_accessible(organization_id, client_id, true));

grant select, insert, update on public.imports to authenticated;
grant select, insert, update, delete on public.imports to service_role;
