-- 0052: Secure export download + 30-day retention (ticket 20, docs/data-exchange-contracts.md §10).
--
-- §10 requires the export authorization to be re-asserted "ещё раз перед download"
-- and the private artifact to be deleted after 30 days with an audit row. Ticket 19
-- built the request lifecycle and the private bucket but deliberately left no
-- downloadable path: no storage policy exists, so an artifact can only be reached
-- through this migration's delivery RPCs.
--
-- Download (two RPCs, split so the audit can describe the bytes actually served)
-- ---------------------------------------------------------------------------
--   claim_export_download(export_id)                  -- user session, re-authorizes
--   record_export_download(export_id, bytes, sha256)  -- service_role, audits delivery
--
--   claim_export_download() re-runs, against the CALLER's live session, exactly the
--   gates the artifact was built with:
--     * tenant membership + ClientAssignment   (is_org_member + is_client_accessible);
--     * audience role / visibility             (export_audience_allowed: owner /
--                                               primary|secondary specialist /
--                                               supervisor);
--     * type-specific consent                  (data_storage for archive + signals;
--                                               supervisor_access + anonymized_analytics
--                                               for the supervision export);
--     * relationship privacy                   (for a client archive, no partner of the
--                                               subject may have WITHDRAWN the
--                                               `relationship_analysis` consent §11 needs
--                                               — otherwise the prepared file holds data a
--                                               partner has since withdrawn);
--     * status `available` AND `expires_at` still in the future.
--
--   A refusal on a row the caller IS allowed to know about (same tenant, client
--   accessible) is recorded as a durable `export.denied` audit row plus a
--   `download_denied_count` increment on the request, and returned as
--   outcome = 'denied'.
--
--   Why a denial is a RETURNED state and not an exception: PostgREST runs one RPC
--   as one transaction, so a function that writes the denial audit row and then
--   raises rolls both the write and the row back — the caller would see the
--   refusal but no evidence of it. This is the same lesson migration 0051 records
--   for request_export(). The service maps outcome = 'denied' to the ordinary
--   FORBIDDEN contract. The "no tenant/client access at all" branch still raises
--   42501 before any write, so no audit row is ever fabricated for a client the
--   caller must not learn about.
--
--   The split between claim and record exists so the delivery audit can carry the
--   size and sha256 of the bytes that were really handed out. The service reads the
--   object with the service role, verifies the sha256 recorded at completion, and
--   calls record_export_download(). Neither RPC ever returns a storage path or a
--   signed URL to the caller: the database stays the only authority on "may this
--   artifact be delivered", and the bytes never leave the server.
--
-- Retention (one RPC, safe to re-run)
-- ---------------------------------------------------------------------------
--   expire_export_requests(limit)                     -- service_role only, batch reaper
--
--   Two states can outlive their 30 days:
--     * `available`  — the artifact must be deleted and the row moved to `expired`;
--     * `generating` — ticket 19's hung request, which pinned its idempotency key
--                      forever and can never become downloadable. It is closed as
--                      `failed` / `generation_timeout`.
--
--   Idempotency and partial-failure safety:
--     * candidates are selected `for update skip locked`, so two concurrent runs
--       never process the same row and never block each other;
--     * storage deletion happens in the service BEFORE this RPC, so a crash in
--       between leaves an `available` row whose object is already gone — the retry
--       deletes nothing and still expires the row;
--     * a terminal row is not a candidate, so re-running writes no second
--       transition and no second audit row;
--     * the batch commits per row, so a later failure does not undo earlier work.
--
-- The audit rows are appended through append_export_audit() (migration 0051), which
-- attributes them to the actor pinned on the request row, because a retention run
-- has no JWT subject. Payloads carry ids, counts and a sha256 only — never file
-- content, a filename or a storage path (artifact_path is cleared in the same
-- statement that expires the row).

-- ---------------------------------------------------------------------------
-- New columns: retention evidence and the denial/delivery counters.
-- ---------------------------------------------------------------------------

alter table public.export_requests
  add column if not exists expired_at timestamptz,
  add column if not exists last_downloaded_at timestamptz,
  add column if not exists download_denied_count integer not null default 0;

-- The ticket-19 index covers (organization_id, status, expires_at); this one serves
-- the cross-organization retention scan.
create index if not exists export_requests_expiry_idx
  on public.export_requests (status, expires_at);

-- A row can only be `expired` with a recorded expiry timestamp, so the state and
-- its evidence cannot drift apart.
alter table public.export_requests
  drop constraint if exists export_requests_expired_at_check;
alter table public.export_requests
  add constraint export_requests_expired_at_check
  check (status <> 'expired' or expired_at is not null);

-- ---------------------------------------------------------------------------
-- Internal: did every partner of this client WITHDRAW the
-- `relationship_analysis` consent the §11 archive needs?
--
-- §11 includes a relationship only when BOTH clients hold active
-- `relationship_analysis` consent, and creating a relationship already requires
-- that consent (public.createRelationship). A partner who has revoked it since the
-- artifact was built therefore means the prepared FILE holds data they have
-- withdrawn, so delivery must be refused.
--
-- The rule is deliberately about withdrawal rather than a build timestamp:
-- revocation is the event that invalidates an artifact that was legally built, and
-- comparing against `generated_at` would race with the microseconds between
-- granting consent and building the file. A relationship created AFTER the export
-- cannot deny delivery on its own (creating it needs active consent); refusing is
-- the safe direction and re-issuing the export is the remedy.
-- ---------------------------------------------------------------------------
create or replace function public.export_relationship_consent_withdrawn(
  p_client_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_row record;
begin
  for v_row in
    select r.client_a_id, r.client_b_id
    from public.relationships r
    where r.client_a_id = p_client_id
       or r.client_b_id = p_client_id
  loop
    if v_row.client_a_id <> p_client_id
      and not public.has_consent(v_row.client_a_id, 'relationship_analysis')
    then
      return true;
    end if;

    if v_row.client_b_id <> p_client_id
      and not public.has_consent(v_row.client_b_id, 'relationship_analysis')
    then
      return true;
    end if;
  end loop;

  return false;
end;
$$;

revoke all on function public.export_relationship_consent_withdrawn(uuid)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- claim_export_download: re-authorize this caller for this export, right now.
--
-- Returns exactly one row:
--   outcome = 'granted'     → every claim_* column is populated;
--   outcome = 'denied'      → the denial audit row and the download_denied_count
--                             increment were written in THIS transaction;
--   outcome = 'unavailable' → terminal status or past `expires_at`; no denial row,
--                             because an expired artifact is not an access refusal.
--
-- Raises:
--   42501 — anonymous caller, unknown export id, no tenant/client access. Nothing
--           is written: a caller who may not know the client leaves no trace;
--   22023 — malformed export id.
-- ---------------------------------------------------------------------------
create or replace function public.claim_export_download(p_export_id uuid)
returns table (
  outcome text,
  claim_export_id uuid,
  claim_organization_id uuid,
  claim_client_id uuid,
  claim_kind public.export_kind,
  claim_format public.export_format,
  claim_contract_version text,
  claim_audience public.export_audience,
  claim_artifact_path text,
  claim_artifact_filename text,
  claim_artifact_sha256 text,
  claim_artifact_bytes bigint,
  claim_expires_at timestamptz,
  claim_download_count integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid;
  v_claim public.export_requests%rowtype;
  v_reason text;
begin
  v_actor := auth.uid();

  select * into v_claim
  from public.export_requests e
  where e.id = p_export_id;

  if not found then
    -- An unknown export id is indistinguishable from one the caller may not see.
    raise exception 'export request not found' using errcode = '42501';
  end if;

  -- Tenant + ClientAssignment, evaluated for the caller of THIS call. The owner
  -- branch of is_client_accessible is what lets an organization owner download
  -- without a personal assignment.
  if v_actor is null or not (
    public.is_org_member(v_claim.organization_id)
    and public.is_client_accessible(v_claim.organization_id, v_claim.client_id, false)
  ) then
    raise exception 'no access to this export' using errcode = '42501';
  end if;

  if v_claim.status <> 'available'
    or v_claim.artifact_path is null
    or v_claim.expires_at <= now()
  then
    return query select 'unavailable'::text, null::uuid, null::uuid, null::uuid,
      null::public.export_kind, null::public.export_format, null::text,
      null::public.export_audience, null::text, null::text, null::text,
      null::bigint, null::timestamptz, null::integer;
    return;
  end if;

  -- Audience role, type-specific consent and relationship privacy, re-evaluated
  -- against the live session. The reason is a stable code with no client data.
  v_reason := null;

  if not public.export_audience_allowed(
    v_claim.organization_id, v_claim.client_id, v_claim.audience
  ) then
    v_reason := 'audience_revoked';
  elsif v_claim.kind in ('client_archive', 'signals_csv')
    and not public.has_consent(v_claim.client_id, 'data_storage')
  then
    v_reason := 'consent_revoked';
  elsif v_claim.kind = 'supervision_export' and (
    not public.has_consent(v_claim.client_id, 'supervisor_access')
    or not public.has_consent(v_claim.client_id, 'anonymized_analytics')
  ) then
    v_reason := 'consent_revoked';
  elsif v_claim.kind = 'client_archive'
    and public.export_relationship_consent_withdrawn(v_claim.client_id)
  then
    v_reason := 'relationship_consent_revoked';
  end if;

  if v_reason is not null then
    update public.export_requests
    set download_denied_count = download_denied_count + 1
    where id = p_export_id;

    perform public.append_export_audit(
      p_org_id => v_claim.organization_id,
      p_client_id => v_claim.client_id,
      p_actor_user_id => v_claim.actor_user_id,
      p_action => 'export.denied',
      p_before => jsonb_build_object('status', 'available'),
      p_after => jsonb_build_object(
        'export_id', p_export_id,
        'status', 'available',
        'failure_code', 'download_' || v_reason,
        'kind', v_claim.kind,
        'format', v_claim.format,
        'audience', v_claim.audience
      ),
      p_reason => 'export download refused: ' || v_reason
    );

    -- Return the refusal so the audit row above COMMITS: raising here would roll
    -- the whole transaction (including the denial) back.
    return query select 'denied'::text, null::uuid, null::uuid, null::uuid,
      null::public.export_kind, null::public.export_format, null::text,
      null::public.export_audience, null::text, null::text, null::text,
      null::bigint, null::timestamptz, null::integer;
    return;
  end if;

  return query
  select
    'granted'::text,
    v_claim.id,
    v_claim.organization_id,
    v_claim.client_id,
    v_claim.kind,
    v_claim.format,
    v_claim.contract_version,
    v_claim.audience,
    v_claim.artifact_path,
    v_claim.artifact_filename,
    v_claim.artifact_sha256,
    v_claim.artifact_bytes,
    v_claim.expires_at,
    v_claim.download_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- record_export_download: the delivery audit of ONE served artifact.
--
-- The bytes are already on the wire when this runs, so it records what was served
-- (size + sha256 of the delivered payload) instead of a filename, a storage path
-- or a signed URL. The counter and the audit row are written in one transaction;
-- an expired or non-available row refuses the recording.
-- ---------------------------------------------------------------------------
create or replace function public.record_export_download(
  p_export_id uuid,
  p_bytes bigint,
  p_sha256 text
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request public.export_requests%rowtype;
  v_count integer;
begin
  if p_bytes is null or p_bytes <= 0
    or p_sha256 is null or p_sha256 !~ '^[0-9a-f]{64}$'
  then
    raise exception 'a delivered artifact needs its size and checksum'
      using errcode = '22023';
  end if;

  select * into v_request
  from public.export_requests e
  where e.id = p_export_id
  for update;

  if not found then
    raise exception 'export request not found' using errcode = '22023';
  end if;

  if v_request.status <> 'available' or v_request.expires_at <= now() then
    raise exception 'export request is no longer downloadable' using errcode = '55000';
  end if;

  update public.export_requests
  set download_count = v_request.download_count + 1,
      last_downloaded_at = now()
  where id = p_export_id
  returning download_count into v_count;

  perform public.append_export_audit(
    p_org_id => v_request.organization_id,
    p_client_id => v_request.client_id,
    p_actor_user_id => v_request.actor_user_id,
    p_action => 'export.downloaded',
    p_before => null,
    p_after => jsonb_build_object(
      'export_id', p_export_id,
      'status', 'available',
      'kind', v_request.kind,
      'format', v_request.format,
      'contract_version', v_request.contract_version,
      'audience', v_request.audience,
      'artifact_bytes', p_bytes,
      'artifact_sha256', p_sha256,
      'download_count', v_count
    ),
    p_reason => null
  );

  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- expire_export_requests: close every request whose 30 days are over.
--
-- The service deletes the storage object first (see the module docstring), then
-- calls this with the same candidate selection rules. `for update skip locked`
-- keeps two concurrent runs from fighting over a row, and each row is its own
-- statement pair so one bad row does not roll back earlier expired rows.
--
-- Returns (export_id, outcome) with outcome in ('expired', 'failed'); 0 rows means
-- nothing was due.
-- ---------------------------------------------------------------------------
create or replace function public.expire_export_requests(p_limit integer default 100)
returns table (export_id uuid, outcome text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.export_requests%rowtype;
  v_updated integer;
begin
  if p_limit is null or p_limit <= 0 or p_limit > 1000 then
    raise exception 'expiry batch size must be between 1 and 1000' using errcode = '22023';
  end if;

  for v_row in
    select *
    from public.export_requests e
    where e.status in ('available', 'generating')
      and e.expires_at <= now()
    order by e.expires_at asc
    limit p_limit
    for update skip locked
  loop
    if v_row.status = 'available' then
      update public.export_requests
      set status = 'expired',
          expired_at = now(),
          -- The private object is already gone (the service deletes before this
          -- RPC), so no storage path may survive on the row.
          artifact_path = null,
          artifact_filename = null,
          failure_code = null
      where id = v_row.id
        and status = 'available';

      get diagnostics v_updated = row_count;

      if v_updated > 0 then
        perform public.append_export_audit(
          p_org_id => v_row.organization_id,
          p_client_id => v_row.client_id,
          p_actor_user_id => v_row.actor_user_id,
          p_action => 'export.expired',
          p_before => jsonb_build_object('status', 'available'),
          p_after => jsonb_build_object(
            'export_id', v_row.id,
            'status', 'expired',
            'kind', v_row.kind,
            'format', v_row.format,
            'audience', v_row.audience,
            'artifact_bytes', v_row.artifact_bytes,
            'download_count', v_row.download_count
          ),
          p_reason => 'retention: artifact deleted after 30 days'
        );

        export_id := v_row.id;
        outcome := 'expired';
        return next;
      end if;
    else
      -- Ticket 19's hung request: generation never finished, so no artifact exists
      -- and none will ever be produced. Closing the row in a terminal state
      -- releases it from the candidate scan instead of pinning it forever.
      update public.export_requests
      set status = 'failed',
          failed_at = now(),
          failure_code = 'generation_timeout',
          artifact_path = null,
          artifact_filename = null,
          artifact_sha256 = null,
          artifact_bytes = null
      where id = v_row.id
        and status = 'generating';

      get diagnostics v_updated = row_count;

      if v_updated > 0 then
        perform public.append_export_audit(
          p_org_id => v_row.organization_id,
          p_client_id => v_row.client_id,
          p_actor_user_id => v_row.actor_user_id,
          p_action => 'export.failed',
          p_before => jsonb_build_object('status', 'generating'),
          p_after => jsonb_build_object(
            'export_id', v_row.id,
            'status', 'failed',
            'failure_code', 'generation_timeout',
            'kind', v_row.kind,
            'format', v_row.format,
            'audience', v_row.audience
          ),
          p_reason => 'retention: generation did not complete within 30 days'
        );

        export_id := v_row.id;
        outcome := 'failed';
        return next;
      end if;
    end if;
  end loop;

  return;
end;
$$;

-- ---------------------------------------------------------------------------
-- Least privilege.
--   * claim_export_download  — user-facing: authenticated + service_role;
--   * record_export_download — system transition: service_role only;
--   * expire_export_requests — system transition: service_role only;
--   * the relationship-privacy helper stays internal.
-- No table privilege is added for anon.
-- ---------------------------------------------------------------------------
revoke all on function public.claim_export_download(uuid) from public, anon, authenticated;
revoke all on function public.record_export_download(uuid, bigint, text)
  from public, anon, authenticated;
revoke all on function public.expire_export_requests(integer) from public, anon, authenticated;

grant execute on function public.claim_export_download(uuid) to authenticated, service_role;
grant execute on function public.record_export_download(uuid, bigint, text) to service_role;
grant execute on function public.expire_export_requests(integer) to service_role;
