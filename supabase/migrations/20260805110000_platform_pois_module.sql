-- ============================================================================
-- Platform CMS — POI module (Phase 3; additive, forward-only, aiolly-dev).
-- ----------------------------------------------------------------------------
-- Brings canonical destination_pois to the same Draft→Publish→Live→History→
-- Rollback→Archive workflow as Services/Knowledge/Destinations, and adds the
-- factual/provenance/verification/media fields from Architecture Parts 6/10/12.
--
-- destination_pois already has: key-per-destination UNIQUE, lat/lng CHECKs, a
-- protect-publish trigger (blocks direct status→published), an audit trigger,
-- and NO DELETE policy (archive-only). This migration only ADDS:
--   1. Canonical fields (map/website/phone/opening/accessibility/price/duration/
--      validity), provenance (source_*), verification, featured_default, and a
--      canonical media reference (canonical_asset_id → assets).
--   2. Draft/Live separation via published_snapshot (written ONLY by publish_poi).
--   3. RPCs publish_poi / rollback_poi / list_poi_versions (platform_admin only,
--      SECURITY DEFINER, empty search_path, authenticated+service_role grants).
--   4. resolved_destination_pois rewired to serve the LIVE snapshot (immutable),
--      excluding archived — so a draft edit never changes hotel-facing content
--      until publish. Existing published POIs are backfilled so nothing changes.
-- Reuses the content_source_type + verification_status enums from Phase 2.
-- No unrelated tables or RLS are redesigned.
-- ============================================================================

-- ── 1. Canonical + provenance + verification + media fields ─────────────────
alter table public.destination_pois
  add column if not exists map_url                    text,
  add column if not exists website                    text,
  add column if not exists phone                      text,
  add column if not exists opening_info               text,
  add column if not exists accessibility_info         text,
  add column if not exists price_info                 text,
  add column if not exists recommended_duration_minutes int,
  add column if not exists valid_from                 timestamptz,
  add column if not exists valid_to                   timestamptz,
  add column if not exists source_type                public.content_source_type not null default 'manual',
  add column if not exists source_name                text,
  add column if not exists source_url                 text,
  add column if not exists imported_at                timestamptz,
  add column if not exists last_verified_at           timestamptz,
  add column if not exists verification_status        public.verification_status not null default 'unverified',
  add column if not exists rights_notes               text,
  add column if not exists featured_default           boolean not null default false,
  add column if not exists canonical_asset_id         uuid references public.assets(id) on delete set null,
  add column if not exists published_snapshot         jsonb;

do $$ begin
  if not exists (select 1 from pg_constraint where conname='destination_pois_duration_nonneg') then
    alter table public.destination_pois add constraint destination_pois_duration_nonneg
      check (recommended_duration_minutes is null or recommended_duration_minutes >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname='destination_pois_validity_range') then
    alter table public.destination_pois add constraint destination_pois_validity_range
      check (valid_to is null or valid_from is null or valid_to >= valid_from);
  end if;
end $$;

-- ── 2. Backfill: existing published POIs adopt their current row as live copy ─
update public.destination_pois p
   set published_snapshot = to_jsonb(p) - 'published_snapshot'
 where p.status = 'published' and p.published_snapshot is null;

-- ── 3. RPCs ─────────────────────────────────────────────────────────────────

-- Publish: freeze the current draft as the live snapshot + immutable version.
create or replace function public.publish_poi(
  p_poi uuid,
  p_change_summary text default null
) returns public.content_versions
language plpgsql volatile security definer set search_path = '' as $$
declare poi public.destination_pois; vnum int; cv public.content_versions; snap jsonb;
begin
  if not platform.is_platform_admin() then
    raise exception 'only platform_admin may publish POIs' using errcode = '42501';
  end if;

  select * into poi from public.destination_pois where id = p_poi;
  if poi.id is null then raise exception 'POI % not found', p_poi using errcode = 'P0002'; end if;

  select coalesce(max(version_number),0) + 1 into vnum
    from public.content_versions where entity_type = 'destination_poi' and entity_id = p_poi;

  update public.destination_pois
     set status = 'published', published_at = now(), updated_by = auth.uid()
   where id = p_poi
   returning * into poi;

  snap := to_jsonb(poi) - 'published_snapshot';         -- content going live now
  update public.destination_pois set published_snapshot = snap where id = p_poi;

  insert into public.content_versions
    (entity_type, entity_id, version_number, status, snapshot, change_summary, hotel_id, published_at, created_by)
  values
    ('destination_poi', p_poi, vnum, 'published', snap, p_change_summary, null, now(), auth.uid())
  returning * into cv;

  return cv;
end; $$;

-- Rollback: restore a prior version's content into a NEW DRAFT (live untouched).
create or replace function public.rollback_poi(
  p_poi uuid,
  p_version uuid
) returns public.destination_pois
language plpgsql volatile security definer set search_path = '' as $$
declare snap jsonb; poi public.destination_pois; cvrow public.content_versions;
begin
  if not platform.is_platform_admin() then
    raise exception 'only platform_admin may roll back POIs' using errcode = '42501';
  end if;

  select * into cvrow from public.content_versions
   where id = p_version and entity_type = 'destination_poi' and entity_id = p_poi;
  if cvrow.id is null then
    raise exception 'version % not found for POI %', p_version, p_poi using errcode = 'P0002';
  end if;

  snap := cvrow.snapshot;
  update public.destination_pois set
     key              = coalesce(snap->>'key', key),
     name             = coalesce(snap->>'name', name),
     category         = coalesce((snap->>'category')::public.poi_category, category),
     short_description= snap->>'short_description',
     -- to_jsonb() encodes a NULL column as JSON null; coerce back to SQL NULL so
     -- the is_valid_service_body CHECK (NULL-or-object) is satisfied.
     body_content     = case when jsonb_typeof(snap->'body_content') = 'object' then snap->'body_content' else null end,
     address          = snap->>'address',
     latitude         = nullif(snap->>'latitude','')::numeric,
     longitude        = nullif(snap->>'longitude','')::numeric,
     map_url          = snap->>'map_url',
     website          = snap->>'website',
     phone            = snap->>'phone',
     opening_info     = snap->>'opening_info',
     accessibility_info = snap->>'accessibility_info',
     price_info       = snap->>'price_info',
     recommended_duration_minutes = nullif(snap->>'recommended_duration_minutes','')::int,
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
   where id = p_poi
   returning * into poi;

  return poi;
end; $$;

-- History (platform_admin only — hotels never read POI version history).
create or replace function public.list_poi_versions(p_poi uuid)
returns table (
  id uuid, version_number integer, status public.content_status,
  change_summary text, created_by uuid,
  published_at timestamptz, created_at timestamptz, snapshot jsonb
)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not platform.is_platform_admin() then
    raise exception 'only platform_admin may read POI history' using errcode = '42501';
  end if;
  return query
    select v.id, v.version_number, v.status, v.change_summary, v.created_by,
           v.published_at, v.created_at, v.snapshot
      from public.content_versions v
     where v.entity_type = 'destination_poi' and v.entity_id = p_poi
     order by v.version_number desc;
end; $$;

-- ── 4. resolved_destination_pois → serve the LIVE snapshot (immutable) ───────
-- Canonical facts read from published_snapshot when present, so a draft edit to a
-- published POI never reaches hotels before the next publish. Falls back to the
-- live row for POIs published before this snapshot workflow existed (and for the
-- generic publish_destination_content path). Archived POIs are excluded. Stays
-- SECURITY INVOKER so per-hotel RLS keeps it tenant-safe; hotel presentation
-- (visibility/order/recommendation/photo) is applied unchanged.
create or replace function public.resolved_destination_pois(p_hotel uuid)
returns table (
  poi_id uuid, key text, name text, category public.poi_category, short_description text,
  body_content jsonb, latitude numeric, longitude numeric, address text,
  featured boolean, sort_order integer, walking_time_minutes integer,
  hotel_recommendation text, hotel_photo_url text, hotel_short_description text,
  published_at timestamptz
)
language sql stable set search_path = '' as $$
  select p.id,
         coalesce(p.published_snapshot->>'key', p.key),
         coalesce(p.published_snapshot->>'name', p.name),
         coalesce((p.published_snapshot->>'category')::public.poi_category, p.category),
         coalesce(p.published_snapshot->>'short_description', p.short_description),
         coalesce(p.published_snapshot->'body_content', p.body_content),
         coalesce(nullif(p.published_snapshot->>'latitude','')::numeric, p.latitude),
         coalesce(nullif(p.published_snapshot->>'longitude','')::numeric, p.longitude),
         coalesce(p.published_snapshot->>'address', p.address),
         coalesce(s.featured, false),
         coalesce(s.sort_order_override, (p.published_snapshot->>'sort_order')::int, p.sort_order),
         s.walking_time_minutes, s.hotel_recommendation, s.hotel_photo_url, s.hotel_short_description,
         coalesce(nullif(p.published_snapshot->>'published_at','')::timestamptz, p.published_at)
  from public.hotels h
  join public.destination_pois p on p.destination_id = h.destination_id
  left join public.hotel_poi_settings s on s.hotel_id = h.id and s.poi_id = p.id
  where h.id = p_hotel
    and p.status <> 'archived'
    and ( p.published_snapshot is not null or (p.status = 'published' and p.active) )
    and coalesce((p.published_snapshot->>'active')::boolean, p.active) = true
    and coalesce(s.visible, true) = true
  order by coalesce(s.sort_order_override, (p.published_snapshot->>'sort_order')::int, p.sort_order),
           coalesce(p.published_snapshot->>'name', p.name);
$$;

-- ── 5. Grants: new RPCs are authenticated + service_role only (never anon) ───
revoke all on function public.publish_poi(uuid, text) from public, anon;
revoke all on function public.rollback_poi(uuid, uuid) from public, anon;
revoke all on function public.list_poi_versions(uuid) from public, anon;
grant execute on function public.publish_poi(uuid, text) to authenticated, service_role;
grant execute on function public.rollback_poi(uuid, uuid) to authenticated, service_role;
grant execute on function public.list_poi_versions(uuid) to authenticated, service_role;
