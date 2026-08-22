-- 0024: add review_status + evidence_refs to resources (ticket 36) for pending AI proposals.

alter table public.resources
  add column review_status text not null default 'approved'
    check (review_status in ('pending', 'approved', 'rejected'));

alter table public.resources
  add column evidence_refs text[] not null default '{}';
