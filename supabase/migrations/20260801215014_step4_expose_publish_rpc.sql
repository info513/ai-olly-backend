-- ============================================================================
-- Fix: expose the service publish/rollback primitives via PostgREST.
-- ----------------------------------------------------------------------------
-- FINDING: functions in the private `platform` schema are NOT reachable through
-- PostgREST rpc (only `public`/`graphql_public` are exposed in config.toml), so
-- the dashboard (authenticated) could not call publish/rollback. Move them to
-- `public` (still SECURITY DEFINER, still authz-guarded internally). anon has no
-- EXECUTE grant, so PostgREST denies anonymous callers. Forward-only + idempotent.
-- ============================================================================

drop function if exists platform.publish_hotel_service(uuid, text, boolean);
drop function if exists platform.rollback_hotel_service(uuid, uuid);

-- Publishing lifecycle (public RPC; SECURITY DEFINER). Only publish path: flips
-- status->published, stamps published_at, requires explicit acknowledgement for
-- critical content, writes an IMMUTABLE content_versions snapshot (Step 1).
-- Authorized: platform_admin (any), hotel_admin/editor (own hotel).
create or replace function public.publish_hotel_service(
  p_service uuid,
  p_change_summary text default null,
  p_acknowledge_critical boolean default false
) returns public.content_versions
language plpgsql volatile security definer set search_path = '' as $$
declare svc public.hotel_services; vnum int; cv public.content_versions;
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

  insert into public.content_versions
    (entity_type, entity_id, version_number, status, snapshot, change_summary, hotel_id, published_at, created_by)
  values
    ('hotel_service', p_service, vnum, 'published', to_jsonb(svc), p_change_summary, svc.hotel_id, now(), auth.uid())
  returning * into cv;

  return cv;
end; $$;

-- Rollback: load a previous snapshot into the CURRENT record as a new DRAFT.
-- Historical versions are never mutated; a NEW version is created only on the
-- next publish. Authorized identically to publish.
create or replace function public.rollback_hotel_service(p_service uuid, p_version uuid)
returns public.hotel_services
language plpgsql volatile security definer set search_path = '' as $$
declare snap jsonb; svc public.hotel_services; cvrow public.content_versions;
begin
  select * into cvrow from public.content_versions
    where id = p_version and entity_type = 'hotel_service' and entity_id = p_service;
  if cvrow.id is null then raise exception 'version % not found for service %', p_version, p_service using errcode = 'P0002'; end if;
  select * into svc from public.hotel_services where id = p_service;
  if not ( platform.is_platform_admin()
           or ( svc.hotel_id is not null
                and platform.has_hotel_role(svc.hotel_id, array['hotel_admin','editor']::public.hotel_member_role[]) ) ) then
    raise exception 'insufficient privilege to roll back service %', p_service using errcode = '42501';
  end if;
  snap := cvrow.snapshot;
  update public.hotel_services set
     title             = coalesce(snap->>'title', title),
     short_description = snap->>'short_description',
     body_content      = snap->'body_content',
     sort_order        = coalesce((snap->>'sort_order')::int, sort_order),
     visible_in_pwa    = coalesce((snap->>'visible_in_pwa')::boolean, visible_in_pwa),
     visible_in_web    = coalesce((snap->>'visible_in_web')::boolean, visible_in_web),
     available_to_ai   = coalesce((snap->>'available_to_ai')::boolean, available_to_ai),
     valid_from        = nullif(snap->>'valid_from','')::timestamptz,
     valid_to          = nullif(snap->>'valid_to','')::timestamptz,
     status            = 'draft',
     updated_by        = auth.uid()
   where id = p_service
   returning * into svc;
  return svc;
end; $$;

revoke all on function
  public.publish_hotel_service(uuid, text, boolean),
  public.rollback_hotel_service(uuid, uuid)
  from public;
grant execute on function
  public.publish_hotel_service(uuid, text, boolean),
  public.rollback_hotel_service(uuid, uuid)
  to authenticated, service_role;
