-- ============================================================================
-- AI OLLY Platform 2.0 — Migration Step 6: Presentation Layer (Pattern B)
-- ----------------------------------------------------------------------------
-- Per-hotel PRESENTATION over canonical destination content — WITHOUT modifying
-- canonical data and WITHOUT field-level merge. Hotels control visibility,
-- featured, ordering, walking time, their own recommendation/photo/short
-- description. Deterministic resolved_destination_* functions overlay settings
-- onto canonical rows. RLS from row one. Target: aiolly-dev only. Idempotent.
-- ============================================================================

-- ── hotel_poi_settings ───────────────────────────────────────────────────────
create table if not exists public.hotel_poi_settings (
  id                       uuid primary key default gen_random_uuid(),
  hotel_id                 uuid not null references public.hotels(id) on delete cascade,
  poi_id                   uuid not null references public.destination_pois(id) on delete cascade,
  visible                  boolean not null default true,
  featured                 boolean not null default false,
  sort_order_override      integer,
  walking_time_minutes     integer,
  hotel_recommendation     text,
  hotel_photo_url          text,
  hotel_short_description  text,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  updated_by               uuid,
  constraint hotel_poi_settings_unique unique (hotel_id, poi_id),
  constraint hotel_poi_settings_walk check (walking_time_minutes is null or walking_time_minutes >= 0)
);
create index if not exists hotel_poi_settings_hotel_idx on public.hotel_poi_settings (hotel_id);

-- ── hotel_route_settings ─────────────────────────────────────────────────────
create table if not exists public.hotel_route_settings (
  id                       uuid primary key default gen_random_uuid(),
  hotel_id                 uuid not null references public.hotels(id) on delete cascade,
  route_id                 uuid not null references public.destination_routes(id) on delete cascade,
  visible                  boolean not null default true,
  featured                 boolean not null default false,
  sort_order_override      integer,
  walking_time_minutes     integer,
  hotel_recommendation     text,
  hotel_photo_url          text,
  hotel_short_description  text,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  updated_by               uuid,
  constraint hotel_route_settings_unique unique (hotel_id, route_id),
  constraint hotel_route_settings_walk check (walking_time_minutes is null or walking_time_minutes >= 0)
);
create index if not exists hotel_route_settings_hotel_idx on public.hotel_route_settings (hotel_id);

-- ── hotel_whisper_settings ───────────────────────────────────────────────────
create table if not exists public.hotel_whisper_settings (
  id                       uuid primary key default gen_random_uuid(),
  hotel_id                 uuid not null references public.hotels(id) on delete cascade,
  whisper_id               uuid not null references public.destination_whispers(id) on delete cascade,
  visible                  boolean not null default true,
  featured                 boolean not null default false,
  sort_order_override      integer,
  hotel_recommendation     text,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  updated_by               uuid,
  constraint hotel_whisper_settings_unique unique (hotel_id, whisper_id)
);
create index if not exists hotel_whisper_settings_hotel_idx on public.hotel_whisper_settings (hotel_id);

-- ── hotel_event_settings ─────────────────────────────────────────────────────
create table if not exists public.hotel_event_settings (
  id                       uuid primary key default gen_random_uuid(),
  hotel_id                 uuid not null references public.hotels(id) on delete cascade,
  event_id                 uuid not null references public.destination_events(id) on delete cascade,
  visible                  boolean not null default true,
  featured                 boolean not null default false,
  sort_order_override      integer,
  hotel_recommendation     text,
  hotel_short_description  text,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  updated_by               uuid,
  constraint hotel_event_settings_unique unique (hotel_id, event_id)
);
create index if not exists hotel_event_settings_hotel_idx on public.hotel_event_settings (hotel_id);

create trigger trg_hotel_poi_settings_set_updated_at     before update on public.hotel_poi_settings     for each row execute function platform.set_updated_at();
create trigger trg_hotel_route_settings_set_updated_at   before update on public.hotel_route_settings   for each row execute function platform.set_updated_at();
create trigger trg_hotel_whisper_settings_set_updated_at before update on public.hotel_whisper_settings for each row execute function platform.set_updated_at();
create trigger trg_hotel_event_settings_set_updated_at   before update on public.hotel_event_settings   for each row execute function platform.set_updated_at();

-- Guard: hotel presentation settings may only target content in the hotel's own
-- destination (no cross-destination leakage).
create or replace function platform.check_presentation_destination()
returns trigger language plpgsql as $$
declare hotel_dest uuid; content_dest uuid; content_tbl text; content_col text;
begin
  select destination_id into hotel_dest from public.hotels where id = new.hotel_id;
  if tg_table_name = 'hotel_poi_settings' then
    select destination_id into content_dest from public.destination_pois where id = new.poi_id;
  elsif tg_table_name = 'hotel_route_settings' then
    select destination_id into content_dest from public.destination_routes where id = new.route_id;
  elsif tg_table_name = 'hotel_whisper_settings' then
    select destination_id into content_dest from public.destination_whispers where id = new.whisper_id;
  else
    select destination_id into content_dest from public.destination_events where id = new.event_id;
  end if;
  if content_dest is null or content_dest <> hotel_dest then
    raise exception 'presentation target is not in hotel''s destination' using errcode = '23514';
  end if;
  return new;
end; $$;
create trigger trg_hotel_poi_settings_scope     before insert or update on public.hotel_poi_settings     for each row execute function platform.check_presentation_destination();
create trigger trg_hotel_route_settings_scope   before insert or update on public.hotel_route_settings   for each row execute function platform.check_presentation_destination();
create trigger trg_hotel_whisper_settings_scope before insert or update on public.hotel_whisper_settings for each row execute function platform.check_presentation_destination();
create trigger trg_hotel_event_settings_scope   before insert or update on public.hotel_event_settings   for each row execute function platform.check_presentation_destination();

-- Redacted audit (SECURITY DEFINER; shared across the 4 settings tables)
create or replace function platform.audit_presentation_settings()
returns trigger language plpgsql security definer set search_path = '' as $$
declare nj jsonb; oj jsonb; a_uid uuid; et text;
begin
  a_uid := auth.uid();
  nj := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  oj := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  et := tg_table_name;
  insert into public.audit_log
    (actor_user_id, actor_type, hotel_id, entity_type, entity_id, action, before_state, after_state, metadata)
  values
    (a_uid, case when a_uid is not null then 'user'::public.actor_type else 'service'::public.actor_type end,
     coalesce((nj->>'hotel_id'), (oj->>'hotel_id'))::uuid, et, coalesce((nj->>'id'), (oj->>'id'))::uuid,
     case when tg_op='INSERT' then 'create' when tg_op='DELETE' then 'delete' else 'update' end::public.audit_action,
     case when oj is not null then jsonb_build_object('visible',oj->>'visible','featured',oj->>'featured','sort_order_override',oj->>'sort_order_override') end,
     case when nj is not null then jsonb_build_object('visible',nj->>'visible','featured',nj->>'featured','sort_order_override',nj->>'sort_order_override') end,
     jsonb_build_object('note','presentation/pattern-b'));
  return coalesce(new, old);
end; $$;
create trigger trg_hotel_poi_settings_audit     after insert or update or delete on public.hotel_poi_settings     for each row execute function platform.audit_presentation_settings();
create trigger trg_hotel_route_settings_audit   after insert or update or delete on public.hotel_route_settings   for each row execute function platform.audit_presentation_settings();
create trigger trg_hotel_whisper_settings_audit after insert or update or delete on public.hotel_whisper_settings for each row execute function platform.audit_presentation_settings();
create trigger trg_hotel_event_settings_audit   after insert or update or delete on public.hotel_event_settings   for each row execute function platform.audit_presentation_settings();

-- ── RLS + GRANTS ─────────────────────────────────────────────────────────────
alter table public.hotel_poi_settings     enable row level security;
alter table public.hotel_route_settings   enable row level security;
alter table public.hotel_whisper_settings enable row level security;
alter table public.hotel_event_settings   enable row level security;

revoke all on public.hotel_poi_settings, public.hotel_route_settings,
              public.hotel_whisper_settings, public.hotel_event_settings
  from public, anon, authenticated, service_role;

do $$
declare t text;
begin
  foreach t in array array['hotel_poi_settings','hotel_route_settings','hotel_whisper_settings','hotel_event_settings'] loop
    execute format('grant select, insert, update, delete on public.%1$I to service_role, authenticated;', t);
    execute format($f$
      create policy %1$s_select on public.%1$I for select to authenticated
        using ( platform.is_platform_admin() or platform.has_hotel_membership(hotel_id) );
      create policy %1$s_ins on public.%1$I for insert to authenticated
        with check ( platform.is_platform_admin()
                     or platform.has_hotel_role(hotel_id, array['hotel_admin','editor']::public.hotel_member_role[]) );
      create policy %1$s_upd on public.%1$I for update to authenticated
        using ( platform.is_platform_admin()
                or platform.has_hotel_role(hotel_id, array['hotel_admin','editor']::public.hotel_member_role[]) )
        with check ( platform.is_platform_admin()
                     or platform.has_hotel_role(hotel_id, array['hotel_admin','editor']::public.hotel_member_role[]) );
      create policy %1$s_del on public.%1$I for delete to authenticated
        using ( platform.is_platform_admin()
                or platform.has_hotel_role(hotel_id, array['hotel_admin','editor']::public.hotel_member_role[]) );
    $f$, t);
  end loop;
end $$;

-- ── Resolved destination models (Pattern B; SECURITY INVOKER -> caller RLS) ───
-- Canonical fields come from destination_* (never merged/edited); presentation
-- (visible/featured/order/walking/recommendation/photo/short) overlays from the
-- hotel's settings. Only published+active canonical; hidden (visible=false) rows
-- excluded. No authoring metadata.
create or replace function public.resolved_destination_pois(p_hotel uuid)
returns table (
  poi_id uuid, key text, name text, category public.poi_category, short_description text,
  body_content jsonb, latitude numeric, longitude numeric, address text,
  featured boolean, sort_order integer, walking_time_minutes integer,
  hotel_recommendation text, hotel_photo_url text, hotel_short_description text, published_at timestamptz
) language sql stable security invoker set search_path = '' as $$
  select p.id, p.key, p.name, p.category, p.short_description, p.body_content,
         p.latitude, p.longitude, p.address,
         coalesce(s.featured, false), coalesce(s.sort_order_override, p.sort_order),
         s.walking_time_minutes, s.hotel_recommendation, s.hotel_photo_url, s.hotel_short_description,
         p.published_at
  from public.hotels h
  join public.destination_pois p on p.destination_id = h.destination_id
  left join public.hotel_poi_settings s on s.hotel_id = h.id and s.poi_id = p.id
  where h.id = p_hotel and p.status = 'published' and p.active
    and coalesce(s.visible, true) = true
  order by coalesce(s.sort_order_override, p.sort_order), p.name;
$$;

create or replace function public.resolved_destination_routes(p_hotel uuid)
returns table (
  route_id uuid, key text, name text, short_description text, body_content jsonb,
  difficulty public.route_difficulty, distance_km numeric, duration_minutes integer, waypoints jsonb,
  featured boolean, sort_order integer, walking_time_minutes integer,
  hotel_recommendation text, hotel_photo_url text, hotel_short_description text, published_at timestamptz
) language sql stable security invoker set search_path = '' as $$
  select r.id, r.key, r.name, r.short_description, r.body_content, r.difficulty,
         r.distance_km, r.duration_minutes, r.waypoints,
         coalesce(s.featured, false), coalesce(s.sort_order_override, r.sort_order),
         s.walking_time_minutes, s.hotel_recommendation, s.hotel_photo_url, s.hotel_short_description,
         r.published_at
  from public.hotels h
  join public.destination_routes r on r.destination_id = h.destination_id
  left join public.hotel_route_settings s on s.hotel_id = h.id and s.route_id = r.id
  where h.id = p_hotel and r.status = 'published' and r.active
    and coalesce(s.visible, true) = true
  order by coalesce(s.sort_order_override, r.sort_order), r.name;
$$;

create or replace function public.resolved_destination_whispers(p_hotel uuid)
returns table (
  whisper_id uuid, channel_key text, key text, title text, body_content jsonb,
  featured boolean, sort_order integer, hotel_recommendation text, published_at timestamptz
) language sql stable security invoker set search_path = '' as $$
  select w.id, w.channel_key, w.key, w.title, w.body_content,
         coalesce(s.featured, false), coalesce(s.sort_order_override, w.sort_order),
         s.hotel_recommendation, w.published_at
  from public.hotels h
  join public.destination_whispers w on w.destination_id = h.destination_id
  left join public.hotel_whisper_settings s on s.hotel_id = h.id and s.whisper_id = w.id
  where h.id = p_hotel and w.status = 'published' and w.active
    and coalesce(s.visible, true) = true
  order by w.channel_key, coalesce(s.sort_order_override, w.sort_order);
$$;

-- Events: only upcoming/ongoing (ends_at null or in the future) surface live.
create or replace function public.resolved_destination_events(p_hotel uuid)
returns table (
  event_id uuid, key text, title text, short_description text, body_content jsonb,
  starts_at timestamptz, ends_at timestamptz, all_day boolean, location_name text,
  latitude numeric, longitude numeric, recurrence text,
  featured boolean, sort_order integer, hotel_recommendation text, hotel_short_description text, published_at timestamptz
) language sql stable security invoker set search_path = '' as $$
  select e.id, e.key, e.title, e.short_description, e.body_content,
         e.starts_at, e.ends_at, e.all_day, e.location_name, e.latitude, e.longitude, e.recurrence,
         coalesce(s.featured, false), coalesce(s.sort_order_override, e.sort_order),
         s.hotel_recommendation, s.hotel_short_description, e.published_at
  from public.hotels h
  join public.destination_events e on e.destination_id = h.destination_id
  left join public.hotel_event_settings s on s.hotel_id = h.id and s.event_id = e.id
  where h.id = p_hotel and e.status = 'published' and e.active
    and coalesce(s.visible, true) = true
    and (e.ends_at is null or e.ends_at >= now())
  order by e.starts_at nulls last, coalesce(s.sort_order_override, e.sort_order);
$$;

revoke all on function
  public.resolved_destination_pois(uuid), public.resolved_destination_routes(uuid),
  public.resolved_destination_whispers(uuid), public.resolved_destination_events(uuid)
  from public;
grant execute on function
  public.resolved_destination_pois(uuid), public.resolved_destination_routes(uuid),
  public.resolved_destination_whispers(uuid), public.resolved_destination_events(uuid)
  to authenticated, service_role;
