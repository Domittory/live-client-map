-- 0048: Guarded mutations for the positive/development layer (ticket 13).
--
-- Template: supabase/migrations/0042_atomic_psychological_model.sql and
-- 0047_atomic_model_review.sql, reusing the shared guards introduced by
-- 0040/0041 (require_org_member_actor, assert_client_write, assert_client_consent).
--
-- The client workspace screens (ticket 13) let a specialist create/edit
-- DevelopmentTargets and review AI Recommendations. Up to now:
--   * DevelopmentTargets had create_development_target() but no update path at
--     all, so "изменяет DevelopmentTarget" was only possible through a raw
--     table UPDATE from the service layer — with no audit row and no guard;
--   * Recommendations were created only by the AI batch RPC and had no human
--     review path either, so an AI proposal could never become an approved,
--     publishable Recommendation without a raw UPDATE (which would also have
--     silently overwritten a human decision);
--   * visibility/published state had no guarded path, so a draft (unreviewed
--     AI) Recommendation could have been published to the Client Portal by a
--     raw UPDATE.
--
-- Every function below is one transaction: the state change and its AuditLog
-- row (carrying the authenticated actor and the specialist's reason) commit or
-- roll back together. A reviewed Recommendation is never silently re-decided,
-- and only a human-approved, non-high-risk Recommendation can become
-- client-visible (SPEC §20, §36).

-- ---------------------------------------------------------------------------
-- DevelopmentTargets
-- ---------------------------------------------------------------------------

-- Update one DevelopmentTarget with its audit row. Progress claims
-- (current_level / target_level) and lifecycle changes (status) must carry a
-- human reason, mirroring the Resource score rule in update_resource().
create or replace function public.update_development_target(
  p_org_id uuid,
  p_target_id uuid,
  p_patch jsonb,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_client_id uuid;
  v_allowed text[] := array[
    'name', 'description', 'domain', 'current_level', 'target_level',
    'importance', 'status', 'linked_resources', 'linked_core_nodes',
    'success_markers'
  ];
  v_key text;
  v_reason text;
begin
  select t.client_id into v_client_id
  from public.development_targets t
  where t.id = p_target_id and t.organization_id = p_org_id;

  if v_client_id is null then
    raise exception 'development target not found in this organization' using errcode = '22023';
  end if;

  perform public.assert_client_write(p_org_id, v_client_id);

  if p_patch is null or jsonb_typeof(p_patch) <> 'object' or p_patch = '{}'::jsonb then
    raise exception 'no fields to update' using errcode = '22023';
  end if;

  for v_key in select jsonb_object_keys(p_patch) loop
    if not (v_key = any (v_allowed)) then
      raise exception 'field % cannot be updated', v_key using errcode = '22023';
    end if;
  end loop;

  v_reason := nullif(btrim(coalesce(p_reason, '')), '');

  if (p_patch ? 'current_level' or p_patch ? 'target_level' or p_patch ? 'status')
    and v_reason is null
  then
    raise exception 'development target level or status change requires a human reason'
      using errcode = '22023';
  end if;

  update public.development_targets
  set name = case when p_patch ? 'name' then p_patch ->> 'name' else name end,
      description = case when p_patch ? 'description'
        then p_patch ->> 'description' else description end,
      domain = case when p_patch ? 'domain' then p_patch ->> 'domain' else domain end,
      current_level = case when p_patch ? 'current_level'
        then (p_patch ->> 'current_level')::integer else current_level end,
      target_level = case when p_patch ? 'target_level'
        then (p_patch ->> 'target_level')::integer else target_level end,
      importance = case when p_patch ? 'importance'
        then p_patch ->> 'importance' else importance end,
      status = case when p_patch ? 'status' then p_patch ->> 'status' else status end,
      linked_resources = case when p_patch ? 'linked_resources'
        then public.jsonb_text_array(p_patch -> 'linked_resources')::uuid[] else linked_resources end,
      linked_core_nodes = case when p_patch ? 'linked_core_nodes'
        then public.jsonb_text_array(p_patch -> 'linked_core_nodes')::uuid[] else linked_core_nodes end,
      success_markers = case when p_patch ? 'success_markers'
        then public.jsonb_text_array(p_patch -> 'success_markers') else success_markers end,
      updated_at = now()
  where id = p_target_id and organization_id = p_org_id;

  perform public.append_audit(
    p_org_id, 'development_target', p_target_id, 'development_target.updated',
    null, p_patch, v_reason, null, null
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Recommendation human review
-- ---------------------------------------------------------------------------

-- Human review of an AI-proposed Recommendation (status draft → approved /
-- rejected, SPEC §36). A Recommendation that a human already decided is never
-- re-decided here: an AI proposal can never overwrite a human decision.
create or replace function public.review_recommendation(
  p_org_id uuid,
  p_recommendation_id uuid,
  p_decision text,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_client_id uuid;
  v_status text;
  v_new_status text;
  v_reason text;
  v_actor uuid;
begin
  if p_decision not in ('approve', 'reject') then
    raise exception 'unknown review decision' using errcode = '22023';
  end if;

  select r.client_id, r.status into v_client_id, v_status
  from public.recommendations r
  where r.id = p_recommendation_id and r.organization_id = p_org_id;

  if v_client_id is null then
    raise exception 'recommendation not found in this organization' using errcode = '22023';
  end if;

  v_actor := public.assert_client_write(p_org_id, v_client_id);

  -- Only a draft (pending) proposal is reviewable.
  if v_status <> 'draft' then
    raise exception 'recommendation was already reviewed' using errcode = '55000';
  end if;

  v_reason := nullif(btrim(coalesce(p_reason, '')), '');
  if p_decision = 'reject' and v_reason is null then
    raise exception 'rejecting a recommendation requires an audit reason' using errcode = '22023';
  end if;

  v_new_status := case when p_decision = 'approve' then 'approved' else 'rejected' end;

  update public.recommendations
  set status = v_new_status,
      reviewed_by = v_actor,
      reviewed_at = now(),
      updated_at = now()
  where id = p_recommendation_id
    and organization_id = p_org_id
    and status = 'draft';

  perform public.append_audit(
    p_org_id, 'recommendation', p_recommendation_id, 'recommendation.' || p_decision,
    jsonb_build_object('status', v_status),
    jsonb_build_object('status', v_new_status),
    v_reason, null, null
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Recommendation visibility (specialist control over the Client Portal)
-- ---------------------------------------------------------------------------

-- Publish (or withdraw) one Recommendation from the Client Portal projection.
-- Publishing requires a human-approved Recommendation, is refused for a
-- human_review_required (high-risk, SPEC §20) Recommendation, and re-checks the
-- client_portal consent inside the transaction.
create or replace function public.set_recommendation_visibility(
  p_org_id uuid,
  p_recommendation_id uuid,
  p_visibility text,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.recommendations;
  v_reason text;
  v_actor uuid;
begin
  if p_visibility not in ('internal', 'client_visible') then
    raise exception 'unknown recommendation visibility' using errcode = '22023';
  end if;

  select * into v_row
  from public.recommendations r
  where r.id = p_recommendation_id and r.organization_id = p_org_id;

  if v_row.id is null then
    raise exception 'recommendation not found in this organization' using errcode = '22023';
  end if;

  v_actor := public.assert_client_write(p_org_id, v_row.client_id);

  v_reason := nullif(btrim(coalesce(p_reason, '')), '');

  if p_visibility = 'client_visible' then
    -- Unreviewed AI output is never exposed, even if the browser was bypassed.
    if v_row.status <> 'approved' then
      raise exception 'only a human-approved recommendation can be published'
        using errcode = '22023';
    end if;
    -- SPEC §20: risk_score >= 80 keeps the Recommendation internal.
    if v_row.human_review_required then
      raise exception 'high-risk recommendation stays internal' using errcode = '22023';
    end if;
    if not public.has_consent(v_row.client_id, 'client_portal') then
      raise exception 'missing consent: client_portal' using errcode = '42501';
    end if;
  end if;

  update public.recommendations
  set visibility = p_visibility, updated_at = now()
  where id = p_recommendation_id and organization_id = p_org_id;

  perform public.append_audit(
    p_org_id, 'recommendation', p_recommendation_id,
    case when p_visibility = 'client_visible'
      then 'recommendation.published' else 'recommendation.unpublished' end,
    jsonb_build_object('visibility', v_row.visibility),
    jsonb_build_object('visibility', p_visibility),
    v_reason, null, null
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Least privilege: new functions inherit EXECUTE for anon from the 0002
-- default privileges, so every public RPC is revoked explicitly.
-- ---------------------------------------------------------------------------
revoke all on function public.update_development_target(uuid, uuid, jsonb, text) from public, anon;
revoke all on function public.review_recommendation(uuid, uuid, text, text) from public, anon;
revoke all on function public.set_recommendation_visibility(uuid, uuid, text, text) from public, anon;

grant execute on function public.update_development_target(uuid, uuid, jsonb, text) to authenticated, service_role;
grant execute on function public.review_recommendation(uuid, uuid, text, text) to authenticated, service_role;
grant execute on function public.set_recommendation_visibility(uuid, uuid, text, text) to authenticated, service_role;
