-- 0041: Atomic intake, review, import and feedback writes (ticket 05).
--
-- Template: supabase/migrations/0039_atomic_business_mutation.sql.
--
-- Before this migration the service layer created evidence row-by-row and then
-- appended the AuditLog with a second network call: a DiagnosticSession could
-- exist without its audit row, an AI ingest could persist half of its pending
-- Signals, an import commit could stop midway with a partial signal set, and a
-- feedback submission could complete the form without its pending Signal.
--
-- Every path below is one transaction: the business rows and the audit row
-- commit or roll back together. Public service contracts are unchanged.

-- ---------------------------------------------------------------------------
-- Shared guards
-- ---------------------------------------------------------------------------

-- Internal: assert that the caller may write to this client and that the client
-- really belongs to the organization (the owner exception in
-- is_client_accessible() does not check the tenant by itself).
create or replace function public.assert_client_write(p_org_id uuid, p_client_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid;
begin
  v_actor := public.require_org_member_actor(p_org_id);

  if not public.is_client_accessible(p_org_id, p_client_id, true) then
    raise exception 'no write access to this client' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.clients c where c.id = p_client_id and c.organization_id = p_org_id
  ) then
    raise exception 'client not found in this organization' using errcode = '22023';
  end if;

  return v_actor;
end;
$$;

-- Internal: insert one Signal row from a JSON object. Called only by the
-- SECURITY DEFINER RPCs below, which decide the review/evidence semantics.
-- Unknown or invalid values are rejected by the table CHECK constraints.
create or replace function public.insert_signal_row(
  p_org_id uuid,
  p_client_id uuid,
  p_signal jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_session_id uuid;
  v_source_type text := p_signal ->> 'source_type';
  v_epistemic_type text := p_signal ->> 'epistemic_type';
  v_raw_statement text := p_signal ->> 'raw_statement';
begin
  if v_source_type is null or v_epistemic_type is null
    or coalesce(btrim(v_raw_statement), '') = ''
  then
    raise exception 'source_type, epistemic_type and raw_statement are required'
      using errcode = '22023';
  end if;

  if nullif(p_signal ->> 'diagnostic_session_id', '') is not null then
    v_session_id := (p_signal ->> 'diagnostic_session_id')::uuid;
    if not exists (
      select 1 from public.diagnostic_sessions s
      where s.id = v_session_id
        and s.client_id = p_client_id
        and s.organization_id = p_org_id
    ) then
      raise exception 'diagnostic session does not belong to this client' using errcode = '22023';
    end if;
  end if;

  insert into public.signals (
    organization_id, client_id, diagnostic_session_id, source_type, epistemic_type,
    raw_statement, statement_polarity, test_result, normalized_meaning, inferred_opposite,
    intensity, confidence, life_areas, tags, context, time_scope, evidence_level,
    review_status, visibility, created_by
  )
  values (
    p_org_id,
    p_client_id,
    v_session_id,
    v_source_type,
    v_epistemic_type,
    v_raw_statement,
    p_signal ->> 'statement_polarity',
    p_signal ->> 'test_result',
    p_signal ->> 'normalized_meaning',
    p_signal ->> 'inferred_opposite',
    (p_signal ->> 'intensity')::integer,
    (p_signal ->> 'confidence')::integer,
    coalesce(array(select jsonb_array_elements_text(p_signal -> 'life_areas')), '{}'::text[]),
    coalesce(array(select jsonb_array_elements_text(p_signal -> 'tags')), '{}'::text[]),
    coalesce(p_signal -> 'context', '{}'::jsonb),
    p_signal ->> 'time_scope',
    coalesce(p_signal ->> 'evidence_level', 'L1_SINGLE_SIGNAL'),
    coalesce(p_signal ->> 'review_status', 'approved'),
    coalesce(p_signal ->> 'visibility', 'internal'),
    auth.uid()
  )
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.assert_client_write(uuid, uuid) from public, anon, authenticated;
revoke all on function public.insert_signal_row(uuid, uuid, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- DiagnosticSession (+ optional batch of Signals) with its audit row.
-- ---------------------------------------------------------------------------
create or replace function public.create_diagnostic_session(
  p_org_id uuid,
  p_client_id uuid,
  p_title text,
  p_session_type text,
  p_source_type text,
  p_raw_input text,
  p_input_format text,
  p_notes text,
  p_signals jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid;
  v_session_id uuid;
  v_signal_ids jsonb := '[]'::jsonb;
  v_element jsonb;
  v_signal_id uuid;
  v_count integer := 0;
begin
  v_actor := public.assert_client_write(p_org_id, p_client_id);

  insert into public.diagnostic_sessions (
    organization_id, client_id, title, session_type, source_type,
    raw_input, input_format, performed_by_user_id, notes
  )
  values (
    p_org_id, p_client_id, p_title, p_session_type, p_source_type,
    p_raw_input, p_input_format, v_actor, p_notes
  )
  returning id into v_session_id;

  perform public.append_audit(
    p_org_id, 'diagnostic_session', v_session_id, 'session.created',
    null,
    jsonb_build_object('title', p_title, 'session_type', p_session_type),
    null, null, null
  );

  -- Optional signals are part of the same transaction: a session is never
  -- created without the signals its caller asked for.
  for v_element in select * from jsonb_array_elements(coalesce(p_signals, '[]'::jsonb))
  loop
    v_signal_id := public.insert_signal_row(
      p_org_id,
      p_client_id,
      v_element || jsonb_build_object('diagnostic_session_id', v_session_id, 'review_status', 'approved')
    );
    v_signal_ids := v_signal_ids || to_jsonb(v_signal_id);
    v_count := v_count + 1;

    perform public.append_audit(
      p_org_id, 'signal', v_signal_id, 'signal.created',
      null,
      jsonb_build_object(
        'source_type', v_element ->> 'source_type',
        'epistemic_type', v_element ->> 'epistemic_type'
      ),
      null, null, null
    );
  end loop;

  return jsonb_build_object(
    'session_id', v_session_id,
    'signal_ids', v_signal_ids,
    'signal_count', v_count
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Manual Signal with its audit row.
-- ---------------------------------------------------------------------------
create or replace function public.create_signal(
  p_org_id uuid,
  p_client_id uuid,
  p_signal jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_signal_id uuid;
begin
  perform public.assert_client_write(p_org_id, p_client_id);

  -- Manually entered evidence is human-confirmed by definition; only AI ingest
  -- and import staging may create pending Signals.
  v_signal_id := public.insert_signal_row(
    p_org_id,
    p_client_id,
    p_signal || jsonb_build_object('review_status', 'approved')
  );

  perform public.append_audit(
    p_org_id, 'signal', v_signal_id, 'signal.created',
    null,
    jsonb_build_object(
      'source_type', p_signal ->> 'source_type',
      'epistemic_type', p_signal ->> 'epistemic_type'
    ),
    null, null, null
  );

  return v_signal_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- AI ingest: every pending L0 Signal and its audit row in one transaction.
-- Evidence level and review status are forced here, never taken from input.
-- ---------------------------------------------------------------------------
create or replace function public.ingest_signals(
  p_org_id uuid,
  p_client_id uuid,
  p_session_id uuid,
  p_signals jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_signal_ids jsonb := '[]'::jsonb;
  v_element jsonb;
  v_signal_id uuid;
begin
  perform public.assert_client_write(p_org_id, p_client_id);

  if p_session_id is not null and not exists (
    select 1 from public.diagnostic_sessions s
    where s.id = p_session_id and s.client_id = p_client_id and s.organization_id = p_org_id
  ) then
    raise exception 'diagnostic session does not belong to this client' using errcode = '22023';
  end if;

  for v_element in select * from jsonb_array_elements(coalesce(p_signals, '[]'::jsonb))
  loop
    v_signal_id := public.insert_signal_row(
      p_org_id,
      p_client_id,
      v_element || jsonb_build_object(
        'diagnostic_session_id', p_session_id,
        'source_type', 'ai_hypothesis',
        'epistemic_type', 'hypothesis',
        'evidence_level', 'L0_AI_ONLY',
        'review_status', 'pending'
      )
    );
    v_signal_ids := v_signal_ids || to_jsonb(v_signal_id);
  end loop;

  perform public.append_audit(
    p_org_id, 'diagnostic_session', p_session_id, 'ai.ingest_signals',
    null,
    jsonb_build_object('created_signals', jsonb_array_length(v_signal_ids)),
    null, null, null
  );

  return v_signal_ids;
end;
$$;

-- ---------------------------------------------------------------------------
-- Review decision: the pending-evidence change and its audit row are atomic and
-- carry the authenticated actor plus the reviewer's reason.
-- ---------------------------------------------------------------------------
create or replace function public.review_signal(
  p_org_id uuid,
  p_signal_id uuid,
  p_action text,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_before jsonb;
  v_after jsonb;
begin
  perform public.require_org_member_actor(p_org_id);

  if p_action not in ('approve', 'reject', 'mark_sensitive', 'hide') then
    raise exception 'unknown review action' using errcode = '22023';
  end if;

  select jsonb_build_object('review_status', s.review_status, 'visibility', s.visibility)
  into v_before
  from public.signals s
  where s.id = p_signal_id
    and s.organization_id = p_org_id
    and public.is_client_accessible(p_org_id, s.client_id, true);

  if v_before is null then
    raise exception 'signal not found or not writable' using errcode = '22023';
  end if;

  v_after := case p_action
    when 'approve' then jsonb_build_object('review_status', 'approved', 'visibility', v_before ->> 'visibility')
    when 'reject' then jsonb_build_object('review_status', 'rejected', 'visibility', v_before ->> 'visibility')
    when 'mark_sensitive' then jsonb_build_object('review_status', v_before ->> 'review_status', 'visibility', 'sensitive')
    else jsonb_build_object('review_status', v_before ->> 'review_status', 'visibility', 'internal')
  end;

  update public.signals
  set review_status = v_after ->> 'review_status',
      visibility = v_after ->> 'visibility',
      updated_at = now()
  where id = p_signal_id and organization_id = p_org_id;

  perform public.append_audit(
    p_org_id, 'signal', p_signal_id, 'review.' || p_action,
    v_before, v_after,
    coalesce(nullif(btrim(p_reason), ''), 'signal ' || p_action),
    null, null
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Feedback submission: completing the form, creating the pending Signal and the
-- audit row happen together. The reporter is either a specialist with write
-- access or the client's own active portal identity.
-- ---------------------------------------------------------------------------
create or replace function public.submit_feedback_form(
  p_form_id uuid,
  p_answers jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_form public.client_feedback_forms;
  v_is_staff boolean;
  v_is_portal boolean;
  v_signal_id uuid;
begin
  select * into v_form from public.client_feedback_forms where id = p_form_id;

  if v_form.id is null then
    raise exception 'form not found' using errcode = '22023';
  end if;

  v_is_staff := public.is_org_member(v_form.organization_id)
    and public.is_client_accessible(v_form.organization_id, v_form.client_id, true);

  v_is_portal := exists (
    select 1 from public.client_portal_users p
    where p.client_id = v_form.client_id
      and p.email = (auth.jwt() ->> 'email')
      and p.status = 'active'
  );

  if not (v_is_staff or v_is_portal) then
    raise exception 'not allowed to submit this form' using errcode = '42501';
  end if;

  if v_form.status <> 'sent' then
    raise exception 'form is not open for submission' using errcode = '55000';
  end if;
  if v_form.expires_at is not null and v_form.expires_at < now() then
    raise exception 'form has expired' using errcode = '55000';
  end if;

  update public.client_feedback_forms
  set answers = p_answers,
      status = 'completed',
      completed_at = now(),
      updated_at = now()
  where id = p_form_id;

  -- Submission becomes a pending Signal — never a confirmed model change.
  v_signal_id := public.insert_signal_row(
    v_form.organization_id,
    v_form.client_id,
    jsonb_build_object(
      'source_type', 'follow_up',
      'epistemic_type', 'self_report',
      'raw_statement', coalesce(p_answers, '{}'::jsonb)::text,
      'evidence_level', 'L1_SINGLE_SIGNAL',
      'review_status', 'pending',
      'context', jsonb_build_object('feedback_form_id', p_form_id)
    )
  );

  perform public.append_audit(
    v_form.organization_id, 'client_feedback_form', p_form_id, 'feedback_form.submit',
    null, jsonb_build_object('signal_id', v_signal_id), null, null, null
  );

  return v_signal_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Import staging start (AI text import): session + import row in one transaction.
-- ---------------------------------------------------------------------------
create or replace function public.begin_import(
  p_org_id uuid,
  p_client_id uuid,
  p_session_id uuid,
  p_input_format text,
  p_contract_version text,
  p_idempotency_key text,
  p_content_sha256 text,
  p_title text,
  p_raw_content text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid;
  v_existing public.imports;
  v_import_id uuid;
begin
  v_actor := public.assert_client_write(p_org_id, p_client_id);

  select * into v_existing
  from public.imports i
  where i.organization_id = p_org_id
    and i.client_id = p_client_id
    and i.contract_version = p_contract_version
    and i.idempotency_key = p_idempotency_key;

  if v_existing.id is not null then
    if v_existing.content_sha256 <> p_content_sha256 then
      raise exception 'conflicting_idempotency_key' using errcode = '23505';
    end if;
    return jsonb_build_object(
      'import_id', v_existing.id,
      'session_id', v_existing.diagnostic_session_id,
      'status', v_existing.status,
      'counts', v_existing.counts,
      'report', v_existing.report,
      'fatal_errors', v_existing.fatal_errors,
      'reused', true
    );
  end if;

  insert into public.diagnostic_sessions (
    id, organization_id, client_id, title, session_type, source_type,
    raw_input, input_format, performed_by_user_id
  )
  values (
    p_session_id, p_org_id, p_client_id, coalesce(p_title, 'Import'), 'import',
    'imported_note', p_raw_content, p_input_format, v_actor
  );

  insert into public.imports (
    organization_id, client_id, diagnostic_session_id, input_format,
    contract_version, idempotency_key, content_sha256, status
  )
  values (
    p_org_id, p_client_id, p_session_id, p_input_format,
    p_contract_version, p_idempotency_key, p_content_sha256, 'parsing'
  )
  returning id into v_import_id;

  return jsonb_build_object(
    'import_id', v_import_id,
    'session_id', p_session_id,
    'status', 'parsing',
    'counts', '{}'::jsonb,
    'report', '{}'::jsonb,
    'fatal_errors', '[]'::jsonb,
    'reused', false
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Import commit: the whole selected set of Signals, the import report and the
-- audit row in one transaction. Idempotent by (org, client, contract, key).
-- ---------------------------------------------------------------------------
create or replace function public.commit_import(
  p_org_id uuid,
  p_client_id uuid,
  p_session_id uuid,
  p_input_format text,
  p_contract_version text,
  p_idempotency_key text,
  p_content_sha256 text,
  p_title text,
  p_raw_content text,
  p_counts jsonb,
  p_report jsonb,
  p_fatal_errors jsonb,
  p_signals jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid;
  v_existing public.imports;
  v_import_id uuid;
  v_element jsonb;
  v_signal_ids jsonb := '[]'::jsonb;
  v_signal_id uuid;
  v_counts jsonb;
  v_report jsonb;
begin
  v_actor := public.assert_client_write(p_org_id, p_client_id);

  select * into v_existing
  from public.imports i
  where i.organization_id = p_org_id
    and i.client_id = p_client_id
    and i.contract_version = p_contract_version
    and i.idempotency_key = p_idempotency_key;

  if v_existing.id is not null then
    if v_existing.content_sha256 <> p_content_sha256 then
      raise exception 'conflicting_idempotency_key' using errcode = '23505';
    end if;
    return jsonb_build_object(
      'import_id', v_existing.id,
      'session_id', v_existing.diagnostic_session_id,
      'status', v_existing.status,
      'counts', v_existing.counts,
      'report', v_existing.report,
      'fatal_errors', v_existing.fatal_errors,
      'signal_ids', '[]'::jsonb,
      'reused', true
    );
  end if;

  insert into public.diagnostic_sessions (
    id, organization_id, client_id, title, session_type, source_type,
    raw_input, input_format, performed_by_user_id
  )
  values (
    p_session_id, p_org_id, p_client_id, coalesce(p_title, 'Import'), 'import',
    'imported_note', p_raw_content, p_input_format, v_actor
  );

  v_report := coalesce(p_report, '{}'::jsonb);

  for v_element in select * from jsonb_array_elements(coalesce(p_signals, '[]'::jsonb))
  loop
    v_signal_id := public.insert_signal_row(
      p_org_id,
      p_client_id,
      v_element || jsonb_build_object('diagnostic_session_id', p_session_id)
    );
    v_signal_ids := v_signal_ids || to_jsonb(v_signal_id);

    -- Record the generated signal id in the stored report, keeping the report
    -- and the evidence it describes in the same transaction.
    if nullif(v_element ->> 'record_position', '') is not null then
      v_report := jsonb_set(
        v_report,
        array['records', (v_element ->> 'record_position'), 'signal_id'],
        to_jsonb(v_signal_id),
        true
      );
    end if;
  end loop;

  v_counts := coalesce(p_counts, '{}'::jsonb)
    || jsonb_build_object('committed', jsonb_array_length(v_signal_ids));

  insert into public.imports (
    organization_id, client_id, diagnostic_session_id, input_format,
    contract_version, idempotency_key, content_sha256, status, counts, report, fatal_errors
  )
  values (
    p_org_id, p_client_id, p_session_id, p_input_format,
    p_contract_version, p_idempotency_key, p_content_sha256, 'awaiting_review',
    v_counts, v_report, coalesce(p_fatal_errors, '[]'::jsonb)
  )
  returning id into v_import_id;

  perform public.append_audit(
    p_org_id, 'import', v_import_id, 'import.parsed',
    null,
    jsonb_build_object(
      'input_format', p_input_format,
      'committed', jsonb_array_length(v_signal_ids)
    ),
    null, null, null
  );

  return jsonb_build_object(
    'import_id', v_import_id,
    'session_id', p_session_id,
    'status', 'awaiting_review',
    'counts', v_counts,
    'report', v_report,
    'fatal_errors', coalesce(p_fatal_errors, '[]'::jsonb),
    'signal_ids', v_signal_ids,
    'reused', false
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Import finalize (AI text import): report/status update and audit row together.
-- ---------------------------------------------------------------------------
create or replace function public.finalize_import(
  p_org_id uuid,
  p_import_id uuid,
  p_counts jsonb,
  p_report jsonb,
  p_fatal_errors jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing public.imports;
  v_counts jsonb;
begin
  select * into v_existing
  from public.imports i
  where i.id = p_import_id and i.organization_id = p_org_id;

  if v_existing.id is null then
    raise exception 'import not found' using errcode = '22023';
  end if;

  perform public.assert_client_write(p_org_id, v_existing.client_id);

  v_counts := coalesce(p_counts, '{}'::jsonb);

  update public.imports
  set status = 'awaiting_review',
      counts = v_counts,
      report = coalesce(p_report, '{}'::jsonb),
      fatal_errors = coalesce(p_fatal_errors, '[]'::jsonb),
      updated_at = now()
  where id = p_import_id;

  perform public.append_audit(
    p_org_id, 'import', p_import_id, 'import.parsed',
    null,
    jsonb_build_object(
      'input_format', v_existing.input_format,
      'committed', coalesce(v_counts ->> 'committed', '0')::integer
    ),
    null, null, null
  );

  return jsonb_build_object(
    'import_id', p_import_id,
    'session_id', v_existing.diagnostic_session_id,
    'status', 'awaiting_review',
    'counts', v_counts,
    'report', coalesce(p_report, '{}'::jsonb),
    'fatal_errors', coalesce(p_fatal_errors, '[]'::jsonb),
    'reused', false
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Feedback form authoring: the draft form and its audit row commit together.
-- ---------------------------------------------------------------------------
create or replace function public.create_feedback_form(
  p_org_id uuid,
  p_client_id uuid,
  p_title text,
  p_questions jsonb,
  p_correction_id uuid,
  p_follow_up_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_form_id uuid;
begin
  perform public.assert_client_write(p_org_id, p_client_id);

  insert into public.client_feedback_forms (
    organization_id, client_id, correction_id, follow_up_id, created_by, title, questions
  )
  values (
    p_org_id, p_client_id, p_correction_id, p_follow_up_id, auth.uid(), p_title,
    coalesce(p_questions, '[]'::jsonb)
  )
  returning id into v_form_id;

  perform public.append_audit(
    p_org_id, 'client_feedback_form', v_form_id, 'feedback_form.create',
    null, jsonb_build_object('title', p_title), null, null, null
  );

  return v_form_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Least privilege: new functions inherit EXECUTE for anon from 0002 defaults.
-- ---------------------------------------------------------------------------
revoke all on function public.create_diagnostic_session(uuid, uuid, text, text, text, text, text, text, jsonb) from public, anon;
revoke all on function public.create_signal(uuid, uuid, jsonb) from public, anon;
revoke all on function public.ingest_signals(uuid, uuid, uuid, jsonb) from public, anon;
revoke all on function public.review_signal(uuid, uuid, text, text) from public, anon;
revoke all on function public.submit_feedback_form(uuid, jsonb) from public, anon;
revoke all on function public.create_feedback_form(uuid, uuid, text, jsonb, uuid, uuid) from public, anon;
revoke all on function public.begin_import(uuid, uuid, uuid, text, text, text, text, text, text) from public, anon;
revoke all on function public.commit_import(uuid, uuid, uuid, text, text, text, text, text, text, jsonb, jsonb, jsonb, jsonb) from public, anon;
revoke all on function public.finalize_import(uuid, uuid, jsonb, jsonb, jsonb) from public, anon;

grant execute on function public.create_diagnostic_session(uuid, uuid, text, text, text, text, text, text, jsonb) to authenticated, service_role;
grant execute on function public.create_signal(uuid, uuid, jsonb) to authenticated, service_role;
grant execute on function public.ingest_signals(uuid, uuid, uuid, jsonb) to authenticated, service_role;
grant execute on function public.review_signal(uuid, uuid, text, text) to authenticated, service_role;
grant execute on function public.submit_feedback_form(uuid, jsonb) to authenticated, service_role;
grant execute on function public.create_feedback_form(uuid, uuid, text, jsonb, uuid, uuid) to authenticated, service_role;
grant execute on function public.begin_import(uuid, uuid, uuid, text, text, text, text, text, text) to authenticated, service_role;
grant execute on function public.commit_import(uuid, uuid, uuid, text, text, text, text, text, text, jsonb, jsonb, jsonb, jsonb) to authenticated, service_role;
grant execute on function public.finalize_import(uuid, uuid, jsonb, jsonb, jsonb) to authenticated, service_role;
