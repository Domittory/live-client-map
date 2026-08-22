-- 0009: AI gateway run log (ticket 32).
-- Every AI call persists request id, version metadata (contract / prompt /
-- provider / model snapshot / ontology / scoring), hashes, status and safe
-- telemetry. Raw prompts and responses are never stored (docs/ai-contracts.md).

create table public.ai_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  client_id uuid not null references public.clients (id) on delete cascade,
  actor_user_id uuid not null references auth.users (id),
  request_id uuid not null unique,
  -- organization + client + function + input hash + contract/prompt/model versions.
  idempotency_key text not null unique,
  function text not null,
  contract_version text not null,
  prompt_version text not null,
  ontology_version text not null,
  scoring_model_version text,
  provider text not null,
  model_snapshot text not null,
  reasoning_effort text not null,
  input_hash text not null,
  output_hash text,
  redaction_version text not null,
  status text not null check (status in (
    'queued', 'running', 'succeeded', 'needs_review', 'blocked_environment',
    'blocked_consent', 'redaction_failed', 'provider_model_unavailable',
    'provider_timeout', 'provider_rate_limited', 'provider_error',
    'invalid_output', 'safety_blocked', 'cancelled'
  )),
  error_code text,
  retryable boolean,
  input_tokens integer,
  output_tokens integer,
  latency_ms integer,
  created_at timestamptz not null default now()
);

create index ai_runs_org_created_idx
  on public.ai_runs (organization_id, created_at desc);
create index ai_runs_client_idx
  on public.ai_runs (client_id, created_at desc);

-- Run log is append-only (SPEC §3.3): no updates or deletes.
create or replace function public.block_mutation()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'this table is append-only' using errcode = '42501';
end;
$$;

create trigger ai_runs_no_update
  before update or delete on public.ai_runs
  for each row execute procedure public.block_mutation();

alter table public.ai_runs enable row level security;

-- Org members read their own tenant's runs; specialists see metadata only via
-- the service layer (raw payloads are not stored at all).
create policy "org members read own ai runs" on public.ai_runs
  for select to authenticated
  using (public.is_org_member(organization_id));

-- Inserts go through the gateway: the caller must be an active org member and
-- the recorded actor is the real caller.
create policy "org members append own ai runs" on public.ai_runs
  for insert to authenticated
  with check (public.is_org_member(organization_id) and actor_user_id = auth.uid());

grant select, insert on public.ai_runs to authenticated;
grant all on public.ai_runs to service_role;
