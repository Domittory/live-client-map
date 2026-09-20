-- 0040: Atomic organization, client, access and consent mutations (ticket 04).
--
-- Follows the atomic business mutation template from migration 0039: one
-- SECURITY DEFINER RPC per compound mutation, actor resolved from auth.uid(),
-- tenant/assignment/consent guards, fixed search_path, minimal grants, and the
-- AuditLog appended inside the same transaction.
--
-- Membership/admin RPCs from migration 0007 (invite, role, status, ownership
-- transfer) already wrote their audit row inside the RPC; this migration closes
-- the remaining gaps:
--   * Client update and archive were a table UPDATE followed by a separate
--     recordAudit() call in the service layer — a failure between the two left a
--     changed client without its audit row.
--   * updateOrgSettings did the same for organization name/retention settings.
--   * grant/revoke of ClientAssignment and consent wrote no audit at all, and
--     both trusted the caller for tenant scoping.

-- ---------------------------------------------------------------------------
-- Client update: whitelisted patch, one transaction with its audit row.
-- ---------------------------------------------------------------------------
create or replace function public.update_client(
  p_client_id uuid,
  p_org_id uuid,
  p_patch jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_allowed text[] := array[
    'display_name', 'first_name', 'last_name', 'occupation',
    'specialist_notes_private', 'client_visible_notes'
  ];
  v_key text;
  v_before jsonb;
  v_after jsonb;
begin
  perform public.require_org_member_actor(p_org_id);

  if not public.is_client_accessible(p_org_id, p_client_id, true) then
    raise exception 'no write access to this client' using errcode = '42501';
  end if;

  if p_patch is null or jsonb_typeof(p_patch) <> 'object' or p_patch = '{}'::jsonb then
    raise exception 'no fields to update' using errcode = '22023';
  end if;

  for v_key in select jsonb_object_keys(p_patch) loop
    if not (v_key = any(v_allowed)) then
      raise exception 'field % cannot be updated', v_key using errcode = '22023';
    end if;
    if jsonb_typeof(p_patch -> v_key) not in ('string', 'null') then
      raise exception 'field % must be a string or null', v_key using errcode = '22023';
    end if;
  end loop;

  select jsonb_build_object(
           'display_name', c.display_name,
           'first_name', c.first_name,
           'last_name', c.last_name,
           'occupation', c.occupation,
           'specialist_notes_private', c.specialist_notes_private,
           'client_visible_notes', c.client_visible_notes
         )
  into v_before
  from public.clients c
  where c.id = p_client_id and c.organization_id = p_org_id;

  if v_before is null then
    raise exception 'client not found in this organization' using errcode = '22023';
  end if;

  update public.clients c
  set display_name = case when p_patch ? 'display_name' then p_patch ->> 'display_name' else c.display_name end,
      first_name = case when p_patch ? 'first_name' then p_patch ->> 'first_name' else c.first_name end,
      last_name = case when p_patch ? 'last_name' then p_patch ->> 'last_name' else c.last_name end,
      occupation = case when p_patch ? 'occupation' then p_patch ->> 'occupation' else c.occupation end,
      specialist_notes_private = case when p_patch ? 'specialist_notes_private'
        then p_patch ->> 'specialist_notes_private' else c.specialist_notes_private end,
      client_visible_notes = case when p_patch ? 'client_visible_notes'
        then p_patch ->> 'client_visible_notes' else c.client_visible_notes end,
      updated_at = now()
  where c.id = p_client_id and c.organization_id = p_org_id;

  select jsonb_build_object(
           'display_name', c.display_name,
           'first_name', c.first_name,
           'last_name', c.last_name,
           'occupation', c.occupation,
           'specialist_notes_private', c.specialist_notes_private,
           'client_visible_notes', c.client_visible_notes
         )
  into v_after
  from public.clients c
  where c.id = p_client_id;

  perform public.append_audit(
    p_org_id, 'client', p_client_id, 'client.updated',
    v_before, v_after, null, null, null
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Client archive: status change and audit row in one transaction.
-- ---------------------------------------------------------------------------
create or replace function public.archive_client(
  p_client_id uuid,
  p_org_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_archived integer;
begin
  perform public.require_org_member_actor(p_org_id);

  if not public.is_client_accessible(p_org_id, p_client_id, true) then
    raise exception 'no write access to this client' using errcode = '42501';
  end if;

  update public.clients
  set status = 'archived',
      archived_at = coalesce(archived_at, now()),
      updated_at = now()
  where id = p_client_id and organization_id = p_org_id;

  get diagnostics v_archived = row_count;
  if v_archived = 0 then
    raise exception 'client not found in this organization' using errcode = '22023';
  end if;

  perform public.append_audit(
    p_org_id, 'client', p_client_id, 'client.archived',
    null, jsonb_build_object('status', 'archived'), null, null, null
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- ClientAssignment grant/revoke: owner-only, tenant- and membership-validated,
-- audited in the same transaction.
-- ---------------------------------------------------------------------------
create or replace function public.grant_client_assignment(
  p_org_id uuid,
  p_client_id uuid,
  p_user_id uuid,
  p_access_role text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old_role text;
begin
  if auth.uid() is null or not public.is_org_owner(p_org_id) then
    raise exception 'only the organization owner can manage assignments' using errcode = '42501';
  end if;

  if p_access_role not in ('primary_specialist', 'secondary_specialist', 'supervisor', 'read_only') then
    raise exception 'invalid access role' using errcode = '22023';
  end if;

  -- The client must belong to the caller's organization: otherwise an owner
  -- could grant (or revoke) access to another tenant's client.
  if not exists (
    select 1 from public.clients c where c.id = p_client_id and c.organization_id = p_org_id
  ) then
    raise exception 'client not found in this organization' using errcode = '22023';
  end if;

  -- Assignments are only meaningful for active members of this organization.
  if not exists (
    select 1 from public.organization_members m
    where m.organization_id = p_org_id and m.user_id = p_user_id and m.status = 'active'
  ) then
    raise exception 'user is not an active member of this organization' using errcode = '22023';
  end if;

  select a.access_role into v_old_role
  from public.client_assignments a
  where a.client_id = p_client_id and a.user_id = p_user_id;

  insert into public.client_assignments (client_id, user_id, access_role)
  values (p_client_id, p_user_id, p_access_role)
  on conflict (client_id, user_id) do update
    set access_role = excluded.access_role, revoked_at = null;

  perform public.append_audit(
    p_org_id, 'client_assignment', p_client_id, 'assignment.grant',
    case when v_old_role is null then null else jsonb_build_object('access_role', v_old_role) end,
    jsonb_build_object('user_id', p_user_id, 'access_role', p_access_role),
    null, null, null
  );
end;
$$;

create or replace function public.revoke_client_assignment(
  p_org_id uuid,
  p_client_id uuid,
  p_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_revoked integer;
begin
  if auth.uid() is null or not public.is_org_owner(p_org_id) then
    raise exception 'only the organization owner can manage assignments' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.clients c where c.id = p_client_id and c.organization_id = p_org_id
  ) then
    raise exception 'client not found in this organization' using errcode = '22023';
  end if;

  update public.client_assignments
  set revoked_at = now()
  where client_id = p_client_id and user_id = p_user_id and revoked_at is null;

  get diagnostics v_revoked = row_count;

  -- No active assignment means nothing changed; do not fabricate an audit row.
  if v_revoked > 0 then
    perform public.append_audit(
      p_org_id, 'client_assignment', p_client_id, 'assignment.revoke',
      jsonb_build_object('user_id', p_user_id), null, null, null, null
    );
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Consent lifecycle: existing signatures preserved, audit appended inside the
-- transaction and client tenant revalidated.
-- ---------------------------------------------------------------------------
create or replace function public.grant_consent(
  p_org_id uuid,
  p_client_id uuid,
  p_consent_type text,
  p_scope text,
  p_document_version text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if not public.is_client_accessible(p_org_id, p_client_id, true) then
    raise exception 'no write access to this client' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.clients c where c.id = p_client_id and c.organization_id = p_org_id
  ) then
    raise exception 'client not found in this organization' using errcode = '22023';
  end if;

  insert into public.consent_records
    (organization_id, client_id, consent_type, scope, document_version, granted_at)
  values (p_org_id, p_client_id, p_consent_type, p_scope, p_document_version, now())
  returning id into v_id;

  perform public.append_audit(
    p_org_id, 'consent_record', v_id, 'consent.granted',
    null,
    jsonb_build_object(
      'client_id', p_client_id,
      'consent_type', p_consent_type,
      'document_version', p_document_version
    ),
    'consent granted', null, null
  );

  return v_id;
end;
$$;

create or replace function public.revoke_consent(
  p_org_id uuid,
  p_client_id uuid,
  p_consent_type text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if not public.is_client_accessible(p_org_id, p_client_id, true) then
    raise exception 'no write access to this client' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.clients c where c.id = p_client_id and c.organization_id = p_org_id
  ) then
    raise exception 'client not found in this organization' using errcode = '22023';
  end if;

  update public.consent_records
  set revoked_at = now()
  where id = (
    select id from public.consent_records
    where client_id = p_client_id and consent_type = p_consent_type and revoked_at is null
    order by created_at desc, id desc
    limit 1
  )
  returning id into v_id;

  if v_id is not null then
    perform public.append_audit(
      p_org_id, 'consent_record', v_id, 'consent.revoked',
      jsonb_build_object('consent_type', p_consent_type), null,
      'consent revoked', null, null
    );
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Organization settings: owner-only, one transaction with its audit row.
-- p_retention is {"client_data_years": n, "export_days": n} or null to keep the
-- current retention. The table CHECK constraint stays the source of truth for
-- the policy bounds (SQLSTATE 23514 for a violation).
-- ---------------------------------------------------------------------------
create or replace function public.update_organization_settings(
  p_org_id uuid,
  p_name text,
  p_retention jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_before jsonb;
  v_after jsonb;
  v_settings jsonb;
begin
  if auth.uid() is null or not public.is_org_owner(p_org_id) then
    raise exception 'only the organization owner can edit settings' using errcode = '42501';
  end if;

  select jsonb_build_object('name', o.name, 'settings', o.settings)
  into v_before
  from public.organizations o
  where o.id = p_org_id;

  if v_before is null then
    raise exception 'organization not found' using errcode = '22023';
  end if;

  v_settings := v_before -> 'settings';

  if p_retention is not null then
    if jsonb_typeof(p_retention) <> 'object'
      or jsonb_typeof(p_retention -> 'client_data_years') <> 'number'
      or jsonb_typeof(p_retention -> 'export_days') <> 'number'
    then
      raise exception 'retention requires numeric client_data_years and export_days'
        using errcode = '22023';
    end if;
    v_settings := jsonb_set(coalesce(v_settings, '{}'::jsonb), '{retention}', p_retention, true);
  end if;

  update public.organizations
  set name = coalesce(p_name, name),
      settings = v_settings,
      updated_at = now()
  where id = p_org_id;

  select jsonb_build_object('name', o.name, 'settings', o.settings)
  into v_after
  from public.organizations o
  where o.id = p_org_id;

  perform public.append_audit(
    p_org_id, 'organization', p_org_id, 'organization.update_settings',
    v_before, v_after, null, null, null
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Least privilege: new functions inherit EXECUTE for anon/authenticated from
-- the default privileges in 0002, so each one is revoked explicitly.
-- ---------------------------------------------------------------------------
revoke all on function public.update_client(uuid, uuid, jsonb) from public, anon;
revoke all on function public.archive_client(uuid, uuid) from public, anon;
revoke all on function public.grant_client_assignment(uuid, uuid, uuid, text) from public, anon;
revoke all on function public.revoke_client_assignment(uuid, uuid, uuid) from public, anon;
revoke all on function public.grant_consent(uuid, uuid, text, text, text) from public, anon;
revoke all on function public.revoke_consent(uuid, uuid, text) from public, anon;
revoke all on function public.update_organization_settings(uuid, text, jsonb) from public, anon;

grant execute on function public.update_client(uuid, uuid, jsonb) to authenticated, service_role;
grant execute on function public.archive_client(uuid, uuid) to authenticated, service_role;
grant execute on function public.grant_client_assignment(uuid, uuid, uuid, text) to authenticated, service_role;
grant execute on function public.revoke_client_assignment(uuid, uuid, uuid) to authenticated, service_role;
grant execute on function public.grant_consent(uuid, uuid, text, text, text) to authenticated, service_role;
grant execute on function public.revoke_consent(uuid, uuid, text) to authenticated, service_role;
grant execute on function public.update_organization_settings(uuid, text, jsonb) to authenticated, service_role;
