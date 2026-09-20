-- 0045: Client workspace access read model (ticket 09).
--
-- The client-scoped workspace shows the assignment roster of one client, so an
-- Owner can see and revoke access without typing a client id. The
-- `client_assignments` RLS policy only exposes a user's own rows, so the roster
-- is served by a guarded read RPC instead of a service-role bypass:
-- SECURITY DEFINER, fixed search_path, owner-only (the same rule grant/revoke
-- enforce in 0040), tenant-validated, and EXECUTE limited to authenticated.
--
-- Read-only: it never mutates state and appends no audit row.

create or replace function public.list_client_assignments(
  p_org_id uuid,
  p_client_id uuid
)
returns table (
  user_id uuid,
  email text,
  access_role text,
  granted_at timestamptz
)
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  if auth.uid() is null or not public.is_org_owner(p_org_id) then
    raise exception 'only the organization owner can view assignments' using errcode = '42501';
  end if;

  -- The client must belong to the caller's organization: an owner must not be
  -- able to read another tenant's roster.
  if not exists (
    select 1 from public.clients c where c.id = p_client_id and c.organization_id = p_org_id
  ) then
    raise exception 'client not found in this organization' using errcode = '22023';
  end if;

  return query
    select a.user_id, p.email, a.access_role, a.created_at
    from public.client_assignments a
    left join public.profiles p on p.id = a.user_id
    where a.client_id = p_client_id
      and a.revoked_at is null
    order by a.created_at asc;
end;
$$;

revoke all on function public.list_client_assignments(uuid, uuid) from public, anon;
grant execute on function public.list_client_assignments(uuid, uuid) to authenticated, service_role;
