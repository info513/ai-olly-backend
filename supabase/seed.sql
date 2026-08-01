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

-- Room types (Pattern C defaults) for Demo Hotel
insert into public.room_types (id, hotel_id, name, slug, active, default_capacity, smart_glass, underfloor_heating, room_features, ai_welcome)
values
 ('41000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001','Demo Deluxe','demo-deluxe',true,2,true,true,
   array['King-size bed','Air conditioning','Minibar'],'Welcome to your Demo Deluxe room.'),
 ('41000000-0000-4000-8000-000000000002','40000000-0000-4000-8000-000000000001','Demo Standard','demo-standard',true,2,false,false,
   array['Queen-size bed','Air conditioning'],'Welcome to your Demo Standard room.')
on conflict (hotel_id, slug) do nothing;

-- Rooms — synthetic non-production tokens (clearly DEMO), inheritance examples:
--  101 inherits all Deluxe defaults; 102 overrides Smart Glass -> false;
--  201 (Standard) overrides the view.
insert into public.rooms (id, hotel_id, room_type_id, room_number, access_token, active, view_description_override, smart_glass_override)
values
 ('42000000-0000-4000-8000-000000000101','40000000-0000-4000-8000-000000000001','41000000-0000-4000-8000-000000000001','101','DEMO-TOKEN-101',true,null,null),
 ('42000000-0000-4000-8000-000000000102','40000000-0000-4000-8000-000000000001','41000000-0000-4000-8000-000000000001','102','DEMO-TOKEN-102',true,null,false),
 ('42000000-0000-4000-8000-000000000201','40000000-0000-4000-8000-000000000001','41000000-0000-4000-8000-000000000002','201','DEMO-TOKEN-201',true,'View of the demo courtyard',null)
on conflict (hotel_id, room_number) do nothing;

-- ── Step 4: Hotel Services & operational content ─────────────────────────────
-- Platform-default categories (hotel_id NULL). Machine keys are stable.
insert into public.service_categories (id, hotel_id, key, name, sort_order, active) values
 ('43000000-0000-4000-8000-000000000001', null, 'arrival-departure', 'Arrival & Departure', 10, true),
 ('43000000-0000-4000-8000-000000000002', null, 'guest-services',     'Guest Services',      20, true),
 ('43000000-0000-4000-8000-000000000003', null, 'breakfast-food',     'Breakfast & Food',    30, true),
 ('43000000-0000-4000-8000-000000000004', null, 'transport-parking',  'Transport & Parking', 40, true),
 ('43000000-0000-4000-8000-000000000005', null, 'policies-safety',    'Policies & Safety',   50, true)
on conflict do nothing;

-- Platform-DEFAULT critical service (check-in/out), published.
insert into public.hotel_services
  (id, hotel_id, category_id, key, title, short_description, body_content, status, active,
   visible_in_pwa, visible_in_web, available_to_ai, sort_order, is_critical, published_at)
values
 ('44000000-0000-4000-8000-000000000001', null, '43000000-0000-4000-8000-000000000005',
  'check-in-out', 'Check-in & Check-out',
  'Standard arrival and departure times.',
  '{"version":1,"blocks":[{"type":"paragraph","text":"Check-in from 15:00. Check-out by 11:00."}]}'::jsonb,
  'published', true, true, true, true, 10, true, now())
on conflict do nothing;

-- Demo Hotel HOTEL OVERRIDE of the platform check-in/out (override wins), published+critical.
insert into public.hotel_services
  (id, hotel_id, category_id, key, title, short_description, body_content, status, active,
   visible_in_pwa, visible_in_web, available_to_ai, sort_order, is_critical, override_of_service_id,
   published_at, last_critical_ack_at)
values
 ('44000000-0000-4000-8000-000000000002', '40000000-0000-4000-8000-000000000001',
  '43000000-0000-4000-8000-000000000005', 'check-in-out', 'Check-in & Check-out (Demo Hotel)',
  'Demo Hotel arrival and departure times.',
  '{"version":1,"blocks":[{"type":"paragraph","text":"Check-in from 14:00. Check-out by 10:30. Late check-out on request."}]}'::jsonb,
  'published', true, true, true, true, 10, true, '44000000-0000-4000-8000-000000000001', now(), now())
on conflict do nothing;

-- Temporary / valid-dated hotel service (breakfast hours for a season).
insert into public.hotel_services
  (id, hotel_id, category_id, key, title, body_content, status, active,
   visible_in_pwa, visible_in_web, available_to_ai, sort_order, valid_from, valid_to, published_at)
values
 ('44000000-0000-4000-8000-000000000003', '40000000-0000-4000-8000-000000000001',
  '43000000-0000-4000-8000-000000000003', 'breakfast-hours', 'Breakfast Hours',
  '{"version":1,"blocks":[{"type":"paragraph","text":"Breakfast 07:00–10:30 in the summer season."}]}'::jsonb,
  'published', true, true, false, true, 20,
  now() - interval '10 days', now() + interval '80 days', now())
on conflict do nothing;

-- PWA + AI hotel service (airport transfer).
insert into public.hotel_services
  (id, hotel_id, category_id, key, title, body_content, status, active,
   visible_in_pwa, visible_in_web, available_to_ai, sort_order, published_at)
values
 ('44000000-0000-4000-8000-000000000004', '40000000-0000-4000-8000-000000000001',
  '43000000-0000-4000-8000-000000000004', 'airport-transfer', 'Airport Transfer',
  '{"version":1,"blocks":[{"type":"paragraph","text":"Private airport transfer available on request."},{"type":"contact_action","action":"call","value":"+385000000000","label":"Call reception"}]}'::jsonb,
  'published', true, true, false, true, 30, now())
on conflict do nothing;

-- AI-only hotel service (surfaced to the AI agent, hidden from PWA/web).
insert into public.hotel_services
  (id, hotel_id, category_id, key, title, body_content, status, active,
   visible_in_pwa, visible_in_web, available_to_ai, sort_order, published_at)
values
 ('44000000-0000-4000-8000-000000000005', '40000000-0000-4000-8000-000000000001',
  '43000000-0000-4000-8000-000000000002', 'concierge-notes', 'Concierge Notes (AI)',
  '{"version":1,"blocks":[{"type":"paragraph","text":"Internal concierge knowledge available to the AI assistant only."}]}'::jsonb,
  'published', true, false, false, true, 40, now())
on conflict do nothing;

-- Archived hotel service (excluded from live/resolved output).
insert into public.hotel_services
  (id, hotel_id, category_id, key, title, body_content, status, active,
   visible_in_pwa, visible_in_web, available_to_ai, sort_order)
values
 ('44000000-0000-4000-8000-000000000006', '40000000-0000-4000-8000-000000000001',
  '43000000-0000-4000-8000-000000000004', 'old-parking', 'Old Parking Notice',
  '{"version":1,"blocks":[{"type":"paragraph","text":"Deprecated parking notice."}]}'::jsonb,
  'archived', true, true, false, true, 50)
on conflict do nothing;

-- Synthetic staff users/memberships are created by the verification script using
-- Supabase Auth admin APIs (so they are real, testable, and cleaned up).
