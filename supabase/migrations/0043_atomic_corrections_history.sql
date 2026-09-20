-- 0043: Atomic corrections, observations and model history (ticket 07).
--
-- Template: supabase/migrations/0039_atomic_business_mutation.sql, reusing the
-- shared guards introduced by 0040/0041/0042 (require_org_member_actor,
-- assert_client_write, assert_client_consent, jsonb_text_array, append_audit).
--
-- Before this migration the correction / observation / follow-up / reactivation
-- paths were a table write followed by separate recordAudit()/withAudit() and
-- recordModelChange() network calls. A failure between two calls left committed
-- business state that diverged from its history:
--   * a Correction existed without its targets/expected markers, or without the
--     audit row that records the plan;
--   * a BehavioralMarker stored a baseline_value but no baseline history entry;
--   * recordMarkerValue appended the history entry and then failed before the
--     current_value/trend update (or the audit append);
--   * an approved follow-up verdict or an approved reactivation changed the
--     model without its ModelChange row;
--   * the reactivation decision touched core_nodes, the proposal and the
--     ModelChange in three independent transactions.
--
-- Every path below is now one transaction: the domain row(s), their child rows,
-- the optional ModelChange row and the AuditLog append commit or roll back
-- together. Public service contracts are unchanged; the services call these
-- RPCs through runAtomicRpc() and no longer pair them with recordAudit().
--
-- Ticket 06 already migrated ModelChange, snapshot and explanation creation
-- (record_model_change / create_snapshot / save_model_explanation /
-- review_model_explanation); those are reused here, never duplicated. The
-- follow-up verdict and the reactivation decision compose a ModelChange inside
-- the same transaction through a new internal helper that mirrors
-- record_model_change()'s write order (row first, audit last) without a nested
-- RPC boundary.
--
-- Human-in-the-loop semantics are unchanged and enforced inside the
-- transactions: a reactivation still requires a pending proposal on a weakened
-- node, a follow-up verdict still requires a pending assessment, "effective"
-- still requires objective evidence, and a completed Correction still requires
-- its expected markers. The AI never writes a final state directly.

-- ---------------------------------------------------------------------------
-- Internal helpers
-- ---------------------------------------------------------------------------

-- Internal: required keys of a stored follow-up assessment. Kept in SQL so the
-- transaction rejects a malformed payload before writing anything.
create or replace function public.p_payload_missing_required(p_assessment jsonb)
returns boolean
language sql
immutable
set search_path = public
as $$
  select p_assessment is null
    or jsonb_typeof(p_assessment) <> 'object'
    or (p_assessment ->> 'approval_status') is null
    or (p_assessment ->> 'source') is null
    or (p_assessment ->> 'proposed_result_status') is null
    or (p_assessment ->> 'rationale') is null
    or (p_assessment -> 'evidence_refs') is null;
$$;

-- ---------------------------------------------------------------------------
-- Internal: collect the "id" field of every element of a JSON array of objects.
-- Used for the reactivation calculation, whose triggerActivations/signals
-- entries are objects rather than bare strings.
create or replace function public.jsonb_object_ids(p_value jsonb)
returns text[]
language sql
immutable
security definer
set search_path = public
as $$
  select coalesce(
    array(
      select elem ->> 'id'
      from jsonb_array_elements(coalesce(p_value, '[]'::jsonb)) as elem
      where elem ->> 'id' is not null
    ),
    '{}'::text[]
  );
$$;

-- Internal: append one ModelChange row and its "model_change.record" audit row
-- in the SAME transaction as the transition that caused it. Mirrors
-- public.record_model_change() (0042) exactly — the row is written first and the
-- audit row last, so a failed audit append rolls the whole mutation back. Used
-- by the compound RPCs below; the standalone RPC keeps its public contract.
create or replace function public.insert_model_change_internal(
  p_org_id uuid,
  p_client_id uuid,
  p_entity_type text,
  p_entity_id uuid,
  p_previous_state jsonb,
  p_new_state jsonb,
  p_change_reason text,
  p_evidence_refs text[]
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.model_changes;
begin
  insert into public.model_changes (
    organization_id, client_id, entity_type, entity_id,
    previous_state, new_state, change_reason, evidence_refs
  )
  values (
    p_org_id, p_client_id, p_entity_type, p_entity_id,
    nullif(p_previous_state, 'null'::jsonb),
    nullif(p_new_state, 'null'::jsonb),
    p_change_reason,
    coalesce(p_evidence_refs, '{}'::text[])::uuid[]
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

  return v_row.id;
end;
$$;

-- The standalone ModelChange RPC now delegates to the shared helper, so the
-- standalone path and the composed paths write the row and its audit entry in
-- exactly the same order. Public signature and behaviour are unchanged.
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
  v_id uuid;
begin
  perform public.assert_client_write(p_org_id, p_client_id);

  v_id := public.insert_model_change_internal(
    p_org_id, p_client_id, p_entity_type, p_entity_id,
    p_previous_state, p_new_state, p_change_reason,
    public.jsonb_text_array(p_evidence_refs)
  );

  return to_jsonb((select c from public.model_changes c where c.id = v_id));
end;
$$;

revoke all on function public.p_payload_missing_required(jsonb) from public, anon, authenticated;
revoke all on function public.jsonb_object_ids(jsonb) from public, anon, authenticated;
revoke all on function public.insert_model_change_internal(uuid, uuid, text, uuid, jsonb, jsonb, text, text[])
  from public, anon, authenticated;
-- Internal helpers stay internal. The composed RPCs are SECURITY DEFINER and
-- owned by the migration role, so they call these helpers with the owner's
-- privileges; no client role needs (or gets) EXECUTE. Granting it to
-- `authenticated` would expose an unguarded writer of ModelChange rows that
-- skips the tenant/assignment checks every public RPC performs.

-- ---------------------------------------------------------------------------
-- Corrections
-- ---------------------------------------------------------------------------

-- Create a Correction from an approved Recommendation together with every
-- target, every expected marker and both audit rows (create_from_recommendation
-- + plan). The recommendation is re-validated inside the transaction: it must be
-- approved and belong to the same organization/client. Every target is
-- re-validated with public.validate_correction_target(). Consent for the
-- client-visible summary is asserted inside the transaction; the service-level
-- consent checks stay as the informative first gate.
create or replace function public.create_correction_from_recommendation(
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
  v_actor uuid;
  v_correction_id uuid;
  v_recommendation public.recommendations;
  v_method public.intervention_methods;
  v_target jsonb;
  v_marker jsonb;
  v_display_consent text[];
  v_reason text;
begin
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'invalid correction payload' using errcode = '22023';
  end if;

  v_display_consent := array['data_storage', 'sensitive_psychological_data'];
  if nullif(btrim(coalesce(p_payload ->> 'client_visible_summary', '')), '') is not null then
    v_display_consent := v_display_consent || array['client_portal'];
  end if;

  v_actor := public.assert_client_consent(p_org_id, p_client_id, v_display_consent);

  select * into v_recommendation
  from public.recommendations r
  where r.id = (p_payload ->> 'recommendation_id')::uuid
    and r.organization_id = p_org_id
    and r.client_id = p_client_id;

  if v_recommendation.id is null then
    raise exception 'recommendation not found for this client' using errcode = '22023';
  end if;
  if v_recommendation.status <> 'approved' then
    raise exception 'only approved recommendations can become corrections' using errcode = '42501';
  end if;

  if nullif(p_payload ->> 'intervention_method_id', '') is not null then
    select * into v_method
    from public.intervention_methods m
    where m.id = (p_payload ->> 'intervention_method_id')::uuid;

    if v_method.id is null then
      raise exception 'intervention method not found' using errcode = '22023';
    end if;
    if v_method.archived_at is not null then
      raise exception 'archived intervention methods cannot be used' using errcode = '55000';
    end if;
    if coalesce(array_length(v_method.contraindications, 1), 0) > 0
      and not coalesce((p_payload ->> 'contraindications_acknowledged')::boolean, false)
    then
      raise exception 'intervention method contraindications must be acknowledged'
        using errcode = '42501';
    end if;
  end if;

  if jsonb_array_length(coalesce(p_payload -> 'targets', '[]'::jsonb)) = 0 then
    raise exception 'a correction requires at least one target' using errcode = '22023';
  end if;
  if jsonb_array_length(coalesce(p_payload -> 'expected_markers', '[]'::jsonb)) = 0 then
    raise exception 'a correction requires at least one expected marker' using errcode = '22023';
  end if;

  for v_target in select * from jsonb_array_elements(p_payload -> 'targets') loop
    if not public.validate_correction_target(
      v_target ->> 'target_type',
      (v_target ->> 'target_id')::uuid,
      p_org_id,
      p_client_id
    ) then
      raise exception 'invalid correction target: % %',
        v_target ->> 'target_type', v_target ->> 'target_id' using errcode = '22023';
    end if;
  end loop;

  insert into public.corrections (
    organization_id, client_id, recommendation_id, intervention_method_id,
    date, title, method_notes, rationale, expected_effect,
    priority_score_before, status, specialist_notes, client_visible_summary,
    contraindications_acknowledged, created_by
  )
  values (
    p_org_id,
    p_client_id,
    v_recommendation.id,
    nullif(p_payload ->> 'intervention_method_id', '')::uuid,
    coalesce(nullif(p_payload ->> 'date', '')::date, current_date),
    p_payload ->> 'title',
    nullif(p_payload ->> 'method_notes', ''),
    nullif(p_payload ->> 'rationale', ''),
    nullif(p_payload ->> 'expected_effect', ''),
    v_recommendation.final_priority_score,
    'planned',
    nullif(p_payload ->> 'specialist_notes', ''),
    nullif(p_payload ->> 'client_visible_summary', ''),
    coalesce((p_payload ->> 'contraindications_acknowledged')::boolean, false),
    v_actor
  )
  returning id into v_correction_id;

  for v_target in select * from jsonb_array_elements(p_payload -> 'targets') loop
    insert into public.correction_targets (
      correction_id, target_type, target_id, role, expected_effect
    )
    values (
      v_correction_id,
      v_target ->> 'target_type',
      (v_target ->> 'target_id')::uuid,
      v_target ->> 'role',
      nullif(v_target ->> 'expected_effect', '')
    );
  end loop;

  for v_marker in select * from jsonb_array_elements(p_payload -> 'expected_markers') loop
    insert into public.correction_expected_markers (
      correction_id, marker, life_area, expected_direction, measurement_type,
      baseline_value, target_value
    )
    values (
      v_correction_id,
      v_marker ->> 'marker',
      nullif(v_marker ->> 'life_area', ''),
      v_marker ->> 'expected_direction',
      v_marker ->> 'measurement_type',
      nullif(v_marker ->> 'baseline_value', ''),
      nullif(v_marker ->> 'target_value', '')
    );
  end loop;

  v_reason := 'From recommendation ' || v_recommendation.id::text;

  -- Two audit rows, exactly as the pre-migration service wrote them: the
  -- transition that produced the correction and the plan itself.
  perform public.append_audit(
    p_org_id, 'correction', v_correction_id, 'correction.create_from_recommendation',
    null, null, v_reason, null, null
  );

  perform public.append_audit(
    p_org_id, 'correction', v_correction_id, 'correction.plan',
    null,
    jsonb_build_object(
      'targets', jsonb_array_length(p_payload -> 'targets'),
      'expected_markers', jsonb_array_length(p_payload -> 'expected_markers'),
      'priority_score_before', v_recommendation.final_priority_score
    ),
    null, null, null
  );

  return v_correction_id;
end;
$$;

-- Update a Correction and append its audit row in one transaction. The patch
-- carries schema column names; unknown fields are rejected. Completing a
-- Correction re-checks inside the transaction that expected markers exist and
-- that the storage consents are active (mirroring the service-level guard).
-- The archived_at IS NULL predicate is re-checked so an archived correction can
-- never be edited by a concurrent caller.
create or replace function public.update_correction(
  p_correction_id uuid,
  p_patch jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.corrections;
  v_before jsonb;
  v_actor uuid;
  v_allowed text[] := array[
    'title', 'date', 'method_notes', 'rationale', 'expected_effect',
    'specialist_notes', 'client_visible_summary', 'status',
    'contraindications_acknowledged'
  ];
  v_key text;
  v_kind text;
begin
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' or p_patch = '{}'::jsonb then
    raise exception 'no fields to update' using errcode = '22023';
  end if;

  select * into v_row
  from public.corrections c
  where c.id = p_correction_id;

  if v_row.id is null then
    raise exception 'correction not found' using errcode = '22023';
  end if;

  v_actor := public.assert_client_consent(
    v_row.organization_id, v_row.client_id,
    array['data_storage', 'sensitive_psychological_data']
  );

  if v_row.archived_at is not null then
    raise exception 'archived corrections cannot be edited' using errcode = '55000';
  end if;

  for v_key in select jsonb_object_keys(p_patch) loop
    if not (v_key = any (v_allowed)) then
      raise exception 'field % cannot be updated', v_key using errcode = '22023';
    end if;
    v_kind := jsonb_typeof(p_patch -> v_key);
    if v_key = 'contraindications_acknowledged' then
      if v_kind <> 'boolean' then
        raise exception 'field % must be a boolean', v_key using errcode = '22023';
      end if;
    elsif v_key = 'status' then
      if v_kind <> 'string' or (p_patch ->> 'status') not in (
        'planned', 'in_progress', 'completed', 'cancelled', 'archived'
      ) then
        raise exception 'unsupported correction status' using errcode = '22023';
      end if;
    elsif v_kind not in ('string', 'null') then
      raise exception 'field % must be a string or null', v_key using errcode = '22023';
    end if;
  end loop;

  if p_patch ->> 'status' = 'completed' and v_row.status <> 'completed' then
    if not exists (
      select 1 from public.correction_expected_markers m
      where m.correction_id = p_correction_id
    ) then
      raise exception 'expected markers must be captured before completing a correction'
        using errcode = '22023';
    end if;
  end if;

  if nullif(btrim(coalesce(p_patch ->> 'client_visible_summary', '')), '') is not null then
    if not public.has_consent(v_row.client_id, 'client_portal') then
      raise exception 'missing consent: client_portal' using errcode = '42501';
    end if;
  end if;

  v_before := jsonb_build_object(
    'status', v_row.status,
    'title', v_row.title,
    'priority_score_before', v_row.priority_score_before
  );

  update public.corrections
  set title = case when p_patch ? 'title' then p_patch ->> 'title' else title end,
      date = case when p_patch ? 'date' then (p_patch ->> 'date')::date else date end,
      method_notes = case when p_patch ? 'method_notes'
        then p_patch ->> 'method_notes' else method_notes end,
      rationale = case when p_patch ? 'rationale'
        then p_patch ->> 'rationale' else rationale end,
      expected_effect = case when p_patch ? 'expected_effect'
        then p_patch ->> 'expected_effect' else expected_effect end,
      specialist_notes = case when p_patch ? 'specialist_notes'
        then p_patch ->> 'specialist_notes' else specialist_notes end,
      client_visible_summary = case when p_patch ? 'client_visible_summary'
        then p_patch ->> 'client_visible_summary' else client_visible_summary end,
      status = case when p_patch ? 'status' then p_patch ->> 'status' else status end,
      contraindications_acknowledged = case when p_patch ? 'contraindications_acknowledged'
        then (p_patch ->> 'contraindications_acknowledged')::boolean
        else contraindications_acknowledged end,
      updated_at = now()
  where id = p_correction_id and archived_at is null
  returning * into v_row;

  if v_row.id is null then
    raise exception 'correction not found or already archived' using errcode = '22023';
  end if;

  perform public.append_audit(
    v_row.organization_id, 'correction', p_correction_id, 'correction.update',
    v_before,
    jsonb_build_object('status', v_row.status, 'title', v_row.title),
    null, null, null
  );

  return to_jsonb(v_row);
end;
$$;

-- Soft-delete a Correction and append its audit row in one transaction.
-- Idempotent: archiving an archived correction changes nothing and writes no
-- second audit row.
create or replace function public.archive_correction(p_correction_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.corrections;
  v_archived integer;
  v_now timestamptz := now();
begin
  select * into v_row
  from public.corrections c
  where c.id = p_correction_id;

  if v_row.id is null then
    raise exception 'correction not found' using errcode = '22023';
  end if;

  perform public.assert_client_write(v_row.organization_id, v_row.client_id);

  update public.corrections
  set archived_at = v_now, updated_at = v_now
  where id = p_correction_id and archived_at is null;

  get diagnostics v_archived = row_count;
  if v_archived = 0 then
    return;
  end if;

  perform public.append_audit(
    v_row.organization_id, 'correction', p_correction_id, 'correction.archive',
    jsonb_build_object('archived_at', v_row.archived_at),
    jsonb_build_object('archived_at', v_now),
    null, null, null
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Observations
-- ---------------------------------------------------------------------------

-- Record one Observation with its audit row. The optional correction reference
-- is validated inside the transaction (same organization/client, not
-- archived); an invalid reference raises 22023 instead of a raw FK violation.
create or replace function public.create_observation(
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
  v_row public.observations;
  v_correction_id uuid;
  v_visibility text := coalesce(p_payload ->> 'visibility', 'private');
  v_consents text[] := array['data_storage', 'sensitive_psychological_data'];
begin
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'invalid observation payload' using errcode = '22023';
  end if;

  if v_visibility = 'client_visible' then
    v_consents := v_consents || array['client_portal'];
  end if;

  v_actor := public.assert_client_consent(p_org_id, p_client_id, v_consents);

  if nullif(p_payload ->> 'correction_id', '') is not null then
    v_correction_id := (p_payload ->> 'correction_id')::uuid;
    if not exists (
      select 1 from public.corrections c
      where c.id = v_correction_id
        and c.organization_id = p_org_id
        and c.client_id = p_client_id
    ) then
      raise exception 'invalid correction reference: %', v_correction_id using errcode = '22023';
    end if;
  end if;

  insert into public.observations (
    organization_id, client_id, correction_id, date, source_type, description,
    life_areas, valence, intensity, supports_improvement, confidence, visibility,
    created_by
  )
  values (
    p_org_id,
    p_client_id,
    v_correction_id,
    coalesce(nullif(p_payload ->> 'date', '')::date, current_date),
    p_payload ->> 'source_type',
    p_payload ->> 'description',
    public.jsonb_text_array(p_payload -> 'life_areas'),
    p_payload ->> 'valence',
    (p_payload ->> 'intensity')::integer,
    coalesce((p_payload ->> 'supports_improvement')::boolean, false),
    (p_payload ->> 'confidence')::integer,
    v_visibility,
    v_actor
  )
  returning * into v_row;

  perform public.append_audit(
    p_org_id, 'observation', v_row.id, 'observation.create',
    null,
    jsonb_build_object(
      'source_type', v_row.source_type,
      'valence', v_row.valence,
      'intensity', v_row.intensity,
      'visibility', v_row.visibility
    ),
    case when v_correction_id is null
      then null else 'Linked to correction ' || v_correction_id::text end,
    null, null
  );

  return to_jsonb(v_row);
end;
$$;

-- Update one Observation with its audit row. Switching visibility to
-- client_visible re-checks the client_portal consent inside the transaction.
create or replace function public.update_observation(
  p_observation_id uuid,
  p_patch jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.observations;
  v_allowed text[] := array[
    'date', 'source_type', 'description', 'life_areas', 'valence',
    'intensity', 'supports_improvement', 'confidence', 'visibility'
  ];
  v_key text;
begin
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' or p_patch = '{}'::jsonb then
    raise exception 'no fields to update' using errcode = '22023';
  end if;

  select * into v_row
  from public.observations o
  where o.id = p_observation_id;

  if v_row.id is null then
    raise exception 'observation not found' using errcode = '22023';
  end if;

  perform public.assert_client_consent(
    v_row.organization_id, v_row.client_id,
    array['data_storage', 'sensitive_psychological_data']
  );

  for v_key in select jsonb_object_keys(p_patch) loop
    if not (v_key = any (v_allowed)) then
      raise exception 'field % cannot be updated', v_key using errcode = '22023';
    end if;
  end loop;

  if p_patch ->> 'visibility' = 'client_visible'
    and v_row.visibility <> 'client_visible'
    and not public.has_consent(v_row.client_id, 'client_portal')
  then
    raise exception 'missing consent: client_portal' using errcode = '42501';
  end if;

  update public.observations
  set date = case when p_patch ? 'date' then (p_patch ->> 'date')::date else date end,
      source_type = case when p_patch ? 'source_type'
        then p_patch ->> 'source_type' else source_type end,
      description = case when p_patch ? 'description'
        then p_patch ->> 'description' else description end,
      life_areas = case when p_patch ? 'life_areas'
        then public.jsonb_text_array(p_patch -> 'life_areas') else life_areas end,
      valence = case when p_patch ? 'valence' then p_patch ->> 'valence' else valence end,
      intensity = case when p_patch ? 'intensity'
        then (p_patch ->> 'intensity')::integer else intensity end,
      supports_improvement = case when p_patch ? 'supports_improvement'
        then (p_patch ->> 'supports_improvement')::boolean else supports_improvement end,
      confidence = case when p_patch ? 'confidence'
        then (p_patch ->> 'confidence')::integer else confidence end,
      visibility = case when p_patch ? 'visibility'
        then p_patch ->> 'visibility' else visibility end,
      updated_at = now()
  where id = p_observation_id
  returning * into v_row;

  perform public.append_audit(
    v_row.organization_id, 'observation', p_observation_id, 'observation.update',
    jsonb_build_object('visibility', v_row.visibility, 'valence', v_row.valence),
    jsonb_build_object(
      'visibility', v_row.visibility,
      'valence', v_row.valence,
      'intensity', v_row.intensity
    ),
    null, null, null
  );

  return to_jsonb(v_row);
end;
$$;

-- ---------------------------------------------------------------------------
-- Behavioral markers
-- ---------------------------------------------------------------------------

-- Create a BehavioralMarker, seed the baseline history entry and append the
-- audit row in one transaction. The marker row, its baseline entry and the
-- audit can no longer diverge (a marker with a baseline but no history entry is
-- impossible). Evidence links are validated inside the transaction.
create or replace function public.create_behavioral_marker(
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
  v_actor uuid;
  v_marker_id uuid;
  v_scale_min double precision := coalesce((p_payload ->> 'scale_min')::double precision, 0);
  v_scale_max double precision := coalesce((p_payload ->> 'scale_max')::double precision, 10);
  v_baseline double precision;
  v_current double precision;
  v_trend text;
  v_link record;
begin
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'invalid behavioral marker payload' using errcode = '22023';
  end if;
  if v_scale_min >= v_scale_max then
    raise exception 'scaleMin must be less than scaleMax' using errcode = '22023';
  end if;

  v_actor := public.assert_client_consent(
    p_org_id, p_client_id, array['data_storage', 'sensitive_psychological_data']
  );

  if nullif(p_payload ->> 'baseline_value', '') is not null then
    v_baseline := (p_payload ->> 'baseline_value')::double precision;
  end if;
  if nullif(p_payload ->> 'current_value', '') is not null then
    v_current := (p_payload ->> 'current_value')::double precision;
  end if;

  if v_baseline is not null and (v_baseline < v_scale_min or v_baseline > v_scale_max) then
    raise exception 'baseline value % is outside the marker scale [%, %]',
      v_baseline, v_scale_min, v_scale_max using errcode = '22023';
  end if;
  if v_current is not null and (v_current < v_scale_min or v_current > v_scale_max) then
    raise exception 'current value % is outside the marker scale [%, %]',
      v_current, v_scale_min, v_scale_max using errcode = '22023';
  end if;

  for v_link in
    select * from (values
      ('core_node', nullif(p_payload ->> 'linked_core_node_id', '')::uuid),
      ('theme', nullif(p_payload ->> 'linked_theme_id', '')::uuid),
      ('resource', nullif(p_payload ->> 'linked_resource_id', '')::uuid)
    ) as links(link_type, link_id)
  loop
    if v_link.link_id is not null
      and not public.validate_behavioral_marker_link(
        v_link.link_type, v_link.link_id, p_org_id, p_client_id
      )
    then
      raise exception 'invalid marker link: % %',
        v_link.link_type, v_link.link_id using errcode = '22023';
    end if;
  end loop;

  -- Deterministic trend, identical to computeTrend() in lib/service/observations.ts:
  -- epsilon is 5% of the scale range, higher is better.
  if v_current is null or v_baseline is null then
    v_trend := 'unknown';
  elsif abs(v_current - v_baseline) <= (v_scale_max - v_scale_min) * 0.05 then
    v_trend := 'stable';
  elsif v_current > v_baseline then
    v_trend := 'improving';
  else
    v_trend := 'worsening';
  end if;

  insert into public.behavioral_markers (
    organization_id, client_id, name, description, life_area, marker_type,
    scale_min, scale_max, current_value, baseline_value, trend,
    linked_core_node_id, linked_theme_id, linked_resource_id
  )
  values (
    p_org_id, p_client_id,
    p_payload ->> 'name',
    nullif(p_payload ->> 'description', ''),
    nullif(p_payload ->> 'life_area', ''),
    p_payload ->> 'marker_type',
    v_scale_min, v_scale_max, v_current, v_baseline, v_trend,
    nullif(p_payload ->> 'linked_core_node_id', '')::uuid,
    nullif(p_payload ->> 'linked_theme_id', '')::uuid,
    nullif(p_payload ->> 'linked_resource_id', '')::uuid
  )
  returning id into v_marker_id;

  if v_baseline is not null then
    insert into public.behavioral_marker_entries (marker_id, value, note, recorded_by)
    values (v_marker_id, v_baseline, 'baseline', v_actor);
  end if;

  perform public.append_audit(
    p_org_id, 'behavioral_marker', v_marker_id, 'behavioral_marker.create',
    null,
    jsonb_build_object(
      'name', p_payload ->> 'name',
      'baseline_value', v_baseline,
      'trend', v_trend
    ),
    null, null, null
  );

  return v_marker_id;
end;
$$;

-- Update marker metadata and evidence links with its audit row. baseline_value
-- and current_value are intentionally NOT patchable here: the baseline is
-- immutable and current values change only through
-- record_behavioral_marker_value(), which appends history.
create or replace function public.update_behavioral_marker(
  p_marker_id uuid,
  p_patch jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.behavioral_markers;
  v_allowed text[] := array[
    'name', 'description', 'life_area', 'marker_type', 'scale_min', 'scale_max',
    'linked_core_node_id', 'linked_theme_id', 'linked_resource_id'
  ];
  v_key text;
  v_scale_min double precision;
  v_scale_max double precision;
  v_link record;
begin
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' or p_patch = '{}'::jsonb then
    raise exception 'no fields to update' using errcode = '22023';
  end if;

  select * into v_row
  from public.behavioral_markers m
  where m.id = p_marker_id;

  if v_row.id is null then
    raise exception 'behavioral marker not found' using errcode = '22023';
  end if;

  perform public.assert_client_consent(
    v_row.organization_id, v_row.client_id,
    array['data_storage', 'sensitive_psychological_data']
  );

  for v_key in select jsonb_object_keys(p_patch) loop
    if not (v_key = any (v_allowed)) then
      raise exception 'field % cannot be updated', v_key using errcode = '22023';
    end if;
  end loop;

  v_scale_min := coalesce((p_patch ->> 'scale_min')::double precision, v_row.scale_min);
  v_scale_max := coalesce((p_patch ->> 'scale_max')::double precision, v_row.scale_max);
  if v_scale_min >= v_scale_max then
    raise exception 'scaleMin must be less than scaleMax' using errcode = '22023';
  end if;

  for v_link in
    select * from (values
      ('core_node', case when p_patch ? 'linked_core_node_id'
        then nullif(p_patch ->> 'linked_core_node_id', '')::uuid
        else v_row.linked_core_node_id end),
      ('theme', case when p_patch ? 'linked_theme_id'
        then nullif(p_patch ->> 'linked_theme_id', '')::uuid
        else v_row.linked_theme_id end),
      ('resource', case when p_patch ? 'linked_resource_id'
        then nullif(p_patch ->> 'linked_resource_id', '')::uuid
        else v_row.linked_resource_id end)
    ) as links(link_type, link_id)
  loop
    if v_link.link_id is not null
      and not public.validate_behavioral_marker_link(
        v_link.link_type, v_link.link_id, v_row.organization_id, v_row.client_id
      )
    then
      raise exception 'invalid marker link: % %',
        v_link.link_type, v_link.link_id using errcode = '22023';
    end if;
  end loop;

  update public.behavioral_markers
  set name = case when p_patch ? 'name' then p_patch ->> 'name' else name end,
      description = case when p_patch ? 'description'
        then p_patch ->> 'description' else description end,
      life_area = case when p_patch ? 'life_area'
        then p_patch ->> 'life_area' else life_area end,
      marker_type = case when p_patch ? 'marker_type'
        then p_patch ->> 'marker_type' else marker_type end,
      scale_min = v_scale_min,
      scale_max = v_scale_max,
      linked_core_node_id = case when p_patch ? 'linked_core_node_id'
        then nullif(p_patch ->> 'linked_core_node_id', '')::uuid else linked_core_node_id end,
      linked_theme_id = case when p_patch ? 'linked_theme_id'
        then nullif(p_patch ->> 'linked_theme_id', '')::uuid else linked_theme_id end,
      linked_resource_id = case when p_patch ? 'linked_resource_id'
        then nullif(p_patch ->> 'linked_resource_id', '')::uuid else linked_resource_id end,
      updated_at = now()
  where id = p_marker_id
  returning * into v_row;

  perform public.append_audit(
    v_row.organization_id, 'behavioral_marker', p_marker_id, 'behavioral_marker.update',
    jsonb_build_object('name', v_row.name, 'marker_type', v_row.marker_type),
    jsonb_build_object(
      'name', v_row.name,
      'marker_type', v_row.marker_type,
      'scale_min', v_row.scale_min,
      'scale_max', v_row.scale_max
    ),
    null, null, null
  );

  return to_jsonb(v_row);
end;
$$;

-- Record a new current value: the history entry, the marker's new
-- current_value/trend and the audit row commit or roll back together. The
-- value is validated against the marker scale and the trend is recomputed with
-- the same deterministic rule as computeTrend().
create or replace function public.record_behavioral_marker_value(
  p_marker_id uuid,
  p_value double precision,
  p_note text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.behavioral_markers;
  v_actor uuid;
  v_trend text;
begin
  select * into v_row
  from public.behavioral_markers m
  where m.id = p_marker_id;

  if v_row.id is null then
    raise exception 'behavioral marker not found' using errcode = '22023';
  end if;

  v_actor := public.assert_client_consent(
    v_row.organization_id, v_row.client_id,
    array['data_storage', 'sensitive_psychological_data']
  );

  if p_value is null or p_value < v_row.scale_min or p_value > v_row.scale_max then
    raise exception 'value % is outside the marker scale [%, %]',
      p_value, v_row.scale_min, v_row.scale_max using errcode = '22023';
  end if;

  if v_row.baseline_value is null then
    v_trend := 'unknown';
  elsif abs(p_value - v_row.baseline_value) <= (v_row.scale_max - v_row.scale_min) * 0.05 then
    v_trend := 'stable';
  elsif p_value > v_row.baseline_value then
    v_trend := 'improving';
  else
    v_trend := 'worsening';
  end if;

  insert into public.behavioral_marker_entries (marker_id, value, note, recorded_by)
  values (p_marker_id, p_value, nullif(p_note, ''), v_actor);

  update public.behavioral_markers
  set current_value = p_value, trend = v_trend, updated_at = now()
  where id = p_marker_id
  returning * into v_row;

  perform public.append_audit(
    v_row.organization_id, 'behavioral_marker', p_marker_id,
    'behavioral_marker.record_value',
    jsonb_build_object('current_value', v_row.current_value, 'trend', v_row.trend),
    jsonb_build_object('current_value', p_value, 'trend', v_trend),
    nullif(p_note, ''), null, null
  );

  return to_jsonb(v_row);
end;
$$;

-- ---------------------------------------------------------------------------
-- Follow-ups
-- ---------------------------------------------------------------------------

-- Schedule a FollowUp for an in_progress/completed Correction with its audit
-- row. The correction is re-read inside the transaction (same org/client, not
-- archived) and its status is re-checked.
create or replace function public.schedule_follow_up(
  p_org_id uuid,
  p_client_id uuid,
  p_correction_id uuid,
  p_scheduled_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid;
  v_correction public.corrections;
  v_row public.follow_ups;
begin
  v_actor := public.assert_client_consent(
    p_org_id, p_client_id, array['data_storage', 'sensitive_psychological_data']
  );

  select * into v_correction
  from public.corrections c
  where c.id = p_correction_id
    and c.organization_id = p_org_id
    and c.client_id = p_client_id
    and c.archived_at is null;

  if v_correction.id is null then
    raise exception 'invalid correction reference: %', p_correction_id using errcode = '22023';
  end if;

  if v_correction.status not in ('in_progress', 'completed') then
    raise exception 'follow-ups can be scheduled only for in_progress or completed corrections'
      using errcode = '55000';
  end if;

  if p_scheduled_at is null then
    raise exception 'scheduled_at is required' using errcode = '22023';
  end if;

  insert into public.follow_ups (
    organization_id, client_id, correction_id, scheduled_at, result_status, created_by
  )
  values (p_org_id, p_client_id, p_correction_id, p_scheduled_at, 'scheduled', v_actor)
  returning * into v_row;

  perform public.append_audit(
    p_org_id, 'follow_up', v_row.id, 'follow_up.schedule',
    null, jsonb_build_object('result_status', 'scheduled'),
    'For correction ' || p_correction_id::text, null, null
  );

  return to_jsonb(v_row);
end;
$$;

-- Fill in follow-up results: scheduled → completed, with its audit row.
-- client_feedback / specialist_assessment / ai_assessment stay in their own
-- columns; ai_assessment is untouched here.
create or replace function public.complete_follow_up(
  p_follow_up_id uuid,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.follow_ups;
begin
  select * into v_row
  from public.follow_ups f
  where f.id = p_follow_up_id;

  if v_row.id is null then
    raise exception 'follow-up not found' using errcode = '22023';
  end if;

  perform public.assert_client_consent(
    v_row.organization_id, v_row.client_id,
    array['data_storage', 'sensitive_psychological_data']
  );

  update public.follow_ups
  set retest_result = coalesce(p_payload -> 'retest_result', 'null'::jsonb),
      behavioral_result = coalesce(p_payload -> 'behavioral_result', 'null'::jsonb),
      client_feedback = coalesce(p_payload -> 'client_feedback', 'null'::jsonb),
      specialist_assessment = coalesce(p_payload -> 'specialist_assessment', 'null'::jsonb),
      completed_at = now(),
      result_status = 'completed',
      updated_at = now()
  where id = p_follow_up_id and result_status = 'scheduled'
  returning * into v_row;

  if v_row.id is null then
    raise exception 'follow-up is not scheduled' using errcode = '55000';
  end if;

  perform public.append_audit(
    v_row.organization_id, 'follow_up', p_follow_up_id, 'follow_up.complete',
    jsonb_build_object('result_status', 'scheduled'),
    jsonb_build_object('result_status', 'completed'),
    null, null, null
  );

  return to_jsonb(v_row);
end;
$$;

-- Cancel a scheduled FollowUp with its audit row.
create or replace function public.cancel_follow_up(p_follow_up_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.follow_ups;
begin
  select * into v_row
  from public.follow_ups f
  where f.id = p_follow_up_id;

  if v_row.id is null then
    raise exception 'follow-up not found' using errcode = '22023';
  end if;

  perform public.assert_client_consent(
    v_row.organization_id, v_row.client_id,
    array['data_storage', 'sensitive_psychological_data']
  );

  update public.follow_ups
  set result_status = 'cancelled', updated_at = now()
  where id = p_follow_up_id and result_status = 'scheduled'
  returning * into v_row;

  if v_row.id is null then
    raise exception 'follow-up is not scheduled' using errcode = '55000';
  end if;

  perform public.append_audit(
    v_row.organization_id, 'follow_up', p_follow_up_id, 'follow_up.cancel',
    jsonb_build_object('result_status', 'scheduled'),
    jsonb_build_object('result_status', 'cancelled'),
    null, null, null
  );

  return to_jsonb(v_row);
end;
$$;

-- Store a pending AI / deterministic-guard assessment and its audit row.
-- The assessment stays pending: result_status is never final here, so no
-- ModelChange is produced on this path.
create or replace function public.set_follow_up_ai_assessment(
  p_follow_up_id uuid,
  p_assessment jsonb,
  p_action text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.follow_ups;
  v_status text;
  v_source text;
begin
  if p_payload_missing_required(p_assessment) then
    raise exception 'incomplete follow-up assessment' using errcode = '22023';
  end if;

  v_status := p_assessment ->> 'approval_status';
  v_source := p_assessment ->> 'source';
  if v_status <> 'pending' then
    raise exception 'an AI assessment must be stored pending' using errcode = '22023';
  end if;
  if v_source not in ('ai', 'deterministic_guard') then
    raise exception 'unknown assessment source: %', v_source using errcode = '22023';
  end if;
  if p_action not in ('follow_up.evaluate', 'follow_up.evaluate_guard') then
    raise exception 'unknown assessment action: %', p_action using errcode = '22023';
  end if;

  select * into v_row
  from public.follow_ups f
  where f.id = p_follow_up_id;

  if v_row.id is null then
    raise exception 'follow-up not found' using errcode = '22023';
  end if;

  perform public.assert_client_consent(
    v_row.organization_id, v_row.client_id,
    array['data_storage', 'sensitive_psychological_data']
  );

  if v_row.result_status <> 'completed' then
    raise exception 'follow-up is not completed' using errcode = '55000';
  end if;
  if v_row.ai_assessment ->> 'approval_status' = 'pending' then
    raise exception 'follow-up already has a pending assessment' using errcode = '55000';
  end if;

  update public.follow_ups
  set ai_assessment = p_assessment, updated_at = now()
  where id = p_follow_up_id
  returning * into v_row;

  perform public.append_audit(
    v_row.organization_id, 'follow_up', p_follow_up_id, p_action,
    jsonb_build_object('ai_assessment_status', v_row.ai_assessment ->> 'approval_status'),
    jsonb_build_object(
      'approval_status', v_status,
      'proposed_result_status', p_assessment ->> 'proposed_result_status',
      'source', v_source
    ),
    null, null, null
  );

  return to_jsonb(v_row);
end;
$$;

-- Human review of a pending assessment. Rejection only flips the assessment;
-- approval additionally applies the final result_status AND records the
-- ModelChange for that significant model transition — all in one transaction,
-- so an approved verdict can never exist without its ModelChange row and a
-- failed ModelChange insert rolls the whole approval back.
create or replace function public.review_follow_up_assessment(
  p_follow_up_id uuid,
  p_decision text,
  p_assessment jsonb,
  p_final_status text,
  p_model_change_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.follow_ups;
  v_before_status text;
  v_actor uuid;
  v_status text;
begin
  if p_decision not in ('approve', 'reject') then
    raise exception 'unknown review decision: %', p_decision using errcode = '22023';
  end if;
  if p_payload_missing_required(p_assessment) then
    raise exception 'incomplete follow-up assessment' using errcode = '22023';
  end if;

  select * into v_row
  from public.follow_ups f
  where f.id = p_follow_up_id;

  if v_row.id is null then
    raise exception 'follow-up not found' using errcode = '22023';
  end if;

  v_actor := public.assert_client_consent(
    v_row.organization_id, v_row.client_id,
    array['data_storage', 'sensitive_psychological_data']
  );

  if v_row.result_status <> 'completed' or v_row.ai_assessment is null then
    raise exception 'follow-up has no assessment to review' using errcode = '55000';
  end if;
  if v_row.ai_assessment ->> 'approval_status' <> 'pending' then
    raise exception 'assessment was already reviewed' using errcode = '55000';
  end if;

  v_before_status := v_row.result_status;
  v_status := case when p_decision = 'approve' then 'approved' else 'rejected' end;

  if (p_assessment ->> 'approval_status') <> v_status then
    raise exception 'assessment approval status does not match the decision'
      using errcode = '22023';
  end if;
  if (p_assessment ->> 'decided_by') <> v_actor::text then
    raise exception 'assessment decided_by must be the authenticated actor'
      using errcode = '22023';
  end if;

  if p_decision = 'approve' then
    if p_final_status not in ('effective', 'partially_effective', 'ineffective', 'unclear') then
      raise exception 'unsupported final result status: %', p_final_status using errcode = '22023';
    end if;

    -- Defense in depth (SPEC §51.9): "effective" still requires objective
    -- follow-up evidence, re-checked inside the transaction. Client feedback
    -- and the specialist's own assessment are subjective and never suffice.
    if p_final_status = 'effective' then
      if not (
        v_row.retest_result is not null
        or v_row.behavioral_result is not null
        or exists (
          select 1 from public.observations o where o.correction_id = v_row.correction_id
        )
        or exists (
          select 1 from public.behavioral_markers m
          where m.client_id = v_row.client_id
            and m.baseline_value is not null
            and m.current_value is not null
        )
      ) then
        raise exception 'a correction cannot be marked effective without follow-up evidence'
          using errcode = '42501';
      end if;
    end if;

    update public.follow_ups
    set ai_assessment = p_assessment,
        result_status = p_final_status,
        updated_at = now()
    where id = p_follow_up_id and result_status = 'completed'
    returning * into v_row;

    if v_row.id is null then
      raise exception 'follow-up is not completed' using errcode = '55000';
    end if;

    perform public.append_audit(
      v_row.organization_id, 'follow_up', p_follow_up_id, 'follow_up.assessment_approve',
      jsonb_build_object('result_status', v_before_status),
      jsonb_build_object('result_status', p_final_status),
      null, null, null
    );

    -- ModelChange (ticket 43, SPEC §8.31): the approved final verdict is a
    -- significant model transition (completed → effective/…/unclear).
    perform public.insert_model_change_internal(
      v_row.organization_id,
      v_row.client_id,
      'follow_up'::text,
      p_follow_up_id,
      jsonb_build_object('result_status', v_before_status),
      jsonb_build_object('result_status', p_final_status),
      p_model_change_reason,
      public.jsonb_text_array(p_assessment -> 'evidence_refs')
    );

    return to_jsonb(v_row);
  end if;

  update public.follow_ups
  set ai_assessment = p_assessment, updated_at = now()
  where id = p_follow_up_id and result_status = 'completed'
  returning * into v_row;

  if v_row.id is null then
    raise exception 'follow-up is not completed' using errcode = '55000';
  end if;

  perform public.append_audit(
    v_row.organization_id, 'follow_up', p_follow_up_id, 'follow_up.assessment_reject',
    jsonb_build_object('ai_assessment_status', 'pending'),
    jsonb_build_object('approval_status', 'rejected'),
    null, null, null
  );

  return to_jsonb(v_row);
end;
$$;

-- ---------------------------------------------------------------------------
-- Reactivation decisions
-- ---------------------------------------------------------------------------

-- Evaluate-proposal audit row (the evaluator itself is deterministic TS; the
-- pending proposal and its audit row commit together).
create or replace function public.create_core_node_reactivation(
  p_org_id uuid,
  p_client_id uuid,
  p_core_node_id uuid,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid;
  v_row public.core_node_reactivations;
  v_reason text := p_payload ->> 'reason';
begin
  -- The deterministic evaluator is a read-only review step; it has never
  -- required a consent gate, so the RPC only asserts tenant + assignment.
  v_actor := public.assert_client_write(p_org_id, p_client_id);

  if not exists (
    select 1 from public.core_nodes c
    where c.id = p_core_node_id
      and c.organization_id = p_org_id
      and c.client_id = p_client_id
  ) then
    raise exception 'core node not found in this organization' using errcode = '22023';
  end if;

  if exists (
    select 1 from public.core_node_reactivations r
    where r.core_node_id = p_core_node_id and r.status = 'pending'
  ) then
    raise exception 'core node already has a pending reactivation proposal'
      using errcode = '55000';
  end if;

  insert into public.core_node_reactivations (
    organization_id, client_id, core_node_id, scoring_model_version,
    previous_activation_score, proposed_activation_score, calculation, reason,
    status, created_by
  )
  values (
    p_org_id,
    p_client_id,
    p_core_node_id,
    p_payload ->> 'scoring_model_version',
    (p_payload ->> 'previous_activation_score')::integer,
    (p_payload ->> 'proposed_activation_score')::integer,
    p_payload -> 'calculation',
    v_reason,
    'pending',
    v_actor
  )
  returning * into v_row;

  perform public.append_audit(
    p_org_id, 'core_node_reactivation', v_row.id, 'core_node.reactivation_proposed',
    null, jsonb_build_object('status', 'pending', 'core_node_id', p_core_node_id),
    v_reason, null, null
  );

  return to_jsonb(v_row);
end;
$$;

-- Approve or reject a pending reactivation proposal.
--
-- Reject: only the proposal flips, the node stays untouched.
-- Approve: the weakened → reactivated transition on the node, the proposal
-- decision, both audit rows and the ModelChange row commit or roll back
-- together. The lifecycle guard and the ModelChange are enforced inside the
-- transaction, so a committed reactivated node can never miss its
-- ModelChange/history rows.
create or replace function public.review_core_node_reactivation(
  p_org_id uuid,
  p_reactivation_id uuid,
  p_decision text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_proposal public.core_node_reactivations;
  v_node public.core_nodes;
  v_actor uuid;
  v_now timestamptz := now();
  v_updated integer;
begin
  if p_decision not in ('approve', 'reject') then
    raise exception 'unknown review decision: %', p_decision using errcode = '22023';
  end if;

  select * into v_proposal
  from public.core_node_reactivations r
  where r.id = p_reactivation_id and r.organization_id = p_org_id;

  if v_proposal.id is null then
    raise exception 'reactivation proposal not found in this organization'
      using errcode = '22023';
  end if;

  v_actor := public.assert_client_write(p_org_id, v_proposal.client_id);

  if v_proposal.status <> 'pending' then
    raise exception 'reactivation proposal was already reviewed' using errcode = '55000';
  end if;

  if p_decision = 'reject' then
    update public.core_node_reactivations
    set status = 'rejected', decided_by = v_actor, decided_at = v_now, updated_at = v_now
    where id = p_reactivation_id and status = 'pending'
    returning * into v_proposal;

    if v_proposal.id is null then
      raise exception 'reactivation proposal was already reviewed' using errcode = '55000';
    end if;

    perform public.append_audit(
      p_org_id, 'core_node_reactivation', p_reactivation_id,
      'core_node_reactivation.reject',
      jsonb_build_object('status', 'pending'),
      jsonb_build_object('status', 'rejected'),
      null, null, null
    );

    return to_jsonb(v_proposal);
  end if;

  select * into v_node
  from public.core_nodes c
  where c.id = v_proposal.core_node_id;

  if v_node.id is null then
    raise exception 'core node not found' using errcode = '22023';
  end if;

  -- Lifecycle guard re-checked at decision time (only weakened → reactivated).
  if v_node.status <> 'weakened' then
    raise exception 'core node in status "%" cannot be reactivated', v_node.status
      using errcode = '55000';
  end if;

  update public.core_nodes
  set status = 'reactivated',
      activation_score = v_proposal.proposed_activation_score,
      updated_at = v_now
  where id = v_node.id and status = 'weakened';

  get diagnostics v_updated = row_count;
  if v_updated = 0 then
    raise exception 'core node is no longer weakened' using errcode = '55000';
  end if;

  perform public.append_audit(
    p_org_id, 'core_node', v_node.id, 'core_node.reactivated',
    jsonb_build_object('status', v_node.status, 'activation_score', v_node.activation_score),
    jsonb_build_object(
      'status', 'reactivated',
      'activation_score', v_proposal.proposed_activation_score
    ),
    v_proposal.reason, null, null
  );

  -- ModelChange (ticket 43, SPEC §8.31): the approved reactivation is a
  -- significant model transition (weakened → reactivated).
  perform public.insert_model_change_internal(
    p_org_id,
    v_proposal.client_id,
    'core_node'::text,
    v_node.id,
    jsonb_build_object('status', v_node.status, 'activation_score', v_node.activation_score),
    jsonb_build_object(
      'status', 'reactivated',
      'activation_score', v_proposal.proposed_activation_score
    ),
    v_proposal.reason,
    (
      array[v_proposal.id]::text[]
      || public.jsonb_object_ids(v_proposal.calculation -> 'triggerActivations')
      || public.jsonb_object_ids(v_proposal.calculation -> 'signals')
    )
  );

  update public.core_node_reactivations
  set status = 'approved', decided_by = v_actor, decided_at = v_now, updated_at = v_now
  where id = p_reactivation_id and status = 'pending'
  returning * into v_proposal;

  if v_proposal.id is null then
    raise exception 'reactivation proposal was already reviewed' using errcode = '55000';
  end if;

  perform public.append_audit(
    p_org_id, 'core_node_reactivation', p_reactivation_id,
    'core_node_reactivation.approve',
    jsonb_build_object('status', 'pending'),
    jsonb_build_object('status', 'approved'),
    null, null, null
  );

  return to_jsonb(v_proposal);
end;
$$;

-- ---------------------------------------------------------------------------
-- Least privilege: new functions inherit EXECUTE for anon from the 0002
-- default privileges, so every public RPC is revoked explicitly.
-- ---------------------------------------------------------------------------
revoke all on function public.create_correction_from_recommendation(uuid, uuid, jsonb) from public, anon;
revoke all on function public.update_correction(uuid, jsonb) from public, anon;
revoke all on function public.archive_correction(uuid) from public, anon;
revoke all on function public.create_observation(uuid, uuid, jsonb) from public, anon;
revoke all on function public.update_observation(uuid, jsonb) from public, anon;
revoke all on function public.create_behavioral_marker(uuid, uuid, jsonb) from public, anon;
revoke all on function public.update_behavioral_marker(uuid, jsonb) from public, anon;
revoke all on function public.record_behavioral_marker_value(uuid, double precision, text) from public, anon;
revoke all on function public.schedule_follow_up(uuid, uuid, uuid, timestamptz) from public, anon;
revoke all on function public.complete_follow_up(uuid, jsonb) from public, anon;
revoke all on function public.cancel_follow_up(uuid) from public, anon;
revoke all on function public.set_follow_up_ai_assessment(uuid, jsonb, text) from public, anon;
revoke all on function public.review_follow_up_assessment(uuid, text, jsonb, text, text) from public, anon;
revoke all on function public.create_core_node_reactivation(uuid, uuid, uuid, jsonb) from public, anon;
revoke all on function public.review_core_node_reactivation(uuid, uuid, text) from public, anon;
-- Internal helpers: never callable by a client role (see the note next to their
-- definitions). The SECURITY DEFINER RPCs above reach them as the owner.

grant execute on function public.create_correction_from_recommendation(uuid, uuid, jsonb) to authenticated, service_role;
grant execute on function public.update_correction(uuid, jsonb) to authenticated, service_role;
grant execute on function public.archive_correction(uuid) to authenticated, service_role;
grant execute on function public.create_observation(uuid, uuid, jsonb) to authenticated, service_role;
grant execute on function public.update_observation(uuid, jsonb) to authenticated, service_role;
grant execute on function public.create_behavioral_marker(uuid, uuid, jsonb) to authenticated, service_role;
grant execute on function public.update_behavioral_marker(uuid, jsonb) to authenticated, service_role;
grant execute on function public.record_behavioral_marker_value(uuid, double precision, text) to authenticated, service_role;
grant execute on function public.schedule_follow_up(uuid, uuid, uuid, timestamptz) to authenticated, service_role;
grant execute on function public.complete_follow_up(uuid, jsonb) to authenticated, service_role;
grant execute on function public.cancel_follow_up(uuid) to authenticated, service_role;
grant execute on function public.set_follow_up_ai_assessment(uuid, jsonb, text) to authenticated, service_role;
grant execute on function public.review_follow_up_assessment(uuid, text, jsonb, text, text) to authenticated, service_role;
grant execute on function public.create_core_node_reactivation(uuid, uuid, uuid, jsonb) to authenticated, service_role;
grant execute on function public.review_core_node_reactivation(uuid, uuid, text) to authenticated, service_role;
