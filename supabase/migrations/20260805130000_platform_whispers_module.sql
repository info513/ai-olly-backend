-- ============================================================================
-- Platform CMS — Whispers module (Phase 5; additive, forward-only, aiolly-dev).
-- ----------------------------------------------------------------------------
-- Brings canonical destination_whispers (channel-grouped story chapters) to the
-- same Draft→Publish→Live→History→Rollback→Archive workflow as POIs/Routes, plus
-- provenance/verification/media fields. Mirrors the POI module exactly.
--
-- destination_whispers already has: key-per-destination UNIQUE, a protect-publish
-- trigger, an audit trigger, and NO DELETE policy. This migration ADDS:
--   1. short_description + provenance/verification/media fields + published_snapshot.
--   2. publish_whisper / rollback_whisper / list_whisper_versions RPCs.
--   3. resolved_destination_whispers rewired to serve the LIVE snapshot (row
--      fallback), excluding archived; stays INVOKER. Existing 12 backfilled.
-- Reuses content_source_type + verification_status enums. No unrelated redesign.
-- ============================================================================

alter table public.destination_whispers
  add column if not exists short_description   text,
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

update public.destination_whispers w
   set published_snapshot = to_jsonb(w) - 'published_snapshot'
 where w.status = 'published' and w.published_snapshot is null;

create or replace function public.publish_whisper(
  p_whisper uuid, p_change_summary text default null
) returns public.content_versions
language plpgsql volatile security definer set search_path = '' as $$
declare wh public.destination_whispers; vnum int; cv public.content_versions; snap jsonb;
begin
  if not platform.is_platform_admin() then raise exception 'only platform_admin may publish whispers' using errcode='42501'; end if;
  select * into wh from public.destination_whispers where id = p_whisper;
  if wh.id is null then raise exception 'whisper % not found', p_whisper using errcode='P0002'; end if;
  select coalesce(max(version_number),0)+1 into vnum from public.content_versions where entity_type='destination_whisper' and entity_id=p_whisper;
  update public.destination_whispers set status='published', published_at=now(), updated_by=auth.uid() where id=p_whisper returning * into wh;
  snap := to_jsonb(wh) - 'published_snapshot';
  update public.destination_whispers set published_snapshot=snap where id=p_whisper;
  insert into public.content_versions (entity_type,entity_id,version_number,status,snapshot,change_summary,hotel_id,published_at,created_by)
  values ('destination_whisper',p_whisper,vnum,'published',snap,p_change_summary,null,now(),auth.uid()) returning * into cv;
  return cv;
end; $$;

create or replace function public.rollback_whisper(
  p_whisper uuid, p_version uuid
) returns public.destination_whispers
language plpgsql volatile security definer set search_path = '' as $$
declare snap jsonb; wh public.destination_whispers; cvrow public.content_versions;
begin
  if not platform.is_platform_admin() then raise exception 'only platform_admin may roll back whispers' using errcode='42501'; end if;
  select * into cvrow from public.content_versions where id=p_version and entity_type='destination_whisper' and entity_id=p_whisper;
  if cvrow.id is null then raise exception 'version % not found for whisper %', p_version, p_whisper using errcode='P0002'; end if;
  snap := cvrow.snapshot;
  update public.destination_whispers set
     channel_key = coalesce(snap->>'channel_key', channel_key),
     key = coalesce(snap->>'key', key), title = coalesce(snap->>'title', title),
     short_description = snap->>'short_description',
     body_content = case when jsonb_typeof(snap->'body_content')='object' then snap->'body_content' else null end,
     source_type = coalesce((snap->>'source_type')::public.content_source_type, source_type),
     source_name = snap->>'source_name', source_url = snap->>'source_url',
     last_verified_at = nullif(snap->>'last_verified_at','')::timestamptz,
     verification_status = coalesce((snap->>'verification_status')::public.verification_status, verification_status),
     rights_notes = snap->>'rights_notes', featured_default = coalesce((snap->>'featured_default')::boolean, featured_default),
     canonical_asset_id = nullif(snap->>'canonical_asset_id','')::uuid,
     sort_order = coalesce((snap->>'sort_order')::int, sort_order), active = coalesce((snap->>'active')::boolean, active),
     status = 'draft', updated_by = auth.uid()
   where id = p_whisper returning * into wh;
  return wh;
end; $$;

create or replace function public.list_whisper_versions(p_whisper uuid)
returns table (id uuid, version_number integer, status public.content_status, change_summary text, created_by uuid, published_at timestamptz, created_at timestamptz, snapshot jsonb)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not platform.is_platform_admin() then raise exception 'only platform_admin may read whisper history' using errcode='42501'; end if;
  return query select v.id,v.version_number,v.status,v.change_summary,v.created_by,v.published_at,v.created_at,v.snapshot
    from public.content_versions v where v.entity_type='destination_whisper' and v.entity_id=p_whisper order by v.version_number desc;
end; $$;

create or replace function public.resolved_destination_whispers(p_hotel uuid)
returns table (whisper_id uuid, channel_key text, key text, title text, body_content jsonb, featured boolean, sort_order integer, hotel_recommendation text, published_at timestamptz)
language sql stable set search_path = '' as $$
  select w.id,
         coalesce(w.published_snapshot->>'channel_key', w.channel_key),
         coalesce(w.published_snapshot->>'key', w.key),
         coalesce(w.published_snapshot->>'title', w.title),
         coalesce(w.published_snapshot->'body_content', w.body_content),
         coalesce(s.featured, false),
         coalesce(s.sort_order_override, (w.published_snapshot->>'sort_order')::int, w.sort_order),
         s.hotel_recommendation,
         coalesce(nullif(w.published_snapshot->>'published_at','')::timestamptz, w.published_at)
  from public.hotels h
  join public.destination_whispers w on w.destination_id = h.destination_id
  left join public.hotel_whisper_settings s on s.hotel_id = h.id and s.whisper_id = w.id
  where h.id = p_hotel
    and w.status <> 'archived'
    and ( w.published_snapshot is not null or (w.status='published' and w.active) )
    and coalesce((w.published_snapshot->>'active')::boolean, w.active) = true
    and coalesce(s.visible, true) = true
  order by coalesce(w.published_snapshot->>'channel_key', w.channel_key),
           coalesce(s.sort_order_override, (w.published_snapshot->>'sort_order')::int, w.sort_order);
$$;

revoke all on function public.publish_whisper(uuid, text) from public, anon;
revoke all on function public.rollback_whisper(uuid, uuid) from public, anon;
revoke all on function public.list_whisper_versions(uuid) from public, anon;
grant execute on function public.publish_whisper(uuid, text) to authenticated, service_role;
grant execute on function public.rollback_whisper(uuid, uuid) to authenticated, service_role;
grant execute on function public.list_whisper_versions(uuid) to authenticated, service_role;
