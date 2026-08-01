-- ============================================================================
-- AI OLLY Platform 2.0 — Step 1 grants hardening
-- ----------------------------------------------------------------------------
-- FINDING: Supabase default privileges grant ALL (incl. DELETE/TRUNCATE) to
-- service_role (and would to anon/authenticated) on new public tables. The
-- previous migration's positive grants were therefore redundant, leaving
-- service_role over-privileged (e.g. audit_log DELETE was possible).
--
-- This migration resets our four cross-cutting tables to strict least-privilege:
--   • service_role: append-only where required (no UPDATE/DELETE/TRUNCATE on
--     content_versions & audit_log; no DELETE on retention_policies).
--   • anon/authenticated: no privileges (defensive re-revoke).
--
-- Forward-only + idempotent. Every future migration must follow this pattern:
-- REVOKE ALL then GRANT the exact minimum, because Supabase defaults over-grant.
-- ============================================================================

-- Defensive: ensure anon/authenticated/public hold nothing on these tables.
revoke all on public.translations,
              public.content_versions,
              public.audit_log,
              public.retention_policies
  from public, anon, authenticated;

-- Reset service_role to least privilege (removes the default ALL grant).
revoke all on public.translations,
              public.content_versions,
              public.audit_log,
              public.retention_policies
  from service_role;

grant select, insert, update, delete on public.translations       to service_role;  -- editable content
grant select, insert                 on public.content_versions   to service_role;  -- append-only (immutable snapshots)
grant select, insert                 on public.audit_log          to service_role;  -- append-only
grant select, insert, update         on public.retention_policies to service_role;  -- editable; deactivate via `active`, never delete
