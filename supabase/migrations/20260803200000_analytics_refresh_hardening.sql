-- ============================================================================
-- Analytics refresh hardening (Sprint 8; additive, aiolly-dev only).
-- ----------------------------------------------------------------------------
-- FINDING — anon EXECUTE regression on all five analytics refresh functions
-- (created in Step 13 with the default PUBLIC/anon EXECUTE). Each already
-- authorizes internally (platform.assert_analytics_access requires a hotel
-- membership or platform_admin), so no data was refreshable by anon, but anon
-- holding EXECUTE is the exact hardening regression Part 12/19 forbids. Revoke
-- PUBLIC/anon; re-grant authenticated + service_role. Forward-only.
-- ============================================================================

revoke all on function public.refresh_ai_quality_daily(uuid, date) from public, anon;
grant execute on function public.refresh_ai_quality_daily(uuid, date) to authenticated, service_role;

revoke all on function public.refresh_operations_daily(uuid, date) from public, anon;
grant execute on function public.refresh_operations_daily(uuid, date) to authenticated, service_role;

revoke all on function public.refresh_newsletter_daily(uuid, date) from public, anon;
grant execute on function public.refresh_newsletter_daily(uuid, date) to authenticated, service_role;

revoke all on function public.refresh_content_health_daily(uuid, date) from public, anon;
grant execute on function public.refresh_content_health_daily(uuid, date) to authenticated, service_role;

revoke all on function public.refresh_analytics(uuid, date) from public, anon;
grant execute on function public.refresh_analytics(uuid, date) to authenticated, service_role;
