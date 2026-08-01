-- ============================================================================
-- Fix: grant USAGE on the private `platform` schema to app roles.
-- ----------------------------------------------------------------------------
-- FINDING (surfaced in Step 3): SECURITY INVOKER trigger functions
-- (protect_room_columns, protect_hotel_privileged_columns, ...) call
-- platform.is_platform_admin()/has_hotel_role() in the invoker's context. Without
-- USAGE on the `platform` schema, an authenticated user hits "permission denied
-- for schema platform" and legitimate updates fail. (RLS policy expressions did
-- not surface this; trigger bodies do.)
--
-- Granting USAGE lets these roles REFERENCE platform objects; it does NOT grant
-- access to platform TABLES (no table grants exist), and EXECUTE on the helper
-- functions was already granted. Safe.
-- ============================================================================

grant usage on schema platform to authenticated, service_role;
