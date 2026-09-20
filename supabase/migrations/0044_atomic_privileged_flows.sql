-- 0044: Atomic privileged erasure, legal-hold and access flows (ticket 08).
--
-- Template: supabase/migrations/0039_atomic_business_mutation.sql, reusing the
-- shared guards from 0039/0041/0042 (require_org_member_actor,
-- assert_client_write, assert_client_consent, append_audit).
--
-- Transaction gaps this migration closes
-- -------------------------------------------------------------------------
--   * executeErasure() orchestrated the whole erasure from the service layer as
--     eight independent PostgREST calls. A failure after
--     anonymize_client_audit() — which is irreversible — but before the client
--     delete left a live client whose audit trail was already stripped; a
--     failure between the delete and the erasure_requests update left a request
--     stuck in_progress without its backup_marker and with no client to retry
--     against.
--   * legal_hold was read in a separate transaction before the irreversible
--     steps, so a legal hold committed concurrently could be silently ignored.
--   * setLegalHold() and revokeDataStorage() bypassed RLS through service_role
--     after a client-side is_org_owner() probe, and each paired its write with a
--     separate recordAudit()/upsert() call that could fail independently.
--   * createSafetyReview(), createPortalUser() and revokePortalUser() wrote an
--     access/safety control row and then appended the audit row as a second
--     network call: the control could exist without its audit trail.
--
-- Every path below is now one transaction. Authorization resolves from
-- auth.uid() INSIDE the RPC, before any RLS-bypassing write, and the AuditLog
-- append travels the same single write path (append_audit). Public service
-- contracts are unchanged; the services call these RPCs through runAtomicRpc().
--
-- Erasure semantics (unchanged, now transactional)
-- -------------------------------------------------------------------------
--   * Owner-only: require_org_owner_actor() raises 42501 for anyone else.
--   * legal_hold is re-checked on the locked client row before anything
--     irreversible runs; a hold returns status "blocked" and touches nothing.
--   * Every active consent is revoked before the first irreversible write, so
--     the AI / portal / supervisor gates can no longer observe active consent.
--   * The audit trail is anonymized (never deleted) and ai_runs are purged
--     inside the same transaction as the client delete: the append-only guards
--     are opened only for this transaction via the transaction-local
--     `app.data_erasure` flag.
--   * Idempotent/recoverable retry: a completed request is never re-run; a
--     request whose client is already gone is finalized instead of failing.
--
-- Least privilege: internal helpers are revoked from public, anon AND
-- authenticated and are NOT granted to any client role — the SECURITY DEFINER
-- RPCs call them with the migration owner's privileges. Only genuinely public
-- RPCs are granted to authenticated, service_role.

-- ---------------------------------------------------------------------------
-- Internal helpers
-- ---------------------------------------------------------------------------

-- Internal: the opaque, non-reversible client handle. Must stay byte-for-byte
-- identical to opaqueClientRef() in lib/service/erasure.ts
-- (sha256(client_id)[0..16] in hex); the integration suite asserts both agree.
create or replace function public.opaque_client_ref(p_client_id uuid)
returns text
language sql
immutable
set search_path = public
as $$
  select substring(encode(sha256(convert_to(p_client_id::text, 'UTF8')), 'hex') from 1 for 16);
$$;

-- Internal: resolve the authenticated actor and assert that it owns the
-- organization. Raised before any RLS-bypassing write so an unauthenticated or
-- non-owner caller can never reach the destructive statements below.
create or replace function public.require_org_owner_actor(p_organization_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
begin
  if v_actor is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if not public.is_org_owner(p_organization_id) then
    raise exception 'only the organization owner can perform this operation'
      using errcode = '42501';
  end if;
  return v_actor;
end;
$$;

-- Internal: the client-scoped tables whose rows a full erasure removes. Kept in
-- SQL so the erasure RPC and the service preview derive their impact from one
-- list; every table below has a `client_id` column and cascades from `clients`.
-- `relationships` / `relationship_dynamics` are collected separately by key and
-- `clients` itself is the deleted row.
create or replace function public.erasure_impact_tables()
returns text[]
language sql
immutable
set search_path = public
as $$
  select array[
    'behavioral_markers',
    'client_assignments',
    'client_feedback_forms',
    'client_goals',
    'client_portal_users',
    'client_requests',
    'consent_records',
    'core_node_reactivations',
    'core_node_relations',
    'core_nodes',
    'corrections',
    'development_targets',
    'diagnostic_session_summaries',
    'diagnostic_sessions',
    'differential_hypotheses',
    'evidence_clusters',
    'follow_ups',
    'imports',
    'life_events',
    'model_changes',
    'model_explanations',
    'observations',
    'psychological_snapshots',
    'purpose_profiles',
    'purpose_syntheses',
    'recommendations',
    'resources',
    'safety_reviews',
    'signals',
    'themes',
    'triggers'
  ]::text[];
$$;

revoke all on function public.opaque_client_ref(uuid) from public, anon, authenticated;
revoke all on function public.require_org_owner_actor(uuid) from public, anon, authenticated;
revoke all on function public.erasure_impact_tables() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Legal hold: one Owner-only transaction with its audit row.
-- ---------------------------------------------------------------------------

-- Set or clear the legal hold that defers erasure. Idempotent: setting the
-- current value changes nothing and writes no second audit row. The client row
-- is locked FOR UPDATE so this decision serializes with execute_client_erasure()
-- — either the hold commits first (and the erasure sees it) or the erasure
-- commits first (and this call then finds no client).
create or replace function public.set_client_legal_hold(
  p_client_id uuid,
  p_hold boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_client public.clients;
  v_actor uuid;
begin
  if p_hold is null then
    raise exception 'hold is required' using errcode = '22023';
  end if;

  select * into v_client
  from public.clients c
  where c.id = p_client_id
  for update;

  if v_client.id is null then
    raise exception 'client not found' using errcode = '22023';
  end if;

  v_actor := public.require_org_owner_actor(v_client.organization_id);

  if v_client.legal_hold = p_hold then
    return jsonb_build_object(
      'client_id', p_client_id, 'legal_hold', p_hold, 'changed', false
    );
  end if;

  update public.clients
  set legal_hold = p_hold, updated_at = now()
  where id = p_client_id;

  perform public.append_audit(
    v_client.organization_id,
    'client',
    p_client_id,
    case when p_hold then 'client.legal_hold_set' else 'client.legal_hold_cleared' end,
    jsonb_build_object('legal_hold', v_client.legal_hold),
    jsonb_build_object('legal_hold', p_hold),
    null, null, null
  );

  return jsonb_build_object('client_id', p_client_id, 'legal_hold', p_hold, 'changed', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- Erasure request: revoke data_storage and record the request in one step.
-- ---------------------------------------------------------------------------

-- The ticket 05 trigger: the Owner revokes the `data_storage` consent and an
-- erasure request is recorded. Both commit or roll back together, so a revoked
-- consent can never be missing its request (and vice versa). Idempotent: a
-- terminal request is never downgraded.
create or replace function public.request_client_erasure(p_client_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_client public.clients;
  v_actor uuid;
  v_request public.erasure_requests;
  v_ref text;
begin
  select * into v_client
  from public.clients c
  where c.id = p_client_id
  for update;

  if v_client.id is null then
    raise exception 'client not found' using errcode = '22023';
  end if;

  v_actor := public.require_org_owner_actor(v_client.organization_id);
  v_ref := public.opaque_client_ref(p_client_id);

  update public.consent_records
  set revoked_at = now()
  where client_id = p_client_id
    and consent_type = 'data_storage'
    and revoked_at is null;

  select * into v_request
  from public.erasure_requests r
  where r.organization_id = v_client.organization_id
    and r.client_ref = v_ref;

  if v_request.id is not null and v_request.status in ('completed', 'blocked') then
    return jsonb_build_object(
      'erasure_request_id', v_request.id,
      'client_ref', v_ref,
      'status', v_request.status
    );
  end if;

  insert into public.erasure_requests as er (
    organization_id, client_id, client_ref, status, requested_by
  )
  values (v_client.organization_id, p_client_id, v_ref, 'requested', v_actor)
  on conflict (organization_id, client_ref) do update
    set client_id = excluded.client_id,
        status = 'requested',
        requested_by = excluded.requested_by,
        blocked_reason = null,
        failed_at = null
  returning * into v_request;

  return jsonb_build_object(
    'erasure_request_id', v_request.id,
    'client_ref', v_ref,
    'status', v_request.status
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Full erasure: one transaction for the gates, the audit anonymization, the
-- AI-run purge and the hard delete.
-- ---------------------------------------------------------------------------

create or replace function public.execute_client_erasure(p_client_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_client public.clients;
  v_request public.erasure_requests;
  v_actor uuid;
  v_ref text;
  v_org uuid;
  v_table text;
  v_ids uuid[];
  v_entity_ids uuid[] := '{}'::uuid[];
  v_impacted jsonb := '{}'::jsonb;
  v_count integer;
  v_now timestamptz := now();
  v_deleted integer;
  v_backup jsonb;
begin
  v_ref := public.opaque_client_ref(p_client_id);

  -- Lock the client row first so set_client_legal_hold() serializes with this
  -- decision instead of racing it.
  select * into v_client
  from public.clients c
  where c.id = p_client_id
  for update;

  select * into v_request
  from public.erasure_requests r
  where r.client_ref = v_ref;

  -- The client is authoritative; the request is the recovery handle once the
  -- client is gone.
  v_org := coalesce(v_client.organization_id, v_request.organization_id);
  if v_org is null then
    raise exception 'client not found' using errcode = '22023';
  end if;

  -- Owner/actor context is established before any RLS-bypassing write below.
  v_actor := public.require_org_owner_actor(v_org);

  -- Terminal state: a completed request is never re-run.
  if v_request.id is not null and v_request.status = 'completed' then
    return jsonb_build_object(
      'status', 'already_completed',
      'erasure_request_id', v_request.id,
      'client_ref', v_ref,
      'impacted', v_request.impacted_counts
    );
  end if;

  -- Recovery: the irreversible part already committed (a previous attempt
  -- deleted the client and failed before finalizing). Only the bookkeeping is
  -- left, so finish it instead of failing the retry.
  if v_client.id is null then
    if v_request.id is null then
      raise exception 'client not found' using errcode = '22023';
    end if;

    v_backup := coalesce(
      v_request.backup_marker,
      jsonb_build_object(
        'policy', '30_day_rotation',
        'tombstone_required', true,
        'erased_at', v_now,
        'client_ref', v_ref,
        'organization_id', v_org,
        'impacted_counts', v_request.impacted_counts
      )
    );

    update public.erasure_requests
    set status = 'completed',
        client_id = null,
        completed_at = coalesce(completed_at, v_now),
        failed_at = null,
        blocked_reason = null,
        backup_marker = v_backup
    where id = v_request.id
    returning * into v_request;

    perform public.append_audit(
      v_org,
      'erasure_request',
      v_request.id,
      'client.erasure_completed',
      null,
      jsonb_build_object(
        'client_ref', v_ref,
        'impacted', v_request.impacted_counts,
        'recovered', true
      ),
      null, null, null
    );

    return jsonb_build_object(
      'status', 'already_completed',
      'erasure_request_id', v_request.id,
      'client_ref', v_ref,
      'impacted', v_request.impacted_counts
    );
  end if;

  -- Legal hold is checked inside this transaction, on the locked row, before
  -- any irreversible step: a held client is left completely untouched.
  if v_client.legal_hold then
    insert into public.erasure_requests as er (
      organization_id, client_id, client_ref, status, requested_by, blocked_reason
    )
    values (v_org, p_client_id, v_ref, 'blocked', v_actor, 'legal_hold')
    on conflict (organization_id, client_ref) do update
      set client_id = excluded.client_id,
          status = 'blocked',
          requested_by = excluded.requested_by,
          blocked_reason = 'legal_hold',
          started_at = null,
          failed_at = null
    returning * into v_request;

    perform public.append_audit(
      v_org, 'client', p_client_id, 'client.erasure_blocked',
      null, jsonb_build_object('legal_hold', true), null, null, null
    );

    return jsonb_build_object(
      'status', 'blocked',
      'erasure_request_id', v_request.id,
      'client_ref', v_ref,
      'impacted', '{}'::jsonb
    );
  end if;

  -- Collect ids and counts BEFORE any mutation: the ids are needed to anonymize
  -- the child audit rows that survive the cascade.
  foreach v_table in array public.erasure_impact_tables() loop
    execute format(
      'select coalesce(array_agg(id), ''{}''::uuid[]) from public.%I where client_id = $1',
      v_table
    ) into v_ids using p_client_id;

    v_count := coalesce(array_length(v_ids, 1), 0);
    v_impacted := v_impacted || jsonb_build_object(v_table, v_count);
    v_entity_ids := v_entity_ids || v_ids;
  end loop;

  -- relationships carry client_a_id / client_b_id instead of client_id, and
  -- relationship_dynamics hang off the relationship.
  execute
    'select coalesce(array_agg(id), ''{}''::uuid[]) from public.relationships'
    ' where client_a_id = $1 or client_b_id = $1'
  into v_ids using p_client_id;
  v_count := coalesce(array_length(v_ids, 1), 0);
  v_impacted := v_impacted || jsonb_build_object('relationships', v_count);
  v_entity_ids := v_entity_ids || v_ids;

  execute
    'select coalesce(array_agg(id), ''{}''::uuid[]) from public.relationship_dynamics'
    ' where relationship_id in ('
    '   select id from public.relationships where client_a_id = $1 or client_b_id = $1)'
  into v_ids using p_client_id;
  v_count := coalesce(array_length(v_ids, 1), 0);
  v_impacted := v_impacted || jsonb_build_object('relationship_dynamics', v_count);
  v_entity_ids := v_entity_ids || v_ids;

  v_entity_ids := array(select distinct u from unnest(v_entity_ids || array[p_client_id]) as u);

  -- Record the attempt. started_at is preserved across retries so the first
  -- attempt stays auditable; the counts are the current, authoritative snapshot.
  insert into public.erasure_requests as er (
    organization_id, client_id, client_ref, status, requested_by,
    started_at, blocked_reason, impacted_counts
  )
  values (v_org, p_client_id, v_ref, 'in_progress', v_actor, v_now, null, v_impacted)
  on conflict (organization_id, client_ref) do update
    set client_id = excluded.client_id,
        status = 'in_progress',
        requested_by = excluded.requested_by,
        started_at = coalesce(er.started_at, excluded.started_at),
        blocked_reason = null,
        failed_at = null,
        impacted_counts = excluded.impacted_counts
  returning * into v_request;

  perform public.append_audit(
    v_org, 'client', p_client_id, 'client.erasure_requested',
    null, jsonb_build_object('client_ref', v_ref, 'impacted', v_impacted),
    null, null, null
  );

  -- --- Irreversible phase -------------------------------------------------
  -- Consent constraints are applied first: every active consent for the client
  -- is revoked inside this transaction, so the AI / portal / supervisor gates
  -- are closed before a single row is destroyed. If any later step fails, the
  -- revocation rolls back with it.
  update public.consent_records
  set revoked_at = v_now
  where client_id = p_client_id and revoked_at is null;

  -- Open the append-only guards for this transaction only. set_config(..., true)
  -- is transaction-local and can be set by no one but this SECURITY DEFINER
  -- path.
  perform set_config('app.data_erasure', 'on', true);

  -- Anonymize the surviving audit rows (never delete them), then purge the
  -- append-only AI telemetry before the cascade reaches it.
  perform public.anonymize_client_audit(p_client_id, v_entity_ids);
  perform public.purge_client_ai_runs(p_client_id);

  -- Hard delete the client; every client-scoped table cascades.
  delete from public.clients where id = p_client_id;
  get diagnostics v_deleted = row_count;
  if v_deleted = 0 then
    raise exception 'client disappeared during erasure' using errcode = '22023';
  end if;

  v_backup := jsonb_build_object(
    'policy', '30_day_rotation',
    'tombstone_required', true,
    'erased_at', v_now,
    'client_ref', v_ref,
    'organization_id', v_org,
    'impacted_counts', v_impacted
  );

  update public.erasure_requests
  set status = 'completed',
      client_id = null,
      completed_at = v_now,
      failed_at = null,
      blocked_reason = null,
      backup_marker = v_backup
  where id = v_request.id
  returning * into v_request;

  perform public.append_audit(
    v_org,
    'erasure_request',
    v_request.id,
    'client.erasure_completed',
    null,
    jsonb_build_object(
      'client_ref', v_ref,
      'impacted', v_impacted,
      'completed_at', v_now
    ),
    null, null, null
  );

  return jsonb_build_object(
    'status', 'completed',
    'erasure_request_id', v_request.id,
    'client_ref', v_ref,
    'impacted', v_impacted
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Safety review: the control row and its audit row in one transaction.
-- ---------------------------------------------------------------------------

create or replace function public.create_safety_review(
  p_org_id uuid,
  p_client_id uuid,
  p_category text,
  p_severity text,
  p_source text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid;
  v_id uuid;
begin
  if coalesce(btrim(p_category), '') = '' then
    raise exception 'category is required' using errcode = '22023';
  end if;
  if p_severity not in ('low', 'medium', 'high', 'critical') then
    raise exception 'unsupported severity: %', p_severity using errcode = '22023';
  end if;

  v_actor := public.assert_client_write(p_org_id, p_client_id);

  insert into public.safety_reviews (
    organization_id, client_id, category, severity, source, created_by
  )
  values (p_org_id, p_client_id, p_category, p_severity, nullif(p_source, ''), v_actor)
  returning id into v_id;

  perform public.append_audit(
    p_org_id, 'safety_review', v_id, 'safety_review.create',
    null,
    jsonb_build_object('category', p_category, 'severity', p_severity),
    null, null, null
  );

  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Client portal: granting and revoking access with its audit row.
-- ---------------------------------------------------------------------------

-- Grant (or re-activate) a portal identity. The `client_portal` consent is
-- re-checked inside the transaction, so a revoked consent can never be raced
-- into a granted portal access.
create or replace function public.create_portal_user(
  p_client_id uuid,
  p_email text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_actor uuid;
  v_id uuid;
begin
  if coalesce(btrim(p_email), '') = '' then
    raise exception 'email is required' using errcode = '22023';
  end if;

  select c.organization_id into v_org
  from public.clients c
  where c.id = p_client_id;

  if v_org is null then
    raise exception 'client not found' using errcode = '22023';
  end if;

  v_actor := public.assert_client_consent(v_org, p_client_id, array['client_portal']);

  insert into public.client_portal_users (client_id, email, status, revoked_at, created_by)
  values (p_client_id, p_email, 'active', null, v_actor)
  on conflict (client_id, email) do update
    set status = 'active',
        revoked_at = null,
        created_by = excluded.created_by
  returning id into v_id;

  perform public.append_audit(
    v_org, 'client_portal_user', v_id, 'portal.access_granted',
    null,
    jsonb_build_object('client_id', p_client_id, 'email', p_email),
    null, null, null
  );

  return v_id;
end;
$$;

-- Revoke a portal identity with its audit row. Idempotent: revoking an already
-- revoked identity changes nothing and writes no second audit row. Returns
-- false when the row does not exist so the service keeps its NOT_FOUND contract.
create or replace function public.revoke_portal_user(p_portal_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.client_portal_users;
  v_org uuid;
  v_changed integer;
begin
  select * into v_row
  from public.client_portal_users u
  where u.id = p_portal_user_id;

  if v_row.id is null then
    return false;
  end if;

  select c.organization_id into v_org
  from public.clients c
  where c.id = v_row.client_id;

  if v_org is null then
    return false;
  end if;

  perform public.assert_client_write(v_org, v_row.client_id);

  update public.client_portal_users
  set status = 'revoked', revoked_at = now()
  where id = p_portal_user_id and status <> 'revoked';

  get diagnostics v_changed = row_count;
  if v_changed = 0 then
    return true;
  end if;

  perform public.append_audit(
    v_org, 'client_portal_user', p_portal_user_id, 'portal.access_revoked',
    jsonb_build_object('status', v_row.status),
    jsonb_build_object('status', 'revoked'),
    null, null, null
  );

  return true;
end;
$$;

-- ---------------------------------------------------------------------------
-- Least privilege
-- ---------------------------------------------------------------------------

revoke all on function public.set_client_legal_hold(uuid, boolean) from public, anon;
revoke all on function public.request_client_erasure(uuid) from public, anon;
revoke all on function public.execute_client_erasure(uuid) from public, anon;
revoke all on function public.create_safety_review(uuid, uuid, text, text, text) from public, anon;
revoke all on function public.create_portal_user(uuid, text) from public, anon;
revoke all on function public.revoke_portal_user(uuid) from public, anon;

grant execute on function public.set_client_legal_hold(uuid, boolean) to authenticated, service_role;
grant execute on function public.request_client_erasure(uuid) to authenticated, service_role;
grant execute on function public.execute_client_erasure(uuid) to authenticated, service_role;
grant execute on function public.create_safety_review(uuid, uuid, text, text, text)
  to authenticated, service_role;
grant execute on function public.create_portal_user(uuid, text) to authenticated, service_role;
grant execute on function public.revoke_portal_user(uuid) to authenticated, service_role;

-- The erasure helpers are internal now: they are called only from
-- execute_client_erasure() (SECURITY DEFINER, migration owner), so no client
-- role — including service_role — needs direct EXECUTE. Granting it would let
-- any service_role caller anonymize an audit trail or purge AI runs by guessing
-- a client UUID, outside the Owner-only transaction that guards them.
revoke all on function public.anonymize_client_audit(uuid, uuid[]) from service_role;
revoke all on function public.purge_client_ai_runs(uuid) from service_role;
