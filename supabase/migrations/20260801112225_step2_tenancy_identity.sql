-- ============================================================================
-- AI OLLY Platform 2.0 — Migration Step 2: Tenancy & Identity
-- ----------------------------------------------------------------------------
-- Objects: enums; destinations, hotel_groups, hotels, profiles,
-- hotel_memberships; tenant helper functions; RLS + least-privilege grants;
-- cross-cutting FKs (content_versions/audit_log/retention_policies -> hotels).
-- Target: aiolly-dev only. RLS from row one. No later-domain tables.
-- Idempotent; rebuildable via `supabase db reset`.
-- ============================================================================

-- ── 0) Prevent Supabase default privileges from over-granting FUTURE public tables
-- (the Step 1 finding). Applies to tables created by `postgres` after this point.
alter default privileges for role postgres in schema public
  revoke all on tables from anon, authenticated, service_role;

-- ── 1) ENUMS ─────────────────────────────────────────────────────────────────
do $$ begin
  if not exists (select 1 from pg_type where typname = 'hotel_member_role') then
    create type public.hotel_member_role as enum ('hotel_admin','reception','editor','marketing','read_only');
  end if;
  if not exists (select 1 from pg_type where typname = 'membership_status') then
    create type public.membership_status as enum ('invited','active','suspended','removed');
  end if;
  if not exists (select 1 from pg_type where typname = 'hotel_status') then
    create type public.hotel_status as enum ('setup','active','suspended','archived');
  end if;
  if not exists (select 1 from pg_type where typname = 'hotel_group_status') then
    create type public.hotel_group_status as enum ('active','archived');
  end if;
  if not exists (select 1 from pg_type where typname = 'destination_status') then
    create type public.destination_status as enum ('active','archived');
  end if;
end $$;

-- ── 2) TABLES ────────────────────────────────────────────────────────────────

create table if not exists public.destinations (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  slug           text not null unique,
  country_code   text,
  timezone       text not null,
  default_locale text not null default 'en',
  status         public.destination_status not null default 'active',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  created_by     uuid,
  updated_by     uuid,
  constraint destinations_country_iso check (country_code is null or country_code ~ '^[A-Z]{2}$'),
  constraint destinations_locale_fmt  check (default_locale ~ '^[a-z]{2}(-[a-z]{2})?$')
);

create table if not exists public.hotel_groups (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  slug       text not null unique,
  status     public.hotel_group_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid
);

create table if not exists public.hotels (
  id                uuid primary key default gen_random_uuid(),
  hotel_group_id    uuid references public.hotel_groups(id) on delete set null,
  destination_id    uuid not null references public.destinations(id) on delete restrict,
  name              text not null,
  slug              text not null unique,                 -- globally unique (backward-compat)
  status            public.hotel_status not null default 'setup',
  timezone          text not null,
  default_locale    text not null default 'en',
  currency          text not null default 'EUR',
  country_code      text,
  address_line      text,
  city              text,
  postal_code       text,
  reception_phone   text,
  reception_mobile  text,
  reception_email   text,
  check_in_time     time,
  check_out_time    time,
  legacy_airtable_id text,                                -- nullable; future mapping
  settings          jsonb,                                -- flexible/future config ONLY (not core facts)
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  created_by        uuid,
  updated_by        uuid,
  constraint hotels_currency_iso check (currency ~ '^[A-Z]{3}$'),
  constraint hotels_country_iso  check (country_code is null or country_code ~ '^[A-Z]{2}$'),
  constraint hotels_locale_fmt   check (default_locale ~ '^[a-z]{2}(-[a-z]{2})?$')
);
create index if not exists hotels_destination_idx on public.hotels (destination_id);
create index if not exists hotels_group_idx       on public.hotels (hotel_group_id);

create table if not exists public.profiles (
  user_id          uuid primary key references auth.users(id) on delete cascade,
  display_name     text,
  email            text,                                  -- snapshot for display without joining auth
  is_platform_admin boolean not null default false,
  active           boolean not null default true,
  last_login_at    timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create table if not exists public.hotel_memberships (
  id          uuid primary key default gen_random_uuid(),
  hotel_id    uuid not null references public.hotels(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  role        public.hotel_member_role not null,
  status      public.membership_status not null default 'invited',
  invited_by  uuid,
  invited_at  timestamptz,
  accepted_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint hotel_memberships_unique unique (hotel_id, user_id)
);
create index if not exists memberships_user_idx  on public.hotel_memberships (user_id);
create index if not exists memberships_hotel_idx on public.hotel_memberships (hotel_id);
create index if not exists memberships_active_idx on public.hotel_memberships (hotel_id, user_id) where status = 'active';

-- updated_at triggers
create trigger trg_destinations_set_updated_at   before update on public.destinations       for each row execute function platform.set_updated_at();
create trigger trg_hotel_groups_set_updated_at   before update on public.hotel_groups        for each row execute function platform.set_updated_at();
create trigger trg_hotels_set_updated_at         before update on public.hotels              for each row execute function platform.set_updated_at();
create trigger trg_profiles_set_updated_at       before update on public.profiles            for each row execute function platform.set_updated_at();
create trigger trg_memberships_set_updated_at    before update on public.hotel_memberships   for each row execute function platform.set_updated_at();

-- ── 3) GUARD TRIGGERS (privileged-column protection; not SECURITY DEFINER) ────

-- profiles: only the service/backend role may change is_platform_admin or active.
create or replace function platform.protect_profile_privileged_columns()
returns trigger language plpgsql as $$
begin
  if current_user not in ('service_role','postgres','supabase_admin') then
    new.is_platform_admin := old.is_platform_admin;
    new.active            := old.active;
  end if;
  return new;
end; $$;
create trigger trg_profiles_protect before update on public.profiles
  for each row execute function platform.protect_profile_privileged_columns();

-- hotels: non-admin (hotel_admin) callers may not change platform-level columns.
create or replace function platform.protect_hotel_privileged_columns()
returns trigger language plpgsql as $$
begin
  if current_user not in ('service_role','postgres','supabase_admin')
     and not platform.is_platform_admin() then
    new.slug           := old.slug;
    new.destination_id := old.destination_id;
    new.hotel_group_id := old.hotel_group_id;
    new.status         := old.status;
  end if;
  return new;
end; $$;
create trigger trg_hotels_protect before update on public.hotels
  for each row execute function platform.protect_hotel_privileged_columns();

-- memberships: prevent removing/demoting/suspending the LAST active hotel_admin.
create or replace function platform.protect_last_hotel_admin()
returns trigger language plpgsql as $$
declare remaining int;
begin
  if (tg_op = 'DELETE' and old.role = 'hotel_admin' and old.status = 'active')
     or (tg_op = 'UPDATE' and old.role = 'hotel_admin' and old.status = 'active'
         and (new.role <> 'hotel_admin' or new.status <> 'active')) then
    select count(*) into remaining
      from public.hotel_memberships
      where hotel_id = old.hotel_id and role = 'hotel_admin' and status = 'active'
        and id <> old.id;
    if remaining = 0 then
      raise exception 'Cannot remove the last active hotel_admin for hotel %', old.hotel_id
        using errcode = '23514';
    end if;
  end if;
  return coalesce(new, old);
end; $$;
create trigger trg_memberships_last_admin before update or delete on public.hotel_memberships
  for each row execute function platform.protect_last_hotel_admin();

-- ── 4) TENANT HELPER FUNCTIONS (SECURITY DEFINER — read-only, no escalation) ──
-- SECURITY DEFINER so RLS policies can call them WITHOUT re-triggering RLS on the
-- underlying tables (avoids recursion). They only READ status for the CURRENT
-- auth.uid(); hotel_uuid comes from the row being checked, never trusted alone.
-- search_path='' + schema-qualified; STABLE; no writes.

create or replace function platform.is_platform_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles
    where user_id = auth.uid() and is_platform_admin = true and active = true
  );
$$;

create or replace function platform.has_hotel_membership(hotel_uuid uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.hotel_memberships
    where hotel_id = hotel_uuid and user_id = auth.uid() and status = 'active'
  );
$$;

create or replace function platform.has_hotel_role(hotel_uuid uuid, allowed public.hotel_member_role[])
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.hotel_memberships
    where hotel_id = hotel_uuid and user_id = auth.uid()
      and status = 'active' and role = any(allowed)
  );
$$;

create or replace function platform.has_destination_access(dest_uuid uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.hotels h
    join public.hotel_memberships m on m.hotel_id = h.id
    where h.destination_id = dest_uuid and m.user_id = auth.uid() and m.status = 'active'
  );
$$;

create or replace function platform.has_group_access(group_uuid uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.hotels h
    join public.hotel_memberships m on m.hotel_id = h.id
    where h.hotel_group_id = group_uuid and m.user_id = auth.uid() and m.status = 'active'
  );
$$;

revoke all on function
  platform.is_platform_admin(),
  platform.has_hotel_membership(uuid),
  platform.has_hotel_role(uuid, public.hotel_member_role[]),
  platform.has_destination_access(uuid),
  platform.has_group_access(uuid)
  from public;
grant execute on function
  platform.is_platform_admin(),
  platform.has_hotel_membership(uuid),
  platform.has_hotel_role(uuid, public.hotel_member_role[]),
  platform.has_destination_access(uuid),
  platform.has_group_access(uuid)
  to authenticated, service_role;

-- ── 5) RLS + GRANTS (fail-closed; REVOKE ALL then precise GRANT) ──────────────

alter table public.destinations      enable row level security;
alter table public.hotel_groups      enable row level security;
alter table public.hotels            enable row level security;
alter table public.profiles          enable row level security;
alter table public.hotel_memberships enable row level security;

revoke all on public.destinations, public.hotel_groups, public.hotels,
              public.profiles, public.hotel_memberships
  from public, anon, authenticated, service_role;

-- service_role: backend least privilege (archive via status; no destructive DELETE
-- except memberships which are genuinely removable).
grant select, insert, update on public.destinations      to service_role;
grant select, insert, update on public.hotel_groups      to service_role;
grant select, insert, update on public.hotels            to service_role;
grant select, insert, update on public.profiles          to service_role;
grant select, insert, update, delete on public.hotel_memberships to service_role;

-- authenticated: coarse grants; RLS is the real gate.
grant select, insert, update, delete on public.destinations      to authenticated;
grant select, insert, update, delete on public.hotel_groups      to authenticated;
grant select, insert, update, delete on public.hotels            to authenticated;
grant select, update                 on public.profiles          to authenticated;  -- created by backend; self read/update
grant select, insert, update, delete on public.hotel_memberships to authenticated;

-- DESTINATIONS policies
create policy destinations_select on public.destinations for select to authenticated
  using (platform.is_platform_admin() or platform.has_destination_access(id));
create policy destinations_admin_ins on public.destinations for insert to authenticated
  with check (platform.is_platform_admin());
create policy destinations_admin_upd on public.destinations for update to authenticated
  using (platform.is_platform_admin()) with check (platform.is_platform_admin());
create policy destinations_admin_del on public.destinations for delete to authenticated
  using (platform.is_platform_admin());

-- HOTEL_GROUPS policies
create policy groups_select on public.hotel_groups for select to authenticated
  using (platform.is_platform_admin() or platform.has_group_access(id));
create policy groups_admin_ins on public.hotel_groups for insert to authenticated
  with check (platform.is_platform_admin());
create policy groups_admin_upd on public.hotel_groups for update to authenticated
  using (platform.is_platform_admin()) with check (platform.is_platform_admin());
create policy groups_admin_del on public.hotel_groups for delete to authenticated
  using (platform.is_platform_admin());

-- HOTELS policies
create policy hotels_select on public.hotels for select to authenticated
  using (platform.is_platform_admin() or platform.has_hotel_membership(id));
create policy hotels_admin_ins on public.hotels for insert to authenticated
  with check (platform.is_platform_admin());
create policy hotels_update on public.hotels for update to authenticated
  using (platform.is_platform_admin() or platform.has_hotel_role(id, array['hotel_admin']::public.hotel_member_role[]))
  with check (platform.is_platform_admin() or platform.has_hotel_role(id, array['hotel_admin']::public.hotel_member_role[]));
create policy hotels_admin_del on public.hotels for delete to authenticated
  using (platform.is_platform_admin());

-- PROFILES policies
create policy profiles_select on public.profiles for select to authenticated
  using (user_id = auth.uid() or platform.is_platform_admin());
create policy profiles_update_self on public.profiles for update to authenticated
  using (user_id = auth.uid() or platform.is_platform_admin())
  with check (user_id = auth.uid() or platform.is_platform_admin());
-- (INSERT/DELETE not granted to authenticated: profiles are created by the backend
--  and removed via auth.users cascade. Privileged columns protected by trigger.)

-- HOTEL_MEMBERSHIPS policies
create policy memberships_select on public.hotel_memberships for select to authenticated
  using (user_id = auth.uid()
         or platform.is_platform_admin()
         or platform.has_hotel_role(hotel_id, array['hotel_admin']::public.hotel_member_role[]));
create policy memberships_admin_ins on public.hotel_memberships for insert to authenticated
  with check (platform.is_platform_admin()
              or platform.has_hotel_role(hotel_id, array['hotel_admin']::public.hotel_member_role[]));
create policy memberships_admin_upd on public.hotel_memberships for update to authenticated
  using (platform.is_platform_admin()
         or platform.has_hotel_role(hotel_id, array['hotel_admin']::public.hotel_member_role[]))
  with check (platform.is_platform_admin()
              or platform.has_hotel_role(hotel_id, array['hotel_admin']::public.hotel_member_role[]));
create policy memberships_admin_del on public.hotel_memberships for delete to authenticated
  using (platform.is_platform_admin()
         or platform.has_hotel_role(hotel_id, array['hotel_admin']::public.hotel_member_role[]));

-- ── 6) CROSS-CUTTING INTEGRATION (add hotel_id FK; keep nullable + protections) ─
alter table public.content_versions
  add constraint content_versions_hotel_fk foreign key (hotel_id) references public.hotels(id) on delete set null;
create index if not exists content_versions_hotel_idx on public.content_versions (hotel_id);

alter table public.audit_log
  add constraint audit_log_hotel_fk foreign key (hotel_id) references public.hotels(id) on delete set null;

alter table public.retention_policies
  add constraint retention_policies_hotel_fk foreign key (hotel_id) references public.hotels(id) on delete set null;
-- (translations/content_versions RLS stays closed — service-role only — until a later phase.)
