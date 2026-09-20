-- 0051: Asynchronous ExportRequest lifecycle (ticket 19, docs/data-exchange-contracts.md §10).
--
-- §10 requires every export to be an asynchronous ExportRequest that records the
-- client, format, exact contract version, audience, optional snapshot version and
-- an idempotency key, and whose request / completion / denial / failure are
-- audited. This migration adds that lifecycle as one table plus four
-- SECURITY DEFINER RPCs. Template: 0039_atomic_business_mutation.sql (fixed
-- search_path, actor from auth.uid(), tenant/assignment checks, audit appended in
-- the same transaction), reusing the guards from 0032/0038/0039/0041.
--
-- State machine
-- ---------------------------------------------------------------------------
--   requested ──▶ generating ──▶ available      (artifact stored, downloadable)
--        │              ├──────▶ failed         (no artifact, audited)
--        └──────────────┴──────▶ denied         (authorization/consent refused)
--   generating ──▶ expired                      (retention reaper, ticket 20)
--
--   * `available` is the ONLY state that means "downloadable". A partial or
--     failed generation can never reach it: only complete_export_request() may
--     set it, and it requires a complete artifact metadata triple (path,
--     filename, sha256, byte size) that the storage upload already produced.
--     complete_export_request() also refuses to overwrite an existing artifact.
--   * `requested → generating` happens inside request_export(), so no caller can
--     park a row in `requested` and skip the generation attempt.
--   * `denied` is written as a full state transition (status + actor + timestamp
--     + audit row) for a caller who IS the organization member and CAN access the
--     client but lacks the audience role or an active consent. A caller without
--     tenant or client access is refused with 42501 before any row exists — no
--     audit row is fabricated for a client the caller must not even learn about.
--
-- Idempotency
-- ---------------------------------------------------------------------------
--   UNIQUE (organization_id, idempotency_key). A repeat of an equivalent request
--   returns the SAME export row (no second generation, no second audit row); the
--   same key with different parameters raises SQLSTATE 23505, which the service
--   maps to a typed conflict. The artifact content itself is not part of the
--   comparison because it is derived from database state that only moves forward;
--   the request identity is (kind, format, contract version, audience, snapshot
--   version).
--
-- Storage layout (private)
-- ---------------------------------------------------------------------------
--   bucket: `client-exports` (private; created below, never a public bucket)
--   object: <organization_id>/<export_request_id>/<opaque filename>
--   filename: <kind>_<opaque-ref>_<UTC timestamp>.<ext>
--     * the opaque ref is a sha256 digest, the kind is a contract word
--       ("client_archive" / "signals" / "supervision"), so no direct identifier
--       (client name, client id, organization name, subject content) can appear.
--     * the object path carries only opaque UUIDs and that filename.
--   No RLS policy is granted on storage.objects to authenticated/anon, so an
--   artifact is unreachable through the Storage API even for its requester;
--   delivery is a separate, re-authorized, audited step (ticket 20).
--
-- Retention precursor: expires_at defaults to created_at + 30 days (§10). Ticket
-- 20 owns the deletion job and the `expired` transition; the column and the
-- `expired` state exist here so the state machine is complete.

-- ---------------------------------------------------------------------------
-- Enumerated types
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_catalog.pg_type where typname = 'export_request_status') then
    create type public.export_request_status as enum (
      'requested',
      'generating',
      'available',
      'failed',
      'denied',
      'expired'
    );
  end if;
  if not exists (select 1 from pg_catalog.pg_type where typname = 'export_kind') then
    create type public.export_kind as enum ('client_archive', 'signals_csv', 'supervision_export');
  end if;
  if not exists (select 1 from pg_catalog.pg_type where typname = 'export_format') then
    create type public.export_format as enum ('json', 'csv', 'markdown', 'pdf');
  end if;
  if not exists (select 1 from pg_catalog.pg_type where typname = 'export_audience') then
    create type public.export_audience as enum ('owner', 'specialist', 'supervisor', 'client');
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- Table
-- ---------------------------------------------------------------------------

create table if not exists public.export_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  client_id uuid not null references public.clients (id) on delete cascade,
  kind public.export_kind not null,
  format public.export_format not null,
  contract_version text not null,
  audience public.export_audience not null,
  snapshot_version integer,
  idempotency_key text not null,
  -- The user who requested the export. Completion/failure transitions are
  -- system-driven (service_role only) and attribute their audit rows to this
  -- pinned actor, so a client role can never fabricate a downloadable artifact.
  actor_user_id uuid not null references auth.users (id),
  status public.export_request_status not null default 'requested',
  requested_at timestamptz not null default now(),
  generated_at timestamptz,
  completed_at timestamptz,
  failed_at timestamptz,
  denied_at timestamptz,
  expires_at timestamptz not null default (now() + interval '30 days'),
  artifact_path text,
  artifact_filename text,
  artifact_sha256 text,
  artifact_bytes bigint,
  failure_code text,
  download_count integer not null default 0,
  constraint export_requests_idempotency_key_key unique (organization_id, idempotency_key),
  -- §10: a report export must name an exact snapshot version; the other kinds
  -- carry no snapshot at all.
  constraint export_requests_snapshot_version_check check (
    case
      when format in ('markdown', 'pdf') then snapshot_version is not null
      else snapshot_version is null
    end
  ),
  -- A downloadable artifact requires the complete metadata triple written by
  -- complete_export_request() in one statement; a bare status update cannot
  -- produce a downloadable row.
  constraint export_requests_artifact_check check (
    status <> 'available'
    or (
      artifact_path is not null
      and artifact_filename is not null
      and artifact_sha256 is not null
      and artifact_bytes is not null
      and artifact_bytes > 0
      and completed_at is not null
    )
  ),
  constraint export_requests_failure_code_check check (
    status not in ('failed', 'denied') or failure_code is not null
  )
);

create index if not exists export_requests_client_created_idx
  on public.export_requests (client_id, requested_at desc);

create index if not exists export_requests_org_status_idx
  on public.export_requests (organization_id, status, expires_at);

-- ---------------------------------------------------------------------------
-- Row level security: read-only for the owning organization; every write goes
-- through the RPCs below (no insert/update/delete policy is created).
-- ---------------------------------------------------------------------------

alter table public.export_requests enable row level security;

drop policy if exists "members read own export requests" on public.export_requests;
create policy "members read own export requests" on public.export_requests
  for select to authenticated
  using (
    exists (
      select 1 from public.organizations o
      where o.id = organization_id and o.owner_user_id = auth.uid()
    )
    or (
      public.is_org_member(organization_id)
      and public.is_client_accessible(organization_id, client_id, false)
    )
  );

-- ---------------------------------------------------------------------------
-- Shared helpers
-- ---------------------------------------------------------------------------

-- Internal: the opaque, non-reversible export reference. Kept independent from
-- the per-client archive reference so a request id is never a client handle.
create or replace function public.opaque_export_ref(p_export_id uuid)
returns text
language sql
immutable
set search_path = public
as $$
  select substring(encode(sha256(convert_to(p_export_id::text, 'UTF8')), 'hex') from 1 for 16);
$$;

-- Internal: the single format each kind is allowed to produce (§11/§12/§14).
create or replace function public.export_format_for_kind(p_kind public.export_kind)
returns public.export_format
language sql
immutable
set search_path = public
as $$
  select case p_kind
    when 'client_archive' then 'json'::public.export_format
    when 'signals_csv' then 'csv'::public.export_format
    when 'supervision_export' then 'json'::public.export_format
  end;
$$;

-- Internal: the exact contract identifier and version this build produces.
create or replace function public.export_contract_version(
  p_kind public.export_kind,
  p_format public.export_format
)
returns text
language plpgsql
immutable
set search_path = public
as $$
begin
  if p_kind = 'client_archive' and p_format = 'json' then
    return 'live-client-map.client-archive/1.0';
  end if;
  if p_kind = 'signals_csv' and p_format = 'csv' then
    return 'live-client-map.signals-csv/1.0';
  end if;
  if p_kind = 'supervision_export' and p_format = 'json' then
    return 'live-client-map.supervision-export/1.0';
  end if;
  raise exception 'unsupported export kind/format combination' using errcode = '22023';
end;
$$;

-- Internal: does the caller hold the audience this export requires?
--   * owner      — organization owner (the only audience a full archive allows);
--   * specialist — active non-supervisor ClientAssignment with write access
--                  (matches the Signals CSV guard: a read_only assignment may
--                  read the client but never export it);
--   * supervisor — active supervisor ClientAssignment (§14, read-only by design).
create or replace function public.export_audience_allowed(
  p_org_id uuid,
  p_client_id uuid,
  p_audience public.export_audience
)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_role text;
begin
  if v_actor is null then
    return false;
  end if;

  if p_audience = 'owner' then
    return public.is_org_owner(p_org_id);
  end if;

  if not (
    public.is_org_member(p_org_id)
    and public.is_client_accessible(p_org_id, p_client_id, false)
  ) then
    return false;
  end if;

  select a.access_role into v_role
  from public.client_assignments a
  where a.client_id = p_client_id
    and a.user_id = v_actor
    and a.revoked_at is null
  limit 1;

  if p_audience = 'supervisor' then
    return v_role = 'supervisor';
  end if;

  if p_audience = 'specialist' then
    return v_role in ('primary_specialist', 'secondary_specialist');
  end if;

  -- The client portal audience is not an export requester in v1.
  return false;
end;
$$;

revoke all on function public.opaque_export_ref(uuid) from public, anon, authenticated;
revoke all on function public.export_format_for_kind(public.export_kind)
  from public, anon, authenticated;
revoke all on function public.export_contract_version(public.export_kind, public.export_format)
  from public, anon, authenticated;
revoke all on function public.export_audience_allowed(uuid, uuid, public.export_audience)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- request_export: claim (or replay) an export request in one transaction.
--
-- Returns the effective organization id, the export request id and the request
-- state after this call:
--   'generating' — the request is claimed and generation must now run;
--   'available'  — a repeat of an equivalent completed request; the caller must
--                  return that export unchanged;
--   'failed'     — the equivalent request already failed; nothing is regenerated;
--   'denied'     — this call was refused on audience or consent grounds. The
--                  refusal is a persisted, audited state and the service maps it
--                  to FORBIDDEN (the SQLSTATE 42501 contract callers already know).
--
-- Raises:
--   42501 — anonymous caller, or a client the caller must not learn about
--           (no tenant membership / no client access). Nothing is written: an
--           audit row is never fabricated for a client the caller may not know;
--   22023 — malformed request (unknown kind/format, mismatched contract version,
--           blank idempotency key);
--   23505 — the same idempotency key with different parameters (conflict).
--
-- Why denial returns instead of raising: a PL/pgSQL exception handler that
-- re-raises also rolls back its own writes, so a denial recorded in the handler
-- and then `raise`d would persist no `denied` row and no `export.denied` audit
-- row. Recording the refusal and returning it keeps the transition durable.
-- ---------------------------------------------------------------------------
create or replace function public.request_export(
  p_client_id uuid,
  p_kind public.export_kind,
  p_format public.export_format,
  p_contract_version text,
  p_audience public.export_audience,
  p_idempotency_key text,
  p_snapshot_version integer default null
)
returns table (organization_id uuid, export_id uuid, state public.export_request_status)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid;
  v_org uuid;
  v_expected_format public.export_format;
  v_expected_contract text;
  v_existing public.export_requests%rowtype;
  v_export_id uuid;
  v_status public.export_request_status;
begin
  v_actor := auth.uid();
  if v_actor is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  select c.organization_id into v_org
  from public.clients c
  where c.id = p_client_id;

  -- An unknown client and a client of another tenant are indistinguishable to
  -- the caller: both are "no access", and neither leaves an audit row.
  if v_org is null or not (
    public.is_org_member(v_org)
    and public.is_client_accessible(v_org, p_client_id, false)
  ) then
    raise exception 'no access to this client' using errcode = '42501';
  end if;

  if p_idempotency_key is null or btrim(p_idempotency_key) = ''
    or length(p_idempotency_key) > 200
  then
    raise exception 'idempotency key is required (max 200 characters)'
      using errcode = '22023';
  end if;

  v_expected_format := public.export_format_for_kind(p_kind);
  if p_format <> v_expected_format then
    raise exception 'export kind % produces format %, not %',
      p_kind, v_expected_format, p_format using errcode = '22023';
  end if;

  v_expected_contract := public.export_contract_version(p_kind, p_format);
  if p_contract_version is null or p_contract_version <> v_expected_contract then
    raise exception 'unsupported contract version for this export kind'
      using errcode = '22023';
  end if;

  if (p_format in ('markdown', 'pdf')) <> (p_snapshot_version is not null) then
    raise exception 'snapshot version is required exactly for report exports'
      using errcode = '22023';
  end if;

  -- Idempotency: an equivalent replay returns the same export, including its
  -- failed/denied outcome; only a different request identity is a conflict.
  select * into v_existing
  from public.export_requests e
  where e.organization_id = v_org
    and e.idempotency_key = p_idempotency_key;

  if found then
    if v_existing.client_id = p_client_id
      and v_existing.kind = p_kind
      and v_existing.format = p_format
      and v_existing.contract_version = p_contract_version
      and v_existing.audience = p_audience
      and v_existing.snapshot_version is not distinct from p_snapshot_version
    then
      return query select v_org, v_existing.id, v_existing.status as state;
      return;
    end if;
    raise exception 'idempotency key already used with different export parameters'
      using errcode = '23505';
  end if;

  -- Claim the request, then audit it in the same transaction. actor is pinned by
  -- append_audit() to auth.uid(); the payload carries no export content.
  insert into public.export_requests (
    organization_id,
    client_id,
    kind,
    format,
    contract_version,
    audience,
    snapshot_version,
    idempotency_key,
    actor_user_id,
    status
  )
  values (
    v_org,
    p_client_id,
    p_kind,
    p_format,
    p_contract_version,
    p_audience,
    p_snapshot_version,
    p_idempotency_key,
    v_actor,
    'generating'
  )
  returning id into v_export_id;

  perform public.append_audit(
    p_organization_id => v_org,
    p_entity_type => 'client',
    p_entity_id => p_client_id,
    p_action => 'export.requested',
    p_before => null,
    p_after => jsonb_build_object(
      'export_id', v_export_id,
      'kind', p_kind,
      'format', p_format,
      'contract_version', p_contract_version,
      'audience', p_audience,
      'snapshot_version', p_snapshot_version
    ),
    p_reason => null,
    p_ip_address => null,
    p_user_agent => null
  );

  -- Audience and consent are re-asserted INSIDE the transaction, after the
  -- request exists so a refusal can be recorded as a real `denied` transition.
  -- The guard raises 42501; the handler turns that into the persisted denial and
  -- records why, so the caller receives a state instead of a rolled-back write.
  begin
    if not public.export_audience_allowed(v_org, p_client_id, p_audience) then
      raise exception 'export audience % is not allowed for this caller', p_audience
        using errcode = '42501';
    end if;

    if p_kind in ('client_archive', 'signals_csv')
      and not public.has_consent(p_client_id, 'data_storage')
    then
      raise exception 'missing consent: data_storage' using errcode = '42501';
    end if;

    if p_kind = 'supervision_export' then
      if not public.has_consent(p_client_id, 'supervisor_access') then
        raise exception 'missing consent: supervisor_access' using errcode = '42501';
      end if;
      if not public.has_consent(p_client_id, 'anonymized_analytics') then
        raise exception 'missing consent: anonymized_analytics' using errcode = '42501';
      end if;
    end if;
  exception
    when insufficient_privilege then
      v_status := 'denied';
      update public.export_requests
      set status = 'denied',
          denied_at = now(),
          failure_code = 'authorization_denied'
      where id = v_export_id;

      perform public.append_audit(
        p_organization_id => v_org,
        p_entity_type => 'client',
        p_entity_id => p_client_id,
        p_action => 'export.denied',
        p_before => jsonb_build_object('status', 'generating'),
        p_after => jsonb_build_object(
          'export_id', v_export_id,
          'status', 'denied',
          'failure_code', 'authorization_denied'
        ),
        p_reason => 'export authorization or consent refused',
        p_ip_address => null,
        p_user_agent => null
      );
  end;

  return query select v_org, v_export_id,
    coalesce(v_status, 'generating'::public.export_request_status) as state;
end;
$$;

-- ---------------------------------------------------------------------------
-- complete_export_request: requested/generating → available, with the artifact
-- metadata and the completion audit row in one transaction.
--
-- The artifact metadata triple is mandatory and the transition is exclusive: a
-- row that is already `available` (or terminal) is rejected, so a partial file
-- can never replace a complete one, and a failed generation cannot be flipped to
-- downloadable without producing a complete artifact.
-- ---------------------------------------------------------------------------
-- ---------------------------------------------------------------------------
-- Internal: append an audit row for a system-driven export transition. These run
-- as service_role (auth.uid() is null), so append_audit() -- which requires an
-- organization membership for the current actor -- cannot be used. The actor is
-- taken from the export request row, pinned when the user asked for the export.
-- ---------------------------------------------------------------------------
create or replace function public.append_export_audit(
  p_org_id uuid,
  p_client_id uuid,
  p_actor_user_id uuid,
  p_action text,
  p_before jsonb,
  p_after jsonb,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if p_actor_user_id is null then
    raise exception 'an export transition needs its requesting actor' using errcode = '22023';
  end if;
  if p_action is null or btrim(p_action) = '' then
    raise exception 'an audit action is required' using errcode = '22023';
  end if;

  insert into public.audit_log (
    organization_id, actor_user_id, entity_type, entity_id,
    action, before_data, after_data, reason
  )
  values (
    p_org_id, p_actor_user_id, 'client', p_client_id,
    p_action, p_before, p_after, p_reason
  )
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.complete_export_request(
  p_export_id uuid,
  p_artifact_path text,
  p_artifact_filename text,
  p_artifact_sha256 text,
  p_artifact_bytes bigint
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request public.export_requests%rowtype;
  v_updated integer;
begin
  select * into v_request
  from public.export_requests e
  where e.id = p_export_id
  for update;

  if not found then
    raise exception 'export request not found' using errcode = '22023';
  end if;

  -- System transition: only service_role may execute this function (see the
  -- grants below), and the audit row is attributed to the pinned requester.
  if v_request.status <> 'generating' then
    raise exception 'export request % is not generating', v_request.status
      using errcode = '55000';
  end if;

  if p_artifact_path is null or btrim(p_artifact_path) = ''
    or p_artifact_filename is null or btrim(p_artifact_filename) = ''
    or p_artifact_sha256 is null or p_artifact_sha256 !~ '^[0-9a-f]{64}$'
    or p_artifact_bytes is null or p_artifact_bytes <= 0
  then
    raise exception 'a complete artifact (path, filename, sha256, bytes) is required'
      using errcode = '22023';
  end if;

  update public.export_requests
  set status = 'available',
      artifact_path = p_artifact_path,
      artifact_filename = p_artifact_filename,
      artifact_sha256 = p_artifact_sha256,
      artifact_bytes = p_artifact_bytes,
      generated_at = coalesce(generated_at, now()),
      completed_at = now(),
      failure_code = null
  where id = p_export_id
    and status = 'generating'
    and artifact_path is null;

  get diagnostics v_updated = row_count;
  if v_updated = 0 then
    raise exception 'export request was already finalized' using errcode = '55000';
  end if;

  perform public.append_export_audit(
    p_org_id => v_request.organization_id,
    p_client_id => v_request.client_id,
    p_actor_user_id => v_request.actor_user_id,
    p_action => 'export.completed',
    p_before => jsonb_build_object('status', 'generating'),
    p_after => jsonb_build_object(
      'export_id', p_export_id,
      'status', 'available',
      'kind', v_request.kind,
      'format', v_request.format,
      'contract_version', v_request.contract_version,
      'audience', v_request.audience,
      'artifact_sha256', p_artifact_sha256,
      'artifact_bytes', p_artifact_bytes
    ),
    p_reason => null
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- fail_export_request: generating → failed. The row keeps its kind/contract and
-- its `export.requested` audit row, so a failure is recoverable and auditable by
-- issuing a new request with a new idempotency key; it never becomes available.
-- ---------------------------------------------------------------------------
create or replace function public.fail_export_request(
  p_export_id uuid,
  p_failure_code text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request public.export_requests%rowtype;
  v_updated integer;
begin
  select * into v_request
  from public.export_requests e
  where e.id = p_export_id
  for update;

  if not found then
    raise exception 'export request not found' using errcode = '22023';
  end if;

  -- System transition: service_role only (see the grants below); the audit row
  -- is attributed to the requester pinned on the row when it was created.
  if p_failure_code is null or btrim(p_failure_code) = '' or length(p_failure_code) > 100 then
    raise exception 'a stable failure code is required' using errcode = '22023';
  end if;

  update public.export_requests
  set status = 'failed',
      failed_at = now(),
      failure_code = p_failure_code,
      artifact_path = null,
      artifact_filename = null,
      artifact_sha256 = null,
      artifact_bytes = null
  where id = p_export_id
    and status = 'generating';

  get diagnostics v_updated = row_count;
  if v_updated = 0 then
    -- Already finalized (including an already-failed retry): nothing to change,
    -- so no second terminal audit row is fabricated.
    return;
  end if;

  perform public.append_export_audit(
    p_org_id => v_request.organization_id,
    p_client_id => v_request.client_id,
    p_actor_user_id => v_request.actor_user_id,
    p_action => 'export.failed',
    p_before => jsonb_build_object('status', 'generating'),
    p_after => jsonb_build_object(
      'export_id', p_export_id,
      'status', 'failed',
      'failure_code', p_failure_code
    ),
    p_reason => null
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Private storage bucket for generated artifacts. Declared in the migration (not
-- only in supabase/config.toml) so `supabase db reset` and any fresh environment
-- converge on the same private bucket without an extra `supabase stop / start`.
-- No storage.objects policy is created: the bucket is reachable by the service
-- role only.
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'client-exports',
  'client-exports',
  false,
  52428800,
  array[
    'application/json',
    'application/vnd.live-client-map.client-archive+json',
    'application/vnd.live-client-map.supervision-export+json',
    'text/csv'
  ]
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- ---------------------------------------------------------------------------
-- Least privilege: helpers are internal; the three lifecycle RPCs are granted
-- to authenticated and service_role only.
-- ---------------------------------------------------------------------------
revoke all on function public.request_export(
  uuid, public.export_kind, public.export_format, text, public.export_audience, text, integer
) from public, anon, authenticated;
revoke all on function public.append_export_audit(uuid, uuid, uuid, text, jsonb, jsonb, text)
  from public, anon, authenticated;
revoke all on function public.complete_export_request(uuid, text, text, text, bigint)
  from public, anon, authenticated;
revoke all on function public.fail_export_request(uuid, text) from public, anon, authenticated;

grant execute on function public.request_export(
  uuid, public.export_kind, public.export_format, text, public.export_audience, text, integer
) to authenticated, service_role;

-- Internal helpers keep no client-facing EXECUTE even though PostgreSQL grants
-- EXECUTE to PUBLIC by default.
revoke all on function public.opaque_export_ref(uuid) from public, anon, authenticated;
revoke all on function public.export_format_for_kind(public.export_kind)
  from public, anon, authenticated;
revoke all on function public.export_contract_version(public.export_kind, public.export_format)
  from public, anon, authenticated;
revoke all on function public.export_audience_allowed(uuid, uuid, public.export_audience)
  from public, anon, authenticated;
grant execute on function public.complete_export_request(uuid, text, text, text, bigint)
  to service_role;
grant execute on function public.fail_export_request(uuid, text) to service_role;

-- Table privileges: reads go through RLS, writes only through the RPCs.
revoke all on table public.export_requests from public, anon;
grant select on table public.export_requests to authenticated;
grant select, insert, update, delete on table public.export_requests to service_role;
