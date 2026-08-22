-- 0001: Infrastructure foundation (ticket 10).
-- No psychological business entities — only shared conventions future migrations rely on.

-- UUID generation for all entity ids (ticket 03).
create extension if not exists pgcrypto;

-- Database readiness probe used by GET /api/health.
-- `security definer` functions must `set search_path = public` and expose
-- minimal privileges (SPEC §44).
create or replace function public.health_check()
returns boolean
language sql
security definer
set search_path = public
as $$
  select true;
$$;

revoke all on function public.health_check() from public;
grant execute on function public.health_check() to anon, authenticated, service_role;
