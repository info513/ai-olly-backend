-- ============================================================================
-- Draft/Live separation for Hotel Services (production hardening, Sprint 3.1).
-- ----------------------------------------------------------------------------
-- DEFECT: resolved_hotel_services read guest-facing content from the LIVE,
-- MUTABLE hotel_services row. So editing a published service and saving changed
-- what guests see immediately — there was no separation between the working
-- draft and the published/live copy. Publishing did create an immutable
-- content_versions snapshot, but the resolved view never used it.
--
-- FIX (additive, non-breaking):
--   • Add a nullable `published_snapshot jsonb` to hotel_services holding the
--     CURRENTLY-LIVE content. It is written ONLY by publish_hotel_service.
--   • resolved_hotel_services now sources all guest-facing content from
--     published_snapshot (immutable), and a service is LIVE iff it has a
--     published_snapshot AND its live row is not archived. Draft edits to the
--     row no longer affect guests.
--   • rollback_hotel_service is unchanged — it restores content into the DRAFT
--     row and does NOT touch published_snapshot, so guests keep seeing the last
--     published version until the rollback is itself published.
--   • Existing published services are backfilled (their current content becomes
--     the live snapshot) so nothing disappears from guests.
-- Signatures of publish_hotel_service / resolved_hotel_services are unchanged.
-- aiolly-dev only. Idempotent.
-- ============================================================================

alter table public.hotel_services add column if not exists published_snapshot jsonb;

-- Backfill: any already-published service adopts its current content as the live
-- snapshot (so the switch to snapshot-sourced resolution is invisible to guests).
update public.hotel_services
   set published_snapshot = to_jsonb(hotel_services.*) - 'published_snapshot'
 where status = 'published' and published_snapshot is null;

-- ── publish now records the live snapshot alongside the immutable version ─────
create or replace function public.publish_hotel_service(
  p_service uuid,
  p_change_summary text default null,
  p_acknowledge_critical boolean default false
) returns public.content_versions
language plpgsql volatile security definer set search_path = '' as $$
declare svc public.hotel_services; vnum int; cv public.content_versions; snap jsonb;
begin
  select * into svc from public.hotel_services where id = p_service;
  if svc.id is null then raise exception 'service % not found', p_service using errcode = 'P0002'; end if;

  if not ( platform.is_platform_admin()
           or ( svc.hotel_id is not null
                and platform.has_hotel_role(svc.hotel_id, array['hotel_admin','editor']::public.hotel_member_role[]) ) ) then
    raise exception 'insufficient privilege to publish service %', p_service using errcode = '42501';
  end if;

  if svc.is_critical and not p_acknowledge_critical then
    raise exception 'service % is critical; explicit acknowledgement required to publish', p_service using errcode = 'P0001';
  end if;

  select coalesce(max(version_number),0) + 1 into vnum
    from public.content_versions where entity_type = 'hotel_service' and entity_id = p_service;

  update public.hotel_services
     set status = 'published',
         published_at = now(),
         last_critical_ack_at = case when svc.is_critical then now() else last_critical_ack_at end,
         last_critical_ack_by = case when svc.is_critical then auth.uid() else last_critical_ack_by end,
         updated_by = auth.uid()
   where id = p_service
   returning * into svc;

  snap := to_jsonb(svc) - 'published_snapshot';        -- the content going live now
  update public.hotel_services set published_snapshot = snap where id = p_service;

  insert into public.content_versions
    (entity_type, entity_id, version_number, status, snapshot, change_summary, hotel_id, published_at, created_by)
  values
    ('hotel_service', p_service, vnum, 'published', snap, p_change_summary, svc.hotel_id, now(), auth.uid())
  returning * into cv;

  return cv;
end; $$;

-- ── resolved services now come from the LIVE snapshot (immutable), not the draft ─
create or replace function public.resolved_hotel_services(p_hotel uuid)
returns table (
  service_id       uuid,
  source           public.service_source_type,
  category_id      uuid,
  category_key     text,
  category_name    text,
  key              text,
  title            text,
  short_description text,
  body_content     jsonb,
  is_critical      boolean,
  featured         boolean,
  sort_order       integer,
  visible_in_pwa   boolean,
  visible_in_web   boolean,
  available_to_ai  boolean,
  valid_from       timestamptz,
  valid_to         timestamptz,
  published_at     timestamptz
)
language sql stable security invoker set search_path = '' as $$
  with pub as (
    -- currently-LIVE services: a published snapshot exists and the row is not archived.
    -- Content is read from the snapshot (immutable); draft edits to the row are ignored.
    select
      s.id,
      s.hotel_id,
      (s.published_snapshot->>'source_type')::public.service_source_type as source,
      (s.published_snapshot->>'category_id')::uuid                        as category_id,
      s.published_snapshot->>'key'                                        as key,
      s.published_snapshot->>'title'                                      as title,
      s.published_snapshot->>'short_description'                          as short_description,
      s.published_snapshot->'body_content'                               as body_content,
      coalesce((s.published_snapshot->>'is_critical')::boolean, false)   as is_critical,
      coalesce((s.published_snapshot->>'active')::boolean, true)         as active,
      coalesce((s.published_snapshot->>'visible_in_pwa')::boolean, false)  as visible_in_pwa,
      coalesce((s.published_snapshot->>'visible_in_web')::boolean, false)  as visible_in_web,
      coalesce((s.published_snapshot->>'available_to_ai')::boolean, false) as available_to_ai,
      coalesce((s.published_snapshot->>'sort_order')::int, 0)            as sort_order,
      nullif(s.published_snapshot->>'override_of_service_id','')::uuid   as override_of,
      nullif(s.published_snapshot->>'valid_from','')::timestamptz        as valid_from,
      nullif(s.published_snapshot->>'valid_to','')::timestamptz          as valid_to,
      nullif(s.published_snapshot->>'published_at','')::timestamptz      as published_at
    from public.hotel_services s
    where s.published_snapshot is not null
      and s.status <> 'archived'
      and (s.hotel_id = p_hotel or s.hotel_id is null)
  ),
  live as (
    select * from pub
    where active
      and (valid_from is null or valid_from <= now())
      and (valid_to   is null or valid_to   >= now())
  ),
  overridden as (
    select override_of as def_id from live where hotel_id = p_hotel and override_of is not null
  ),
  hidden as (
    select service_id from public.hotel_service_settings where hotel_id = p_hotel and visible = false
  ),
  chosen as (
    select l.* from live l
    where ( l.hotel_id = p_hotel
            or ( l.hotel_id is null and l.id not in (select def_id from overridden) ) )
      and l.id not in (select service_id from hidden)
  )
  select
    c.id,
    c.source,
    coalesce(st.category_override_id, c.category_id)                 as category_id,
    cat.key, cat.name,
    c.key, c.title, c.short_description, c.body_content, c.is_critical,
    coalesce(st.featured, false)                                    as featured,
    coalesce(st.sort_order_override, c.sort_order)                  as sort_order,
    c.visible_in_pwa, c.visible_in_web, c.available_to_ai,
    c.valid_from, c.valid_to, c.published_at
  from chosen c
  left join public.hotel_service_settings st on st.hotel_id = p_hotel and st.service_id = c.id
  left join public.service_categories cat on cat.id = coalesce(st.category_override_id, c.category_id)
  order by coalesce(st.sort_order_override, c.sort_order), c.title;
$$;
