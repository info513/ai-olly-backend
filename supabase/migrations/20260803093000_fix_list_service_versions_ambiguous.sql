-- ============================================================================
-- Fix: ambiguous "id" in list_service_versions.
-- ----------------------------------------------------------------------------
-- The RETURNS TABLE output column `id` shadowed the hotel_services.id column in
-- the authorization lookup, raising "column reference id is ambiguous". Qualify
-- the lookup with a table alias. aiolly-dev only. Idempotent.
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
  select hs.* into svc from public.hotel_services hs where hs.id = p_service;
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
