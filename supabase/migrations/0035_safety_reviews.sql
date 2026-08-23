-- 0035: SafetyReview (ticket 59). Sensitive cases and medical-boundary
-- violations create a human safety review record; the record is a control, not
-- a diagnosis.

create table public.safety_reviews (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  client_id uuid not null references public.clients (id) on delete cascade,
  category text not null,
  severity text not null default 'high' check (severity in ('low', 'medium', 'high', 'critical')),
  source text,
  review_status text not null default 'open' check (review_status in ('open', 'acknowledged', 'resolved')),
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index safety_reviews_client_idx on public.safety_reviews (client_id);

alter table public.safety_reviews enable row level security;

create policy "assigned read safety reviews" on public.safety_reviews
  for select using (public.is_client_accessible(organization_id, client_id, false));
create policy "assigned insert safety reviews" on public.safety_reviews
  for insert with check (public.is_client_accessible(organization_id, client_id, true));
create policy "assigned update safety reviews" on public.safety_reviews
  for update using (public.is_client_accessible(organization_id, client_id, true));

grant select, insert, update on public.safety_reviews to authenticated;
grant select, insert, update, delete on public.safety_reviews to service_role;
