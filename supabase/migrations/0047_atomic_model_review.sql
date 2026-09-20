-- 0047: Atomic human review of Themes and DifferentialHypotheses (ticket 12).
--
-- Template: supabase/migrations/0042_atomic_psychological_model.sql, reusing the
-- shared guards introduced by 0040/0041 (require_org_member_actor,
-- assert_client_write).
--
-- The review screen (ticket 12) lets a specialist inspect AI proposals and the
-- human-in-the-loop rule of SPEC §36 requires an explicit decision before a
-- pending entity becomes confirmed evidence. CoreNodes already have
-- set_core_node_status(); Themes and DifferentialHypotheses had no guarded path
-- at all, so the only way to approve them was a raw table UPDATE from the
-- service layer — with no atomic AuditLog row and no state guard.
--
-- Every function below is one transaction: the state change and its AuditLog
-- row (carrying the authenticated actor and the reviewer's reason) commit or
-- roll back together. A pending entity can only be reviewed once; a confirmed
-- entity is never silently re-decided by a repeated call. Contradicting
-- evidence (`evidence_against`, `core_node_relations.contradicts`) is never
-- touched, so confirming one of several competing hypotheses leaves every
-- contradiction and every competing hypothesis in place.

-- ---------------------------------------------------------------------------
-- Themes
-- ---------------------------------------------------------------------------

-- Human review of an AI-proposed Theme (review_status pending → approved /
-- rejected). Rejecting removes the theme from confirmed evidence, so it requires
-- an explicit reason, stored in the audit row.
create or replace function public.review_theme(
  p_org_id uuid,
  p_theme_id uuid,
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
begin
  if p_decision not in ('approve', 'reject') then
    raise exception 'unknown review decision' using errcode = '22023';
  end if;

  select t.client_id, t.review_status into v_client_id, v_status
  from public.themes t
  where t.id = p_theme_id and t.organization_id = p_org_id;

  if v_client_id is null then
    raise exception 'theme not found in this organization' using errcode = '22023';
  end if;

  perform public.assert_client_write(p_org_id, v_client_id);

  -- Only a pending proposal is reviewable: a human already decided this theme,
  -- and an AI proposal can never overwrite that decision.
  if v_status <> 'pending' then
    raise exception 'theme was already reviewed' using errcode = '55000';
  end if;

  v_reason := nullif(btrim(coalesce(p_reason, '')), '');
  if p_decision = 'reject' and v_reason is null then
    raise exception 'rejecting a theme requires an audit reason' using errcode = '22023';
  end if;

  v_new_status := case when p_decision = 'approve' then 'approved' else 'rejected' end;

  update public.themes
  set review_status = v_new_status, updated_at = now()
  where id = p_theme_id and organization_id = p_org_id and review_status = 'pending';

  perform public.append_audit(
    p_org_id, 'theme', p_theme_id, 'theme.' || p_decision,
    jsonb_build_object('review_status', v_status),
    jsonb_build_object('review_status', v_new_status),
    v_reason, null, null
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- DifferentialHypotheses
-- ---------------------------------------------------------------------------

-- Human review of a competing hypothesis (status hypothesis → active /
-- rejected). Approving confirms one explanation; it never removes the competing
-- hypotheses or their contradictory evidence.
create or replace function public.review_hypothesis(
  p_org_id uuid,
  p_hypothesis_id uuid,
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
begin
  if p_decision not in ('approve', 'reject') then
    raise exception 'unknown review decision' using errcode = '22023';
  end if;

  select h.client_id, h.status into v_client_id, v_status
  from public.differential_hypotheses h
  where h.id = p_hypothesis_id and h.organization_id = p_org_id;

  if v_client_id is null then
    raise exception 'hypothesis not found in this organization' using errcode = '22023';
  end if;

  perform public.assert_client_write(p_org_id, v_client_id);

  if v_status <> 'hypothesis' then
    raise exception 'hypothesis was already reviewed' using errcode = '55000';
  end if;

  v_reason := nullif(btrim(coalesce(p_reason, '')), '');
  if p_decision = 'reject' and v_reason is null then
    raise exception 'rejecting a hypothesis requires an audit reason' using errcode = '22023';
  end if;

  v_new_status := case when p_decision = 'approve' then 'active' else 'rejected' end;

  update public.differential_hypotheses
  set status = v_new_status, updated_at = now()
  where id = p_hypothesis_id and organization_id = p_org_id and status = 'hypothesis';

  perform public.append_audit(
    p_org_id, 'differential_hypothesis', p_hypothesis_id, 'hypothesis.' || p_decision,
    jsonb_build_object('status', v_status),
    jsonb_build_object('status', v_new_status),
    v_reason, null, null
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Least privilege: new functions inherit EXECUTE for anon from the 0002
-- default privileges, so every public RPC is revoked explicitly.
-- ---------------------------------------------------------------------------
revoke all on function public.review_theme(uuid, uuid, text, text) from public, anon;
revoke all on function public.review_hypothesis(uuid, uuid, text, text) from public, anon;

grant execute on function public.review_theme(uuid, uuid, text, text) to authenticated, service_role;
grant execute on function public.review_hypothesis(uuid, uuid, text, text) to authenticated, service_role;
