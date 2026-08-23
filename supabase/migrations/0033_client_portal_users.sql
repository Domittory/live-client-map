-- 0033: Client Portal identity (ticket 51, per ticket 04 resolution).
-- A portal user is a Supabase auth identity mapped by email to exactly one
-- client_id; they are NEVER an organization member. Portal sessions only read
-- their own portal row; base business tables remain org-member/assignment
-- scoped, so a portal user cannot read them directly.

create table public.client_portal_users (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  email text not null,
  status text not null default 'active' check (status in ('active', 'revoked')),
  invited_at timestamptz not null default now(),
  last_login_at timestamptz,
  revoked_at timestamptz,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  unique (client_id, email)
);

create index client_portal_users_client_idx on public.client_portal_users (client_id);
create index client_portal_users_email_idx on public.client_portal_users (email);

alter table public.client_portal_users enable row level security;

-- A portal user reads only their own active row (matched by email).
create policy "portal reads own row" on public.client_portal_users
  for select to authenticated
  using (email = auth.jwt() ->> 'email' and status = 'active');

-- Specialists with write access to the client manage portal access.
create policy "assigned manage portal users" on public.client_portal_users
  for all to authenticated
  using (
    exists (
      select 1 from public.clients c
      where c.id = client_portal_users.client_id
        and public.is_client_accessible(c.organization_id, c.id, true)
    )
  )
  with check (
    exists (
      select 1 from public.clients c
      where c.id = client_portal_users.client_id
        and public.is_client_accessible(c.organization_id, c.id, true)
    )
  );

grant select on public.client_portal_users to authenticated;
grant select, insert, update, delete on public.client_portal_users to service_role;
