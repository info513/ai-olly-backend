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

-- ── Step 5: canonical destination content (platform-owned, published) ────────
insert into public.destination_pois (id, destination_id, key, name, category, short_description, body_content, latitude, longitude, status, active, sort_order, published_at) values
 ('45000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-000000000001','diocletian-palace','Diocletian''s Palace','landmark','UNESCO Roman palace at the heart of Split.','{"version":1,"blocks":[{"type":"paragraph","text":"A 4th-century Roman palace forming the old town core."}]}'::jsonb,43.508300,16.440400,'published',true,10,now()),
 ('45000000-0000-4000-8000-000000000002','d0000000-0000-4000-8000-000000000001','riva-promenade','Riva Promenade','landmark','Seafront palm-lined promenade.','{"version":1,"blocks":[{"type":"paragraph","text":"The city''s main waterfront promenade."}]}'::jsonb,43.507000,16.439000,'published',true,20,now())
on conflict do nothing;

insert into public.destination_routes (id, destination_id, key, name, short_description, body_content, difficulty, distance_km, duration_minutes, status, active, sort_order, published_at) values
 ('46000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-000000000001','old-town-walk','Old Town Walk','A gentle loop through the historic core.','{"version":1,"blocks":[{"type":"paragraph","text":"Start at the Riva, loop through the palace cellars."}]}'::jsonb,'easy',2.50,45,'published',true,10,now())
on conflict do nothing;

insert into public.destination_whispers (id, destination_id, channel_key, key, title, body_content, status, active, sort_order, published_at) values
 ('47000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-000000000001','food','best-burek','Where to find the best burek','{"version":1,"blocks":[{"type":"paragraph","text":"Locals queue at the bakery near the fish market."}]}'::jsonb,'published',true,10,now())
on conflict do nothing;

insert into public.destination_events (id, destination_id, key, title, short_description, body_content, starts_at, ends_at, status, active, sort_order, published_at) values
 ('48000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-000000000001','summer-festival','Split Summer Festival','Annual open-air arts festival.','{"version":1,"blocks":[{"type":"paragraph","text":"Concerts and theatre across the old town."}]}'::jsonb, now() + interval '20 days', now() + interval '60 days','published',true,10,now())
on conflict do nothing;

-- ── Step 6: Demo Hotel presentation over canonical content (Pattern B) ───────
insert into public.hotel_poi_settings (id, hotel_id, poi_id, visible, featured, walking_time_minutes, hotel_recommendation) values
 ('4b000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001','45000000-0000-4000-8000-000000000001',true,true,5,'A five-minute stroll from our lobby — go early to beat the crowds.')
on conflict do nothing;
insert into public.hotel_poi_settings (id, hotel_id, poi_id, visible, featured) values
 ('4b000000-0000-4000-8000-000000000002','40000000-0000-4000-8000-000000000001','45000000-0000-4000-8000-000000000002',false,false)  -- Demo Hotel hides Riva
on conflict do nothing;

-- ── Step 7: pricing (platform default + Demo Hotel override + native) ────────
insert into public.price_categories (id, hotel_id, key, name, sort_order) values
 ('49000000-0000-4000-8000-000000000001', null, 'transfers', 'Transfers', 10),
 ('49000000-0000-4000-8000-000000000002', '40000000-0000-4000-8000-000000000001', 'demo-extras', 'Demo Extras', 20)
on conflict do nothing;

insert into public.price_items (id, hotel_id, category_id, key, name, amount, currency, vat_rate, vat_included, billing_unit, status, active, published_at) values
 ('4a000000-0000-4000-8000-000000000001', null, '49000000-0000-4000-8000-000000000001', 'airport-transfer', 'Airport Transfer', 40.00, 'EUR', 25.00, true, 'per_use', 'published', true, now())
on conflict do nothing;
insert into public.price_items (id, hotel_id, category_id, key, name, amount, currency, vat_rate, vat_included, billing_unit, status, active, override_of_price_item_id, published_at) values
 ('4a000000-0000-4000-8000-000000000002', '40000000-0000-4000-8000-000000000001', null, 'airport-transfer', 'Airport Transfer (Demo Hotel)', 35.00, 'EUR', 25.00, true, 'per_use', 'published', true, '4a000000-0000-4000-8000-000000000001', now())
on conflict do nothing;
insert into public.price_items (id, hotel_id, category_id, key, name, amount, currency, vat_rate, vat_included, billing_unit, status, active, published_at) values
 ('4a000000-0000-4000-8000-000000000003', '40000000-0000-4000-8000-000000000001', '49000000-0000-4000-8000-000000000002', 'late-checkout', 'Late Check-out', 20.00, 'EUR', 25.00, true, 'per_use', 'published', true, now())
on conflict do nothing;

-- Synthetic staff users/memberships are created by the verification script using
-- Supabase Auth admin APIs (so they are real, testable, and cleaned up).
