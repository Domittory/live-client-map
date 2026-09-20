-- 0042: Atomic psychological model mutations (ticket 06).
--
-- Template: supabase/migrations/0039_atomic_business_mutation.sql, reusing the
-- shared guards introduced by 0040/0041 (require_org_member_actor,
-- assert_client_write).
--
-- Before this migration every model change was a table write followed by a
-- separate recordAudit()/withAudit() network call (and, for AI proposal flows, a
-- loop of independent writes). A failure between the two calls left a committed
-- model row without its audit trail, an AI batch half-persisted, or a link
-- applied while its parent proposal had failed.
--
-- Every path below is now one transaction: the model row(s), their child links,
-- the evidence trail, the optional ModelChange row and the AuditLog append
-- commit or roll back together. Public service contracts are unchanged.
--
-- Human-in-the-loop semantics are enforced inside the transaction:
--   * human-created model entities keep their pending status (CoreNode
--     "hypothesis", hypothesis "hypothesis", Recommendation "draft");
--   * the AI proposal paths force pending/draft + L0 and never overwrite a
--     human-confirmed entity;
--   * causes_confirmed is reachable only through confirm_causal_relation, which
--     requires an explicit human reason;
--   * a rejected/failed proposal leaves no links, no authoritative evidence and
--     no confidence change, because the whole transaction rolls back.

-- ---------------------------------------------------------------------------
-- Shared helpers
-- ---------------------------------------------------------------------------

-- Convert a JSON array of strings into a text[] (empty array for null).
create or replace function public.jsonb_text_array(p_value jsonb)
returns text[]
language sql
immutable
security definer
set search_path = public
as $$
  select coalesce(
    array(select jsonb_array_elements_text(coalesce(p_value, '[]'::jsonb))),
    '{}'::text[]
  );
$$;

-- Internal: assert write access to a client and that every listed consent is
-- active. Consent is checked inside the transaction boundary (ticket 13).
create or replace function public.assert_client_consent(
  p_org_id uuid,
  p_client_id uuid,
  p_types text[]
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid;
  v_index integer;
begin
  v_actor := public.assert_client_write(p_org_id, p_client_id);

  for v_index in 1 .. coalesce(array_length(p_types, 1), 0) loop
    if not public.has_consent(p_client_id, p_types[v_index]) then
      raise exception 'missing consent: %', p_types[v_index] using errcode = '42501';
    end if;
  end loop;

  return v_actor;
end;
$$;

-- Internal: assert the caller is an active owner/specialist of the organization
-- (the role set the intervention-method library grants write access to).
create or replace function public.assert_org_author_actor(p_organization_id uuid)
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
  if not exists (
    select 1
    from public.organization_members m
    where m.organization_id = p_organization_id
      and m.user_id = v_actor
      and m.status = 'active'
      and m.role in ('owner', 'specialist')
  ) then
    raise exception 'not allowed to modify the organization library' using errcode = '42501';
  end if;
  return v_actor;
end;
$$;

-- Internal: recompute theme aggregates from CONFIRMED evidence only (SPEC §3.5):
-- approved signals that are not AI-only hypotheses. Rejected and pending signals
-- never increase counts; a single session is one independent context.
create or replace function public.recompute_theme_aggregates_internal(p_theme_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.themes t
  set evidence_count = agg.confirmed,
      independent_evidence_count = agg.contexts,
      contexts_count = agg.contexts,
      last_seen_at = now()
  from (
    select
      count(*) filter (
        where s.review_status = 'approved' and s.source_type <> 'ai_hypothesis'
      ) as confirmed,
      count(distinct coalesce(s.diagnostic_session_id::text, 'no-session')) filter (
        where s.review_status = 'approved' and s.source_type <> 'ai_hypothesis'
      ) as contexts
    from public.signal_theme_links l
    join public.signals s on s.id = l.signal_id
    where l.theme_id = p_theme_id
  ) agg
  where t.id = p_theme_id;
$$;

-- Internal: deterministic grounding check for model explanations. Returns the
-- list of violations (empty = grounded). Mirrors
-- validateExplanationGrounding() in lib/service/explanations.ts so a fabricated
-- reference can never be approved even if the service check is bypassed.
create or replace function public.validate_explanation_grounding(
  p_explanations jsonb,
  p_grounding jsonb
)
returns text[]
language plpgsql
immutable
security definer
set search_path = public
as $$
declare
  v_errors text[] := '{}';
  v_seen text[] := '{}';
  v_entry jsonb;
  v_ref text;
  v_change_id text;
  v_known_changes text[] := public.jsonb_text_array(p_grounding -> 'model_change_ids');
  v_known_evidence text[] := public.jsonb_text_array(p_grounding -> 'evidence_ids');
begin
  for v_entry in select * from jsonb_array_elements(coalesce(p_explanations, '[]'::jsonb)) loop
    v_change_id := v_entry ->> 'model_change_id';

    if v_change_id is null or not (v_change_id = any (v_known_changes)) then
      v_errors := v_errors || ('fabricated model_change_id: ' || coalesce(v_change_id, ''));
    elsif v_change_id = any (v_seen) then
      v_errors := v_errors || ('duplicate model_change_id: ' || v_change_id);
    end if;
    v_seen := v_seen || v_change_id;

    for v_ref in
      select jsonb_array_elements_text(coalesce(v_entry -> 'evidence_refs', '[]'::jsonb))
    loop
      if not (v_ref = any (v_known_evidence)) then
        v_errors := v_errors ||
          ('fabricated evidence_ref: ' || v_ref || ' (change ' || coalesce(v_change_id, '') || ')');
      end if;
    end loop;
  end loop;

  return v_errors;
end;
$$;

revoke all on function public.jsonb_text_array(jsonb) from public, anon, authenticated;
revoke all on function public.assert_client_consent(uuid, uuid, text[]) from public, anon, authenticated;
revoke all on function public.assert_org_author_actor(uuid) from public, anon, authenticated;
revoke all on function public.recompute_theme_aggregates_internal(uuid) from public, anon, authenticated;
revoke all on function public.validate_explanation_grounding(jsonb, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Themes
-- ---------------------------------------------------------------------------

create or replace function public.create_theme(
  p_org_id uuid,
  p_client_id uuid,
  p_name text,
  p_description text,
  p_domain text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_theme_id uuid;
begin
  perform public.assert_client_write(p_org_id, p_client_id);

  insert into public.themes (organization_id, client_id, name, description, domain, first_seen_at)
  values (p_org_id, p_client_id, p_name, p_description, p_domain, now())
  returning id into v_theme_id;

  perform public.append_audit(
    p_org_id, 'theme', v_theme_id, 'theme.created',
    null, jsonb_build_object('name', p_name), null, null, null
  );

  return v_theme_id;
end;
$$;

-- Human link of one confirmed Signal to a Theme. The link, the recomputed
-- aggregates and the audit row are one transaction.
create or replace function public.link_theme_signal(
  p_org_id uuid,
  p_theme_id uuid,
  p_signal_id uuid,
  p_relevance_score integer,
  p_link_rationale text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_client_id uuid;
begin
  select t.client_id into v_client_id
  from public.themes t
  where t.id = p_theme_id and t.organization_id = p_org_id;

  if v_client_id is null then
    raise exception 'theme not found in this organization' using errcode = '22023';
  end if;

  perform public.assert_client_write(p_org_id, v_client_id);

  -- Only evidence of the same client can be linked; a cross-client or
  -- cross-tenant signal is rejected before anything is written.
  if not exists (
    select 1 from public.signals s
    where s.id = p_signal_id
      and s.client_id = v_client_id
      and s.organization_id = p_org_id
  ) then
    raise exception 'signal not found for this client' using errcode = '22023';
  end if;

  insert into public.signal_theme_links (
    signal_id, theme_id, relevance_score, link_rationale, created_by
  )
  values (p_signal_id, p_theme_id, p_relevance_score, p_link_rationale, auth.uid());

  perform public.append_audit(
    p_org_id, 'signal_theme_link', p_theme_id, 'theme.signal_linked',
    null, jsonb_build_object('signal_id', p_signal_id), null, null, null
  );

  perform public.recompute_theme_aggregates_internal(p_theme_id);
end;
$$;

create or replace function public.unlink_theme_signal(
  p_org_id uuid,
  p_theme_id uuid,
  p_signal_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_client_id uuid;
begin
  select t.client_id into v_client_id
  from public.themes t
  where t.id = p_theme_id and t.organization_id = p_org_id;

  if v_client_id is null then
    raise exception 'theme not found in this organization' using errcode = '22023';
  end if;

  perform public.assert_client_write(p_org_id, v_client_id);

  delete from public.signal_theme_links
  where theme_id = p_theme_id and signal_id = p_signal_id;

  perform public.append_audit(
    p_org_id, 'signal_theme_link', p_theme_id, 'theme.signal_unlinked',
    null, jsonb_build_object('signal_id', p_signal_id), null, null, null
  );

  perform public.recompute_theme_aggregates_internal(p_theme_id);
end;
$$;

-- Public wrapper kept for the exported service helper.
create or replace function public.recompute_theme_aggregates(p_theme_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_client_id uuid;
  v_org_id uuid;
begin
  select t.client_id, t.organization_id into v_client_id, v_org_id
  from public.themes t
  where t.id = p_theme_id;

  if v_client_id is null then
    raise exception 'theme not found' using errcode = '22023';
  end if;

  perform public.assert_client_write(v_org_id, v_client_id);
  perform public.recompute_theme_aggregates_internal(p_theme_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- CoreNodes
-- ---------------------------------------------------------------------------

create or replace function public.create_core_node(
  p_org_id uuid,
  p_client_id uuid,
  p_title text,
  p_hypothesis text,
  p_root_domain text,
  p_confidence_score integer
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid;
  v_node_id uuid;
begin
  v_actor := public.assert_client_write(p_org_id, p_client_id);

  -- A manually created node is a working hypothesis, never a confirmed entity.
  insert into public.core_nodes (
    organization_id, client_id, title, hypothesis, root_domain,
    confidence_score, created_by, status
  )
  values (
    p_org_id, p_client_id, p_title, p_hypothesis, p_root_domain,
    p_confidence_score, v_actor, 'hypothesis'
  )
  returning id into v_node_id;

  perform public.append_audit(
    p_org_id, 'core_node', v_node_id, 'core_node.created',
    null, jsonb_build_object('title', p_title), null, null, null
  );

  return v_node_id;
end;
$$;

create or replace function public.link_theme_core_node(
  p_org_id uuid,
  p_core_node_id uuid,
  p_theme_id uuid,
  p_relationship_type text,
  p_confidence integer,
  p_link_rationale text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_client_id uuid;
  v_theme_client_id uuid;
begin
  select c.client_id into v_client_id
  from public.core_nodes c
  where c.id = p_core_node_id and c.organization_id = p_org_id;

  if v_client_id is null then
    raise exception 'core node not found in this organization' using errcode = '22023';
  end if;

  perform public.assert_client_write(p_org_id, v_client_id);

  select t.client_id into v_theme_client_id
  from public.themes t
  where t.id = p_theme_id and t.organization_id = p_org_id;

  if v_theme_client_id is null or v_theme_client_id <> v_client_id then
    raise exception 'theme not found for this client' using errcode = '22023';
  end if;

  insert into public.theme_core_node_links (
    theme_id, core_node_id, relationship_type, confidence, link_rationale, created_by
  )
  values (
    p_theme_id, p_core_node_id, p_relationship_type, p_confidence, p_link_rationale, auth.uid()
  );

  perform public.append_audit(
    p_org_id, 'theme_core_node_link', p_core_node_id, 'core_node.theme_linked',
    null,
    jsonb_build_object('theme_id', p_theme_id, 'relationship_type', p_relationship_type),
    null, null, null
  );
end;
$$;

-- Human status transition for a CoreNode (hypothesis → active / rejected /
-- archived). The actor is resolved from auth.uid() and the audit row commits
-- with the status change.
create or replace function public.set_core_node_status(
  p_org_id uuid,
  p_node_id uuid,
  p_status text,
  p_mark_confirmed boolean,
  p_mark_archived boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_client_id uuid;
  v_actor uuid;
begin
  if p_status not in ('active', 'rejected', 'archived') then
    raise exception 'unsupported core node status: %', p_status using errcode = '22023';
  end if;

  select c.client_id into v_client_id
  from public.core_nodes c
  where c.id = p_node_id and c.organization_id = p_org_id;

  if v_client_id is null then
    raise exception 'core node not found in this organization' using errcode = '22023';
  end if;

  v_actor := public.assert_client_write(p_org_id, v_client_id);

  update public.core_nodes
  set status = p_status,
      last_confirmed_by = case when p_mark_confirmed then v_actor else last_confirmed_by end,
      last_confirmed_at = case when p_mark_confirmed then now() else last_confirmed_at end,
      archived_at = case when p_mark_archived then coalesce(archived_at, now()) else archived_at end
  where id = p_node_id and organization_id = p_org_id;

  perform public.append_audit(
    p_org_id, 'core_node', p_node_id, 'core_node.' || p_status,
    null, jsonb_build_object('status', p_status), null, null, null
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- DifferentialHypotheses
-- ---------------------------------------------------------------------------

create or replace function public.create_hypothesis(
  p_org_id uuid,
  p_client_id uuid,
  p_title text,
  p_description text,
  p_confidence_score integer
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
  v_actor := public.assert_client_write(p_org_id, p_client_id);

  insert into public.differential_hypotheses (
    organization_id, client_id, title, description, confidence_score, created_by
  )
  values (p_org_id, p_client_id, p_title, p_description, p_confidence_score, v_actor)
  returning id into v_id;

  perform public.append_audit(
    p_org_id, 'differential_hypothesis', v_id, 'hypothesis.created',
    null, jsonb_build_object('title', p_title), null, null, null
  );

  return v_id;
end;
$$;

-- One contradicting evidence reference and the deterministic confidence drop
-- (−10, floor 0) commit with the audit row.
create or replace function public.add_hypothesis_contradiction(
  p_org_id uuid,
  p_hypothesis_id uuid,
  p_evidence_ref text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_client_id uuid;
  v_against text[];
  v_confidence integer;
  v_new_confidence integer;
begin
  select h.client_id, h.evidence_against, h.confidence_score
  into v_client_id, v_against, v_confidence
  from public.differential_hypotheses h
  where h.id = p_hypothesis_id and h.organization_id = p_org_id;

  if v_client_id is null then
    raise exception 'hypothesis not found in this organization' using errcode = '22023';
  end if;

  perform public.assert_client_write(p_org_id, v_client_id);

  v_against := coalesce(v_against, '{}'::text[]) || p_evidence_ref;
  v_new_confidence := greatest(0, coalesce(v_confidence, 0) - 10);

  update public.differential_hypotheses
  set evidence_against = v_against,
      confidence_score = v_new_confidence
  where id = p_hypothesis_id and organization_id = p_org_id;

  perform public.append_audit(
    p_org_id, 'differential_hypothesis', p_hypothesis_id, 'hypothesis.contradiction_added',
    null,
    jsonb_build_object('evidence_ref', p_evidence_ref, 'confidence_score', v_new_confidence),
    null, null, null
  );

  return jsonb_build_object('confidence_score', v_new_confidence);
end;
$$;

-- ---------------------------------------------------------------------------
-- Relations
-- ---------------------------------------------------------------------------

create or replace function public.create_relation(
  p_org_id uuid,
  p_client_id uuid,
  p_from_core_node_id uuid,
  p_to_core_node_id uuid,
  p_relation_type text,
  p_strength integer,
  p_confidence integer,
  p_evidence_summary text
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
  v_actor := public.assert_client_write(p_org_id, p_client_id);

  -- causes_confirmed is reachable only through confirm_causal_relation (human
  -- review with an explicit reason); the AI/service path can never set it.
  if p_relation_type not in (
    'may_contribute_to', 'reinforces', 'protects_from', 'compensates_for',
    'triggers', 'depends_on', 'contradicts', 'unlocks', 'is_variant_of',
    'associated_with', 'supports_hypothesis_of'
  ) then
    raise exception 'relation type % is not allowed on this path', p_relation_type
      using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.core_nodes c
    where c.id = p_from_core_node_id
      and c.client_id = p_client_id
      and c.organization_id = p_org_id
  ) or not exists (
    select 1 from public.core_nodes c
    where c.id = p_to_core_node_id
      and c.client_id = p_client_id
      and c.organization_id = p_org_id
  ) then
    raise exception 'relation endpoints must belong to this client' using errcode = '22023';
  end if;

  insert into public.core_node_relations (
    organization_id, client_id, from_core_node_id, to_core_node_id,
    relation_type, strength, confidence, evidence_summary, created_by
  )
  values (
    p_org_id, p_client_id, p_from_core_node_id, p_to_core_node_id,
    p_relation_type, p_strength, p_confidence, p_evidence_summary, v_actor
  )
  returning id into v_id;

  perform public.append_audit(
    p_org_id, 'core_node_relation', v_id, 'relation.created',
    null, jsonb_build_object('relation_type', p_relation_type), null, null, null
  );

  return v_id;
end;
$$;

-- Explicit human confirmation of a strong causal relation (SPEC §8.16).
create or replace function public.confirm_causal_relation(
  p_org_id uuid,
  p_relation_id uuid,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_client_id uuid;
begin
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'causes_confirmed requires an audit reason' using errcode = '22023';
  end if;

  select r.client_id into v_client_id
  from public.core_node_relations r
  where r.id = p_relation_id and r.organization_id = p_org_id;

  if v_client_id is null then
    raise exception 'relation not found in this organization' using errcode = '22023';
  end if;

  perform public.assert_client_write(p_org_id, v_client_id);

  update public.core_node_relations
  set relation_type = 'causes_confirmed'
  where id = p_relation_id and organization_id = p_org_id;

  perform public.append_audit(
    p_org_id, 'core_node_relation', p_relation_id, 'relation.causes_confirmed',
    null, jsonb_build_object('relation_type', 'causes_confirmed'),
    btrim(p_reason), null, null
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Resources
-- ---------------------------------------------------------------------------

create or replace function public.create_resource(
  p_org_id uuid,
  p_client_id uuid,
  p_name text,
  p_description text,
  p_domain text,
  p_strength_score integer,
  p_confidence_score integer,
  p_evidence_summary text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  perform public.assert_client_write(p_org_id, p_client_id);

  insert into public.resources (
    organization_id, client_id, name, description, domain,
    strength_score, confidence_score, evidence_summary
  )
  values (
    p_org_id, p_client_id, p_name, p_description, p_domain,
    p_strength_score, p_confidence_score, p_evidence_summary
  )
  returning id into v_id;

  perform public.append_audit(
    p_org_id, 'resource', v_id, 'resource.created',
    null, jsonb_build_object('name', p_name), null, null, null
  );

  return v_id;
end;
$$;

-- A resource score change must carry evidence or a human reason; the update and
-- its audit row commit together.
create or replace function public.update_resource(
  p_resource_id uuid,
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
  v_org_id uuid;
  v_key text;
  v_reason text;
begin
  select r.client_id, r.organization_id into v_client_id, v_org_id
  from public.resources r
  where r.id = p_resource_id;

  if v_client_id is null then
    raise exception 'resource not found' using errcode = '22023';
  end if;

  perform public.assert_client_write(v_org_id, v_client_id);

  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then
    raise exception 'invalid resource patch' using errcode = '22023';
  end if;

  for v_key in select jsonb_object_keys(p_patch) loop
    if v_key not in ('strength_score', 'confidence_score', 'evidence_summary') then
      raise exception 'field % cannot be updated', v_key using errcode = '22023';
    end if;
  end loop;

  v_reason := nullif(btrim(coalesce(p_reason, '')), '');

  if (p_patch ? 'strength_score' or p_patch ? 'confidence_score') and v_reason is null then
    raise exception 'resource score change requires evidence summary or human reason'
      using errcode = '22023';
  end if;

  update public.resources
  set strength_score = case when p_patch ? 'strength_score'
        then (p_patch ->> 'strength_score')::integer else strength_score end,
      confidence_score = case when p_patch ? 'confidence_score'
        then (p_patch ->> 'confidence_score')::integer else confidence_score end,
      evidence_summary = case when p_patch ? 'evidence_summary'
        then p_patch ->> 'evidence_summary' else evidence_summary end
  where id = p_resource_id;

  perform public.append_audit(
    v_org_id, 'resource', p_resource_id, 'resource.updated',
    null, p_patch, v_reason, null, null
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- DevelopmentTargets
-- ---------------------------------------------------------------------------

create or replace function public.create_development_target(
  p_org_id uuid,
  p_client_id uuid,
  p_payload jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  perform public.assert_client_write(p_org_id, p_client_id);

  insert into public.development_targets (
    organization_id, client_id, name, description, domain,
    current_level, target_level, importance,
    linked_resources, linked_core_nodes, success_markers
  )
  values (
    p_org_id, p_client_id,
    p_payload ->> 'name',
    p_payload ->> 'description',
    p_payload ->> 'domain',
    (p_payload ->> 'current_level')::integer,
    (p_payload ->> 'target_level')::integer,
    coalesce(p_payload ->> 'importance', 'normal'),
    public.jsonb_text_array(p_payload -> 'linked_resources')::uuid[],
    public.jsonb_text_array(p_payload -> 'linked_core_nodes')::uuid[],
    public.jsonb_text_array(p_payload -> 'success_markers')
  )
  returning id into v_id;

  perform public.append_audit(
    p_org_id, 'development_target', v_id, 'development_target.created',
    null, jsonb_build_object('name', p_payload ->> 'name'), null, null, null
  );

  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Purpose
-- ---------------------------------------------------------------------------

create or replace function public.create_purpose_profile(
  p_org_id uuid,
  p_client_id uuid,
  p_payload jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  perform public.assert_client_write(p_org_id, p_client_id);

  insert into public.purpose_profiles (
    organization_id, client_id, source_system, raw_data, interpretation,
    strengths, potential_roles, development_directions, confidence, visibility
  )
  values (
    p_org_id, p_client_id,
    p_payload ->> 'source_system',
    coalesce(p_payload -> 'raw_data', '{}'::jsonb),
    p_payload ->> 'interpretation',
    public.jsonb_text_array(p_payload -> 'strengths'),
    public.jsonb_text_array(p_payload -> 'potential_roles'),
    public.jsonb_text_array(p_payload -> 'development_directions'),
    (p_payload ->> 'confidence')::integer,
    coalesce(p_payload ->> 'visibility', 'internal')
  )
  returning id into v_id;

  perform public.append_audit(
    p_org_id, 'purpose_profile', v_id, 'purpose_profile.created',
    null, jsonb_build_object('source_system', p_payload ->> 'source_system'), null, null, null
  );

  return v_id;
end;
$$;

create or replace function public.create_purpose_synthesis(
  p_org_id uuid,
  p_client_id uuid,
  p_payload jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  perform public.assert_client_write(p_org_id, p_client_id);

  insert into public.purpose_syntheses (
    organization_id, client_id, summary, cross_system_matches,
    potential_conflicts, recommended_development_vectors
  )
  values (
    p_org_id, p_client_id,
    p_payload ->> 'summary',
    public.jsonb_text_array(p_payload -> 'cross_system_matches'),
    public.jsonb_text_array(p_payload -> 'potential_conflicts'),
    public.jsonb_text_array(p_payload -> 'recommended_development_vectors')
  )
  returning id into v_id;

  perform public.append_audit(
    p_org_id, 'purpose_synthesis', v_id, 'purpose_synthesis.created',
    null, null, null, null, null
  );

  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Recommendations (AI proposal batch)
-- ---------------------------------------------------------------------------

-- The whole AI proposal batch, every recommendation target and the audit row
-- commit or roll back together. AI proposals are always created as internal
-- drafts with the deterministic risk gate applied inside the transaction.
create or replace function public.create_recommendations(
  p_org_id uuid,
  p_client_id uuid,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid;
  v_request_id uuid;
  v_item jsonb;
  v_target jsonb;
  v_id uuid;
  v_ids jsonb := '[]'::jsonb;
  v_risk integer;
  v_review boolean;
begin
  v_actor := public.assert_client_write(p_org_id, p_client_id);

  v_request_id := nullif(p_payload ->> 'client_request_id', '')::uuid;
  if v_request_id is not null and not exists (
    select 1 from public.client_requests r
    where r.id = v_request_id
      and r.client_id = p_client_id
      and r.organization_id = p_org_id
  ) then
    raise exception 'client request does not belong to this client' using errcode = '22023';
  end if;

  for v_item in select * from jsonb_array_elements(coalesce(p_payload -> 'items', '[]'::jsonb)) loop
    v_risk := (v_item ->> 'risk_score')::integer;
    -- risk_score >= 80 always forces human review and internal visibility
    -- (SPEC §20), regardless of what the model claimed.
    v_review := coalesce((v_item ->> 'human_review_required')::boolean, false)
      or (v_risk is not null and v_risk >= 80);

    insert into public.recommendations (
      organization_id, client_id, client_request_id, proposed_correction, rationale,
      rootness_score, impact_score, activation_score, confidence_score,
      client_relevance_score, readiness_score, unlock_score, risk_score,
      systemic_leverage_score, final_priority_score, scoring_model_version,
      risk_notes, missing_evidence, rank_rationale, status, human_review_required,
      visibility, created_by
    )
    values (
      p_org_id, p_client_id, v_request_id,
      v_item ->> 'proposed_correction', v_item ->> 'rationale',
      (v_item ->> 'rootness_score')::integer,
      (v_item ->> 'impact_score')::integer,
      (v_item ->> 'activation_score')::integer,
      (v_item ->> 'confidence_score')::integer,
      (v_item ->> 'client_relevance_score')::integer,
      (v_item ->> 'readiness_score')::integer,
      (v_item ->> 'unlock_score')::integer,
      (v_item ->> 'risk_score')::integer,
      (v_item ->> 'systemic_leverage_score')::double precision,
      (v_item ->> 'final_priority_score')::double precision,
      v_item ->> 'scoring_model_version',
      v_item ->> 'risk_notes',
      public.jsonb_text_array(v_item -> 'missing_evidence'),
      v_item ->> 'rank_rationale',
      'draft', v_review, 'internal', v_actor
    )
    returning id into v_id;

    v_ids := v_ids || to_jsonb(v_id);

    for v_target in select * from jsonb_array_elements(coalesce(v_item -> 'targets', '[]'::jsonb)) loop
      insert into public.recommendation_targets (
        recommendation_id, target_type, target_id, role, expected_effect
      )
      values (
        v_id,
        v_target ->> 'target_type',
        (v_target ->> 'target_id')::uuid,
        v_target ->> 'role',
        v_target ->> 'expected_effect'
      );
    end loop;
  end loop;

  perform public.append_audit(
    p_org_id, 'client', p_client_id, 'ai.generate_recommendations',
    null, jsonb_build_object('proposed_recommendations', jsonb_array_length(v_ids)),
    null, null, null
  );

  return v_ids;
end;
$$;

-- ---------------------------------------------------------------------------
-- Diagnostic library (organization extensions)
-- ---------------------------------------------------------------------------

create or replace function public.create_org_domain(
  p_org_id uuid,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid;
  v_ontology_version_id uuid;
  v_row public.diagnostic_domains;
begin
  v_actor := public.require_org_member_actor(p_org_id);

  select v.id into v_ontology_version_id
  from public.ontology_versions v
  where v.status = 'active'
  order by v.created_at desc
  limit 1;

  if v_ontology_version_id is null then
    raise exception 'no active ontology version' using errcode = '55000';
  end if;

  insert into public.diagnostic_domains (
    organization_id, ontology_version_id, slug, name, description, domain_group,
    life_areas, default_priority, applicable_contexts, contraindicated_contexts,
    language, is_system, created_by
  )
  values (
    p_org_id, v_ontology_version_id,
    p_payload ->> 'slug', p_payload ->> 'name', p_payload ->> 'description',
    p_payload ->> 'domain_group',
    public.jsonb_text_array(p_payload -> 'life_areas'),
    (p_payload ->> 'default_priority')::integer,
    public.jsonb_text_array(p_payload -> 'applicable_contexts'),
    public.jsonb_text_array(p_payload -> 'contraindicated_contexts'),
    coalesce(p_payload ->> 'language', 'ru'), false, v_actor
  )
  returning * into v_row;

  perform public.append_audit(
    p_org_id, 'diagnostic_domain', v_row.id, 'diagnostic_domain.create',
    null, to_jsonb(v_row), null, null, null
  );

  return to_jsonb(v_row);
end;
$$;

create or replace function public.create_org_belief_template(
  p_org_id uuid,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid;
  v_ontology_version_id uuid;
  v_domain public.diagnostic_domains;
  v_row public.belief_templates;
begin
  v_actor := public.require_org_member_actor(p_org_id);

  select v.id into v_ontology_version_id
  from public.ontology_versions v
  where v.status = 'active'
  order by v.created_at desc
  limit 1;

  if v_ontology_version_id is null then
    raise exception 'no active ontology version' using errcode = '55000';
  end if;

  select * into v_domain
  from public.diagnostic_domains d
  where d.id = (p_payload ->> 'diagnostic_domain_id')::uuid
    and d.archived_at is null;

  if v_domain.id is null then
    raise exception 'diagnostic domain not found' using errcode = '22023';
  end if;
  if v_domain.organization_id is not null and v_domain.organization_id <> p_org_id then
    raise exception 'domain belongs to another organization' using errcode = '42501';
  end if;

  insert into public.belief_templates (
    organization_id, diagnostic_domain_id, ontology_version_id, code, statement,
    statement_polarity, default_life_areas, default_tags, interpretation_hint,
    root_hypothesis_hint, language, is_system, created_by
  )
  values (
    p_org_id, v_domain.id, v_ontology_version_id,
    p_payload ->> 'code', p_payload ->> 'statement',
    coalesce(p_payload ->> 'statement_polarity', 'unknown'),
    public.jsonb_text_array(p_payload -> 'default_life_areas'),
    public.jsonb_text_array(p_payload -> 'default_tags'),
    p_payload ->> 'interpretation_hint',
    p_payload ->> 'root_hypothesis_hint',
    coalesce(p_payload ->> 'language', 'ru'), false, v_actor
  )
  returning * into v_row;

  perform public.append_audit(
    p_org_id, 'belief_template', v_row.id, 'belief_template.create',
    null, to_jsonb(v_row), null, null, null
  );

  return to_jsonb(v_row);
end;
$$;

create or replace function public.archive_org_domain(p_domain_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.diagnostic_domains;
  v_before jsonb;
  v_after jsonb;
begin
  select * into v_row from public.diagnostic_domains d where d.id = p_domain_id;

  if v_row.id is null or v_row.is_system or v_row.archived_at is not null then
    raise exception 'domain not found or not editable' using errcode = '22023';
  end if;

  perform public.require_org_member_actor(v_row.organization_id);

  v_before := to_jsonb(v_row);

  update public.diagnostic_domains
  set archived_at = now()
  where id = p_domain_id and is_system = false and archived_at is null;

  select to_jsonb(d) into v_after from public.diagnostic_domains d where d.id = p_domain_id;

  perform public.append_audit(
    v_row.organization_id, 'diagnostic_domain', p_domain_id, 'diagnostic_domain.archive',
    v_before, v_after, null, null, null
  );
end;
$$;

create or replace function public.archive_org_belief_template(p_template_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.belief_templates;
  v_before jsonb;
  v_after jsonb;
begin
  select * into v_row from public.belief_templates t where t.id = p_template_id;

  if v_row.id is null or v_row.is_system or v_row.archived_at is not null then
    raise exception 'belief template not found or not editable' using errcode = '22023';
  end if;

  perform public.require_org_member_actor(v_row.organization_id);

  v_before := to_jsonb(v_row);

  update public.belief_templates
  set archived_at = now()
  where id = p_template_id and is_system = false and archived_at is null;

  select to_jsonb(t) into v_after from public.belief_templates t where t.id = p_template_id;

  perform public.append_audit(
    v_row.organization_id, 'belief_template', p_template_id, 'belief_template.archive',
    v_before, v_after, null, null, null
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Intervention methods (organization catalog)
-- ---------------------------------------------------------------------------

create or replace function public.create_org_method(p_org_id uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid;
  v_row public.intervention_methods;
begin
  v_actor := public.assert_org_author_actor(p_org_id);

  insert into public.intervention_methods (
    organization_id, name, description, category, contraindications,
    default_follow_up_days, is_system, created_by
  )
  values (
    p_org_id,
    p_payload ->> 'name',
    p_payload ->> 'description',
    p_payload ->> 'category',
    public.jsonb_text_array(p_payload -> 'contraindications'),
    (p_payload ->> 'default_follow_up_days')::integer,
    false, v_actor
  )
  returning * into v_row;

  perform public.append_audit(
    p_org_id, 'intervention_method', v_row.id, 'intervention_method.create',
    null, to_jsonb(v_row), null, null, null
  );

  return to_jsonb(v_row);
end;
$$;

create or replace function public.update_org_method(p_method_id uuid, p_patch jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.intervention_methods;
  v_before jsonb;
  v_after jsonb;
begin
  select * into v_row from public.intervention_methods m where m.id = p_method_id;

  if v_row.id is null then
    raise exception 'intervention method not found' using errcode = '22023';
  end if;
  if v_row.is_system or v_row.organization_id is null then
    raise exception 'system methods cannot be modified' using errcode = '42501';
  end if;
  if v_row.archived_at is not null then
    raise exception 'archived methods cannot be edited' using errcode = '55000';
  end if;

  perform public.assert_org_author_actor(v_row.organization_id);

  v_before := to_jsonb(v_row);

  update public.intervention_methods
  set name = case when p_patch ? 'name' then p_patch ->> 'name' else name end,
      description = case when p_patch ? 'description' then p_patch ->> 'description' else description end,
      category = case when p_patch ? 'category' then p_patch ->> 'category' else category end,
      contraindications = case when p_patch ? 'contraindications'
        then public.jsonb_text_array(p_patch -> 'contraindications') else contraindications end,
      default_follow_up_days = case when p_patch ? 'default_follow_up_days'
        then (p_patch ->> 'default_follow_up_days')::integer else default_follow_up_days end,
      updated_at = now()
  where id = p_method_id;

  select to_jsonb(m) into v_after from public.intervention_methods m where m.id = p_method_id;

  perform public.append_audit(
    v_row.organization_id, 'intervention_method', p_method_id, 'intervention_method.update',
    v_before, v_after, null, null, null
  );

  return v_after;
end;
$$;

create or replace function public.archive_org_method(p_method_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.intervention_methods;
  v_before jsonb;
  v_after jsonb;
begin
  select * into v_row from public.intervention_methods m where m.id = p_method_id;

  if v_row.id is null then
    raise exception 'intervention method not found' using errcode = '22023';
  end if;
  if v_row.is_system or v_row.organization_id is null then
    raise exception 'system methods cannot be archived' using errcode = '42501';
  end if;

  -- Archiving an already archived method is a no-op: no fabricated audit row.
  if v_row.archived_at is not null then
    return;
  end if;

  perform public.assert_org_author_actor(v_row.organization_id);

  v_before := to_jsonb(v_row);

  update public.intervention_methods
  set archived_at = now()
  where id = p_method_id and is_system = false and archived_at is null;

  select to_jsonb(m) into v_after from public.intervention_methods m where m.id = p_method_id;

  perform public.append_audit(
    v_row.organization_id, 'intervention_method', p_method_id, 'intervention_method.archive',
    v_before, v_after, null, null, null
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Model history: ModelChange, snapshot, explanation
-- ---------------------------------------------------------------------------

create or replace function public.record_model_change(
  p_org_id uuid,
  p_client_id uuid,
  p_entity_type text,
  p_entity_id uuid,
  p_previous_state jsonb,
  p_new_state jsonb,
  p_change_reason text,
  p_evidence_refs jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.model_changes;
begin
  perform public.assert_client_write(p_org_id, p_client_id);

  insert into public.model_changes (
    organization_id, client_id, entity_type, entity_id,
    previous_state, new_state, change_reason, evidence_refs
  )
  values (
    p_org_id, p_client_id, p_entity_type, p_entity_id,
    nullif(p_previous_state, 'null'::jsonb),
    nullif(p_new_state, 'null'::jsonb),
    p_change_reason,
    public.jsonb_text_array(p_evidence_refs)::uuid[]
  )
  returning * into v_row;

  perform public.append_audit(
    p_org_id, 'model_change', null, 'model_change.record',
    null,
    jsonb_build_object(
      'client_id', p_client_id,
      'entity_type', p_entity_type,
      'entity_id', p_entity_id,
      'previous_state', v_row.previous_state,
      'new_state', v_row.new_state,
      'evidence_refs', to_jsonb(v_row.evidence_refs)
    ),
    p_change_reason, null, null
  );

  return to_jsonb(v_row);
end;
$$;

-- The snapshot row and its audit row commit together; the version is allocated
-- under a per-client advisory lock so it stays monotonic without a retry loop.
-- Consent is asserted inside the transaction.
create or replace function public.create_snapshot(
  p_org_id uuid,
  p_client_id uuid,
  p_reason text,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid;
  v_version integer;
  v_row public.psychological_snapshots;
begin
  v_actor := public.assert_client_consent(
    p_org_id, p_client_id, array['data_storage', 'sensitive_psychological_data']
  );

  perform pg_advisory_xact_lock(hashtextextended(p_client_id::text, 0));

  select coalesce(max(s.version), 0) + 1 into v_version
  from public.psychological_snapshots s
  where s.client_id = p_client_id;

  insert into public.psychological_snapshots (
    organization_id, client_id, version, generated_by, reason, summary,
    active_core_nodes, active_themes, resource_state, development_targets,
    weakened_nodes, reactivated_nodes, recent_triggers, recent_corrections,
    current_requests, recommendations, trend_summary, risk_notes, evidence_digest,
    changes_since_previous, model_hash, scoring_model_version, ontology_version,
    ai_model, prompt_version
  )
  values (
    p_org_id, p_client_id, v_version, v_actor, p_reason,
    coalesce(p_payload ->> 'summary', ''),
    coalesce(p_payload -> 'active_core_nodes', '[]'::jsonb),
    coalesce(p_payload -> 'active_themes', '[]'::jsonb),
    coalesce(p_payload -> 'resource_state', '[]'::jsonb),
    coalesce(p_payload -> 'development_targets', '[]'::jsonb),
    coalesce(p_payload -> 'weakened_nodes', '[]'::jsonb),
    coalesce(p_payload -> 'reactivated_nodes', '[]'::jsonb),
    coalesce(p_payload -> 'recent_triggers', '[]'::jsonb),
    coalesce(p_payload -> 'recent_corrections', '[]'::jsonb),
    coalesce(p_payload -> 'current_requests', '[]'::jsonb),
    coalesce(p_payload -> 'recommendations', '[]'::jsonb),
    coalesce(p_payload ->> 'trend_summary', ''),
    coalesce(p_payload ->> 'risk_notes', ''),
    coalesce(p_payload ->> 'evidence_digest', ''),
    nullif(p_payload -> 'changes_since_previous', 'null'::jsonb),
    p_payload ->> 'model_hash',
    p_payload ->> 'scoring_model_version',
    p_payload ->> 'ontology_version',
    p_payload ->> 'ai_model',
    p_payload ->> 'prompt_version'
  )
  returning * into v_row;

  perform public.append_audit(
    p_org_id, 'psychological_snapshot', null, 'snapshot.generate',
    null, null, p_reason, null, null
  );

  return to_jsonb(v_row);
end;
$$;

-- A model explanation is only ever created pending or rejected: the AI can
-- never approve its own output. Consent is asserted inside the transaction.
create or replace function public.save_model_explanation(
  p_org_id uuid,
  p_client_id uuid,
  p_payload jsonb,
  p_action text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid;
  v_status text;
  v_row public.model_explanations;
begin
  v_actor := public.assert_client_consent(
    p_org_id, p_client_id, array['data_storage', 'sensitive_psychological_data']
  );

  v_status := coalesce(p_payload ->> 'status', 'pending');
  if v_status not in ('pending', 'rejected') then
    raise exception 'a model explanation must be created pending or rejected'
      using errcode = '22023';
  end if;

  insert into public.model_explanations (
    organization_id, client_id, status, source, before_snapshot_id,
    after_snapshot_id, explanations, grounding, grounding_errors,
    missing_evidence, versions, run_id, created_by
  )
  values (
    p_org_id, p_client_id, v_status, p_payload ->> 'source',
    nullif(p_payload ->> 'before_snapshot_id', '')::uuid,
    nullif(p_payload ->> 'after_snapshot_id', '')::uuid,
    coalesce(p_payload -> 'explanations', '[]'::jsonb),
    coalesce(p_payload -> 'grounding', '{}'::jsonb),
    coalesce(p_payload -> 'grounding_errors', '[]'::jsonb),
    public.jsonb_text_array(p_payload -> 'missing_evidence'),
    coalesce(p_payload -> 'versions', '{}'::jsonb),
    nullif(p_payload ->> 'run_id', '')::uuid,
    v_actor
  )
  returning * into v_row;

  perform public.append_audit(
    p_org_id, 'model_explanation', null, p_action,
    null, null, 'client ' || p_client_id, null, null
  );

  return to_jsonb(v_row);
end;
$$;

create or replace function public.review_model_explanation(
  p_org_id uuid,
  p_explanation_id uuid,
  p_decision text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.model_explanations;
  v_actor uuid;
  v_status text;
  v_errors text[];
begin
  if p_decision not in ('approve', 'reject') then
    raise exception 'unknown review decision' using errcode = '22023';
  end if;

  select * into v_row
  from public.model_explanations e
  where e.id = p_explanation_id and e.organization_id = p_org_id;

  if v_row.id is null then
    raise exception 'model explanation not found' using errcode = '22023';
  end if;

  v_actor := public.assert_client_write(p_org_id, v_row.client_id);

  if v_row.status <> 'pending' then
    raise exception 'explanation was already reviewed' using errcode = '55000';
  end if;

  v_status := case when p_decision = 'approve' then 'approved' else 'rejected' end;

  -- Defense in depth: re-run the deterministic grounding check inside the
  -- transaction so fabricated references can never become approved.
  if p_decision = 'approve' then
    v_errors := public.validate_explanation_grounding(v_row.explanations, v_row.grounding);
    if array_length(v_errors, 1) > 0 then
      raise exception 'explanation references changes or evidence that do not exist and cannot be approved'
        using errcode = '42501';
    end if;
  end if;

  update public.model_explanations
  set status = v_status, decided_by = v_actor, decided_at = now()
  where id = p_explanation_id and organization_id = p_org_id and status = 'pending'
  returning * into v_row;

  perform public.append_audit(
    p_org_id, 'model_explanation', p_explanation_id, 'model_explanation.' || p_decision,
    jsonb_build_object('status', 'pending'),
    jsonb_build_object('status', v_status),
    null, null, null
  );

  return to_jsonb(v_row);
end;
$$;

-- ---------------------------------------------------------------------------
-- AI proposal batches
--
-- These flows persist AI proposals for the same model tables. Every proposal in
-- a batch, its child links and the audit row commit or roll back together, and
-- the pending/L0 semantics are enforced inside the transaction: proposals are
-- created as pending/draft and a confirmed entity is never overwritten.
-- ---------------------------------------------------------------------------

create or replace function public.apply_ai_core_node_proposals(
  p_org_id uuid,
  p_client_id uuid,
  p_proposals jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid;
  v_ids jsonb := '[]'::jsonb;
  v_proposal jsonb;
  v_action text;
  v_node_id uuid;
  v_target uuid;
  v_status text;
  v_theme_id text;
  v_confirmed text[] := array[
    'active', 'in_treatment', 'treated_unverified', 'weakened',
    'integrated', 'reactivated', 'contradicted'
  ];
begin
  v_actor := public.assert_client_write(p_org_id, p_client_id);

  for v_proposal in select * from jsonb_array_elements(coalesce(p_proposals, '[]'::jsonb)) loop
    v_action := v_proposal ->> 'action';
    if v_action is null or v_action = 'no_change' then
      continue;
    end if;

    if v_action = 'create' then
      -- AI proposals are pending human review and never inflate counts.
      insert into public.core_nodes (
        organization_id, client_id, title, hypothesis, root_domain,
        confidence_score, status, created_by
      )
      values (
        p_org_id, p_client_id,
        v_proposal ->> 'title',
        v_proposal ->> 'hypothesis',
        v_proposal ->> 'root_domain',
        (v_proposal ->> 'confidence')::integer,
        'under_review', v_actor
      )
      returning id into v_node_id;

      v_ids := v_ids || to_jsonb(v_node_id);

      for v_theme_id in
        select jsonb_array_elements_text(coalesce(v_proposal -> 'theme_links', '[]'::jsonb))
      loop
        insert into public.theme_core_node_links (
          theme_id, core_node_id, relationship_type, link_rationale
        )
        values (
          v_theme_id::uuid, v_node_id, 'supports', nullif(v_proposal ->> 'rationale', '')
        );
      end loop;
      continue;
    end if;

    if v_action = 'update' then
      v_target := nullif(v_proposal ->> 'existing_core_node_id', '')::uuid;
      if v_target is null then
        continue;
      end if;

      select c.status into v_status
      from public.core_nodes c
      where c.id = v_target
        and c.client_id = p_client_id
        and c.organization_id = p_org_id;

      -- Cross-tenant/missing nodes and human-confirmed nodes are never touched.
      if v_status is null or v_status = any (v_confirmed) then
        continue;
      end if;

      update public.core_nodes
      set title = coalesce(v_proposal ->> 'title', title),
          hypothesis = v_proposal ->> 'hypothesis',
          root_domain = v_proposal ->> 'root_domain',
          confidence_score = (v_proposal ->> 'confidence')::integer,
          status = 'under_review'
      where id = v_target and organization_id = p_org_id;

      v_ids := v_ids || to_jsonb(v_target);
    end if;
  end loop;

  perform public.append_audit(
    p_org_id, 'client', p_client_id, 'ai.update_core_nodes',
    null, jsonb_build_object('proposed_core_nodes', jsonb_array_length(v_ids)),
    null, null, null
  );

  return v_ids;
end;
$$;

create or replace function public.create_ai_hypotheses(
  p_org_id uuid,
  p_client_id uuid,
  p_hypotheses jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid;
  v_ids jsonb := '[]'::jsonb;
  v_item jsonb;
  v_id uuid;
begin
  v_actor := public.assert_client_write(p_org_id, p_client_id);

  for v_item in select * from jsonb_array_elements(coalesce(p_hypotheses, '[]'::jsonb)) loop
    insert into public.differential_hypotheses (
      organization_id, client_id, title, description, confidence_score,
      status, evidence_for, evidence_against, created_by
    )
    values (
      p_org_id, p_client_id,
      v_item ->> 'title',
      v_item ->> 'description',
      (v_item ->> 'confidence')::integer,
      'hypothesis',
      public.jsonb_text_array(v_item -> 'evidence_for'),
      public.jsonb_text_array(v_item -> 'evidence_against'),
      v_actor
    )
    returning id into v_id;

    v_ids := v_ids || to_jsonb(v_id);
  end loop;

  perform public.append_audit(
    p_org_id, 'client', p_client_id, 'ai.generate_differential_hypotheses',
    null, jsonb_build_object('proposed_hypotheses', jsonb_array_length(v_ids)),
    null, null, null
  );

  return v_ids;
end;
$$;

create or replace function public.create_ai_contradiction_relations(
  p_org_id uuid,
  p_client_id uuid,
  p_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid;
  v_ids jsonb := '[]'::jsonb;
  v_item jsonb;
  v_from uuid;
  v_to uuid;
  v_id uuid;
begin
  v_actor := public.assert_client_write(p_org_id, p_client_id);

  for v_item in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    v_from := nullif(v_item ->> 'from_core_node_id', '')::uuid;
    v_to := nullif(v_item ->> 'to_core_node_id', '')::uuid;
    if v_from is null or v_to is null then
      continue;
    end if;

    -- Both endpoints must belong to this client; otherwise the proposal is
    -- advisory only and creates no side effect.
    if (
      select count(*) from public.core_nodes c
      where c.id in (v_from, v_to)
        and c.client_id = p_client_id
        and c.organization_id = p_org_id
    ) <> 2 then
      continue;
    end if;

    insert into public.core_node_relations (
      organization_id, client_id, from_core_node_id, to_core_node_id,
      relation_type, confidence, evidence_summary, created_by
    )
    values (
      p_org_id, p_client_id, v_from, v_to,
      'contradicts', (v_item ->> 'confidence')::integer,
      v_item ->> 'evidence_summary', v_actor
    )
    returning id into v_id;

    v_ids := v_ids || to_jsonb(v_id);
  end loop;

  perform public.append_audit(
    p_org_id, 'client', p_client_id, 'ai.detect_contradictions',
    null, jsonb_build_object('contradiction_relations', jsonb_array_length(v_ids)),
    null, null, null
  );

  return v_ids;
end;
$$;

create or replace function public.create_evidence_clusters(
  p_org_id uuid,
  p_client_id uuid,
  p_session_id uuid,
  p_clusters jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ids jsonb := '[]'::jsonb;
  v_item jsonb;
  v_id uuid;
begin
  perform public.assert_client_write(p_org_id, p_client_id);

  if p_session_id is not null and not exists (
    select 1 from public.diagnostic_sessions s
    where s.id = p_session_id
      and s.client_id = p_client_id
      and s.organization_id = p_org_id
  ) then
    raise exception 'diagnostic session does not belong to this client' using errcode = '22023';
  end if;

  for v_item in select * from jsonb_array_elements(coalesce(p_clusters, '[]'::jsonb)) loop
    insert into public.evidence_clusters (
      organization_id, client_id, diagnostic_session_id, semantic_topic,
      context_key, signals_count, independent_weight
    )
    values (
      p_org_id, p_client_id, p_session_id,
      v_item ->> 'semantic_topic',
      v_item ->> 'context_key',
      coalesce((v_item ->> 'signals_count')::integer, 0),
      -- AI never inflates independence: the deterministic weight is 1.
      1
    )
    returning id into v_id;

    v_ids := v_ids || to_jsonb(v_id);
  end loop;

  perform public.append_audit(
    p_org_id, 'diagnostic_session', p_session_id, 'ai.cluster_evidence',
    null, jsonb_build_object('created_clusters', jsonb_array_length(v_ids)),
    null, null, null
  );

  return v_ids;
end;
$$;

create or replace function public.apply_ai_theme_proposals(
  p_org_id uuid,
  p_client_id uuid,
  p_proposals jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_theme_ids jsonb := '[]'::jsonb;
  v_proposal jsonb;
  v_action text;
  v_theme_id uuid;
  v_link jsonb;
begin
  perform public.assert_client_write(p_org_id, p_client_id);

  for v_proposal in select * from jsonb_array_elements(coalesce(p_proposals, '[]'::jsonb)) loop
    v_action := v_proposal ->> 'action';
    if v_action is null or v_action = 'no_change' then
      continue;
    end if;

    if v_action = 'create' then
      -- AI-created Themes stay pending human review.
      insert into public.themes (
        organization_id, client_id, name, description, domain,
        confidence_score, review_status
      )
      values (
        p_org_id, p_client_id,
        v_proposal ->> 'name',
        v_proposal ->> 'description',
        v_proposal ->> 'domain',
        (v_proposal ->> 'confidence')::integer,
        'pending'
      )
      returning id into v_theme_id;

      v_theme_ids := v_theme_ids || to_jsonb(v_theme_id);
    else
      v_theme_id := nullif(v_proposal ->> 'existing_theme_id', '')::uuid;
      if v_theme_id is null then
        continue;
      end if;
      if not exists (
        select 1 from public.themes t
        where t.id = v_theme_id
          and t.client_id = p_client_id
          and t.organization_id = p_org_id
      ) then
        continue;
      end if;
    end if;

    for v_link in
      select * from jsonb_array_elements(coalesce(v_proposal -> 'signal_links', '[]'::jsonb))
    loop
      insert into public.signal_theme_links (
        signal_id, theme_id, relevance_score, link_rationale
      )
      values (
        (v_link ->> 'signal_id')::uuid,
        v_theme_id,
        (v_link ->> 'relevance_score')::integer,
        v_link ->> 'link_rationale'
      );
    end loop;
  end loop;

  perform public.append_audit(
    p_org_id, 'client', p_client_id, 'ai.classify_themes',
    null, jsonb_build_object('proposed_themes', jsonb_array_length(v_theme_ids)),
    null, null, null
  );

  return v_theme_ids;
end;
$$;

create or replace function public.apply_ai_resource_proposals(
  p_org_id uuid,
  p_client_id uuid,
  p_proposals jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ids jsonb := '[]'::jsonb;
  v_proposal jsonb;
  v_action text;
  v_id uuid;
  v_target uuid;
  v_existing_refs text[];
  v_merged text[];
begin
  perform public.assert_client_write(p_org_id, p_client_id);

  for v_proposal in select * from jsonb_array_elements(coalesce(p_proposals, '[]'::jsonb)) loop
    v_action := v_proposal ->> 'action';
    if v_action is null or v_action = 'no_change' then
      continue;
    end if;

    if v_action = 'create' then
      -- AI-created Resources stay pending human review.
      insert into public.resources (
        organization_id, client_id, name, description, domain,
        strength_score, confidence_score, trend, evidence_refs,
        evidence_summary, review_status
      )
      values (
        p_org_id, p_client_id,
        v_proposal ->> 'name',
        nullif(v_proposal ->> 'description', ''),
        v_proposal ->> 'domain',
        (v_proposal ->> 'proposed_strength')::integer,
        (v_proposal ->> 'proposed_confidence')::integer,
        v_proposal ->> 'proposed_trend',
        public.jsonb_text_array(v_proposal -> 'evidence_refs'),
        v_proposal ->> 'rationale',
        'pending'
      )
      returning id into v_id;

      v_ids := v_ids || to_jsonb(v_id);
      continue;
    end if;

    if v_action in ('update', 'link_existing') then
      v_target := nullif(v_proposal ->> 'existing_resource_id', '')::uuid;
      if v_target is null then
        continue;
      end if;

      select r.evidence_refs into v_existing_refs
      from public.resources r
      where r.id = v_target
        and r.client_id = p_client_id
        and r.organization_id = p_org_id;

      if not found then
        continue;
      end if;

      if v_action = 'link_existing' then
        -- Deduplicate while preserving the first-seen order.
        select coalesce(array_agg(x order by min_ord), '{}'::text[]) into v_merged
        from (
          select x, min(ord) as min_ord
          from unnest(
            coalesce(v_existing_refs, '{}'::text[])
            || public.jsonb_text_array(v_proposal -> 'evidence_refs')
          ) with ordinality as t(x, ord)
          group by x
        ) g;

        update public.resources
        set evidence_refs = v_merged, review_status = 'pending'
        where id = v_target;
      else
        update public.resources
        set strength_score = (v_proposal ->> 'proposed_strength')::integer,
            confidence_score = (v_proposal ->> 'proposed_confidence')::integer,
            trend = v_proposal ->> 'proposed_trend',
            evidence_refs = public.jsonb_text_array(v_proposal -> 'evidence_refs'),
            review_status = 'pending'
        where id = v_target;
      end if;

      v_ids := v_ids || to_jsonb(v_target);
    end if;
  end loop;

  perform public.append_audit(
    p_org_id, 'client', p_client_id, 'ai.update_resources',
    null, jsonb_build_object('proposed_resources', jsonb_array_length(v_ids)),
    null, null, null
  );

  return v_ids;
end;
$$;

-- ---------------------------------------------------------------------------
-- Least privilege: new functions inherit EXECUTE for anon from the 0002
-- default privileges, so every public RPC is revoked explicitly.
-- ---------------------------------------------------------------------------
revoke all on function public.create_theme(uuid, uuid, text, text, text) from public, anon;
revoke all on function public.link_theme_signal(uuid, uuid, uuid, integer, text) from public, anon;
revoke all on function public.unlink_theme_signal(uuid, uuid, uuid) from public, anon;
revoke all on function public.recompute_theme_aggregates(uuid) from public, anon;
revoke all on function public.create_core_node(uuid, uuid, text, text, text, integer) from public, anon;
revoke all on function public.link_theme_core_node(uuid, uuid, uuid, text, integer, text) from public, anon;
revoke all on function public.set_core_node_status(uuid, uuid, text, boolean, boolean) from public, anon;
revoke all on function public.create_hypothesis(uuid, uuid, text, text, integer) from public, anon;
revoke all on function public.add_hypothesis_contradiction(uuid, uuid, text) from public, anon;
revoke all on function public.create_relation(uuid, uuid, uuid, uuid, text, integer, integer, text) from public, anon;
revoke all on function public.confirm_causal_relation(uuid, uuid, text) from public, anon;
revoke all on function public.create_resource(uuid, uuid, text, text, text, integer, integer, text) from public, anon;
revoke all on function public.update_resource(uuid, jsonb, text) from public, anon;
revoke all on function public.create_development_target(uuid, uuid, jsonb) from public, anon;
revoke all on function public.create_purpose_profile(uuid, uuid, jsonb) from public, anon;
revoke all on function public.create_purpose_synthesis(uuid, uuid, jsonb) from public, anon;
revoke all on function public.create_recommendations(uuid, uuid, jsonb) from public, anon;
revoke all on function public.create_org_domain(uuid, jsonb) from public, anon;
revoke all on function public.create_org_belief_template(uuid, jsonb) from public, anon;
revoke all on function public.archive_org_domain(uuid) from public, anon;
revoke all on function public.archive_org_belief_template(uuid) from public, anon;
revoke all on function public.create_org_method(uuid, jsonb) from public, anon;
revoke all on function public.update_org_method(uuid, jsonb) from public, anon;
revoke all on function public.archive_org_method(uuid) from public, anon;
revoke all on function public.record_model_change(uuid, uuid, text, uuid, jsonb, jsonb, text, jsonb) from public, anon;
revoke all on function public.create_snapshot(uuid, uuid, text, jsonb) from public, anon;
revoke all on function public.save_model_explanation(uuid, uuid, jsonb, text) from public, anon;
revoke all on function public.review_model_explanation(uuid, uuid, text) from public, anon;
revoke all on function public.apply_ai_core_node_proposals(uuid, uuid, jsonb) from public, anon;
revoke all on function public.create_ai_hypotheses(uuid, uuid, jsonb) from public, anon;
revoke all on function public.create_ai_contradiction_relations(uuid, uuid, jsonb) from public, anon;
revoke all on function public.create_evidence_clusters(uuid, uuid, uuid, jsonb) from public, anon;
revoke all on function public.apply_ai_theme_proposals(uuid, uuid, jsonb) from public, anon;
revoke all on function public.apply_ai_resource_proposals(uuid, uuid, jsonb) from public, anon;

grant execute on function public.create_theme(uuid, uuid, text, text, text) to authenticated, service_role;
grant execute on function public.link_theme_signal(uuid, uuid, uuid, integer, text) to authenticated, service_role;
grant execute on function public.unlink_theme_signal(uuid, uuid, uuid) to authenticated, service_role;
grant execute on function public.recompute_theme_aggregates(uuid) to authenticated, service_role;
grant execute on function public.create_core_node(uuid, uuid, text, text, text, integer) to authenticated, service_role;
grant execute on function public.link_theme_core_node(uuid, uuid, uuid, text, integer, text) to authenticated, service_role;
grant execute on function public.set_core_node_status(uuid, uuid, text, boolean, boolean) to authenticated, service_role;
grant execute on function public.create_hypothesis(uuid, uuid, text, text, integer) to authenticated, service_role;
grant execute on function public.add_hypothesis_contradiction(uuid, uuid, text) to authenticated, service_role;
grant execute on function public.create_relation(uuid, uuid, uuid, uuid, text, integer, integer, text) to authenticated, service_role;
grant execute on function public.confirm_causal_relation(uuid, uuid, text) to authenticated, service_role;
grant execute on function public.create_resource(uuid, uuid, text, text, text, integer, integer, text) to authenticated, service_role;
grant execute on function public.update_resource(uuid, jsonb, text) to authenticated, service_role;
grant execute on function public.create_development_target(uuid, uuid, jsonb) to authenticated, service_role;
grant execute on function public.create_purpose_profile(uuid, uuid, jsonb) to authenticated, service_role;
grant execute on function public.create_purpose_synthesis(uuid, uuid, jsonb) to authenticated, service_role;
grant execute on function public.create_recommendations(uuid, uuid, jsonb) to authenticated, service_role;
grant execute on function public.create_org_domain(uuid, jsonb) to authenticated, service_role;
grant execute on function public.create_org_belief_template(uuid, jsonb) to authenticated, service_role;
grant execute on function public.archive_org_domain(uuid) to authenticated, service_role;
grant execute on function public.archive_org_belief_template(uuid) to authenticated, service_role;
grant execute on function public.create_org_method(uuid, jsonb) to authenticated, service_role;
grant execute on function public.update_org_method(uuid, jsonb) to authenticated, service_role;
grant execute on function public.archive_org_method(uuid) to authenticated, service_role;
grant execute on function public.record_model_change(uuid, uuid, text, uuid, jsonb, jsonb, text, jsonb) to authenticated, service_role;
grant execute on function public.create_snapshot(uuid, uuid, text, jsonb) to authenticated, service_role;
grant execute on function public.save_model_explanation(uuid, uuid, jsonb, text) to authenticated, service_role;
grant execute on function public.review_model_explanation(uuid, uuid, text) to authenticated, service_role;
grant execute on function public.apply_ai_core_node_proposals(uuid, uuid, jsonb) to authenticated, service_role;
grant execute on function public.create_ai_hypotheses(uuid, uuid, jsonb) to authenticated, service_role;
grant execute on function public.create_ai_contradiction_relations(uuid, uuid, jsonb) to authenticated, service_role;
grant execute on function public.create_evidence_clusters(uuid, uuid, uuid, jsonb) to authenticated, service_role;
grant execute on function public.apply_ai_theme_proposals(uuid, uuid, jsonb) to authenticated, service_role;
grant execute on function public.apply_ai_resource_proposals(uuid, uuid, jsonb) to authenticated, service_role;
