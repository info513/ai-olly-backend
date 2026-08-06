-- ============================================================================
-- Platform CMS — Events module (Phase 6; additive, forward-only, aiolly-dev).
-- ----------------------------------------------------------------------------
-- Brings canonical destination_events (dated events) to the Draft→Publish→Live→
-- History→Rollback→Archive workflow, plus provenance/verification/media fields.
-- Mirrors POIs; destination_events already has dates/location/coords/recurrence.
-- resolved_destination_events keeps its expiry filter (ended events excluded).
-- Reuses content_source_type + verification_status enums. No unrelated redesign.
-- ============================================================================

alter table public.destination_events
  add column if not exists source_type         public.content_source_type not null default 'manual',
  add column if not exists source_name         text,
  add column if not exists source_url          text,
  add column if not exists imported_at         timestamptz,
  add column if not exists last_verified_at    timestamptz,
  add column if not exists verification_status public.verification_status not null default 'unverified',
  add column if not exists rights_notes        text,
  add column if not exists featured_default    boolean not null default false,
  add column if not exists canonical_asset_id  uuid references public.assets(id) on delete set null,
  add column if not exists published_snapshot  jsonb;

update public.destination_events e
   set published_snapshot = to_jsonb(e) - 'published_snapshot'
 where e.status = 'published' and e.published_snapshot is null;

create or replace function public.publish_event(
  p_event uuid, p_change_summary text default null
) returns public.content_versions
language plpgsql volatile security definer set search_path = '' as $$
declare ev public.destination_events; vnum int; cv public.content_versions; snap jsonb;
begin
  if not platform.is_platform_admin() then raise exception 'only platform_admin may publish events' using errcode='42501'; end if;
  select * into ev from public.destination_events where id = p_event;
  if ev.id is null then raise exception 'event % not found', p_event using errcode='P0002'; end if;
  select coalesce(max(version_number),0)+1 into vnum from public.content_versions where entity_type='destination_event' and entity_id=p_event;
  update public.destination_events set status='published', published_at=now(), updated_by=auth.uid() where id=p_event returning * into ev;
  snap := to_jsonb(ev) - 'published_snapshot';
  update public.destination_events set published_snapshot=snap where id=p_event;
  insert into public.content_versions (entity_type,entity_id,version_number,status,snapshot,change_summary,hotel_id,published_at,created_by)
  values ('destination_event',p_event,vnum,'published',snap,p_change_summary,null,now(),auth.uid()) returning * into cv;
  return cv;
end; $$;

create or replace function public.rollback_event(
  p_event uuid, p_version uuid
) returns public.destination_events
language plpgsql volatile security definer set search_path = '' as $$
declare snap jsonb; ev public.destination_events; cvrow public.content_versions;
begin
  if not platform.is_platform_admin() then raise exception 'only platform_admin may roll back events' using errcode='42501'; end if;
  select * into cvrow from public.content_versions where id=p_version and entity_type='destination_event' and entity_id=p_event;
  if cvrow.id is null then raise exception 'version % not found for event %', p_version, p_event using errcode='P0002'; end if;
  snap := cvrow.snapshot;
  update public.destination_events set
     key = coalesce(snap->>'key', key), title = coalesce(snap->>'title', title),
     short_description = snap->>'short_description',
     body_content = case when jsonb_typeof(snap->'body_content')='object' then snap->'body_content' else null end,
     starts_at = nullif(snap->>'starts_at','')::timestamptz, ends_at = nullif(snap->>'ends_at','')::timestamptz,
     all_day = coalesce((snap->>'all_day')::boolean, all_day), location_name = snap->>'location_name',
     latitude = nullif(snap->>'latitude','')::numeric, longitude = nullif(snap->>'longitude','')::numeric,
     recurrence = snap->>'recurrence',
     source_type = coalesce((snap->>'source_type')::public.content_source_type, source_type),
     source_name = snap->>'source_name', source_url = snap->>'source_url',
     last_verified_at = nullif(snap->>'last_verified_at','')::timestamptz,
     verification_status = coalesce((snap->>'verification_status')::public.verification_status, verification_status),
     rights_notes = snap->>'rights_notes', featured_default = coalesce((snap->>'featured_default')::boolean, featured_default),
     canonical_asset_id = nullif(snap->>'canonical_asset_id','')::uuid,
     sort_order = coalesce((snap->>'sort_order')::int, sort_order), active = coalesce((snap->>'active')::boolean, active),
     status = 'draft', updated_by = auth.uid()
   where id = p_event returning * into ev;
  return ev;
end; $$;

create or replace function public.list_event_versions(p_event uuid)
returns table (id uuid, version_number integer, status public.content_status, change_summary text, created_by uuid, published_at timestamptz, created_at timestamptz, snapshot jsonb)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not platform.is_platform_admin() then raise exception 'only platform_admin may read event history' using errcode='42501'; end if;
  return query select v.id,v.version_number,v.status,v.change_summary,v.created_by,v.published_at,v.created_at,v.snapshot
    from public.content_versions v where v.entity_type='destination_event' and v.entity_id=p_event order by v.version_number desc;
end; $$;

-- Serve the LIVE snapshot (row fallback), exclude archived, keep the expiry filter.
create or replace function public.resolved_destination_events(p_hotel uuid)
returns table (event_id uuid, key text, title text, short_description text, body_content jsonb, starts_at timestamptz, ends_at timestamptz, all_day boolean, location_name text, latitude numeric, longitude numeric, recurrence text, featured boolean, sort_order integer, hotel_recommendation text, hotel_short_description text, published_at timestamptz)
language sql stable set search_path = '' as $$
  select e.id,
         coalesce(e.published_snapshot->>'key', e.key),
         coalesce(e.published_snapshot->>'title', e.title),
         coalesce(e.published_snapshot->>'short_description', e.short_description),
         coalesce(e.published_snapshot->'body_content', e.body_content),
         coalesce(nullif(e.published_snapshot->>'starts_at','')::timestamptz, e.starts_at),
         coalesce(nullif(e.published_snapshot->>'ends_at','')::timestamptz, e.ends_at),
         coalesce((e.published_snapshot->>'all_day')::boolean, e.all_day),
         coalesce(e.published_snapshot->>'location_name', e.location_name),
         coalesce(nullif(e.published_snapshot->>'latitude','')::numeric, e.latitude),
         coalesce(nullif(e.published_snapshot->>'longitude','')::numeric, e.longitude),
         coalesce(e.published_snapshot->>'recurrence', e.recurrence),
         coalesce(s.featured, false),
         coalesce(s.sort_order_override, (e.published_snapshot->>'sort_order')::int, e.sort_order),
         s.hotel_recommendation, s.hotel_short_description,
         coalesce(nullif(e.published_snapshot->>'published_at','')::timestamptz, e.published_at)
  from public.hotels h
  join public.destination_events e on e.destination_id = h.destination_id
  left join public.hotel_event_settings s on s.hotel_id = h.id and s.event_id = e.id
  where h.id = p_hotel
    and e.status <> 'archived'
    and ( e.published_snapshot is not null or (e.status='published' and e.active) )
    and coalesce((e.published_snapshot->>'active')::boolean, e.active) = true
    and coalesce(s.visible, true) = true
    and (coalesce(nullif(e.published_snapshot->>'ends_at','')::timestamptz, e.ends_at) is null
         or coalesce(nullif(e.published_snapshot->>'ends_at','')::timestamptz, e.ends_at) >= now())
  order by coalesce(nullif(e.published_snapshot->>'starts_at','')::timestamptz, e.starts_at) nulls last,
           coalesce(s.sort_order_override, (e.published_snapshot->>'sort_order')::int, e.sort_order);
$$;

revoke all on function public.publish_event(uuid, text) from public, anon;
revoke all on function public.rollback_event(uuid, uuid) from public, anon;
revoke all on function public.list_event_versions(uuid) from public, anon;
grant execute on function public.publish_event(uuid, text) to authenticated, service_role;
grant execute on function public.rollback_event(uuid, uuid) to authenticated, service_role;
grant execute on function public.list_event_versions(uuid) to authenticated, service_role;
