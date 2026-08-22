-- 0014: InterventionMethod library (ticket 38).
-- Reusable method metadata (SPEC §8.22), separate from concrete Corrections.
-- System records are global and immutable for tenants; organizations extend
-- the catalog with their own methods. Archive is soft: archived methods stay
-- readable so existing Corrections keep their references.

create table public.intervention_methods (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations (id) on delete cascade,
  name text not null,
  description text,
  category text,
  contraindications text[] not null default '{}',
  default_follow_up_days integer check (
    default_follow_up_days is null or (default_follow_up_days between 1 and 365)
  ),
  is_system boolean not null default false,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  -- System records are global (organization_id null); org records never are.
  check ((organization_id is null) = is_system)
);

-- System names are unique globally; org names are unique within the org.
create unique index intervention_methods_system_name_key
  on public.intervention_methods (name)
  where organization_id is null;
create unique index intervention_methods_org_name_key
  on public.intervention_methods (organization_id, name)
  where organization_id is not null;
create index intervention_methods_organization_idx
  on public.intervention_methods (organization_id)
  where organization_id is not null;

-- Row level security.
-- Read: system records for everyone; org records for active org members.
-- Archived rows stay readable (version-safe archive for old Corrections).
-- Write: org members with an author role (owner/specialist); supervisors are
-- read-only here. System records have no authenticated write path.
alter table public.intervention_methods enable row level security;

create policy "read system or own-org methods" on public.intervention_methods
  for select to authenticated
  using (is_system or public.is_org_member(organization_id));

create policy "authors create org methods" on public.intervention_methods
  for insert to authenticated
  with check (
    not is_system
    and exists (
      select 1 from public.organization_members m
      where m.organization_id = intervention_methods.organization_id
        and m.user_id = auth.uid()
        and m.status = 'active'
        and m.role in ('owner', 'specialist')
    )
  );

create policy "authors update org methods" on public.intervention_methods
  for update to authenticated
  using (
    not is_system
    and exists (
      select 1 from public.organization_members m
      where m.organization_id = intervention_methods.organization_id
        and m.user_id = auth.uid()
        and m.status = 'active'
        and m.role in ('owner', 'specialist')
    )
  )
  with check (
    not is_system
    and exists (
      select 1 from public.organization_members m
      where m.organization_id = intervention_methods.organization_id
        and m.user_id = auth.uid()
        and m.status = 'active'
        and m.role in ('owner', 'specialist')
    )
  );

-- Table privileges; RLS above still constrains which rows each role touches.
grant select, insert, update on public.intervention_methods to authenticated;
grant all on public.intervention_methods to service_role;
