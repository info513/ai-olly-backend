-- ============================================================================
-- AI EXECUTE hardening (Sprint 4 security audit finding; additive, aiolly-dev).
-- ----------------------------------------------------------------------------
-- FINDING (security-audit-ai.mjs): three AI functions created in Step 8 with
-- `create or replace` kept the default EXECUTE grant to PUBLIC/anon:
--   • public.rollback_knowledge_article(uuid, uuid)
--   • public.publish_ai_config(uuid, text)
--   • public.resolved_ai_config(uuid)
-- Data was never actually exposed — each enforces authorization internally and
-- the underlying tables are RLS-protected — but anon holding EXECUTE is the
-- exact hardening regression Part 17 forbids. Revoke PUBLIC/anon, re-grant to
-- authenticated + service_role only. Forward-only; no behaviour change for
-- legitimate callers. (The Sprint-4 draft/live migration already did this for
-- publish_knowledge_article / resolved_ai_knowledge / list_article_versions.)
-- ============================================================================

revoke all on function public.rollback_knowledge_article(uuid, uuid) from public, anon;
grant execute on function public.rollback_knowledge_article(uuid, uuid) to authenticated, service_role;

revoke all on function public.publish_ai_config(uuid, text) from public, anon;
grant execute on function public.publish_ai_config(uuid, text) to authenticated, service_role;

revoke all on function public.resolved_ai_config(uuid) from public, anon;
grant execute on function public.resolved_ai_config(uuid) to authenticated, service_role;
