-- ============================================================================
-- resolved_hotel_services: snapshot with backward-compatible fallback.
-- ----------------------------------------------------------------------------
-- The Sprint-3.1 draft/live change made resolution require published_snapshot.
-- But privileged/backend inserts (seed data, backend regression suites) create
-- status='published' rows WITHOUT a snapshot. Add a safe fallback: content comes
-- from published_snapshot when present, otherwise from the live row for rows that
-- are status='published'. This keeps the Draft/Live guarantee for the real flow
-- (authenticated users can NEVER set status='published' directly — the column
-- guard forces publishing through the RPC, which always writes the snapshot; so
-- an edited-after-publish row always has a snapshot and its draft edits stay
-- hidden), while remaining compatible with direct-published rows.
--
-- Live gate: NOT archived AND (published_snapshot present OR status='published').
-- Also re-applies EXECUTE grants (create-or-replace resets them to PUBLIC).
-- aiolly-dev only. Idempotent.
-- ============================================================================

create or replace function public.resolved_hotel_services(p_hotel uuid)
returns table (
  service_id uuid, source public.service_source_type, category_id uuid, category_key text,
  category_name text, key text, title text, short_description text, body_content jsonb,
  is_critical boolean, featured boolean, sort_order integer, visible_in_pwa boolean,
  visible_in_web boolean, available_to_ai boolean, valid_from timestamptz, valid_to timestamptz,
  published_at timestamptz
)
language sql stable security invoker set search_path = '' as $$
  with pub as (
    select
      s.id, s.hotel_id,
      coalesce(s.published_snapshot, to_jsonb(s) - 'published_snapshot') as snap
    from public.hotel_services s
    where s.status <> 'archived'
      and (s.published_snapshot is not null or s.status = 'published')
      and (s.hotel_id = p_hotel or s.hotel_id is null)
  ),
  ext as (
    select
      id, hotel_id,
      (snap->>'source_type')::public.service_source_type as source,
      (snap->>'category_id')::uuid                        as category_id,
      snap->>'key'                                        as key,
      snap->>'title'                                      as title,
      snap->>'short_description'                          as short_description,
      snap->'body_content'                               as body_content,
      coalesce((snap->>'is_critical')::boolean, false)    as is_critical,
      coalesce((snap->>'active')::boolean, true)          as active,
      coalesce((snap->>'visible_in_pwa')::boolean, false)  as visible_in_pwa,
      coalesce((snap->>'visible_in_web')::boolean, false)  as visible_in_web,
      coalesce((snap->>'available_to_ai')::boolean, false) as available_to_ai,
      coalesce((snap->>'sort_order')::int, 0)             as sort_order,
      nullif(snap->>'override_of_service_id','')::uuid    as override_of,
      nullif(snap->>'valid_from','')::timestamptz         as valid_from,
      nullif(snap->>'valid_to','')::timestamptz           as valid_to,
      nullif(snap->>'published_at','')::timestamptz       as published_at
    from pub
  ),
  live as (
    select * from ext
    where active
      and (valid_from is null or valid_from <= now())
      and (valid_to   is null or valid_to   >= now())
  ),
  overridden as (select override_of as def_id from live where hotel_id = p_hotel and override_of is not null),
  hidden as (select service_id from public.hotel_service_settings where hotel_id = p_hotel and visible = false),
  chosen as (
    select l.* from live l
    where ( l.hotel_id = p_hotel or ( l.hotel_id is null and l.id not in (select def_id from overridden) ) )
      and l.id not in (select service_id from hidden)
  )
  select
    c.id, c.source, coalesce(st.category_override_id, c.category_id) as category_id, cat.key, cat.name,
    c.key, c.title, c.short_description, c.body_content, c.is_critical,
    coalesce(st.featured, false) as featured, coalesce(st.sort_order_override, c.sort_order) as sort_order,
    c.visible_in_pwa, c.visible_in_web, c.available_to_ai, c.valid_from, c.valid_to, c.published_at
  from chosen c
  left join public.hotel_service_settings st on st.hotel_id = p_hotel and st.service_id = c.id
  left join public.service_categories cat on cat.id = coalesce(st.category_override_id, c.category_id)
  order by coalesce(st.sort_order_override, c.sort_order), c.title;
$$;

revoke all on function public.resolved_hotel_services(uuid) from public, anon, authenticated, service_role;
grant execute on function public.resolved_hotel_services(uuid) to authenticated, service_role;
