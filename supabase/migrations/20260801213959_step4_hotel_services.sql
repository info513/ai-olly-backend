-- ============================================================================
-- AI OLLY Platform 2.0 — Migration Step 4: Hotel Services & Operational Content
-- ----------------------------------------------------------------------------
-- Objects: service_source_type enum; service_categories, hotel_services,
-- hotel_service_settings; structured JSONB body validation; Pattern A platform
-- default -> hotel override resolution; publishing/versioning via SECURITY
-- DEFINER functions writing content_versions (Step 1); redacted audit triggers;
-- deterministic resolved_hotel_services(hotel) function; RLS from row one;
-- least-privilege grants. Target: aiolly-dev only. No later domains. No Airtable
-- data. Idempotent; rebuildable via `supabase db reset`.
-- ============================================================================

-- content lifecycle reuses public.content_status (draft/preview/published/archived)
-- from Step 1 — no new status enum. Only the service ORIGIN needs an enum.
do $$ begin
  if not exists (select 1 from pg_type where typname = 'service_source_type') then
    create type public.service_source_type as enum ('platform','hotel','override');
  end if;
end $$;

-- ── Structured body-content validator ────────────────────────────────────────
-- Canonical content is a typed BLOCK document (never raw HTML). Shape:
--   { "version": 1, "blocks": [ {"type":"paragraph","text":"..."}, ... ] }
-- Allowed block types: paragraph, heading, bullet_list, price_list, callout,
-- link, contact_action, divider. The renderer later converts blocks -> HTML.
create or replace function platform.is_valid_service_body(b jsonb)
returns boolean language sql immutable set search_path = '' as $$
  select jsonb_typeof(b) = 'object'
     and jsonb_typeof(b->'blocks') = 'array'
     and not exists (
       select 1 from jsonb_array_elements(b->'blocks') e
       where jsonb_typeof(e) <> 'object'
          or not (e ? 'type')
          or (e->>'type') not in
             ('paragraph','heading','bullet_list','price_list','callout','link','contact_action','divider')
     );
$$;

-- ── has-any-active-membership helper (SECURITY DEFINER — read-only) ───────────
create or replace function platform.has_any_membership()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.hotel_memberships
    where user_id = auth.uid() and status = 'active'
  );
$$;
revoke all on function platform.has_any_membership() from public;
grant execute on function platform.has_any_membership() to authenticated, service_role;

-- ── service_categories ───────────────────────────────────────────────────────
-- hotel_id NULL = platform default category; hotel_id set = hotel-specific
-- category or complete override (no field-level merge; Task 1).
create table if not exists public.service_categories (
  id                        uuid primary key default gen_random_uuid(),
  hotel_id                  uuid references public.hotels(id) on delete cascade,
  key                       text not null,
  name                      text not null,
  description               text,
  icon_key                  text,
  sort_order                integer not null default 0,
  active                    boolean not null default true,
  legacy_airtable_record_id text,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  created_by                uuid,
  updated_by                uuid,
  constraint service_categories_key_fmt check (key ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
);
-- key unique per SCOPE (platform-default scope vs each hotel scope).
create unique index if not exists service_categories_key_platform
  on public.service_categories (key) where hotel_id is null;
create unique index if not exists service_categories_key_hotel
  on public.service_categories (hotel_id, key) where hotel_id is not null;
create index if not exists service_categories_hotel_idx on public.service_categories (hotel_id);

-- ── hotel_services ───────────────────────────────────────────────────────────
-- Pattern A: hotel_id NULL = platform default; hotel_id set with
-- override_of_service_id -> a complete hotel override of a platform default.
create table if not exists public.hotel_services (
  id                        uuid primary key default gen_random_uuid(),
  hotel_id                  uuid references public.hotels(id) on delete cascade,
  category_id               uuid not null references public.service_categories(id) on delete restrict,
  key                       text not null,
  title                     text not null,
  short_description         text,
  body_content              jsonb,                     -- structured blocks (validated)
  status                    public.content_status not null default 'draft',
  active                    boolean not null default true,
  visible_in_pwa            boolean not null default true,
  visible_in_web            boolean not null default false,
  available_to_ai           boolean not null default true,
  sort_order                integer not null default 0,
  is_critical               boolean not null default false,
  source_type               public.service_source_type not null default 'hotel',  -- derived by trigger
  override_of_service_id    uuid references public.hotel_services(id) on delete set null,
  published_at              timestamptz,               -- server-controlled (publish fn)
  valid_from                timestamptz,               -- null = no start bound (permanent)
  valid_to                  timestamptz,               -- null = no end bound (evergreen)
  last_critical_ack_at      timestamptz,               -- set by publish fn on critical publish
  last_critical_ack_by      uuid,
  legacy_airtable_record_id text,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  created_by                uuid,
  updated_by                uuid,
  constraint hotel_services_body_valid check (body_content is null or platform.is_valid_service_body(body_content)),
  constraint hotel_services_valid_range check (valid_to is null or valid_from is null or valid_to >= valid_from),
  constraint hotel_services_key_fmt check (key ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
);
create unique index if not exists hotel_services_key_platform
  on public.hotel_services (key) where hotel_id is null;
create unique index if not exists hotel_services_key_hotel
  on public.hotel_services (hotel_id, key) where hotel_id is not null;
create index if not exists hotel_services_hotel_idx    on public.hotel_services (hotel_id);
create index if not exists hotel_services_category_idx on public.hotel_services (category_id);
create index if not exists hotel_services_override_idx on public.hotel_services (override_of_service_id);
create index if not exists hotel_services_live_idx     on public.hotel_services (hotel_id, status, active);

-- ── hotel_service_settings (presentation only; NO content override) ──────────
-- Justified: lets a hotel hide an inherited platform default, re-order, mark
-- featured, or re-categorize WITHOUT cloning the whole service record (Task 6).
create table if not exists public.hotel_service_settings (
  id                   uuid primary key default gen_random_uuid(),
  hotel_id             uuid not null references public.hotels(id) on delete cascade,
  service_id           uuid not null references public.hotel_services(id) on delete cascade,
  visible              boolean not null default true,    -- false = hide inherited/native for this hotel
  featured             boolean not null default false,
  sort_order_override  integer,
  category_override_id uuid references public.service_categories(id) on delete set null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  updated_by           uuid,
  constraint hotel_service_settings_unique unique (hotel_id, service_id)
);
create index if not exists hotel_service_settings_hotel_idx   on public.hotel_service_settings (hotel_id);
create index if not exists hotel_service_settings_service_idx on public.hotel_service_settings (service_id);

-- updated_at triggers
create trigger trg_service_categories_set_updated_at      before update on public.service_categories      for each row execute function platform.set_updated_at();
create trigger trg_hotel_services_set_updated_at          before update on public.hotel_services          for each row execute function platform.set_updated_at();
create trigger trg_hotel_service_settings_set_updated_at  before update on public.hotel_service_settings  for each row execute function platform.set_updated_at();

-- ── Integrity + normalization ────────────────────────────────────────────────
-- Derive source_type deterministically; normalize blank short_description.
create or replace function platform.normalize_hotel_service()
returns trigger language plpgsql as $$
begin
  new.source_type := case
    when new.hotel_id is null then 'platform'::public.service_source_type
    when new.override_of_service_id is not null then 'override'::public.service_source_type
    else 'hotel'::public.service_source_type end;
  new.short_description := nullif(btrim(coalesce(new.short_description,'')), '');
  return new;
end; $$;
create trigger trg_hotel_services_normalize before insert or update on public.hotel_services
  for each row execute function platform.normalize_hotel_service();

-- Category scope + override-target integrity (cross-row).
create or replace function platform.check_service_relations()
returns trigger language plpgsql as $$
declare cat_hotel uuid; ov_hotel uuid;
begin
  select hotel_id into cat_hotel from public.service_categories where id = new.category_id;
  if not found then
    raise exception 'category % not found', new.category_id using errcode = '23503';
  end if;
  -- a hotel service may use a platform category (null) or its OWN hotel's category
  if cat_hotel is not null and new.hotel_id is not null and cat_hotel <> new.hotel_id then
    raise exception 'category % is not in hotel %', new.category_id, new.hotel_id using errcode = '23514';
  end if;
  -- a platform-default service must use a platform category
  if new.hotel_id is null and cat_hotel is not null then
    raise exception 'platform-default service must use a platform (null-hotel) category' using errcode = '23514';
  end if;
  -- override target must be a PLATFORM default, and only hotel-scoped services may override
  if new.override_of_service_id is not null then
    if new.hotel_id is null then
      raise exception 'a platform-default service cannot be an override' using errcode = '23514';
    end if;
    select hotel_id into ov_hotel from public.hotel_services where id = new.override_of_service_id;
    if ov_hotel is not null then
      raise exception 'override target % must be a platform default (null hotel_id)', new.override_of_service_id using errcode = '23514';
    end if;
  end if;
  return new;
end; $$;
create trigger trg_hotel_services_relations before insert or update on public.hotel_services
  for each row execute function platform.check_service_relations();

-- settings: service_id and category_override must be same-hotel/platform-scoped.
create or replace function platform.check_service_settings_scope()
returns trigger language plpgsql as $$
declare svc_hotel uuid; cat_hotel uuid;
begin
  select hotel_id into svc_hotel from public.hotel_services where id = new.service_id;
  if not found then raise exception 'service % not found', new.service_id using errcode = '23503'; end if;
  -- settings may target the hotel's own services OR platform defaults it inherits
  if svc_hotel is not null and svc_hotel <> new.hotel_id then
    raise exception 'service % is neither a platform default nor in hotel %', new.service_id, new.hotel_id using errcode = '23514';
  end if;
  if new.category_override_id is not null then
    select hotel_id into cat_hotel from public.service_categories where id = new.category_override_id;
    if cat_hotel is not null and cat_hotel <> new.hotel_id then
      raise exception 'category_override % is not in hotel %', new.category_override_id, new.hotel_id using errcode = '23514';
    end if;
  end if;
  return new;
end; $$;
create trigger trg_service_settings_scope before insert or update on public.hotel_service_settings
  for each row execute function platform.check_service_settings_scope();

-- ── Column protection (tenancy/link/server-controlled fields) ────────────────
create or replace function platform.protect_service_category_columns()
returns trigger language plpgsql as $$
begin
  if current_user in ('service_role','postgres','supabase_admin') or platform.is_platform_admin() then
    return new;
  end if;
  new.hotel_id                  := old.hotel_id;
  new.key                       := old.key;
  new.legacy_airtable_record_id := old.legacy_airtable_record_id;
  new.created_by                := old.created_by;
  return new;
end; $$;
create trigger trg_service_categories_protect before update on public.service_categories
  for each row execute function platform.protect_service_category_columns();

create or replace function platform.protect_hotel_service_columns()
returns trigger language plpgsql as $$
begin
  if current_user in ('service_role','postgres','supabase_admin') or platform.is_platform_admin() then
    return new; -- backend / migrations / platform_admin: full control (publish fn runs here)
  end if;
  -- tenancy / linkage / server-controlled fields: never editable by hotel staff
  new.hotel_id                  := old.hotel_id;
  new.override_of_service_id    := old.override_of_service_id;
  new.legacy_airtable_record_id := old.legacy_airtable_record_id;
  new.created_by                := old.created_by;
  new.key                       := old.key;                      -- machine key stable after create
  new.published_at              := old.published_at;             -- only the publish fn sets this
  new.last_critical_ack_at      := old.last_critical_ack_at;
  new.last_critical_ack_by      := old.last_critical_ack_by;
  -- publishing must go through platform.publish_hotel_service() (which creates a version)
  if new.status = 'published' and old.status is distinct from 'published' then
    raise exception 'direct publish is not allowed; use platform.publish_hotel_service()' using errcode = '42501';
  end if;
  -- marking a service critical is a hotel_admin decision (editors cannot toggle)
  if not platform.has_hotel_role(old.hotel_id, array['hotel_admin']::public.hotel_member_role[]) then
    new.is_critical := old.is_critical;
  end if;
  return new;
end; $$;
create trigger trg_hotel_services_protect before update on public.hotel_services
  for each row execute function platform.protect_hotel_service_columns();

-- ── Redacted audit triggers (SECURITY DEFINER; append to Step 1 audit_log) ───
create or replace function platform.audit_hotel_service()
returns trigger language plpgsql security definer set search_path = '' as $$
declare act public.audit_action; a_uid uuid; a_type public.actor_type;
begin
  a_uid  := auth.uid();
  a_type := case when a_uid is not null then 'user'::public.actor_type else 'service'::public.actor_type end;
  if tg_op = 'INSERT' then act := 'create';
  elsif tg_op = 'DELETE' then act := 'delete';
  elsif new.status = 'published' and old.status is distinct from 'published' then act := 'publish';
  elsif new.status = 'archived'  and old.status is distinct from 'archived'  then act := 'archive';
  elsif old.status = 'archived'  and new.status is distinct from 'archived'  then act := 'restore';
  else act := 'update';
  end if;
  insert into public.audit_log
    (actor_user_id, actor_type, hotel_id, entity_type, entity_id, action, before_state, after_state, metadata)
  values
    (a_uid, a_type, coalesce(new.hotel_id, old.hotel_id), 'hotel_service', coalesce(new.id, old.id), act,
     case when tg_op <> 'INSERT' then jsonb_build_object(
       'status',old.status,'title',old.title,'is_critical',old.is_critical,'active',old.active,
       'visible_in_pwa',old.visible_in_pwa,'visible_in_web',old.visible_in_web,'available_to_ai',old.available_to_ai,
       'category_id',old.category_id,'sort_order',old.sort_order,'valid_from',old.valid_from,'valid_to',old.valid_to) end,
     case when tg_op <> 'DELETE' then jsonb_build_object(
       'status',new.status,'title',new.title,'is_critical',new.is_critical,'active',new.active,
       'visible_in_pwa',new.visible_in_pwa,'visible_in_web',new.visible_in_web,'available_to_ai',new.available_to_ai,
       'category_id',new.category_id,'sort_order',new.sort_order,'valid_from',new.valid_from,'valid_to',new.valid_to) end,
     jsonb_build_object('source_type', coalesce(new.source_type, old.source_type),
                        'critical_ack', (tg_op <> 'INSERT' and new.last_critical_ack_at is distinct from old.last_critical_ack_at)));
  return coalesce(new, old);
end; $$;
create trigger trg_hotel_services_audit after insert or update or delete on public.hotel_services
  for each row execute function platform.audit_hotel_service();

create or replace function platform.audit_service_category()
returns trigger language plpgsql security definer set search_path = '' as $$
declare a_uid uuid;
begin
  a_uid := auth.uid();
  insert into public.audit_log
    (actor_user_id, actor_type, hotel_id, entity_type, entity_id, action, before_state, after_state)
  values
    (a_uid, case when a_uid is not null then 'user'::public.actor_type else 'service'::public.actor_type end,
     coalesce(new.hotel_id, old.hotel_id), 'service_category', coalesce(new.id, old.id),
     case when tg_op='INSERT' then 'create' when tg_op='DELETE' then 'delete' else 'update' end::public.audit_action,
     case when tg_op<>'INSERT' then jsonb_build_object('key',old.key,'name',old.name,'active',old.active,'sort_order',old.sort_order) end,
     case when tg_op<>'DELETE' then jsonb_build_object('key',new.key,'name',new.name,'active',new.active,'sort_order',new.sort_order) end);
  return coalesce(new, old);
end; $$;
create trigger trg_service_categories_audit after insert or update or delete on public.service_categories
  for each row execute function platform.audit_service_category();

create or replace function platform.audit_service_settings()
returns trigger language plpgsql security definer set search_path = '' as $$
declare a_uid uuid;
begin
  a_uid := auth.uid();
  insert into public.audit_log
    (actor_user_id, actor_type, hotel_id, entity_type, entity_id, action, before_state, after_state, metadata)
  values
    (a_uid, case when a_uid is not null then 'user'::public.actor_type else 'service'::public.actor_type end,
     coalesce(new.hotel_id, old.hotel_id), 'hotel_service_settings', coalesce(new.service_id, old.service_id),
     case when tg_op='INSERT' then 'create' when tg_op='DELETE' then 'delete' else 'update' end::public.audit_action,
     case when tg_op<>'INSERT' then jsonb_build_object('visible',old.visible,'featured',old.featured,'sort_order_override',old.sort_order_override) end,
     case when tg_op<>'DELETE' then jsonb_build_object('visible',new.visible,'featured',new.featured,'sort_order_override',new.sort_order_override) end,
     jsonb_build_object('note','visibility/presentation'));
  return coalesce(new, old);
end; $$;
create trigger trg_hotel_service_settings_audit after insert or update or delete on public.hotel_service_settings
  for each row execute function platform.audit_service_settings();

-- ── Publishing lifecycle (SECURITY DEFINER) ──────────────────────────────────
-- Only publish path: flips status->published, stamps published_at, requires
-- explicit acknowledgement for critical content, and writes an IMMUTABLE
-- content_versions snapshot (Step 1). Authorized: platform_admin (any),
-- hotel_admin/editor (own hotel). No one may silently publish critical content.
create or replace function platform.publish_hotel_service(
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
create or replace function platform.rollback_hotel_service(p_service uuid, p_version uuid)
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
  platform.publish_hotel_service(uuid, text, boolean),
  platform.rollback_hotel_service(uuid, uuid)
  from public;
grant execute on function
  platform.publish_hotel_service(uuid, text, boolean),
  platform.rollback_hotel_service(uuid, uuid)
  to authenticated, service_role;

-- ── Deterministic resolved service model for a hotel (Pattern A) ─────────────
-- Returns the LIVE service set a hotel presents: published + active + within
-- validity window; hotel override wins over the platform default it overrides;
-- platform defaults that are overridden OR hidden (settings.visible=false) are
-- excluded; native/override rows hidden via settings are excluded; presentation
-- (featured, sort, category) resolved from hotel_service_settings. No authoring
-- metadata. SECURITY INVOKER — the caller's RLS on hotel_services still applies.
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
  with live as (
    select s.* from public.hotel_services s
    where s.status = 'published' and s.active
      and (s.valid_from is null or s.valid_from <= now())
      and (s.valid_to   is null or s.valid_to   >= now())
      and (s.hotel_id = p_hotel or s.hotel_id is null)
  ),
  overridden as (   -- platform defaults replaced by an active hotel override
    select override_of_service_id as def_id from live
    where hotel_id = p_hotel and override_of_service_id is not null
  ),
  hidden as (       -- services hidden for this hotel via presentation settings
    select service_id from public.hotel_service_settings
    where hotel_id = p_hotel and visible = false
  ),
  chosen as (
    select l.* from live l
    where ( l.hotel_id = p_hotel                                   -- hotel-native + overrides
            or ( l.hotel_id is null                                -- platform default, not replaced
                 and l.id not in (select def_id from overridden) ) )
      and l.id not in (select service_id from hidden)
  )
  select
    c.id,
    c.source_type,
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
revoke all on function public.resolved_hotel_services(uuid) from public;
grant execute on function public.resolved_hotel_services(uuid) to authenticated, service_role;

-- ── RLS + GRANTS (fail-closed; REVOKE ALL then precise GRANT) ─────────────────
alter table public.service_categories     enable row level security;
alter table public.hotel_services         enable row level security;
alter table public.hotel_service_settings enable row level security;

revoke all on public.service_categories, public.hotel_services, public.hotel_service_settings
  from public, anon, authenticated, service_role;

-- service_role (Render backend): manage content; archive via status (no hard delete).
grant select, insert, update on public.service_categories     to service_role;
grant select, insert, update on public.hotel_services         to service_role;
grant select, insert, update, delete on public.hotel_service_settings to service_role;

-- authenticated: NO delete on categories/services (archive instead, Task 8); RLS gates writes.
grant select, insert, update on public.service_categories     to authenticated;
grant select, insert, update on public.hotel_services         to authenticated;
grant select, insert, update, delete on public.hotel_service_settings to authenticated;

-- SERVICE_CATEGORIES policies
create policy service_categories_select on public.service_categories for select to authenticated
  using ( platform.is_platform_admin()
          or (hotel_id is not null and platform.has_hotel_membership(hotel_id))
          or (hotel_id is null and active and platform.has_any_membership()) );
create policy service_categories_ins on public.service_categories for insert to authenticated
  with check ( (hotel_id is null and platform.is_platform_admin())
               or (hotel_id is not null and (platform.is_platform_admin()
                     or platform.has_hotel_role(hotel_id, array['hotel_admin','editor']::public.hotel_member_role[]))) );
create policy service_categories_upd on public.service_categories for update to authenticated
  using ( (hotel_id is null and platform.is_platform_admin())
          or (hotel_id is not null and (platform.is_platform_admin()
                or platform.has_hotel_role(hotel_id, array['hotel_admin','editor']::public.hotel_member_role[]))) )
  with check ( (hotel_id is null and platform.is_platform_admin())
               or (hotel_id is not null and (platform.is_platform_admin()
                     or platform.has_hotel_role(hotel_id, array['hotel_admin','editor']::public.hotel_member_role[]))) );
-- (no DELETE policy: categories are deactivated via `active`, not deleted)

-- HOTEL_SERVICES policies
-- authors (platform_admin, hotel_admin, editor) see ALL statuses of their scope;
-- other members (reception/marketing/read_only) see PUBLISHED only; members see
-- published platform defaults. anon / no-membership / suspended: nothing.
create policy hotel_services_select on public.hotel_services for select to authenticated
  using ( platform.is_platform_admin()
          or (hotel_id is not null
              and platform.has_hotel_role(hotel_id, array['hotel_admin','editor']::public.hotel_member_role[]))
          or (hotel_id is not null and status = 'published'
              and platform.has_hotel_membership(hotel_id))
          or (hotel_id is null and status = 'published' and active
              and platform.has_any_membership()) );
create policy hotel_services_ins on public.hotel_services for insert to authenticated
  with check ( (hotel_id is null and platform.is_platform_admin())
               or (hotel_id is not null and (platform.is_platform_admin()
                     or platform.has_hotel_role(hotel_id, array['hotel_admin','editor']::public.hotel_member_role[]))) );
create policy hotel_services_upd on public.hotel_services for update to authenticated
  using ( platform.is_platform_admin()
          or (hotel_id is not null
              and platform.has_hotel_role(hotel_id, array['hotel_admin','editor']::public.hotel_member_role[])) )
  with check ( platform.is_platform_admin()
               or (hotel_id is not null
                   and platform.has_hotel_role(hotel_id, array['hotel_admin','editor']::public.hotel_member_role[])) );
-- (no DELETE policy: services are archived via status, never hard-deleted by staff)

-- HOTEL_SERVICE_SETTINGS policies (presentation; hotel_admin/editor manage)
create policy hss_select on public.hotel_service_settings for select to authenticated
  using ( platform.is_platform_admin() or platform.has_hotel_membership(hotel_id) );
create policy hss_ins on public.hotel_service_settings for insert to authenticated
  with check ( platform.is_platform_admin()
               or platform.has_hotel_role(hotel_id, array['hotel_admin','editor']::public.hotel_member_role[]) );
create policy hss_upd on public.hotel_service_settings for update to authenticated
  using ( platform.is_platform_admin()
          or platform.has_hotel_role(hotel_id, array['hotel_admin','editor']::public.hotel_member_role[]) )
  with check ( platform.is_platform_admin()
               or platform.has_hotel_role(hotel_id, array['hotel_admin','editor']::public.hotel_member_role[]) );
create policy hss_del on public.hotel_service_settings for delete to authenticated
  using ( platform.is_platform_admin()
          or platform.has_hotel_role(hotel_id, array['hotel_admin','editor']::public.hotel_member_role[]) );
