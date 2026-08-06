-- ============================================================================
-- Platform CMS — Routes module (Phase 4; additive, forward-only, aiolly-dev).
-- ----------------------------------------------------------------------------
-- Brings canonical destination_routes to the same Draft→Publish→Live→History→
-- Rollback→Archive workflow as POIs, and formalizes the ordered POI-waypoint
-- relationship, provenance, verification, and media fields.
--
-- WAYPOINTS: kept in the existing `waypoints` jsonb (no new table), under a
-- canonical `stops` key — an ordered array of {poi_id, poi_key, note}. This is a
-- structured POI relationship (ids, not free text), reorderable (array order),
-- note-bearing, and same-destination-validated by a trigger. The pre-existing
-- Split routes' waypoints are left untouched (legacy pois/order keys remain);
-- they gain `stops` only when an admin next saves them.
--
-- destination_routes already has: key-per-destination UNIQUE, distance/duration
-- CHECKs, a protect-publish trigger, an audit trigger, and NO DELETE policy
-- (archive-only). This migration only ADDS:
--   1. route_type enum + canonical/provenance/verification/media fields +
--      published_snapshot (draft/live).
--   2. validate_route_waypoints() trigger — every stop POI must belong to the
--      route's destination (and exist).
--   3. RPCs publish_route / rollback_route / list_route_versions (platform_admin
--      only, SECURITY DEFINER, empty search_path, authenticated+service_role).
--   4. resolved_destination_routes rewired to serve the LIVE snapshot (row
--      fallback), excluding archived; stays INVOKER (tenant-safe). Existing 6
--      published routes backfilled — no change for hotels.
-- Reuses content_source_type + verification_status enums from Phase 2.
-- No unrelated tables/RLS/POIs/destinations are redesigned.
-- ============================================================================

-- ── 1. Enums + fields ───────────────────────────────────────────────────────
do $$ begin
  if not exists (select 1 from pg_type where typname = 'route_type') then
    create type public.route_type as enum
      ('walking','cycling','driving','cultural','historical','family','accessible');
  end if;
end $$;

alter table public.destination_routes
  add column if not exists route_type            public.route_type not null default 'walking',
  add column if not exists start_location        text,
  add column if not exists end_location          text,
  add column if not exists map_url               text,
  add column if not exists polyline              text,
  add column if not exists accessibility_info    text,
  add column if not exists safety_notes          text,
  add column if not exists seasonality           text,
  add column if not exists recommended_equipment text,
  add column if not exists valid_from            timestamptz,
  add column if not exists valid_to              timestamptz,
  add column if not exists source_type           public.content_source_type not null default 'manual',
  add column if not exists source_name           text,
  add column if not exists source_url            text,
  add column if not exists imported_at           timestamptz,
  add column if not exists last_verified_at      timestamptz,
  add column if not exists verification_status   public.verification_status not null default 'unverified',
  add column if not exists rights_notes          text,
  add column if not exists featured_default      boolean not null default false,
  add column if not exists canonical_asset_id    uuid references public.assets(id) on delete set null,
  add column if not exists published_snapshot    jsonb;

do $$ begin
  if not exists (select 1 from pg_constraint where conname='destination_routes_validity_range') then
    alter table public.destination_routes add constraint destination_routes_validity_range
      check (valid_to is null or valid_from is null or valid_to >= valid_from);
  end if;
end $$;

-- ── 2. Waypoint same-destination validation ─────────────────────────────────
-- Every stop in waypoints->'stops' must reference a POI in the route's own
-- destination. Legacy routes without a `stops` array are skipped.
create or replace function platform.validate_route_waypoints()
returns trigger language plpgsql security definer set search_path = '' as $$
declare bad int;
begin
  if new.waypoints ? 'stops' and jsonb_typeof(new.waypoints->'stops') = 'array' then
    select count(*) into bad
    from jsonb_array_elements(new.waypoints->'stops') s
    where nullif(s->>'poi_id','') is not null
      and not exists (
        select 1 from public.destination_pois p
        where p.id = (s->>'poi_id')::uuid and p.destination_id = new.destination_id
      );
    if bad > 0 then
      raise exception 'route waypoint references % POI(s) not in destination %', bad, new.destination_id
        using errcode = '23514';
    end if;
  end if;
  return new;
end; $$;

drop trigger if exists trg_destination_routes_waypoints on public.destination_routes;
create trigger trg_destination_routes_waypoints
  before insert or update on public.destination_routes
  for each row execute function platform.validate_route_waypoints();

-- ── 3. Backfill existing published routes' live snapshot (waypoints untouched) ─
update public.destination_routes r
   set published_snapshot = to_jsonb(r) - 'published_snapshot'
 where r.status = 'published' and r.published_snapshot is null;

-- ── 4. RPCs ─────────────────────────────────────────────────────────────────
create or replace function public.publish_route(
  p_route uuid,
  p_change_summary text default null
) returns public.content_versions
language plpgsql volatile security definer set search_path = '' as $$
declare rt public.destination_routes; vnum int; cv public.content_versions; snap jsonb;
begin
  if not platform.is_platform_admin() then
    raise exception 'only platform_admin may publish routes' using errcode = '42501';
  end if;
  select * into rt from public.destination_routes where id = p_route;
  if rt.id is null then raise exception 'route % not found', p_route using errcode = 'P0002'; end if;

  select coalesce(max(version_number),0) + 1 into vnum
    from public.content_versions where entity_type = 'destination_route' and entity_id = p_route;

  update public.destination_routes
     set status = 'published', published_at = now(), updated_by = auth.uid()
   where id = p_route
   returning * into rt;

  snap := to_jsonb(rt) - 'published_snapshot';          -- includes ordered waypoints
  update public.destination_routes set published_snapshot = snap where id = p_route;

  insert into public.content_versions
    (entity_type, entity_id, version_number, status, snapshot, change_summary, hotel_id, published_at, created_by)
  values
    ('destination_route', p_route, vnum, 'published', snap, p_change_summary, null, now(), auth.uid())
  returning * into cv;
  return cv;
end; $$;

create or replace function public.rollback_route(
  p_route uuid,
  p_version uuid
) returns public.destination_routes
language plpgsql volatile security definer set search_path = '' as $$
declare snap jsonb; rt public.destination_routes; cvrow public.content_versions;
begin
  if not platform.is_platform_admin() then
    raise exception 'only platform_admin may roll back routes' using errcode = '42501';
  end if;
  select * into cvrow from public.content_versions
   where id = p_version and entity_type = 'destination_route' and entity_id = p_route;
  if cvrow.id is null then
    raise exception 'version % not found for route %', p_version, p_route using errcode = 'P0002';
  end if;
  snap := cvrow.snapshot;
  update public.destination_routes set
     key              = coalesce(snap->>'key', key),
     name             = coalesce(snap->>'name', name),
     route_type       = coalesce((snap->>'route_type')::public.route_type, route_type),
     short_description= snap->>'short_description',
     body_content     = case when jsonb_typeof(snap->'body_content') = 'object' then snap->'body_content' else null end,
     difficulty       = nullif(snap->>'difficulty','')::public.route_difficulty,
     distance_km      = nullif(snap->>'distance_km','')::numeric,
     duration_minutes = nullif(snap->>'duration_minutes','')::int,
     waypoints        = case when jsonb_typeof(snap->'waypoints') in ('object','array') then snap->'waypoints' else null end,  -- restores ordered stops
     start_location   = snap->>'start_location',
     end_location     = snap->>'end_location',
     map_url          = snap->>'map_url',
     polyline         = snap->>'polyline',
     accessibility_info = snap->>'accessibility_info',
     safety_notes     = snap->>'safety_notes',
     seasonality      = snap->>'seasonality',
     recommended_equipment = snap->>'recommended_equipment',
     valid_from       = nullif(snap->>'valid_from','')::timestamptz,
     valid_to         = nullif(snap->>'valid_to','')::timestamptz,
     source_type      = coalesce((snap->>'source_type')::public.content_source_type, source_type),
     source_name      = snap->>'source_name',
     source_url       = snap->>'source_url',
     last_verified_at = nullif(snap->>'last_verified_at','')::timestamptz,
     verification_status = coalesce((snap->>'verification_status')::public.verification_status, verification_status),
     rights_notes     = snap->>'rights_notes',
     featured_default = coalesce((snap->>'featured_default')::boolean, featured_default),
     canonical_asset_id = nullif(snap->>'canonical_asset_id','')::uuid,
     sort_order       = coalesce((snap->>'sort_order')::int, sort_order),
     active           = coalesce((snap->>'active')::boolean, active),
     status           = 'draft',
     updated_by       = auth.uid()
   where id = p_route
   returning * into rt;
  return rt;
end; $$;

create or replace function public.list_route_versions(p_route uuid)
returns table (
  id uuid, version_number integer, status public.content_status,
  change_summary text, created_by uuid,
  published_at timestamptz, created_at timestamptz, snapshot jsonb
)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not platform.is_platform_admin() then
    raise exception 'only platform_admin may read route history' using errcode = '42501';
  end if;
  return query
    select v.id, v.version_number, v.status, v.change_summary, v.created_by,
           v.published_at, v.created_at, v.snapshot
      from public.content_versions v
     where v.entity_type = 'destination_route' and v.entity_id = p_route
     order by v.version_number desc;
end; $$;

-- ── 5. resolved_destination_routes → serve the LIVE snapshot (row fallback) ──
create or replace function public.resolved_destination_routes(p_hotel uuid)
returns table (
  route_id uuid, key text, name text, short_description text, body_content jsonb,
  difficulty public.route_difficulty, distance_km numeric, duration_minutes integer,
  waypoints jsonb, featured boolean, sort_order integer, walking_time_minutes integer,
  hotel_recommendation text, hotel_photo_url text, hotel_short_description text,
  published_at timestamptz
)
language sql stable set search_path = '' as $$
  select r.id,
         coalesce(r.published_snapshot->>'key', r.key),
         coalesce(r.published_snapshot->>'name', r.name),
         coalesce(r.published_snapshot->>'short_description', r.short_description),
         coalesce(r.published_snapshot->'body_content', r.body_content),
         coalesce((r.published_snapshot->>'difficulty')::public.route_difficulty, r.difficulty),
         coalesce(nullif(r.published_snapshot->>'distance_km','')::numeric, r.distance_km),
         coalesce(nullif(r.published_snapshot->>'duration_minutes','')::int, r.duration_minutes),
         coalesce(r.published_snapshot->'waypoints', r.waypoints),
         coalesce(s.featured, false),
         coalesce(s.sort_order_override, (r.published_snapshot->>'sort_order')::int, r.sort_order),
         s.walking_time_minutes, s.hotel_recommendation, s.hotel_photo_url, s.hotel_short_description,
         coalesce(nullif(r.published_snapshot->>'published_at','')::timestamptz, r.published_at)
  from public.hotels h
  join public.destination_routes r on r.destination_id = h.destination_id
  left join public.hotel_route_settings s on s.hotel_id = h.id and s.route_id = r.id
  where h.id = p_hotel
    and r.status <> 'archived'
    and ( r.published_snapshot is not null or (r.status = 'published' and r.active) )
    and coalesce((r.published_snapshot->>'active')::boolean, r.active) = true
    and coalesce(s.visible, true) = true
  order by coalesce(s.sort_order_override, (r.published_snapshot->>'sort_order')::int, r.sort_order),
           coalesce(r.published_snapshot->>'name', r.name);
$$;

-- ── 6. Grants ────────────────────────────────────────────────────────────────
revoke all on function public.publish_route(uuid, text) from public, anon;
revoke all on function public.rollback_route(uuid, uuid) from public, anon;
revoke all on function public.list_route_versions(uuid) from public, anon;
grant execute on function public.publish_route(uuid, text) to authenticated, service_role;
grant execute on function public.rollback_route(uuid, uuid) to authenticated, service_role;
grant execute on function public.list_route_versions(uuid) to authenticated, service_role;
