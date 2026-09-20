-- 0050: Client Portal feedback (ticket 16).
--
-- Ticket 15 gave the portal identity a guarded read model (migration 0049) and
-- the feedback table already had a portal SELECT policy (migration 0034). Two
-- gaps stayed open, and both are closed here without widening a single policy:
--
--   1. A portal identity had no way to *see* its active form. The 0034 policy
--      returns sent/completed rows but ignores the `client_portal` consent and
--      the form's `expires_at`, and the portal is never allowed to read base
--      domain tables directly. `list_client_portal_feedback_forms` is the same
--      guarded RPC seam as `get_client_portal_overview`: it resolves the caller
--      through `portal_client_id()` (which re-checks active access AND the
--      consent) and returns only sent, unexpired forms.
--
--   2. `submit_feedback_form` (migration 0041) authorized a portal identity by
--      its `client_portal_users` row alone and never touched `consent_records`,
--      so a form stayed submittable after the `client_portal` consent was
--      revoked. It also wrote its audit row through `append_audit`, which
--      requires an organization membership a portal identity never has — the
--      whole transaction therefore failed for every portal submission. The
--      replacement below requires `has_consent(client_id, 'client_portal')` for
--      a portal submitter and appends the audit row through the new internal
--      `append_feedback_audit`, which every caller reaches only from inside a
--      SECURITY DEFINER function.
--
-- The submission contract itself is unchanged: one transaction completes the
-- form and creates the pending `self_report` Signal at L1_SINGLE_SIGNAL. It
-- never confirms a hypothesis, never raises an evidence level and never bumps
-- an authoritative confidence.

-- ---------------------------------------------------------------------------
-- Internal: audit append for a reporter who is not an organization member.
-- ---------------------------------------------------------------------------

-- `append_audit` refuses any actor without an organization membership (SPEC
-- §43). A portal identity is deliberately never a member, so a portal feedback
-- submission needs this narrower writer: it still stamps auth.uid() as the
-- actor and is only reachable from inside the SECURITY DEFINER RPC below. EXECUTE
-- is revoked from every client-facing role so the API surface cannot call it.
create or replace function public.append_feedback_audit(
  p_organization_id uuid,
  p_entity_type text,
  p_entity_id uuid,
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
  v_actor uuid := auth.uid();
  v_id uuid;
begin
  if v_actor is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  insert into public.audit_log (
    organization_id, actor_user_id, entity_type, entity_id, action,
    before_data, after_data, reason
  )
  values (
    p_organization_id, v_actor, p_entity_type, p_entity_id, p_action,
    p_before, p_after, p_reason
  )
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.append_feedback_audit(uuid, text, uuid, text, jsonb, jsonb, text)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Portal: the active, unexpired feedback forms of the calling identity.
-- ---------------------------------------------------------------------------

-- Returns one JSON document with the forms the portal identity may fill in:
-- status 'sent', not expired, and the `client_portal` consent still active. Any
-- other caller (revoked portal access, revoked consent, another client's
-- identity, or a staff session) gets 42501 — the same neutral denial as the
-- portal overview, so a foreign client is indistinguishable from a revoked one.
create or replace function public.list_client_portal_feedback_forms()
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_client_id uuid;
begin
  v_client_id := public.portal_client_id();

  if v_client_id is null then
    raise exception 'no active portal access' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'client_id', v_client_id,
    'forms', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', f.id,
          'title', f.title,
          'questions', f.questions,
          'expires_at', f.expires_at
        )
        order by f.sent_at desc nulls last, f.created_at desc
      )
      from public.client_feedback_forms f
      where f.client_id = v_client_id
        and f.status = 'sent'
        and (f.expires_at is null or f.expires_at > now())
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.list_client_portal_feedback_forms() from public, anon;
grant execute on function public.list_client_portal_feedback_forms() to authenticated, service_role;

-- Belt and braces: the 0034 policy let a portal identity SELECT its own
-- sent/completed rows while ignoring the `client_portal` consent and the form's
-- expiry. The RPC above is the only path the portal app takes, but the base
-- table must not offer a wider window than the RPC: the policy now requires the
-- live consent and an unexpired form as well.
drop policy if exists "portal reads own forms" on public.client_feedback_forms;
create policy "portal reads own forms" on public.client_feedback_forms
  for select to authenticated
  using (
    exists (
      select 1 from public.client_portal_users p
      where p.client_id = client_feedback_forms.client_id
        and p.email = auth.jwt() ->> 'email'
        and p.status = 'active'
    )
    and status in ('sent', 'completed')
    and (expires_at is null or expires_at > now())
    and public.has_consent(client_id, 'client_portal')
  );

-- ---------------------------------------------------------------------------
-- Submission: complete the form, create the pending Signal, audit — atomically.
-- ---------------------------------------------------------------------------

-- Replacement of the 0041 function. The only changes are the consent gate for a
-- portal submitter and the internal audit helper; the state machine, the signal
-- shape and the single-transaction guarantee are identical.
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

  -- A portal identity needs BOTH an active portal row and a live client_portal
  -- consent, re-checked on every submission, so revoking the consent stops the
  -- very next attempt.
  v_is_portal := exists (
    select 1 from public.client_portal_users p
    where p.client_id = v_form.client_id
      and p.email = (auth.jwt() ->> 'email')
      and p.status = 'active'
  ) and public.has_consent(v_form.client_id, 'client_portal');

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

  perform public.append_feedback_audit(
    v_form.organization_id, 'client_feedback_form', p_form_id, 'feedback_form.submit',
    null, jsonb_build_object('signal_id', v_signal_id), null
  );

  return v_signal_id;
end;
$$;

revoke all on function public.submit_feedback_form(uuid, jsonb) from public, anon;
grant execute on function public.submit_feedback_form(uuid, jsonb) to authenticated, service_role;
