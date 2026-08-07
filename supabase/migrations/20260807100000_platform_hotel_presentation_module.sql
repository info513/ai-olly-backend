-- ============================================================================
-- Platform CMS — Hotel Presentation (Phase 10): read-only presentation readers.
-- ----------------------------------------------------------------------------
-- The hotel Presentation surface lets a hotel control ONLY its own presentation
-- of shared, canonical destination content (visible/featured/order/recommendation
-- + the schema-supported hotel intro / walking time / image override) via the
-- existing hotel_{poi,route,whisper,event}_settings tables (Pattern B RLS already
-- in place — no policy changes here). Canonical facts stay read-only: these
-- functions only READ.
--
-- resolved_destination_*(p_hotel) already merge canonical + settings, but they are
-- the GUEST view: they hide items where visible=false and don't expose the raw
-- settings a hotel needs to manage. These hotel_presentation_*(p_hotel) mirror the
-- canonical fact resolution (published_snapshot with row fallback) but:
--   • include hidden items (no visible filter) so a hotel can un-hide,
--   • expose the raw settings columns + has_settings (so overrides are editable),
--   • stay SECURITY INVOKER + STABLE so RLS applies: a hotel member sees only its
--     own destination's published canonical items (has_destination_access) and its
--     own settings (has_hotel_membership); other hotels' ids resolve to no rows.
-- No new tables, no policy changes, no writes. Forward-only, aiolly-dev.
-- ============================================================================

-- ── POIs ────────────────────────────────────────────────────────────────────
create or replace function public.hotel_presentation_pois(p_hotel uuid)
returns table(
  poi_id uuid, key text, name text, category public.poi_category, short_description text,
  latitude numeric, longitude numeric, address text,
  visible boolean, featured boolean, sort_order_override integer, sort_order integer,
  walking_time_minutes integer, hotel_recommendation text, hotel_photo_url text, hotel_short_description text,
  has_settings boolean, published_at timestamptz)
language sql stable set search_path = '' as $$
  select p.id,
         coalesce(p.published_snapshot->>'key', p.key),
         coalesce(p.published_snapshot->>'name', p.name),
         coalesce((p.published_snapshot->>'category')::public.poi_category, p.category),
         coalesce(p.published_snapshot->>'short_description', p.short_description),
         coalesce(nullif(p.published_snapshot->>'latitude','')::numeric, p.latitude),
         coalesce(nullif(p.published_snapshot->>'longitude','')::numeric, p.longitude),
         coalesce(p.published_snapshot->>'address', p.address),
         coalesce(s.visible, true), coalesce(s.featured, false), s.sort_order_override,
         coalesce((p.published_snapshot->>'sort_order')::int, p.sort_order),
         s.walking_time_minutes, s.hotel_recommendation, s.hotel_photo_url, s.hotel_short_description,
         (s.id is not null),
         coalesce(nullif(p.published_snapshot->>'published_at','')::timestamptz, p.published_at)
  from public.hotels h
  join public.destination_pois p on p.destination_id = h.destination_id
  left join public.hotel_poi_settings s on s.hotel_id = h.id and s.poi_id = p.id
  where h.id = p_hotel
    and p.status <> 'archived'
    and ( p.published_snapshot is not null or (p.status = 'published' and p.active) )
    and coalesce((p.published_snapshot->>'active')::boolean, p.active) = true
  order by coalesce(s.sort_order_override, (p.published_snapshot->>'sort_order')::int, p.sort_order),
           coalesce(p.published_snapshot->>'name', p.name);
$$;

-- ── Routes ──────────────────────────────────────────────────────────────────
create or replace function public.hotel_presentation_routes(p_hotel uuid)
returns table(
  route_id uuid, key text, name text, short_description text,
  difficulty public.route_difficulty, distance_km numeric, duration_minutes integer,
  visible boolean, featured boolean, sort_order_override integer, sort_order integer,
  walking_time_minutes integer, hotel_recommendation text, hotel_photo_url text, hotel_short_description text,
  has_settings boolean, published_at timestamptz)
language sql stable set search_path = '' as $$
  select r.id,
         coalesce(r.published_snapshot->>'key', r.key),
         coalesce(r.published_snapshot->>'name', r.name),
         coalesce(r.published_snapshot->>'short_description', r.short_description),
         coalesce((r.published_snapshot->>'difficulty')::public.route_difficulty, r.difficulty),
         coalesce(nullif(r.published_snapshot->>'distance_km','')::numeric, r.distance_km),
         coalesce(nullif(r.published_snapshot->>'duration_minutes','')::int, r.duration_minutes),
         coalesce(s.visible, true), coalesce(s.featured, false), s.sort_order_override,
         coalesce((r.published_snapshot->>'sort_order')::int, r.sort_order),
         s.walking_time_minutes, s.hotel_recommendation, s.hotel_photo_url, s.hotel_short_description,
         (s.id is not null),
         coalesce(nullif(r.published_snapshot->>'published_at','')::timestamptz, r.published_at)
  from public.hotels h
  join public.destination_routes r on r.destination_id = h.destination_id
  left join public.hotel_route_settings s on s.hotel_id = h.id and s.route_id = r.id
  where h.id = p_hotel
    and r.status <> 'archived'
    and ( r.published_snapshot is not null or (r.status = 'published' and r.active) )
    and coalesce((r.published_snapshot->>'active')::boolean, r.active) = true
  order by coalesce(s.sort_order_override, (r.published_snapshot->>'sort_order')::int, r.sort_order),
           coalesce(r.published_snapshot->>'name', r.name);
$$;

-- ── Whispers ────────────────────────────────────────────────────────────────
create or replace function public.hotel_presentation_whispers(p_hotel uuid)
returns table(
  whisper_id uuid, channel_key text, key text, title text,
  visible boolean, featured boolean, sort_order_override integer, sort_order integer,
  hotel_recommendation text, has_settings boolean, published_at timestamptz)
language sql stable set search_path = '' as $$
  select w.id,
         coalesce(w.published_snapshot->>'channel_key', w.channel_key),
         coalesce(w.published_snapshot->>'key', w.key),
         coalesce(w.published_snapshot->>'title', w.title),
         coalesce(s.visible, true), coalesce(s.featured, false), s.sort_order_override,
         coalesce((w.published_snapshot->>'sort_order')::int, w.sort_order),
         s.hotel_recommendation, (s.id is not null),
         coalesce(nullif(w.published_snapshot->>'published_at','')::timestamptz, w.published_at)
  from public.hotels h
  join public.destination_whispers w on w.destination_id = h.destination_id
  left join public.hotel_whisper_settings s on s.hotel_id = h.id and s.whisper_id = w.id
  where h.id = p_hotel
    and w.status <> 'archived'
    and ( w.published_snapshot is not null or (w.status = 'published' and w.active) )
    and coalesce((w.published_snapshot->>'active')::boolean, w.active) = true
  order by coalesce(w.published_snapshot->>'channel_key', w.channel_key),
           coalesce(s.sort_order_override, (w.published_snapshot->>'sort_order')::int, w.sort_order),
           coalesce(w.published_snapshot->>'title', w.title);
$$;

-- ── Events ──────────────────────────────────────────────────────────────────
create or replace function public.hotel_presentation_events(p_hotel uuid)
returns table(
  event_id uuid, key text, title text, short_description text,
  starts_at timestamptz, ends_at timestamptz, all_day boolean, location_name text,
  visible boolean, featured boolean, sort_order_override integer, sort_order integer,
  hotel_recommendation text, hotel_short_description text, has_settings boolean, published_at timestamptz)
language sql stable set search_path = '' as $$
  select e.id,
         coalesce(e.published_snapshot->>'key', e.key),
         coalesce(e.published_snapshot->>'title', e.title),
         coalesce(e.published_snapshot->>'short_description', e.short_description),
         coalesce(nullif(e.published_snapshot->>'starts_at','')::timestamptz, e.starts_at),
         coalesce(nullif(e.published_snapshot->>'ends_at','')::timestamptz, e.ends_at),
         coalesce((e.published_snapshot->>'all_day')::boolean, e.all_day),
         coalesce(e.published_snapshot->>'location_name', e.location_name),
         coalesce(s.visible, true), coalesce(s.featured, false), s.sort_order_override,
         coalesce((e.published_snapshot->>'sort_order')::int, e.sort_order),
         s.hotel_recommendation, s.hotel_short_description, (s.id is not null),
         coalesce(nullif(e.published_snapshot->>'published_at','')::timestamptz, e.published_at)
  from public.hotels h
  join public.destination_events e on e.destination_id = h.destination_id
  left join public.hotel_event_settings s on s.hotel_id = h.id and s.event_id = e.id
  where h.id = p_hotel
    and e.status <> 'archived'
    and ( e.published_snapshot is not null or (e.status = 'published' and e.active) )
    and coalesce((e.published_snapshot->>'active')::boolean, e.active) = true
  order by coalesce(s.sort_order_override, (e.published_snapshot->>'sort_order')::int, e.sort_order),
           coalesce(nullif(e.published_snapshot->>'starts_at','')::timestamptz, e.starts_at) nulls last,
           coalesce(e.published_snapshot->>'title', e.title);
$$;

-- Presentation readers are safe for any authenticated caller; RLS on the underlying
-- tables enforces destination + hotel scoping. Keep anon/public off.
revoke all on function public.hotel_presentation_pois(uuid)     from public, anon;
revoke all on function public.hotel_presentation_routes(uuid)   from public, anon;
revoke all on function public.hotel_presentation_whispers(uuid) from public, anon;
revoke all on function public.hotel_presentation_events(uuid)   from public, anon;
grant execute on function public.hotel_presentation_pois(uuid)     to authenticated, service_role;
grant execute on function public.hotel_presentation_routes(uuid)   to authenticated, service_role;
grant execute on function public.hotel_presentation_whispers(uuid) to authenticated, service_role;
grant execute on function public.hotel_presentation_events(uuid)   to authenticated, service_role;
