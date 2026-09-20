-- 0039: Atomic business mutation pattern (ticket 01).
--
-- CONTRACT every compound business mutation follows from here on:
--   1. The domain mutation, its child rows and its AuditLog append run inside a
--      single SECURITY DEFINER RPC. A failure at any step rolls the whole thing
--      back, so a committed business row can never be missing its audit trail.
--   2. The actor is resolved from auth.uid() (never from a parameter), tenant
--      membership is asserted, and ClientAssignment / consent are asserted only
--      where the operation touches an already existing client.
--   3. `set search_path = public`, `revoke all` from public/anon, and EXECUTE
--      granted to the narrowest role set that actually calls the function.
--   4. The public service keeps its camel-case input contract; the RPC payload
--      uses schema column names (p_snake_case parameters).
--   5. A service stops pairing its mutation call with a separate recordAudit()
--      call once that mutation is atomic. withAudit() survives only for
--      demonstrably single-statement operations until ticket 21 retires them.
--
-- Audit appends go through public.append_audit() so the recorded actor stays
-- pinned to the real caller and every audit row travels the same single write
-- path. Payloads built inside an RPC contain business columns only: never
-- private specialist notes, secrets or tokens.
--
-- The exemplary mutation is create_client(): it already inserted the client and
-- its primary_specialist assignment atomically; before this migration the
-- client.created audit row was a second, separately failing network call.
-- Its public RPC signature is unchanged, so existing callers and the existing
-- service contract keep working without migrating the rest of the service layer.

-- Shared precondition helper for atomic RPCs: returns the authenticated actor
-- and raises SQLSTATE 42501 when the caller is anonymous or not a member of the
-- organization. It is called only from SECURITY DEFINER functions owned by the
-- migration role, so no client role needs (or gets) EXECUTE on it.
create or replace function public.require_org_member_actor(p_organization_id uuid)
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
  if not public.is_org_member(p_organization_id) then
    raise exception 'not a member of this organization' using errcode = '42501';
  end if;
  return v_actor;
end;
$$;

revoke all on function public.require_org_member_actor(uuid) from public, anon, authenticated;

-- Exemplary compound mutation: Client + primary_specialist assignment +
-- client.created audit row in one transaction.
--
-- Consent is not applicable at creation (the client record does not exist yet);
-- the operation is gated by organization membership and the creator receives
-- the ClientAssignment that later gates every client-scoped read and write.
create or replace function public.create_client(
  p_organization_id uuid,
  p_display_name text,
  p_first_name text default null,
  p_last_name text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_client_id uuid;
begin
  v_user_id := public.require_org_member_actor(p_organization_id);

  insert into public.clients (organization_id, owner_user_id, display_name, first_name, last_name)
  values (p_organization_id, v_user_id, p_display_name, p_first_name, p_last_name)
  returning id into v_client_id;

  insert into public.client_assignments (client_id, user_id, access_role)
  values (v_client_id, v_user_id, 'primary_specialist');

  perform public.append_audit(
    p_organization_id,
    'client',
    v_client_id,
    'client.created',
    null,
    jsonb_build_object('display_name', p_display_name),
    null,
    null,
    null
  );

  return v_client_id;
end;
$$;

revoke all on function public.create_client(uuid, text, text, text) from public, anon;
grant execute on function public.create_client(uuid, text, text, text) to authenticated, service_role;
