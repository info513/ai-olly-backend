-- ============================================================================
-- Reception/Consent hardening (Sprint 5 findings; additive, aiolly-dev only).
-- ----------------------------------------------------------------------------
-- FINDING 1 — consent-template mutable-live defect (same class as Services/
-- Knowledge). protect_consent_template_columns() froze hotel_id/key/version/
-- created_by/published_at and blocked direct publish, but left title/body_text/
-- locale editable on an ALREADY-PUBLISHED template. sign_consent() snapshots the
-- template's LIVE body_text, so editing a published template silently changed the
-- live signable wording with no new version and no history. (Already-signed
-- consents were never affected — they store an immutable snapshot.)
-- FIX: freeze content columns once a template is published. To change wording a
-- new draft VERSION row is created (version+1) and published — publish promotes a
-- version, the live signable template is unchanged until then, rollback = a new
-- draft version. Mirrors the Services/Knowledge draft/live guarantee.
--
-- FINDING 2 — anon EXECUTE regression on all six Step 9/10 functions
-- (pseudonymize_guest, resolved_active_stay, resolved_stays, sign_consent,
-- revoke_consent, publish_consent_template). Each already enforces authorization
-- internally + RLS, so no data was exposed, but anon holding EXECUTE is the exact
-- hardening regression the audit forbids. Revoke PUBLIC/anon; re-grant to
-- authenticated + service_role only. Forward-only.
-- ============================================================================

-- ── FINDING 1: freeze published consent-template content ─────────────────────
create or replace function platform.protect_consent_template_columns()
returns trigger language plpgsql as $$
begin
  if current_user in ('service_role','postgres','supabase_admin') or platform.is_platform_admin() then return new; end if;
  new.hotel_id := old.hotel_id; new.key := old.key; new.version := old.version; new.created_by := old.created_by;
  new.published_at := old.published_at;
  if new.status = 'published' and old.status is distinct from 'published' then
    raise exception 'direct publish is not allowed; use public.publish_consent_template()' using errcode = '42501';
  end if;
  -- Once published, the signable wording is frozen. Create a NEW draft version to
  -- change it (see sign_consent, which snapshots this exact text at signing time).
  if old.status = 'published' then
    new.title     := old.title;
    new.body_text := old.body_text;
    new.locale    := old.locale;
  end if;
  return new;
end; $$;
-- trigger platform.protect_consent_template_columns already bound (Step 9); replacing the body suffices.

-- ── FINDING 2: re-harden EXECUTE grants (revoke anon/PUBLIC) ──────────────────
revoke all on function public.pseudonymize_guest(uuid) from public, anon;
grant execute on function public.pseudonymize_guest(uuid) to authenticated, service_role;

revoke all on function public.resolved_active_stay(uuid) from public, anon;
grant execute on function public.resolved_active_stay(uuid) to authenticated, service_role;

revoke all on function public.resolved_stays(uuid) from public, anon;
grant execute on function public.resolved_stays(uuid) to authenticated, service_role;

revoke all on function public.sign_consent(uuid, uuid, uuid, text, jsonb) from public, anon;
grant execute on function public.sign_consent(uuid, uuid, uuid, text, jsonb) to authenticated, service_role;

revoke all on function public.revoke_consent(uuid) from public, anon;
grant execute on function public.revoke_consent(uuid) to authenticated, service_role;

revoke all on function public.publish_consent_template(uuid, text) from public, anon;
grant execute on function public.publish_consent_template(uuid, text) to authenticated, service_role;
