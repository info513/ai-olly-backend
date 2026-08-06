-- ============================================================================
-- Platform CMS — Live Feed module (Phase 7; additive, forward-only, aiolly-dev).
-- ----------------------------------------------------------------------------
-- Architecture Part 3/5: the Live Feed is dated destination_events surfaced in an
-- IMPORT mode with DEDUP + AUTO-EXPIRY. It is NOT a new content type — a live-feed
-- item is a destination_event flagged is_live_feed, so it reuses the whole Events
-- publishing/draft-live/history/rollback/archive workflow and RPCs unchanged.
--
-- This migration ADDS to destination_events:
--   1. is_live_feed flag + feed_source + feed_dedup_key + feed_imported_at.
--   2. A partial UNIQUE index (destination_id, feed_dedup_key) so the same feed
--      item can't be imported twice (dedup). Curated events (null key) unaffected.
--   3. archive_expired_feed_events(destination) — platform_admin auto-expiry:
--      archives published feed items whose ends_at is in the past.
-- No new tables/RLS; publish_event/rollback_event/list_event_versions cover feed
-- items too.
-- ============================================================================

alter table public.destination_events
  add column if not exists is_live_feed     boolean not null default false,
  add column if not exists feed_source      text,
  add column if not exists feed_dedup_key   text,
  add column if not exists feed_imported_at timestamptz;

-- Dedup: no two feed items in a destination share a dedup key (curated events null → ignored).
create unique index if not exists destination_events_feed_dedup
  on public.destination_events (destination_id, feed_dedup_key)
  where feed_dedup_key is not null;

-- Auto-expiry: archive published feed items that have already ended.
create or replace function public.archive_expired_feed_events(p_destination uuid)
returns integer
language plpgsql volatile security definer set search_path = '' as $$
declare n int;
begin
  if not platform.is_platform_admin() then
    raise exception 'only platform_admin may run feed auto-expiry' using errcode = '42501';
  end if;
  with expired as (
    update public.destination_events
       set status = 'archived', updated_by = auth.uid()
     where destination_id = p_destination
       and is_live_feed = true
       and status <> 'archived'
       and ends_at is not null
       and ends_at < now()
     returning 1)
  select count(*) into n from expired;
  return n;
end; $$;

revoke all on function public.archive_expired_feed_events(uuid) from public, anon;
grant execute on function public.archive_expired_feed_events(uuid) to authenticated, service_role;
