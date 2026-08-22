-- 0023: add review_status to themes (ticket 34) for pending AI proposals.

alter table public.themes
  add column review_status text not null default 'approved'
    check (review_status in ('pending', 'approved', 'rejected'));
