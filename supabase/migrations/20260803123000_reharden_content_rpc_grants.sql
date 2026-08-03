-- ============================================================================
-- Re-harden EXECUTE grants on Content RPCs (Sprint 3.1 security fix).
-- ----------------------------------------------------------------------------
-- FINDING (caught by the Content security audit): `create or replace function`
-- RESETS a function's privileges to the PostgreSQL default (EXECUTE to PUBLIC).
-- The Sprint-3 ambiguity fix and the Sprint-3.1 draft/live rewrite recreated
-- publish_hotel_service / resolved_hotel_services / list_service_versions without
-- re-applying the REVOKE/GRANT, silently restoring PUBLIC (incl. anon) EXECUTE.
-- Internal authorization still blocked anon (auth.uid() is null), but least
-- privilege requires anon/PUBLIC not be able to invoke these at all. Re-revoke
-- and grant only to authenticated + service_role. Idempotent. aiolly-dev only.
-- ============================================================================

revoke all on function public.publish_hotel_service(uuid, text, boolean) from public, anon, authenticated, service_role;
grant execute on function public.publish_hotel_service(uuid, text, boolean) to authenticated, service_role;

revoke all on function public.rollback_hotel_service(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.rollback_hotel_service(uuid, uuid) to authenticated, service_role;

revoke all on function public.list_service_versions(uuid) from public, anon, authenticated, service_role;
grant execute on function public.list_service_versions(uuid) to authenticated, service_role;

revoke all on function public.resolved_hotel_services(uuid) from public, anon, authenticated, service_role;
grant execute on function public.resolved_hotel_services(uuid) to authenticated, service_role;
