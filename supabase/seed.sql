-- ============================================================================
-- AI OLLY Platform 2.0 — Development seed (DEVELOPMENT ONLY)
-- ----------------------------------------------------------------------------
-- Synthetic, non-personal demo data. Runs on `supabase db reset` (local).
-- NO production hotel data, NO Antique Split, NO real guest/room tokens/emails.
-- Idempotent (fixed UUIDs + on conflict do nothing).
-- ============================================================================

insert into public.destinations (id, name, slug, country_code, timezone, default_locale, status)
values ('d0000000-0000-4000-8000-000000000001', 'Split Test', 'split-test', 'HR', 'Europe/Zagreb', 'en', 'active')
on conflict (slug) do nothing;

insert into public.hotel_groups (id, name, slug, status)
values ('90000000-0000-4000-8000-000000000001', 'Demo Hotel Group', 'demo-hotel-group', 'active')
on conflict (slug) do nothing;

insert into public.hotels (id, hotel_group_id, destination_id, name, slug, status, timezone, default_locale, currency, country_code)
values ('40000000-0000-4000-8000-000000000001',
        '90000000-0000-4000-8000-000000000001',
        'd0000000-0000-4000-8000-000000000001',
        'Demo Hotel', 'demo-hotel', 'setup', 'Europe/Zagreb', 'en', 'EUR', 'HR')
on conflict (slug) do nothing;

-- Synthetic staff users/memberships are created by the verification script using
-- Supabase Auth admin APIs (so they are real, testable, and cleaned up).
