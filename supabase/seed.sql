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

-- ── Package B: AI Knowledge (Step 8) ─────────────────────────────────────────
insert into public.knowledge_categories (id, hotel_id, key, name, sort_order) values
 ('5c000000-0000-4000-8000-000000000001', null, 'policies', 'Policies', 10)
on conflict do nothing;

-- platform article + hotel override (override wins), destination article, hotel, critical, draft
insert into public.knowledge_articles (id, hotel_id, destination_id, category_id, key, title, body_content, approved_answer, locale, status, active, available_to_ai, is_critical, published_at) values
 ('5d000000-0000-4000-8000-000000000001', null, null, '5c000000-0000-4000-8000-000000000001', 'check-in-policy', 'Check-in Policy', '{"version":1,"blocks":[{"type":"paragraph","text":"Standard check-in from 15:00."}]}'::jsonb, 'Check-in is from 15:00.', 'en', 'published', true, true, false, now()),
 ('5d000000-0000-4000-8000-000000000002', null, 'd0000000-0000-4000-8000-000000000001', '5c000000-0000-4000-8000-000000000001', 'local-tips', 'Local Tips', '{"version":1,"blocks":[{"type":"paragraph","text":"Ask reception for the best coffee spots."}]}'::jsonb, null, 'en', 'published', true, true, false, now()),
 ('5d000000-0000-4000-8000-000000000003', '40000000-0000-4000-8000-000000000001', null, null, 'demo-wifi', 'Wi-Fi Access', '{"version":1,"blocks":[{"type":"paragraph","text":"Network AIOLLY-DEMO, password at reception."}]}'::jsonb, 'Network AIOLLY-DEMO.', 'en', 'published', true, true, false, now()),
 ('5d000000-0000-4000-8000-000000000005', '40000000-0000-4000-8000-000000000001', null, '5c000000-0000-4000-8000-000000000001', 'emergency-info', 'Emergency Information', '{"version":1,"blocks":[{"type":"paragraph","text":"Dial 112 for emergencies; reception is staffed 24/7."}]}'::jsonb, 'Dial 112.', 'en', 'published', true, true, true, now()),
 ('5d000000-0000-4000-8000-000000000006', '40000000-0000-4000-8000-000000000001', null, null, 'draft-note', 'Draft Note', '{"version":1,"blocks":[{"type":"paragraph","text":"Work in progress."}]}'::jsonb, null, 'en', 'draft', true, true, false, null)
on conflict do nothing;
-- hotel override of the platform check-in policy (same key+locale)
insert into public.knowledge_articles (id, hotel_id, destination_id, category_id, key, title, body_content, approved_answer, locale, status, active, available_to_ai, override_of_article_id, published_at) values
 ('5d000000-0000-4000-8000-000000000004', '40000000-0000-4000-8000-000000000001', null, '5c000000-0000-4000-8000-000000000001', 'check-in-policy', 'Check-in Policy (Demo Hotel)', '{"version":1,"blocks":[{"type":"paragraph","text":"Demo Hotel check-in from 14:00."}]}'::jsonb, 'Check-in is from 14:00.', 'en', 'published', true, true, '5d000000-0000-4000-8000-000000000001', now())
on conflict do nothing;

insert into public.ai_configs (id, hotel_id, tone, safe_handoff_text, status, active, published_at) values
 ('5e000000-0000-4000-8000-000000000001', null, 'friendly', 'Let me connect you with reception.', 'published', true, now()),
 ('5e000000-0000-4000-8000-000000000002', '40000000-0000-4000-8000-000000000001', 'warm and concise', 'Our reception is happy to help — please call the front desk.', 'published', true, now())
on conflict do nothing;

insert into public.knowledge_aliases (id, hotel_id, article_id, locale, alias_text) values
 ('5f000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001', '5d000000-0000-4000-8000-000000000003', 'en', 'wifi password')
on conflict do nothing;

-- ── Package B: Guests / Stays / Consent (Step 9) ─────────────────────────────
insert into public.guests (id, hotel_id, first_name, last_name, preferred_locale, country_code, external_source, external_id) values
 ('60000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001', 'Demo', 'Guest', 'en', 'HR', 'manual', 'demo-1')
on conflict do nothing;

insert into public.consent_templates (id, hotel_id, key, locale, version, title, body_text, status, active, published_at) values
 ('61000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001', 'marketing-consent', 'en', 1, 'Marketing Consent', '[SYNTHETIC PLACEHOLDER CONSENT TEXT — not legal wording]', 'published', true, now())
on conflict do nothing;

insert into public.stays (id, hotel_id, guest_id, room_id, status, arrival_at, checked_in_at, access_token_hash, external_source, external_id) values
 ('62000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000001', '42000000-0000-4000-8000-000000000101', 'checked_in', now(), now(), 'sha256$DEMO-SYNTHETIC-HASH', 'manual', 'stay-demo-1')
on conflict do nothing;

insert into public.consents (id, hotel_id, guest_id, stay_id, template_id, consent_type, consent_version, locale, consent_text_snapshot, signed_name, signed_at, status) values
 ('63000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000001', '62000000-0000-4000-8000-000000000001', '61000000-0000-4000-8000-000000000001', 'marketing-consent', 1, 'en', '[SYNTHETIC PLACEHOLDER CONSENT TEXT — not legal wording]', 'Demo Guest', now(), 'granted')
on conflict do nothing;

-- ── Package B: Reception (Step 10) ───────────────────────────────────────────
insert into public.guest_requests (id, hotel_id, stay_id, room_id, guest_id, request_type, title, description, priority, status, source, internal_notes) values
 ('64000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001', '62000000-0000-4000-8000-000000000001', '42000000-0000-4000-8000-000000000101', '60000000-0000-4000-8000-000000000001', 'housekeeping', 'Extra towels', 'Two extra towels please.', 'normal', 'new', 'pwa', 'Guest is a repeat visitor.')
on conflict do nothing;

insert into public.feedback (id, hotel_id, stay_id, room_id, rating, category, message, follow_up_requested, status, source) values
 ('65000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001', '62000000-0000-4000-8000-000000000001', '42000000-0000-4000-8000-000000000101', 5, 'stay', 'Lovely room and service!', false, 'new', 'pwa')
on conflict do nothing;

insert into public.push_subscriptions (id, hotel_id, endpoint, p256dh, auth_key, user_agent, active) values
 ('66000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001', 'https://fcm.example.invalid/DEMO-FAKE-ENDPOINT', 'DEMO-FAKE-P256DH', 'DEMO-FAKE-AUTH', 'Seed/DemoDevice', true)
on conflict do nothing;

-- ── Package C: Storage & Assets (Step 11) ────────────────────────────────────
insert into public.assets (id, hotel_id, destination_id, bucket_name, storage_path, original_filename, display_name, asset_type, mime_type, file_size_bytes, status, public_access, alt_text, rights_owner) values
 ('70000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001', null, 'public-media', 'hotels/40000000-0000-4000-8000-000000000001/logo.png', 'logo.png', 'Demo Hotel Logo', 'logo', 'image/png', 40000, 'ready', true, 'Demo Hotel logo', 'Demo Hotel'),
 ('70000000-0000-4000-8000-000000000002', '40000000-0000-4000-8000-000000000001', null, 'public-media', 'hotels/40000000-0000-4000-8000-000000000001/rooms/42000000-0000-4000-8000-000000000101/hero.jpg', 'hero.jpg', 'Room 101 Hero', 'room_image', 'image/jpeg', 900000, 'ready', true, 'Room 101 sea view', 'Demo Hotel'),
 ('70000000-0000-4000-8000-000000000003', null, 'd0000000-0000-4000-8000-000000000001', 'public-media', 'destinations/d0000000-0000-4000-8000-000000000001/poi/palace.jpg', 'palace.jpg', 'Palace (shared)', 'poi_image', 'image/jpeg', 1200000, 'ready', true, 'Diocletian''s Palace', 'Platform'),
 ('70000000-0000-4000-8000-000000000004', '40000000-0000-4000-8000-000000000001', null, 'consent-files', 'hotels/40000000-0000-4000-8000-000000000001/consents/63000000-0000-4000-8000-000000000001/signature.png', 'signature.png', 'Consent signature (synthetic)', 'consent_signature', 'image/png', 12000, 'ready', false, null, 'Demo Hotel')
on conflict do nothing;

insert into public.asset_usages (id, asset_id, hotel_id, entity_type, entity_id, usage_role) values
 ('76000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001', 'hotel', '40000000-0000-4000-8000-000000000001', 'logo'),
 ('76000000-0000-4000-8000-000000000002', '70000000-0000-4000-8000-000000000002', '40000000-0000-4000-8000-000000000001', 'room', '42000000-0000-4000-8000-000000000101', 'hero'),
 ('76000000-0000-4000-8000-000000000003', '70000000-0000-4000-8000-000000000003', null, 'destination_poi', '45000000-0000-4000-8000-000000000001', 'card')
on conflict do nothing;

-- ── Package C: Newsletter (Step 12) ──────────────────────────────────────────
insert into public.newsletter_subscribers (id, hotel_id, email, first_name, locale, status, source, subscribed_at, consent_id) values
 ('71000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001', 'demo.subscriber@verify.local', 'Demo', 'en', 'subscribed', 'pwa', now(), '63000000-0000-4000-8000-000000000001'),
 ('71000000-0000-4000-8000-000000000002', '40000000-0000-4000-8000-000000000001', 'demo.unsub@verify.local', 'Left', 'en', 'unsubscribed', 'pwa', now(), null)
on conflict do nothing;

insert into public.newsletter_segments (id, hotel_id, key, name, type, rules) values
 ('72000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001', 'all-subscribed', 'All Subscribed', 'static', null),
 ('72000000-0000-4000-8000-000000000002', '40000000-0000-4000-8000-000000000001', 'english-guests', 'English Guests', 'rule', '{"match":"all","conditions":[{"field":"locale","op":"eq","value":"en"}]}'::jsonb)
on conflict do nothing;
insert into public.newsletter_segment_members (segment_id, subscriber_id) values
 ('72000000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000001')
on conflict do nothing;

insert into public.newsletter_templates (id, hotel_id, key, name, subject, preview_text, content, locale, status, published_at) values
 ('73000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001', 'welcome', 'Welcome', 'Welcome to Demo Hotel', 'A warm hello', '{"version":1,"blocks":[{"type":"paragraph","text":"Thanks for subscribing!"}]}'::jsonb, 'en', 'published', now()),
 ('73000000-0000-4000-8000-000000000002', '40000000-0000-4000-8000-000000000001', 'draft-news', 'Draft News', 'Summer news', 'Coming soon', '{"version":1,"blocks":[{"type":"paragraph","text":"Draft only."}]}'::jsonb, 'en', 'draft', null)
on conflict do nothing;

insert into public.newsletter_campaigns (id, hotel_id, name, template_id, segment_id, status) values
 ('74000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001', 'Draft Campaign', '73000000-0000-4000-8000-000000000002', '72000000-0000-4000-8000-000000000001', 'draft')
on conflict do nothing;
insert into public.newsletter_campaigns (id, hotel_id, name, template_id, segment_id, subject_snapshot, preview_text_snapshot, content_snapshot, status, scheduled_at) values
 ('74000000-0000-4000-8000-000000000002', '40000000-0000-4000-8000-000000000001', 'Scheduled Campaign', '73000000-0000-4000-8000-000000000001', '72000000-0000-4000-8000-000000000001', 'Welcome to Demo Hotel', 'A warm hello', '{"version":1,"blocks":[{"type":"paragraph","text":"Thanks for subscribing!"}]}'::jsonb, 'scheduled', now() + interval '1 day')
on conflict do nothing;

insert into public.newsletter_campaign_recipients (id, campaign_id, hotel_id, subscriber_id, delivery_status, sent_at) values
 ('75000000-0000-4000-8000-000000000001', '74000000-0000-4000-8000-000000000002', '40000000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000001', 'sent', now())
on conflict do nothing;
insert into public.newsletter_events (id, hotel_id, campaign_id, recipient_id, subscriber_id, event_type) values
 ('75000000-0000-4000-8000-000000000011', '40000000-0000-4000-8000-000000000001', '74000000-0000-4000-8000-000000000002', '75000000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000001', 'delivered')
on conflict do nothing;

-- ── Package C: Analytics (Step 13) — synthetic daily aggregates ──────────────
insert into public.ai_quality_daily (hotel_id, day, total_questions, deterministic_answers, model_answers, safe_handoffs, unanswered, avg_latency_ms, prompt_tokens, completion_tokens, knowledge_articles_used, coverage_estimate, calc_version) values
 ('40000000-0000-4000-8000-000000000001', current_date, 20, 12, 6, 2, 1, 850, 4000, 1500, 5, 0.9000, 'v1')
on conflict do nothing;
insert into public.operations_daily (hotel_id, day, requests_total, requests_resolved, requests_open, avg_ack_seconds, avg_resolution_seconds, feedback_count, avg_rating, stays_arriving, consents_granted, calc_version) values
 ('40000000-0000-4000-8000-000000000001', current_date, 5, 4, 1, 120, 3600, 3, 4.67, 2, 1, 'v1')
on conflict do nothing;
insert into public.newsletter_daily (hotel_id, day, subscribers_active, consent_active, sent, delivered, opened, clicked, bounced, unsubscribed, calc_version) values
 ('40000000-0000-4000-8000-000000000001', current_date, 1, 1, 1, 1, 0, 0, 0, 0, 'v1')
on conflict do nothing;
insert into public.content_health_daily (hotel_id, day, published_count, draft_count, archived_count, expired_count, critical_pending, unresolved_unanswered, unused_assets, assets_missing_alt, assets_missing_rights, completeness_score, calc_version) values
 ('40000000-0000-4000-8000-000000000001', current_date, 4, 1, 0, 0, 0, 0, 1, 1, 0, 0.8000, 'v1')
on conflict do nothing;

-- Synthetic staff users/memberships are created by the verification script using
-- Supabase Auth admin APIs (so they are real, testable, and cleaned up).
