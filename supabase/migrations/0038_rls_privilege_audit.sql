-- 0038: RLS + privilege audit hardening (ticket 60).
--
-- Root cause found during the audit: the Supabase bootstrap default ACL grants
-- `anon` EXECUTE on every public function. The migrations' `revoke all ... from
-- public` pattern only removes the PUBLIC grant; it does NOT remove the named-role
-- grants the default ACL materialized at object-creation time. Net effect: `anon`
-- (and, for the erasure RPCs, `authenticated`) could execute security-definer
-- functions — including the destructive `anonymize_client_audit` /
-- `purge_client_ai_runs`, which would let an anonymous or authenticated caller
-- anonymize audit trails or purge AI runs by guessing a client UUID.
--
-- This migration revokes anon's EXECUTE on the user-facing and destructive RPCs
-- and re-grants the minimal role set. The RLS authorization helpers
-- (`is_org_member`, `is_org_owner`, `is_client_accessible`) are intentionally
-- left executable by `anon`: several RLS policies omit `to authenticated`, so the
-- helpers are evaluated for anonymous queries too. They are safe there (they
-- return false when `auth.uid()` is null), and revoking them would turn the
-- correct "0 rows" result into a `permission denied` error.

-- ---------------------------------------------------------------------------
-- User-facing RPCs: revoke anon; keep authenticated (+ service_role where the
-- service layer calls them directly).
-- ---------------------------------------------------------------------------
revoke all on function public.has_consent(uuid, text) from public, anon;
revoke all on function public.grant_consent(uuid, uuid, text, text, text) from public, anon;
revoke all on function public.revoke_consent(uuid, uuid, text) from public, anon;
revoke all on function public.create_client(uuid, text, text, text) from public, anon;
revoke all on function public.grant_client_assignment(uuid, uuid, uuid, text) from public, anon;
revoke all on function public.revoke_client_assignment(uuid, uuid, uuid) from public, anon;
revoke all on function public.append_audit(uuid, text, uuid, text, jsonb, jsonb, text, text, text) from public, anon;
revoke all on function public.validate_correction_target(text, uuid, uuid, uuid) from public, anon;
revoke all on function public.validate_behavioral_marker_link(text, uuid, uuid, uuid) from public, anon;
grant execute on function public.has_consent(uuid, text) to authenticated, service_role;
grant execute on function public.grant_consent(uuid, uuid, text, text, text) to authenticated, service_role;
grant execute on function public.revoke_consent(uuid, uuid, text) to authenticated, service_role;
grant execute on function public.create_client(uuid, text, text, text) to authenticated, service_role;
grant execute on function public.grant_client_assignment(uuid, uuid, uuid, text) to authenticated, service_role;
grant execute on function public.revoke_client_assignment(uuid, uuid, uuid) to authenticated, service_role;
grant execute on function public.append_audit(uuid, text, uuid, text, jsonb, jsonb, text, text, text) to authenticated;
grant execute on function public.validate_correction_target(text, uuid, uuid, uuid) to authenticated, service_role;
grant execute on function public.validate_behavioral_marker_link(text, uuid, uuid, uuid) to authenticated, service_role;

-- Organization-admin RPCs (owner-only logic, authenticated surface).
revoke all on function public.invite_member(uuid, text, text) from public, anon;
revoke all on function public.accept_invitation(uuid) from public, anon;
revoke all on function public.update_member_role(uuid, uuid, text) from public, anon;
revoke all on function public.set_member_status(uuid, uuid, text) from public, anon;
revoke all on function public.transfer_ownership(uuid, uuid) from public, anon;
grant execute on function public.invite_member(uuid, text, text) to authenticated;
grant execute on function public.accept_invitation(uuid) to authenticated;
grant execute on function public.update_member_role(uuid, uuid, text) to authenticated;
grant execute on function public.set_member_status(uuid, uuid, text) to authenticated;
grant execute on function public.transfer_ownership(uuid, uuid) to authenticated;

-- Destructive erasure RPCs: service_role ONLY. This closes the anonymous-wipe
-- hole where anon/authenticated could anonymize audit trails or purge AI runs
-- by guessing a client UUID.
revoke all on function public.anonymize_client_audit(uuid, uuid[]) from public, anon, authenticated;
revoke all on function public.purge_client_ai_runs(uuid) from public, anon, authenticated;
grant execute on function public.anonymize_client_audit(uuid, uuid[]) to service_role;
grant execute on function public.purge_client_ai_runs(uuid) to service_role;
