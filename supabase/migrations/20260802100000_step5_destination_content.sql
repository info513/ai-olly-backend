-- ============================================================================
-- AI OLLY Platform 2.0 — Migration Step 5: Destination Content (canonical)
-- ----------------------------------------------------------------------------
-- Platform-OWNED canonical content shared across a destination's hotels:
-- destination_pois, destination_routes, destination_whispers, destination_events.
-- Hotels NEVER edit canonical content (Pattern B presentation lands in Step 6).
-- Structured JSONB block bodies (reuse platform.is_valid_service_body). Publishing
-- via a single SECURITY DEFINER function writing immutable content_versions
-- (Step 1). Redacted audit. RLS from row one. Target: aiolly-dev only.
-- Idempotent; rebuildable via `supabase db reset`.
-- ============================================================================

-- content lifecycle reuses public.content_status. Only content-shape enums here.
do $$ begin
  if not exists (select 1 from pg_type where typname = 'poi_category') then
    create type public.poi_category as enum
      ('landmark','museum','restaurant','cafe','bar','beach','shop','activity','nature','transport','nightlife','other');
  end if;
  if not exists (select 1 from pg_type where typname = 'route_difficulty') then
    create type public.route_difficulty as enum ('easy','moderate','challenging');
  end if;
end $$;

-- ── canonical POIs ───────────────────────────────────────────────────────────
create table if not exists public.destination_pois (
  id                        uuid primary key default gen_random_uuid(),
  destination_id            uuid not null references public.destinations(id) on delete cascade,
  key                       text not null,
  name                      text not null,
  category                  public.poi_category not null default 'other',
  short_description         text,
  body_content              jsonb,
  latitude                  numeric(9,6),
  longitude                 numeric(9,6),
  address                   text,
  status                    public.content_status not null default 'draft',
  active                    boolean not null default true,
  sort_order                integer not null default 0,
  published_at              timestamptz,
  legacy_airtable_record_id text,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  created_by                uuid,
  updated_by                uuid,
  constraint destination_pois_key_per_dest unique (destination_id, key),
  constraint destination_pois_key_fmt check (key ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  constraint destination_pois_body_valid check (body_content is null or platform.is_valid_service_body(body_content)),
  constraint destination_pois_lat check (latitude  is null or latitude  between -90 and 90),
  constraint destination_pois_lng check (longitude is null or longitude between -180 and 180)
);
create index if not exists destination_pois_dest_idx on public.destination_pois (destination_id);
create index if not exists destination_pois_live_idx on public.destination_pois (destination_id, status, active);

-- ── canonical Routes ─────────────────────────────────────────────────────────
create table if not exists public.destination_routes (
  id                        uuid primary key default gen_random_uuid(),
  destination_id            uuid not null references public.destinations(id) on delete cascade,
  key                       text not null,
  name                      text not null,
  short_description         text,
  body_content              jsonb,
  difficulty                public.route_difficulty,
  distance_km               numeric(6,2),
  duration_minutes          integer,
  waypoints                 jsonb,               -- ordered [{name,lat,lng}]
  status                    public.content_status not null default 'draft',
  active                    boolean not null default true,
  sort_order                integer not null default 0,
  published_at              timestamptz,
  legacy_airtable_record_id text,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  created_by                uuid,
  updated_by                uuid,
  constraint destination_routes_key_per_dest unique (destination_id, key),
  constraint destination_routes_key_fmt check (key ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  constraint destination_routes_body_valid check (body_content is null or platform.is_valid_service_body(body_content)),
  constraint destination_routes_distance check (distance_km is null or distance_km >= 0),
  constraint destination_routes_duration check (duration_minutes is null or duration_minutes >= 0)
);
create index if not exists destination_routes_dest_idx on public.destination_routes (destination_id);
create index if not exists destination_routes_live_idx on public.destination_routes (destination_id, status, active);

-- ── canonical Whispers (curated local tips; channel-keyed) ───────────────────
create table if not exists public.destination_whispers (
  id                        uuid primary key default gen_random_uuid(),
  destination_id            uuid not null references public.destinations(id) on delete cascade,
  channel_key               text not null,       -- stable machine key of the whisper channel
  key                       text not null,
  title                     text not null,
  body_content              jsonb,
  status                    public.content_status not null default 'draft',
  active                    boolean not null default true,
  sort_order                integer not null default 0,
  published_at              timestamptz,
  legacy_airtable_record_id text,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  created_by                uuid,
  updated_by                uuid,
  constraint destination_whispers_key_per_dest unique (destination_id, key),
  constraint destination_whispers_key_fmt     check (key ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  constraint destination_whispers_channel_fmt check (channel_key ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  constraint destination_whispers_body_valid  check (body_content is null or platform.is_valid_service_body(body_content))
);
create index if not exists destination_whispers_dest_idx    on public.destination_whispers (destination_id);
create index if not exists destination_whispers_channel_idx on public.destination_whispers (destination_id, channel_key);

-- ── canonical Destination Events ─────────────────────────────────────────────
create table if not exists public.destination_events (
  id                        uuid primary key default gen_random_uuid(),
  destination_id            uuid not null references public.destinations(id) on delete cascade,
  key                       text not null,
  title                     text not null,
  short_description         text,
  body_content              jsonb,
  starts_at                 timestamptz,
  ends_at                   timestamptz,
  all_day                   boolean not null default false,
  location_name             text,
  latitude                  numeric(9,6),
  longitude                 numeric(9,6),
  recurrence                text,                -- optional; null = one-off
  status                    public.content_status not null default 'draft',
  active                    boolean not null default true,
  sort_order                integer not null default 0,
  published_at              timestamptz,
  legacy_airtable_record_id text,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  created_by                uuid,
  updated_by                uuid,
  constraint destination_events_key_per_dest unique (destination_id, key),
  constraint destination_events_key_fmt  check (key ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  constraint destination_events_body_valid check (body_content is null or platform.is_valid_service_body(body_content)),
  constraint destination_events_range check (ends_at is null or starts_at is null or ends_at >= starts_at)
);
create index if not exists destination_events_dest_idx on public.destination_events (destination_id);
create index if not exists destination_events_time_idx on public.destination_events (destination_id, ends_at);

-- updated_at triggers
create trigger trg_destination_pois_set_updated_at     before update on public.destination_pois     for each row execute function platform.set_updated_at();
create trigger trg_destination_routes_set_updated_at   before update on public.destination_routes   for each row execute function platform.set_updated_at();
create trigger trg_destination_whispers_set_updated_at before update on public.destination_whispers for each row execute function platform.set_updated_at();
create trigger trg_destination_events_set_updated_at   before update on public.destination_events   for each row execute function platform.set_updated_at();

-- ── Publish guard: direct status->published forbidden (forces versioning) ─────
create or replace function platform.protect_destination_publish()
returns trigger language plpgsql as $$
begin
  if current_user not in ('postgres','supabase_admin')
     and new.status = 'published' and old.status is distinct from 'published' then
    raise exception 'direct publish is not allowed; use public.publish_destination_content()' using errcode = '42501';
  end if;
  return new;
end; $$;
create trigger trg_destination_pois_protect     before update on public.destination_pois     for each row execute function platform.protect_destination_publish();
create trigger trg_destination_routes_protect   before update on public.destination_routes   for each row execute function platform.protect_destination_publish();
create trigger trg_destination_whispers_protect before update on public.destination_whispers for each row execute function platform.protect_destination_publish();
create trigger trg_destination_events_protect   before update on public.destination_events   for each row execute function platform.protect_destination_publish();

-- ── Redacted audit (SECURITY DEFINER; shared across the 4 canonical tables) ──
create or replace function platform.audit_destination_content()
returns trigger language plpgsql security definer set search_path = '' as $$
declare nj jsonb; oj jsonb; act public.audit_action; a_uid uuid; et text;
begin
  a_uid := auth.uid();
  nj := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  oj := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  et := case tg_table_name
          when 'destination_pois'     then 'destination_poi'
          when 'destination_routes'   then 'destination_route'
          when 'destination_whispers' then 'destination_whisper'
          when 'destination_events'   then 'destination_event' end;
  if tg_op = 'INSERT' then act := 'create';
  elsif tg_op = 'DELETE' then act := 'delete';
  elsif (nj->>'status') = 'published' and (oj->>'status') is distinct from 'published' then act := 'publish';
  elsif (nj->>'status') = 'archived'  and (oj->>'status') is distinct from 'archived'  then act := 'archive';
  elsif (oj->>'status') = 'archived'  and (nj->>'status') is distinct from 'archived'  then act := 'restore';
  else act := 'update';
  end if;
  insert into public.audit_log
    (actor_user_id, actor_type, hotel_id, entity_type, entity_id, action, before_state, after_state)
  values
    (a_uid, case when a_uid is not null then 'user'::public.actor_type else 'service'::public.actor_type end,
     null, et, coalesce((nj->>'id'), (oj->>'id'))::uuid, act,
     case when oj is not null then jsonb_build_object('status',oj->>'status','active',oj->>'active','label',coalesce(oj->>'name',oj->>'title'),'sort_order',oj->>'sort_order') end,
     case when nj is not null then jsonb_build_object('status',nj->>'status','active',nj->>'active','label',coalesce(nj->>'name',nj->>'title'),'sort_order',nj->>'sort_order') end);
  return coalesce(new, old);
end; $$;
create trigger trg_destination_pois_audit     after insert or update or delete on public.destination_pois     for each row execute function platform.audit_destination_content();
create trigger trg_destination_routes_audit   after insert or update or delete on public.destination_routes   for each row execute function platform.audit_destination_content();
create trigger trg_destination_whispers_audit after insert or update or delete on public.destination_whispers for each row execute function platform.audit_destination_content();
create trigger trg_destination_events_audit   after insert or update or delete on public.destination_events   for each row execute function platform.audit_destination_content();

-- ── Publishing (public RPC; SECURITY DEFINER; platform_admin only) ───────────
-- Destination content is platform-owned: only platform_admin may publish. Flips
-- status->published, stamps published_at, writes an immutable content_versions
-- snapshot. Dynamic table by validated entity_type (no injection: whitelisted).
create or replace function public.publish_destination_content(
  p_entity_type text,
  p_entity_id uuid,
  p_change_summary text default null
) returns public.content_versions
language plpgsql volatile security definer set search_path = '' as $$
declare tbl text; snap jsonb; vnum int; cv public.content_versions;
begin
  if not platform.is_platform_admin() then
    raise exception 'only platform_admin may publish destination content' using errcode = '42501';
  end if;
  tbl := case p_entity_type
           when 'destination_poi'     then 'destination_pois'
           when 'destination_route'   then 'destination_routes'
           when 'destination_whisper' then 'destination_whispers'
           when 'destination_event'   then 'destination_events'
           else null end;
  if tbl is null then raise exception 'unknown destination entity_type %', p_entity_type using errcode = '22023'; end if;

  execute format(
    'update public.%1$I t set status = ''published'', published_at = now(), updated_by = auth.uid()
       where id = $1 returning to_jsonb(t.*)', tbl)
    into snap using p_entity_id;
  if snap is null then raise exception '% % not found', p_entity_type, p_entity_id using errcode = 'P0002'; end if;

  select coalesce(max(version_number),0) + 1 into vnum
    from public.content_versions where entity_type = p_entity_type and entity_id = p_entity_id;
  insert into public.content_versions
    (entity_type, entity_id, version_number, status, snapshot, change_summary, hotel_id, published_at, created_by)
  values
    (p_entity_type, p_entity_id, vnum, 'published', snap, p_change_summary, null, now(), auth.uid())
  returning * into cv;
  return cv;
end; $$;
revoke all on function public.publish_destination_content(text, uuid, text) from public;
grant execute on function public.publish_destination_content(text, uuid, text) to authenticated, service_role;

-- ── RLS + GRANTS (fail-closed; REVOKE ALL then precise GRANT) ─────────────────
-- Canonical content: hotel members READ published+active for destinations they
-- can access; only platform_admin writes. No hard delete (archive via status).
alter table public.destination_pois     enable row level security;
alter table public.destination_routes   enable row level security;
alter table public.destination_whispers enable row level security;
alter table public.destination_events   enable row level security;

revoke all on public.destination_pois, public.destination_routes,
              public.destination_whispers, public.destination_events
  from public, anon, authenticated, service_role;

grant select, insert, update on public.destination_pois     to service_role;
grant select, insert, update on public.destination_routes   to service_role;
grant select, insert, update on public.destination_whispers to service_role;
grant select, insert, update on public.destination_events   to service_role;
grant select, insert, update on public.destination_pois     to authenticated;
grant select, insert, update on public.destination_routes   to authenticated;
grant select, insert, update on public.destination_whispers to authenticated;
grant select, insert, update on public.destination_events   to authenticated;

do $$
declare t text;
begin
  foreach t in array array['destination_pois','destination_routes','destination_whispers','destination_events'] loop
    execute format($f$
      create policy %1$s_select on public.%1$I for select to authenticated
        using ( platform.is_platform_admin()
                or (status = 'published' and active and platform.has_destination_access(destination_id)) );
      create policy %1$s_ins on public.%1$I for insert to authenticated
        with check ( platform.is_platform_admin() );
      create policy %1$s_upd on public.%1$I for update to authenticated
        using ( platform.is_platform_admin() ) with check ( platform.is_platform_admin() );
    $f$, t);
  end loop;
end $$;
