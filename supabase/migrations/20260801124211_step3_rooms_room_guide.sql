-- ============================================================================
-- AI OLLY Platform 2.0 — Migration Step 3: Rooms & Room Guide (Pattern C)
-- ----------------------------------------------------------------------------
-- room_types (shared/default room-guide content) + rooms (room-specific facts &
-- overrides) with DETERMINISTIC resolution (COALESCE override -> default -> null).
-- Column-level protection for access_token; RLS from row one. aiolly-dev only.
-- No later domains. No Airtable data. Idempotent; rebuildable via db reset.
-- ============================================================================

-- No new enums are required in Step 3: room facts are booleans (3-state nullable
-- overrides) and free text (backward-compatible with v1's rich descriptions).

-- ── room_types (Pattern C defaults) ──────────────────────────────────────────
create table if not exists public.room_types (
  id                            uuid primary key default gen_random_uuid(),
  hotel_id                      uuid not null references public.hotels(id) on delete cascade,
  name                          text not null,
  slug                          text not null,
  description                   text,
  active                        boolean not null default true,
  sort_order                    integer not null default 0,
  default_capacity              integer,
  default_bed_configuration     text,
  default_extra_bed_available   boolean,
  default_extra_bed_price_item_id uuid,          -- future FK -> price_items (deferred)
  -- Room-guide DEFAULTS — explicit columns for stable facts (deterministic + queryable):
  wifi_instructions             text,
  ac_instructions               text,
  tv_instructions               text,
  safe_instructions             text,
  smart_glass                   boolean,         -- default availability
  smart_glass_instructions      text,
  window_instructions           text,
  underfloor_heating            boolean,
  room_features                 text[],          -- list (bullet items)
  room_notes                    text[],
  ai_welcome                    text,
  minibar_available             boolean,
  kettle_available              boolean,
  blackout_system               boolean,
  toiletries                    text,
  extra_facts                   jsonb,           -- ONLY genuinely flexible/future facts
  legacy_airtable_record_id     text,
  created_at                    timestamptz not null default now(),
  updated_at                    timestamptz not null default now(),
  created_by                    uuid,
  updated_by                    uuid,
  constraint room_types_slug_per_hotel unique (hotel_id, slug),
  constraint room_types_slug_fmt check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
);
create index if not exists room_types_hotel_idx on public.room_types (hotel_id);

-- ── rooms (room-specific facts + overrides) ──────────────────────────────────
create table if not exists public.rooms (
  id                              uuid primary key default gen_random_uuid(),
  hotel_id                        uuid not null references public.hotels(id) on delete cascade,
  room_type_id                    uuid not null references public.room_types(id) on delete restrict,
  room_number                     text not null,
  access_token                    text not null,          -- SENSITIVE (see column protection)
  active                          boolean not null default true,
  floor                           smallint,
  -- Overrides (NULL = inherit from room_type; booleans are 3-state):
  capacity_override               integer,
  bed_configuration_override      text,
  view_description_override       text,
  smart_glass_override            boolean,
  smart_glass_instructions_override text,
  window_mode_override            text,
  underfloor_heating_override     boolean,
  air_conditioning_note_override  text,
  extra_bed_available_override    boolean,
  extra_bed_price_item_id         uuid,                   -- future FK -> price_items (deferred)
  room_features_override          text[],
  room_notes_override             text[],
  ai_welcome_override             text,
  legacy_airtable_record_id       text,
  created_at                      timestamptz not null default now(),
  updated_at                      timestamptz not null default now(),
  created_by                      uuid,
  updated_by                      uuid,
  constraint rooms_number_per_hotel unique (hotel_id, room_number),
  constraint rooms_access_token_unique unique (access_token),
  constraint rooms_type_same_hotel check (true)          -- enforced by trigger below (cross-table)
);
create index if not exists rooms_hotel_idx on public.rooms (hotel_id);
create index if not exists rooms_type_idx  on public.rooms (room_type_id);

create trigger trg_room_types_set_updated_at before update on public.room_types for each row execute function platform.set_updated_at();
create trigger trg_rooms_set_updated_at      before update on public.rooms      for each row execute function platform.set_updated_at();

-- ── Integrity + normalization triggers ───────────────────────────────────────

-- room_type belongs to the SAME hotel as the room (cross-table check).
create or replace function platform.check_room_type_same_hotel()
returns trigger language plpgsql as $$
declare th uuid;
begin
  select hotel_id into th from public.room_types where id = new.room_type_id;
  if th is null or th <> new.hotel_id then
    raise exception 'room_type_id % is not in hotel %', new.room_type_id, new.hotel_id using errcode = '23514';
  end if;
  return new;
end; $$;
create trigger trg_rooms_type_same_hotel before insert or update of room_type_id, hotel_id on public.rooms
  for each row execute function platform.check_room_type_same_hotel();

-- Normalize empty text/array overrides to NULL (empty = inherit, per Task 3).
create or replace function platform.normalize_room_overrides()
returns trigger language plpgsql as $$
begin
  new.view_description_override        := nullif(btrim(coalesce(new.view_description_override,'')), '');
  new.smart_glass_instructions_override:= nullif(btrim(coalesce(new.smart_glass_instructions_override,'')), '');
  new.window_mode_override             := nullif(btrim(coalesce(new.window_mode_override,'')), '');
  new.air_conditioning_note_override   := nullif(btrim(coalesce(new.air_conditioning_note_override,'')), '');
  new.bed_configuration_override       := nullif(btrim(coalesce(new.bed_configuration_override,'')), '');
  new.ai_welcome_override              := nullif(btrim(coalesce(new.ai_welcome_override,'')), '');
  if new.room_features_override is not null and array_length(new.room_features_override,1) is null then new.room_features_override := null; end if;
  if new.room_notes_override    is not null and array_length(new.room_notes_override,1)    is null then new.room_notes_override    := null; end if;
  return new;
end; $$;
create trigger trg_rooms_normalize before insert or update on public.rooms
  for each row execute function platform.normalize_room_overrides();

-- ── Column protection (structural + sensitive fields) ────────────────────────
-- Editors may change only guest-facing content overrides; hotel_admins may change
-- operational fields; only platform_admin/service may change hotel_id/access_token/legacy.
create or replace function platform.protect_room_columns()
returns trigger language plpgsql as $$
begin
  if current_user in ('service_role','postgres','supabase_admin') or platform.is_platform_admin() then
    return new; -- full control
  end if;
  -- sensitive/structural: never changeable by hotel staff via the dashboard
  new.hotel_id                  := old.hotel_id;
  new.access_token              := old.access_token;
  new.legacy_airtable_record_id := old.legacy_airtable_record_id;
  if platform.has_hotel_role(old.hotel_id, array['hotel_admin']::public.hotel_member_role[]) then
    return new; -- hotel_admin may change room_number/room_type_id/active/floor/facts
  end if;
  -- editor / other roles: only guest-facing content overrides
  new.room_number   := old.room_number;
  new.room_type_id  := old.room_type_id;
  new.active        := old.active;
  new.floor         := old.floor;
  return new;
end; $$;
create trigger trg_rooms_protect before update on public.rooms
  for each row execute function platform.protect_room_columns();

-- room_types: only platform_admin/service may change hotel_id.
create or replace function platform.protect_room_type_columns()
returns trigger language plpgsql as $$
begin
  if current_user not in ('service_role','postgres','supabase_admin') and not platform.is_platform_admin() then
    new.hotel_id := old.hotel_id;
    new.legacy_airtable_record_id := old.legacy_airtable_record_id;
  end if;
  return new;
end; $$;
create trigger trg_room_types_protect before update on public.room_types
  for each row execute function platform.protect_room_type_columns();

-- ── Resolved room context (deterministic; NO access_token) ───────────────────
-- security_invoker so the caller's RLS on rooms/room_types applies (hotel-scoped).
create or replace view public.resolved_rooms
with (security_invoker = true) as
select
  r.id                as room_id,
  r.hotel_id,
  r.room_type_id,
  r.room_number,
  r.active,
  r.floor,
  rt.name             as room_type_name,
  rt.slug             as room_type_slug,
  coalesce(r.capacity_override, rt.default_capacity)                       as capacity,
  coalesce(r.bed_configuration_override, rt.default_bed_configuration)     as bed_configuration,
  r.view_description_override                                              as view_description,
  coalesce(r.smart_glass_override, rt.smart_glass)                        as smart_glass,
  coalesce(r.smart_glass_instructions_override, rt.smart_glass_instructions) as smart_glass_instructions,
  coalesce(r.window_mode_override, rt.window_instructions)                 as window_instructions,
  coalesce(r.underfloor_heating_override, rt.underfloor_heating)           as underfloor_heating,
  coalesce(r.air_conditioning_note_override, rt.ac_instructions)           as ac_instructions,
  coalesce(r.extra_bed_available_override, rt.default_extra_bed_available)  as extra_bed_available,
  coalesce(r.room_features_override, rt.room_features)                     as room_features,
  coalesce(r.room_notes_override, rt.room_notes)                          as room_notes,
  coalesce(r.ai_welcome_override, rt.ai_welcome)                          as ai_welcome,
  rt.wifi_instructions, rt.tv_instructions, rt.safe_instructions,
  rt.minibar_available, rt.kettle_available, rt.blackout_system, rt.toiletries
from public.rooms r
join public.room_types rt on rt.id = r.room_type_id;

-- Controlled access-token retrieval (platform_admin only). service-role reads
-- the column directly; dashboard users never can (column privilege below).
create or replace function platform.get_room_access_token(room uuid)
returns text language plpgsql stable security definer set search_path = '' as $$
begin
  if not platform.is_platform_admin() then
    raise exception 'insufficient privilege to read access token' using errcode = '42501';
  end if;
  return (select access_token from public.rooms where id = room);
end; $$;

-- ── RLS + GRANTS (fail-closed; REVOKE ALL then precise GRANT) ─────────────────
alter table public.room_types enable row level security;
alter table public.rooms      enable row level security;

revoke all on public.room_types, public.rooms from public, anon, authenticated, service_role;
revoke all on public.resolved_rooms from public, anon, authenticated, service_role;

-- service_role (backend): manage room_types/rooms (archive via active; no hard delete).
grant select, insert, update on public.room_types to service_role;
grant select, insert, update on public.rooms      to service_role;
grant select on public.resolved_rooms to service_role;

-- authenticated: room_types full CRUD (RLS-gated).
grant select, insert, update, delete on public.room_types to authenticated;
-- authenticated on rooms: NO table-wide SELECT (would expose access_token). Grant
-- column-level SELECT on everything EXCEPT access_token, plus write (RLS+trigger gated).
grant select (id, hotel_id, room_type_id, room_number, active, floor,
              capacity_override, bed_configuration_override, view_description_override,
              smart_glass_override, smart_glass_instructions_override, window_mode_override,
              underfloor_heating_override, air_conditioning_note_override,
              extra_bed_available_override, extra_bed_price_item_id,
              room_features_override, room_notes_override, ai_welcome_override,
              legacy_airtable_record_id, created_at, updated_at, created_by, updated_by)
  on public.rooms to authenticated;
grant insert, update, delete on public.rooms to authenticated;
grant select on public.resolved_rooms to authenticated;

grant execute on function platform.get_room_access_token(uuid) to authenticated, service_role;

-- ROOM_TYPES policies
create policy room_types_select on public.room_types for select to authenticated
  using (platform.is_platform_admin() or platform.has_hotel_membership(hotel_id));
create policy room_types_write_ins on public.room_types for insert to authenticated
  with check (platform.is_platform_admin() or platform.has_hotel_role(hotel_id, array['hotel_admin','editor']::public.hotel_member_role[]));
create policy room_types_write_upd on public.room_types for update to authenticated
  using (platform.is_platform_admin() or platform.has_hotel_role(hotel_id, array['hotel_admin','editor']::public.hotel_member_role[]))
  with check (platform.is_platform_admin() or platform.has_hotel_role(hotel_id, array['hotel_admin','editor']::public.hotel_member_role[]));
create policy room_types_del on public.room_types for delete to authenticated
  using (platform.is_platform_admin());

-- ROOMS policies
create policy rooms_select on public.rooms for select to authenticated
  using (platform.is_platform_admin() or platform.has_hotel_membership(hotel_id));
create policy rooms_ins on public.rooms for insert to authenticated
  with check (platform.is_platform_admin() or platform.has_hotel_role(hotel_id, array['hotel_admin']::public.hotel_member_role[]));
create policy rooms_upd on public.rooms for update to authenticated
  using (platform.is_platform_admin() or platform.has_hotel_role(hotel_id, array['hotel_admin','editor']::public.hotel_member_role[]))
  with check (platform.is_platform_admin() or platform.has_hotel_role(hotel_id, array['hotel_admin','editor']::public.hotel_member_role[]));
create policy rooms_del on public.rooms for delete to authenticated
  using (platform.is_platform_admin());
