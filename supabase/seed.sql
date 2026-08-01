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

-- Synthetic staff users/memberships are created by the verification script using
-- Supabase Auth admin APIs (so they are real, testable, and cleaned up).
