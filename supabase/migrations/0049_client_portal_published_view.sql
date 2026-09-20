-- 0049: Client Portal published read model (ticket 15).
--
-- SPEC §5.4 / §43: a Client Portal user is not an organization member and gets
-- "не получает прямого доступа к base tables". Until now the portal projection
-- (lib/service/client-portal.ts) ran on a specialist's RLS context, so a portal
-- identity had no path to its own published data at all: the `clients`,
-- `development_targets` and `recommendations` SELECT policies require an
-- organization membership plus a client assignment.
--
-- The wrong fix would be to widen those policies. RLS is row-level only, so a
-- portal policy on `clients` would also expose `specialist_notes_private`, and
-- a policy on `recommendations` would expose `rationale` / `risk_notes` /
-- `rank_rationale`. Instead the portal reads through one guarded SECURITY
-- DEFINER RPC that:
--   * resolves the caller from auth.uid() and the verified email claim to
--     exactly one active `client_portal_users` row (a portal identity is never
--     an organization member, so nothing else grants it access);
--   * re-checks the `client_portal` consent on every call, so revoking either
--     the portal access or the consent takes effect on the next request;
--   * returns a JSON projection of explicitly published fields only:
--     client-visible notes, active DevelopmentTargets, human-approved
--     client-visible Recommendations and `corrections.client_visible_summary`.
--     Private specialist reasoning never appears in the payload.
--
-- Base tables stay closed to portal identities; the access-matrix and
-- client-portal test suites assert the denial.

-- ---------------------------------------------------------------------------
-- Internal: resolve the authenticated portal identity to its one client.
-- ---------------------------------------------------------------------------

-- Returns the single client_id the caller may see as a portal user, or null
-- when the caller is not an active portal identity or the `client_portal`
-- consent has been revoked. A portal identity is matched by the verified email
-- claim, exactly like the existing `client_portal_users` and
-- `client_feedback_forms` policies, so no JWT/user-id pairing table is needed.
create or replace function public.portal_client_id()
returns uuid
language sql
security definer
set search_path = public
stable
as $$
  select u.client_id
  from public.client_portal_users u
  where u.email = (auth.jwt() ->> 'email')
    and u.status = 'active'
    and public.has_consent(u.client_id, 'client_portal')
  order by u.invited_at desc
  limit 1;
$$;

-- ---------------------------------------------------------------------------
-- Public: the privacy-filtered portal read model.
-- ---------------------------------------------------------------------------

-- One JSON document for the portal screen. Raises 42501 (insufficient
-- privilege) for a caller with no active portal access, which the service
-- translates into the neutral "access revoked or not granted" page — a revoked
-- identity and a foreign identity are indistinguishable.
create or replace function public.get_client_portal_overview()
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_client_id uuid;
  v_client public.clients;
begin
  v_client_id := public.portal_client_id();

  if v_client_id is null then
    raise exception 'no active portal access' using errcode = '42501';
  end if;

  select * into v_client
  from public.clients c
  where c.id = v_client_id;

  if v_client.id is null then
    raise exception 'client not found' using errcode = '22023';
  end if;

  return jsonb_build_object(
    'client_id', v_client.id,
    'display_name', v_client.display_name,
    'notes', v_client.client_visible_notes,
    'agreed_targets', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', t.id,
          'name', t.name,
          'current_level', t.current_level,
          'target_level', t.target_level
        )
        order by t.created_at asc
      )
      from public.development_targets t
      where t.client_id = v_client_id
        and t.status = 'active'
    ), '[]'::jsonb),
    'client_visible_recommendations', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', r.id,
          'proposed_correction', r.proposed_correction,
          'final_priority_score', r.final_priority_score
        )
        order by r.final_priority_score desc nulls last, r.created_at asc
      )
      from public.recommendations r
      where r.client_id = v_client_id
        and r.status = 'approved'
        and r.visibility = 'client_visible'
    ), '[]'::jsonb),
    'published_summaries', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', c.id,
          'date', c.date,
          'title', c.title,
          'summary', c.client_visible_summary,
          'status', c.status
        )
        order by c.date desc, c.created_at desc
      )
      from public.corrections c
      where c.client_id = v_client_id
        and c.status <> 'archived'
        and nullif(btrim(coalesce(c.client_visible_summary, '')), '') is not null
    ), '[]'::jsonb)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Least privilege
-- ---------------------------------------------------------------------------

revoke all on function public.portal_client_id() from public, anon, authenticated;
revoke all on function public.get_client_portal_overview() from public, anon;

grant execute on function public.get_client_portal_overview() to authenticated, service_role;
