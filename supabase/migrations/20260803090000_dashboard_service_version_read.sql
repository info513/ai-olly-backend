-- ============================================================================
-- Dashboard support: member-scoped READ of hotel_service version history.
-- ----------------------------------------------------------------------------
-- WHY (Sprint 3, explicitly reported): content_versions is intentionally closed
-- to app roles (append-only via publish RPCs; Step 1 keeps it policy-free and
-- ungranted to authenticated). The dashboard's History/rollback needs to LIST a
-- service's versions and pick one to roll back to — but there is no read path.
-- Rather than open content_versions with a policy (which would break the Step 1
-- invariant / regression), add ONE additive, read-only SECURITY DEFINER function
-- that returns a hotel service's versions to callers authorized for that service
-- (platform_admin, or any active member of the service's hotel). Nothing existing
-- is modified. aiolly-dev only. Idempotent.
-- ============================================================================

create or replace function public.list_service_versions(p_service uuid)
returns table (
  id uuid,
  version_number integer,
  status public.content_status,
  change_summary text,
  created_by uuid,
  published_at timestamptz,
  created_at timestamptz,
  snapshot jsonb
)
language plpgsql stable security definer set search_path = '' as $$
declare svc public.hotel_services;
begin
  select * into svc from public.hotel_services where id = p_service;
  if svc.id is null then return; end if;
  if not ( platform.is_platform_admin()
           or ( svc.hotel_id is not null and platform.has_hotel_membership(svc.hotel_id) ) ) then
    raise exception 'insufficient privilege to read service history' using errcode = '42501';
  end if;
  return query
    select v.id, v.version_number, v.status, v.change_summary, v.created_by, v.published_at, v.created_at, v.snapshot
    from public.content_versions v
    where v.entity_type = 'hotel_service' and v.entity_id = p_service
    order by v.version_number desc;
end; $$;

revoke all on function public.list_service_versions(uuid) from public;
grant execute on function public.list_service_versions(uuid) to authenticated, service_role;
