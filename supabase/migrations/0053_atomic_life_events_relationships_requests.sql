-- 0053: Atomic life events, triggers, relationships, client requests and goals
-- (ticket 21).
--
-- Template: supabase/migrations/0039_atomic_business_mutation.sql, reusing the
-- shared guards from 0039/0041/0042 (require_org_member_actor,
-- assert_client_write, append_audit).
--
-- Transaction gaps this migration closes
-- -------------------------------------------------------------------------
-- Tickets 01–20 migrated every other compound business mutation to one
-- SECURITY DEFINER RPC. These five paths were the last remaining
-- mutation-then-audit pairs in the service layer: the domain INSERT/UPDATE
-- committed first and the audit row was a second, separately failing network
-- call. A failure between the two left committed business state with no
-- AuditLog row, and (for the relationship paths) the tenant/assignment/consent
-- checks ran as separate pre-flight reads that a concurrent revocation could
-- invalidate.
--
--   * createLifeEvent() / createTrigger(): life_events / triggers insert, then
--     recordAudit().
--   * createRelationship(): client-a and client-b access + consent probe reads
--     outside the transaction, then the insert, then recordAudit(). The
--     "clients belong to the same organization" check was a client-side read.
--   * createRelationshipDynamic(): relationship read, two access probes, two
--     consent probes and a signal-visibility read (to strip private evidence
--     refs), then the insert, then recordAudit(). The strip was also racy: a
--     signal reclassified to `internal` between the probe read and the insert
--     stayed in the stored evidence_refs.
--   * changeRequestStatus() / changeGoalStatus(): status transition validated
--     from a separate read, then the update, then recordAudit().
--
-- Every path below is now one transaction with the audit row inside it. The
-- actor is resolved from auth.uid() INSIDE the RPC, the tenant/assignment/
-- consent checks run before any write, and the AuditLog append travels the
-- single append_audit() write path. Public service contracts are unchanged.
--
-- Consent (unchanged rule, now enforced in one transaction)
-- -------------------------------------------------------------------------
--   * Relationship and RelationshipDynamic require active
--     `relationship_analysis` consent for BOTH clients, checked after write
--     access to both, exactly as the pre-migration service asserted.
--   * Relationship evidence references must name a `client_visible` signal of
--     one of the two relationship clients. The pre-migration service dropped a
--     private reference silently; the RPC rejects the whole write with 22023
--     instead, so private evidence can never be stored and a partial write is
--     impossible. `listRelationshipDynamics()` keeps its read-time filter for
--     rows written before this migration.
--   * Life events, triggers, requests and goals are client-scoped content with
--     no additional consent gate, matching the pre-migration service and its
--     RLS policies (`is_client_accessible(organization_id, client_id, true)`).
--
-- Least privilege: internal helpers are revoked from public, anon AND
-- authenticated and are NOT granted to any client role — the SECURITY DEFINER
-- RPCs call them with the migration owner's privileges. Only the user-facing
-- RPCs are granted to authenticated, service_role.

-- ---------------------------------------------------------------------------
-- Internal helpers
-- ---------------------------------------------------------------------------

-- Internal: the exact signal ids from p_refs that the caller may cite as
-- relationship evidence — signals of the two relationship clients whose
-- visibility is `client_visible`. Returns fewer ids than it was given when a
-- reference is private, unknown or belongs to a third client; the caller
-- compares the count and refuses the write.
create or replace function public.relationship_visible_evidence_refs(
  p_org_id uuid,
  p_client_a_id uuid,
  p_client_b_id uuid,
  p_refs uuid[]
)
returns uuid[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(s.id order by s.id), '{}'::uuid[])
  from public.signals s
  where s.id = any(coalesce(p_refs, '{}'::uuid[]))
    and s.organization_id = p_org_id
    and s.client_id in (p_client_a_id, p_client_b_id)
    and s.visibility = 'client_visible';
$$;

revoke all on function public.relationship_visible_evidence_refs(uuid, uuid, uuid, uuid[])
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Life events
-- ---------------------------------------------------------------------------

-- Record one LifeEvent with its audit row. `p_date` is a date, not a
-- timestamp: the client sends the calendar date it stored.
create or replace function public.create_life_event(
  p_org_id uuid,
  p_client_id uuid,
  p_title text,
  p_date date,
  p_description text,
  p_event_type text,
  p_significance text,
  p_source_type text,
  p_visibility text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if coalesce(btrim(p_title), '') = '' then
    raise exception 'title is required' using errcode = '22023';
  end if;
  if p_visibility not in ('internal', 'sensitive', 'client_visible') then
    raise exception 'unsupported visibility: %', p_visibility using errcode = '22023';
  end if;

  perform public.assert_client_write(p_org_id, p_client_id);

  insert into public.life_events (
    organization_id, client_id, title, date, description,
    event_type, significance, source_type, visibility
  )
  values (
    p_org_id, p_client_id, p_title, p_date, p_description,
    p_event_type, p_significance, p_source_type, p_visibility
  )
  returning id into v_id;

  perform public.append_audit(
    p_org_id, 'life_event', v_id, 'life_event.created',
    null,
    jsonb_build_object('title', p_title),
    null, null, null
  );

  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------

-- Record one Trigger with its audit row. An optional LifeEvent reference is
-- validated inside the transaction (same organization AND same client); a
-- foreign reference raises 22023 instead of a raw FK/tenant violation.
create or replace function public.create_trigger(
  p_org_id uuid,
  p_client_id uuid,
  p_title text,
  p_life_event_id uuid,
  p_description text,
  p_intensity integer,
  p_occurred_at timestamptz,
  p_source_type text,
  p_visibility text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if coalesce(btrim(p_title), '') = '' then
    raise exception 'title is required' using errcode = '22023';
  end if;
  if p_visibility not in ('internal', 'sensitive', 'client_visible') then
    raise exception 'unsupported visibility: %', p_visibility using errcode = '22023';
  end if;
  if p_intensity is not null and (p_intensity < 0 or p_intensity > 100) then
    raise exception 'intensity must be between 0 and 100' using errcode = '22023';
  end if;

  perform public.assert_client_write(p_org_id, p_client_id);

  if p_life_event_id is not null and not exists (
    select 1 from public.life_events e
    where e.id = p_life_event_id
      and e.organization_id = p_org_id
      and e.client_id = p_client_id
  ) then
    raise exception 'life event does not belong to this client' using errcode = '22023';
  end if;

  insert into public.triggers (
    organization_id, client_id, life_event_id, title, description,
    intensity, occurred_at, source_type, visibility
  )
  values (
    p_org_id, p_client_id, p_life_event_id, p_title, p_description,
    p_intensity, p_occurred_at, p_source_type, p_visibility
  )
  returning id into v_id;

  perform public.append_audit(
    p_org_id, 'trigger', v_id, 'trigger.created',
    null,
    jsonb_build_object('title', p_title, 'life_event_id', p_life_event_id),
    null, null, null
  );

  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Relationships
-- ---------------------------------------------------------------------------

-- Create one Relationship between two clients of the SAME organization with
-- active `relationship_analysis` consent for both, plus its audit row.
create or replace function public.create_relationship(
  p_org_id uuid,
  p_client_a_id uuid,
  p_client_b_id uuid,
  p_relationship_type text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid;
  v_same_org integer;
  v_id uuid;
begin
  if p_client_a_id = p_client_b_id then
    raise exception 'relationship requires two distinct clients' using errcode = '22023';
  end if;
  if coalesce(btrim(p_relationship_type), '') = '' then
    raise exception 'relationship type is required' using errcode = '22023';
  end if;

  v_actor := public.assert_client_write(p_org_id, p_client_a_id);
  perform public.assert_client_write(p_org_id, p_client_b_id);

  -- Both clients must live in the organization the caller claims; the owner
  -- exception inside is_client_accessible() does not check the tenant alone.
  select count(*)::integer into v_same_org
  from public.clients c
  where c.organization_id = p_org_id
    and c.id in (p_client_a_id, p_client_b_id);

  if v_same_org <> 2 then
    raise exception 'relationship clients must belong to the same organization'
      using errcode = '42501';
  end if;

  if not public.has_consent(p_client_a_id, 'relationship_analysis')
    or not public.has_consent(p_client_b_id, 'relationship_analysis') then
    raise exception 'missing consent: relationship_analysis' using errcode = '42501';
  end if;

  insert into public.relationships (
    organization_id, client_a_id, client_b_id, relationship_type
  )
  values (p_org_id, p_client_a_id, p_client_b_id, p_relationship_type)
  returning id into v_id;

  perform public.append_audit(
    p_org_id, 'relationship', v_id, 'relationship.created',
    null,
    jsonb_build_object('client_a_id', p_client_a_id, 'client_b_id', p_client_b_id),
    null, null, null
  );

  return v_id;
end;
$$;

-- Create one RelationshipDynamic with its audit row. Write access to BOTH
-- clients and active `relationship_analysis` consent for both are re-asserted
-- inside the transaction, and every evidence reference must be a
-- `client_visible` signal of one of the two clients.
create or replace function public.create_relationship_dynamic(
  p_org_id uuid,
  p_relationship_id uuid,
  p_title text,
  p_description text,
  p_confidence_score integer,
  p_evidence_refs uuid[],
  p_visibility text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.relationships;
  v_visible uuid[];
  v_id uuid;
begin
  if coalesce(btrim(p_title), '') = '' then
    raise exception 'title is required' using errcode = '22023';
  end if;
  if p_visibility not in ('internal', 'sensitive', 'client_visible') then
    raise exception 'unsupported visibility: %', p_visibility using errcode = '22023';
  end if;
  if p_confidence_score is not null and (p_confidence_score < 0 or p_confidence_score > 100) then
    raise exception 'confidence score must be between 0 and 100' using errcode = '22023';
  end if;

  perform public.require_org_member_actor(p_org_id);

  select * into v_row
  from public.relationships r
  where r.id = p_relationship_id and r.organization_id = p_org_id;

  if v_row.id is null then
    raise exception 'relationship not found' using errcode = '22023';
  end if;

  perform public.assert_client_write(p_org_id, v_row.client_a_id);
  perform public.assert_client_write(p_org_id, v_row.client_b_id);

  if not public.has_consent(v_row.client_a_id, 'relationship_analysis')
    or not public.has_consent(v_row.client_b_id, 'relationship_analysis') then
    raise exception 'missing consent: relationship_analysis' using errcode = '42501';
  end if;

  v_visible := public.relationship_visible_evidence_refs(
    p_org_id, v_row.client_a_id, v_row.client_b_id, p_evidence_refs
  );

  -- A private, unknown or third-client reference is refused, never stored and
  -- never silently dropped: the payload the caller sent must equal what lands.
  if coalesce(array_length(v_visible, 1), 0)
    <> coalesce(array_length(p_evidence_refs, 1), 0) then
    raise exception 'relationship evidence must be client-visible signals of the two clients'
      using errcode = '22023';
  end if;

  insert into public.relationship_dynamics (
    relationship_id, title, description, confidence_score, evidence_refs, visibility
  )
  values (
    p_relationship_id, p_title, p_description, p_confidence_score, v_visible, p_visibility
  )
  returning id into v_id;

  perform public.append_audit(
    p_org_id, 'relationship_dynamic', v_id, 'relationship_dynamic.created',
    null,
    jsonb_build_object('title', p_title),
    null, null, null
  );

  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Client requests and goals
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- Internal: the status transition tables below are the exact maps the service
-- used before this migration (lib/service/requests.ts REQUEST_TRANSITIONS /
-- GOAL_TRANSITIONS). Moving them into SQL keeps the "is this transition legal"
-- decision and the write in one transaction, so two concurrent callers cannot
-- both read `active` and both commit a transition out of it.
-- ---------------------------------------------------------------------------

-- Create one ClientRequest with its audit row. `started_at` is set in the
-- database clock, exactly as the service did.
create or replace function public.create_client_request(
  p_org_id uuid,
  p_client_id uuid,
  p_title text,
  p_description text,
  p_priority text,
  p_success_criteria text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if coalesce(btrim(p_title), '') = '' then
    raise exception 'title is required' using errcode = '22023';
  end if;
  if p_priority not in ('low', 'normal', 'high', 'urgent') then
    raise exception 'unsupported priority: %', p_priority using errcode = '22023';
  end if;

  perform public.assert_client_write(p_org_id, p_client_id);

  insert into public.client_requests (
    organization_id, client_id, title, description, priority, success_criteria, started_at
  )
  values (
    p_org_id, p_client_id, p_title, p_description, p_priority, p_success_criteria, now()
  )
  returning id into v_id;

  perform public.append_audit(
    p_org_id, 'client_request', v_id, 'request.created',
    null,
    jsonb_build_object('title', p_title),
    null, null, null
  );

  return v_id;
end;
$$;

-- Internal: legal ClientRequest status transitions, exactly as the service
-- enforced them before this migration.
create or replace function public.request_status_transition_allowed(
  p_from text,
  p_to text
)
returns boolean
language sql
immutable
set search_path = public
as $$
  select case p_from
    when 'active' then p_to in ('paused', 'completed', 'abandoned')
    when 'paused' then p_to in ('active', 'completed', 'abandoned')
    when 'completed' then false
    when 'abandoned' then p_to = 'active'
    else false
  end;
$$;

revoke all on function public.request_status_transition_allowed(text, text)
  from public, anon, authenticated;

-- Internal: legal ClientGoal status transitions.
create or replace function public.goal_status_transition_allowed(
  p_from text,
  p_to text
)
returns boolean
language sql
immutable
set search_path = public
as $$
  select case p_from
    when 'active' then p_to in ('completed', 'archived')
    when 'completed' then p_to = 'archived'
    when 'archived' then p_to = 'active'
    else false
  end;
$$;

revoke all on function public.goal_status_transition_allowed(text, text)
  from public, anon, authenticated;

-- Change one ClientRequest status with its audit row. The transition is
-- validated against the CURRENT row inside the transaction; an illegal target
-- raises 22023 and leaves both the row and the audit trail untouched.
create or replace function public.change_request_status(
  p_org_id uuid,
  p_request_id uuid,
  p_to_status text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.client_requests;
begin
  if p_to_status not in ('active', 'paused', 'completed', 'abandoned') then
    raise exception 'unsupported status: %', p_to_status using errcode = '22023';
  end if;

  select * into v_row
  from public.client_requests r
  where r.id = p_request_id;

  if v_row.id is null then
    raise exception 'request not found' using errcode = '22023';
  end if;

  perform public.assert_client_write(p_org_id, v_row.client_id);

  if not public.request_status_transition_allowed(v_row.status, p_to_status) then
    raise exception 'invalid transition: % -> %', v_row.status, p_to_status
      using errcode = '22023';
  end if;

  update public.client_requests
  set status = p_to_status,
      completed_at = case when p_to_status = 'completed' then now() else completed_at end,
      updated_at = now()
  where id = p_request_id;

  perform public.append_audit(
    p_org_id, 'client_request', p_request_id,
    'request.' || p_to_status,
    jsonb_build_object('status', v_row.status),
    jsonb_build_object('status', p_to_status),
    null, null, null
  );
end;
$$;

-- Create one ClientGoal with its audit row.
create or replace function public.create_client_goal(
  p_org_id uuid,
  p_client_id uuid,
  p_title text,
  p_description text,
  p_importance text,
  p_target_state text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if coalesce(btrim(p_title), '') = '' then
    raise exception 'title is required' using errcode = '22023';
  end if;
  if p_importance not in ('low', 'normal', 'high') then
    raise exception 'unsupported importance: %', p_importance using errcode = '22023';
  end if;

  perform public.assert_client_write(p_org_id, p_client_id);

  insert into public.client_goals (
    organization_id, client_id, title, description, importance, target_state
  )
  values (p_org_id, p_client_id, p_title, p_description, p_importance, p_target_state)
  returning id into v_id;

  perform public.append_audit(
    p_org_id, 'client_goal', v_id, 'goal.created',
    null,
    jsonb_build_object('title', p_title),
    null, null, null
  );

  return v_id;
end;
$$;

-- Change one ClientGoal status with its audit row.
create or replace function public.change_goal_status(
  p_org_id uuid,
  p_goal_id uuid,
  p_to_status text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.client_goals;
begin
  if p_to_status not in ('active', 'completed', 'archived') then
    raise exception 'unsupported status: %', p_to_status using errcode = '22023';
  end if;

  select * into v_row
  from public.client_goals g
  where g.id = p_goal_id;

  if v_row.id is null then
    raise exception 'goal not found' using errcode = '22023';
  end if;

  perform public.assert_client_write(p_org_id, v_row.client_id);

  if not public.goal_status_transition_allowed(v_row.status, p_to_status) then
    raise exception 'invalid transition: % -> %', v_row.status, p_to_status
      using errcode = '22023';
  end if;

  update public.client_goals
  set status = p_to_status, updated_at = now()
  where id = p_goal_id;

  perform public.append_audit(
    p_org_id, 'client_goal', p_goal_id,
    'goal.' || p_to_status,
    jsonb_build_object('status', v_row.status),
    jsonb_build_object('status', p_to_status),
    null, null, null
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

revoke all on function public.create_life_event(uuid, uuid, text, date, text, text, text, text, text)
  from public, anon;
revoke all on function public.create_trigger(uuid, uuid, text, uuid, text, integer, timestamptz, text, text)
  from public, anon;
revoke all on function public.create_relationship(uuid, uuid, uuid, text) from public, anon;
revoke all on function public.create_relationship_dynamic(uuid, uuid, text, text, integer, uuid[], text)
  from public, anon;
revoke all on function public.create_client_request(uuid, uuid, text, text, text, text) from public, anon;
revoke all on function public.change_request_status(uuid, uuid, text) from public, anon;
revoke all on function public.create_client_goal(uuid, uuid, text, text, text, text) from public, anon;
revoke all on function public.change_goal_status(uuid, uuid, text) from public, anon;

grant execute on function public.create_life_event(uuid, uuid, text, date, text, text, text, text, text)
  to authenticated, service_role;
grant execute on function public.create_trigger(uuid, uuid, text, uuid, text, integer, timestamptz, text, text)
  to authenticated, service_role;
grant execute on function public.create_relationship(uuid, uuid, uuid, text)
  to authenticated, service_role;
grant execute on function public.create_relationship_dynamic(uuid, uuid, text, text, integer, uuid[], text)
  to authenticated, service_role;
grant execute on function public.create_client_request(uuid, uuid, text, text, text, text)
  to authenticated, service_role;
grant execute on function public.change_request_status(uuid, uuid, text)
  to authenticated, service_role;
grant execute on function public.create_client_goal(uuid, uuid, text, text, text, text)
  to authenticated, service_role;
grant execute on function public.change_goal_status(uuid, uuid, text)
  to authenticated, service_role;
