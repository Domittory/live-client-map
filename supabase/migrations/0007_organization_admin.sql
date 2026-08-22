-- 0007: Organization administration (ticket 15).
-- Member management (list/invite/role/deactivate), org settings + retention
-- controls (ticket 05 policy), ownership transfer with last-owner protection.
-- All admin mutations are owner-only RPCs that write audit records atomically
-- in the same transaction (ticket 14 mechanism).

-- Pending invitations (ticket 02 contract). Token lives 7 days.
create table public.organization_invitations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  email text not null,
  role text not null check (role in ('specialist', 'supervisor')),
  token uuid not null default gen_random_uuid(),
  expires_at timestamptz not null default (now() + interval '7 days'),
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  unique (organization_id, email)
);

-- Helper: is the current user the organization Owner?
create or replace function public.is_org_owner(org_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.organizations o
    where o.id = org_id and o.owner_user_id = auth.uid()
  );
$$;

-- Last-owner invariant (ticket 02): the organization Owner's membership row
-- cannot be removed, demoted or deactivated — ownership must be transferred
-- first. transfer_ownership() updates organizations.owner_user_id BEFORE
-- touching memberships, so this trigger permits the transfer's own writes.
create or replace function public.protect_org_owner_membership()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_owner uuid;
begin
  select owner_user_id into v_owner
  from public.organizations
  where id = coalesce(old.organization_id, new.organization_id);

  if tg_op = 'DELETE' and old.user_id = v_owner then
    raise exception 'cannot remove the organization owner; transfer ownership first'
      using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and old.user_id = v_owner and (new.role <> 'owner' or new.status <> 'active') then
    raise exception 'cannot demote or deactivate the organization owner; transfer ownership first'
      using errcode = '42501';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger organization_members_protect_owner
  before update or delete on public.organization_members
  for each row execute procedure public.protect_org_owner_membership();

-- Owner invites a specialist/supervisor by email.
create or replace function public.invite_member(
  p_org_id uuid,
  p_email text,
  p_role text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_invitation_id uuid;
begin
  if v_actor is null or not public.is_org_owner(p_org_id) then
    raise exception 'only the organization owner can invite members' using errcode = '42501';
  end if;
  if p_role not in ('specialist', 'supervisor') then
    raise exception 'invitation role must be specialist or supervisor' using errcode = '22023';
  end if;
  if exists (
    select 1
    from public.organization_members m
    join public.profiles p on p.id = m.user_id
    where m.organization_id = p_org_id and lower(p.email) = lower(p_email)
  ) then
    raise exception 'user is already a member of this organization' using errcode = '23505';
  end if;

  insert into public.organization_invitations (organization_id, email, role)
  values (p_org_id, p_email, p_role)
  on conflict (organization_id, email)
  do update set role = excluded.role, token = gen_random_uuid(),
    expires_at = now() + interval '7 days', accepted_at = null
  returning id into v_invitation_id;

  perform public.append_audit(
    p_org_id, 'organization_invitation', v_invitation_id, 'member.invite',
    null, jsonb_build_object('email', p_email, 'role', p_role), null
  );
  return v_invitation_id;
end;
$$;

-- Invited user accepts: token must be fresh, unaccepted and match their email.
create or replace function public.accept_invitation(p_token uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_email text;
  v_invitation public.organization_invitations;
begin
  if v_actor is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  select email into v_email from public.profiles where id = v_actor;

  select * into v_invitation
  from public.organization_invitations
  where token = p_token and accepted_at is null and expires_at > now();
  if not found then
    raise exception 'invitation not found or expired' using errcode = '22023';
  end if;
  if lower(v_invitation.email) <> lower(coalesce(v_email, '')) then
    raise exception 'invitation was issued to a different email' using errcode = '42501';
  end if;

  -- Membership first: append_audit requires active membership of the actor.
  insert into public.organization_members (organization_id, user_id, role, status, joined_at)
  values (v_invitation.organization_id, v_actor, v_invitation.role, 'active', now())
  on conflict (organization_id, user_id)
  do update set role = excluded.role, status = 'active', suspended_at = null;

  update public.organization_invitations
  set accepted_at = now()
  where id = v_invitation.id;

  perform public.append_audit(
    v_invitation.organization_id, 'organization_invitation', v_invitation.id, 'member.accept',
    null, jsonb_build_object('email', v_invitation.email, 'role', v_invitation.role), null
  );
  return v_invitation.organization_id;
end;
$$;

-- Owner changes a member's role (never to/from owner — use transfer_ownership).
create or replace function public.update_member_role(
  p_org_id uuid,
  p_user_id uuid,
  p_role text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_old_role text;
begin
  if v_actor is null or not public.is_org_owner(p_org_id) then
    raise exception 'only the organization owner can change roles' using errcode = '42501';
  end if;
  if p_role not in ('specialist', 'supervisor') then
    raise exception 'role must be specialist or supervisor; use transfer_ownership for owner'
      using errcode = '22023';
  end if;

  select role into v_old_role
  from public.organization_members
  where organization_id = p_org_id and user_id = p_user_id;
  if not found then
    raise exception 'membership not found' using errcode = '22023';
  end if;

  -- The owner row itself is protected by protect_org_owner_membership.
  update public.organization_members
  set role = p_role
  where organization_id = p_org_id and user_id = p_user_id;

  perform public.append_audit(
    p_org_id, 'organization_member', p_user_id, 'member.role_change',
    jsonb_build_object('role', v_old_role), jsonb_build_object('role', p_role), null
  );
end;
$$;

-- Owner suspends or reactivates a member (never the owner row).
create or replace function public.set_member_status(
  p_org_id uuid,
  p_user_id uuid,
  p_status text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_old_status text;
begin
  if v_actor is null or not public.is_org_owner(p_org_id) then
    raise exception 'only the organization owner can change member status' using errcode = '42501';
  end if;
  if p_status not in ('active', 'suspended') then
    raise exception 'status must be active or suspended' using errcode = '22023';
  end if;

  select status into v_old_status
  from public.organization_members
  where organization_id = p_org_id and user_id = p_user_id;
  if not found then
    raise exception 'membership not found' using errcode = '22023';
  end if;

  update public.organization_members
  set status = p_status,
      suspended_at = case when p_status = 'suspended' then now() else null end
  where organization_id = p_org_id and user_id = p_user_id;

  perform public.append_audit(
    p_org_id, 'organization_member', p_user_id,
    case when p_status = 'suspended' then 'member.suspend' else 'member.reactivate' end,
    jsonb_build_object('status', v_old_status), jsonb_build_object('status', p_status), null
  );
end;
$$;

-- Ownership transfer: current owner hands over to another active member.
-- organizations.owner_user_id is updated first so protect_org_owner_membership
-- permits the membership role swap; the whole function is one transaction.
create or replace function public.transfer_ownership(
  p_org_id uuid,
  p_new_owner_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
begin
  if v_actor is null or not public.is_org_owner(p_org_id) then
    raise exception 'only the current owner can transfer ownership' using errcode = '42501';
  end if;
  if p_new_owner_id = v_actor then
    raise exception 'new owner must be a different member' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.organization_members
    where organization_id = p_org_id and user_id = p_new_owner_id and status = 'active'
  ) then
    raise exception 'new owner must be an active member' using errcode = '22023';
  end if;

  update public.organizations
  set owner_user_id = p_new_owner_id, updated_at = now()
  where id = p_org_id;

  update public.organization_members
  set role = 'owner'
  where organization_id = p_org_id and user_id = p_new_owner_id;

  update public.organization_members
  set role = 'specialist'
  where organization_id = p_org_id and user_id = v_actor;

  perform public.append_audit(
    p_org_id, 'organization', p_org_id, 'organization.ownership_transfer',
    jsonb_build_object('owner_user_id', v_actor),
    jsonb_build_object('owner_user_id', p_new_owner_id), null
  );
end;
$$;

revoke all on function public.invite_member(uuid, text, text) from public;
revoke all on function public.accept_invitation(uuid) from public;
revoke all on function public.update_member_role(uuid, uuid, text) from public;
revoke all on function public.set_member_status(uuid, uuid, text) from public;
revoke all on function public.transfer_ownership(uuid, uuid) from public;
grant execute on function public.invite_member(uuid, text, text) to authenticated;
grant execute on function public.accept_invitation(uuid) to authenticated;
grant execute on function public.update_member_role(uuid, uuid, text) to authenticated;
grant execute on function public.set_member_status(uuid, uuid, text) to authenticated;
grant execute on function public.transfer_ownership(uuid, uuid) to authenticated;

-- Retention controls validated against the ticket 05 policy:
-- client data at most 5 years after archive, exports at most 30 days.
-- Audit (3 years) and backups (30 days) are fixed by policy, not configurable.
alter table public.organizations
  add constraint organizations_retention_policy check (
    settings -> 'retention' is null
    or (
      jsonb_typeof(settings #> '{retention,client_data_years}') = 'number'
      and (settings #>> '{retention,client_data_years}')::numeric between 1 and 5
      and jsonb_typeof(settings #> '{retention,export_days}') = 'number'
      and (settings #>> '{retention,export_days}')::numeric between 1 and 30
    )
  );

-- Row level security: only the Owner lists pending invitations.
-- Writes go through the RPCs above (no direct insert/update for authenticated).
alter table public.organization_invitations enable row level security;

create policy "owner manages invitations" on public.organization_invitations
  for select to authenticated
  using (public.is_org_owner(organization_id));

-- Members may see co-member profiles (the member directory needs emails).
create policy "members can read co-member profiles" on public.profiles
  for select to authenticated
  using (
    exists (
      select 1
      from public.organization_members mine
      join public.organization_members theirs
        on theirs.organization_id = mine.organization_id
      where mine.user_id = auth.uid()
        and mine.status = 'active'
        and theirs.user_id = profiles.id
    )
  );

-- Table privileges; RLS above still constrains which rows each role touches.
grant select on public.organization_invitations to authenticated;
grant all on public.organization_invitations to service_role;
