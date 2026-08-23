-- 0034: ClientFeedbackForm (ticket 52, per ticket 04 resolution).
-- Specialists author and send forms; portal users fill only their own sent
-- forms. Submissions become pending Signals (source_type=follow_up), never a
-- confirmed model change.

create table public.client_feedback_forms (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  client_id uuid not null references public.clients (id) on delete cascade,
  correction_id uuid references public.corrections (id) on delete set null,
  follow_up_id uuid references public.follow_ups (id) on delete set null,
  created_by uuid references auth.users (id),
  title text not null,
  questions jsonb not null default '[]'::jsonb,
  answers jsonb,
  status text not null default 'draft' check (status in ('draft', 'sent', 'completed', 'expired')),
  sent_at timestamptz,
  completed_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index client_feedback_forms_client_idx on public.client_feedback_forms (client_id);

alter table public.client_feedback_forms enable row level security;

-- Specialist/owner with write access to the client manage forms.
create policy "assigned manage feedback forms" on public.client_feedback_forms
  for all to authenticated
  using (public.is_client_accessible(organization_id, client_id, true))
  with check (public.is_client_accessible(organization_id, client_id, true));

-- Portal user reads only their own sent/completed forms (matched by email).
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
  );

grant select, insert, update on public.client_feedback_forms to authenticated;
grant select, insert, update, delete on public.client_feedback_forms to service_role;
