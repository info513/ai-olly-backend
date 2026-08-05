-- ============================================================================
-- Platform CMS — Destinations module (Phase 2; additive, forward-only, aiolly-dev).
-- ----------------------------------------------------------------------------
-- Makes the canonical `destinations` record a first-class CMS entity with the
-- same Draft → Publish → Live → History → Rollback + Archive workflow the rest
-- of the platform uses (Services/Knowledge/Newsletter), plus provenance and
-- verification fields from Architecture Parts 6/9/10/12.
--
-- What this migration does (all idempotent):
--   1. New enums: destination_type, content_source_type, verification_status.
--   2. Migrate destinations.status  destination_status(active|archived)
--      -> content_status(draft|preview|published|archived). Existing 'active'
--      rows become 'published' (they are live and hotel-linked).
--   3. Add canonical fields: region, destination_type, supported_locales,
--      coordinates, short_description, SEO, provenance (source_*), verification.
--   4. Draft/Live separation: add published_snapshot jsonb (the CURRENTLY-LIVE
--      copy, written ONLY by publish_destination). Draft edits to the row no
--      longer alter live content until the next publish. Backfill existing
--      published rows so nothing changes for hotels.
--   5. RPCs (platform_admin only, SECURITY DEFINER, empty search_path):
--        publish_destination(uuid,text)        -> content_versions
--        rollback_destination(uuid,uuid)       -> destinations (into a NEW draft)
--        list_destination_versions(uuid)       -> version history
--   6. Triggers on destinations: block direct publish (must use the RPC) and
--      audit create/update/publish/archive/restore.
--   7. Hardening: drop the hard-DELETE policy (archive-only), and grant the new
--      RPCs to authenticated + service_role only (never anon/PUBLIC).
--
-- Create/edit-draft/archive/restore are plain RLS-governed writes (platform_admin
-- INSERT/UPDATE). No unrelated tables or RLS are redesigned.
-- ============================================================================

-- ── 1. Enums ────────────────────────────────────────────────────────────────
do $$ begin
  if not exists (select 1 from pg_type where typname = 'destination_type') then
    create type public.destination_type as enum
      ('city','island','municipality','resort_area','tourism_region');
  end if;
  if not exists (select 1 from pg_type where typname = 'content_source_type') then
    create type public.content_source_type as enum
      ('manual','airtable_import','official_tourism','city_event_feed',
       'external_api','partner','hotel_suggestion','ai_assisted_draft');
  end if;
  if not exists (select 1 from pg_type where typname = 'verification_status') then
    create type public.verification_status as enum ('unverified','verified','stale');
  end if;
end $$;

-- ── 2. status: destination_status -> content_status ─────────────────────────
do $$
declare cur text;
begin
  select udt_name into cur from information_schema.columns
   where table_schema='public' and table_name='destinations' and column_name='status';
  if cur = 'destination_status' then
    alter table public.destinations alter column status drop default;
    alter table public.destinations
      alter column status type public.content_status
      using (case status::text
               when 'active'   then 'published'
               when 'archived' then 'archived'
               else 'draft' end)::public.content_status;
    alter table public.destinations alter column status set default 'draft';
  end if;
end $$;

-- ── 3. Canonical + provenance + verification fields ─────────────────────────
alter table public.destinations
  add column if not exists region             text,
  add column if not exists destination_type   public.destination_type not null default 'city',
  add column if not exists supported_locales  text[] not null default '{}'::text[],
  add column if not exists latitude           numeric,
  add column if not exists longitude          numeric,
  add column if not exists short_description  text,
  add column if not exists seo_title          text,
  add column if not exists seo_description    text,
  add column if not exists source_type        public.content_source_type not null default 'manual',
  add column if not exists source_name        text,
  add column if not exists source_url         text,
  add column if not exists imported_at        timestamptz,
  add column if not exists last_verified_at   timestamptz,
  add column if not exists verification_status public.verification_status not null default 'unverified',
  add column if not exists rights_notes       text,
  add column if not exists published_at       timestamptz,
  add column if not exists published_snapshot jsonb;

-- coordinate sanity (guarded so re-runs don't error on duplicate constraint)
do $$ begin
  if not exists (select 1 from pg_constraint where conname='destinations_lat') then
    alter table public.destinations add constraint destinations_lat
      check (latitude is null or (latitude >= -90 and latitude <= 90));
  end if;
  if not exists (select 1 from pg_constraint where conname='destinations_lng') then
    alter table public.destinations add constraint destinations_lng
      check (longitude is null or (longitude >= -180 and longitude <= 180));
  end if;
  -- (supported_locales tag-shape validation is enforced in the app layer — a
  --  CHECK constraint cannot contain the subquery an array-element check needs.)
end $$;

-- ── 4. Backfill existing published destinations (Split, Split Dev) ───────────
-- supported_locales default to [default_locale]; publish snapshot = current row.
update public.destinations
   set supported_locales = array[default_locale]
 where supported_locales = '{}'::text[];

update public.destinations
   set published_at = coalesce(published_at, updated_at)
 where status = 'published' and published_at is null;

update public.destinations d
   set published_snapshot = to_jsonb(d) - 'published_snapshot'
 where d.status = 'published' and d.published_snapshot is null;

-- ── 5. RPCs ─────────────────────────────────────────────────────────────────

-- Publish: freeze the current draft as the live snapshot + an immutable version.
create or replace function public.publish_destination(
  p_destination uuid,
  p_change_summary text default null
) returns public.content_versions
language plpgsql volatile security definer set search_path = '' as $$
declare d public.destinations; vnum int; cv public.content_versions; snap jsonb;
begin
  if not platform.is_platform_admin() then
    raise exception 'only platform_admin may publish destinations' using errcode = '42501';
  end if;

  select * into d from public.destinations where id = p_destination;
  if d.id is null then
    raise exception 'destination % not found', p_destination using errcode = 'P0002';
  end if;

  select coalesce(max(version_number),0) + 1 into vnum
    from public.content_versions where entity_type = 'destination' and entity_id = p_destination;

  update public.destinations
     set status = 'published', published_at = now(), updated_by = auth.uid()
   where id = p_destination
   returning * into d;

  snap := to_jsonb(d) - 'published_snapshot';          -- content going live now
  update public.destinations set published_snapshot = snap where id = p_destination;

  insert into public.content_versions
    (entity_type, entity_id, version_number, status, snapshot, change_summary, hotel_id, published_at, created_by)
  values
    ('destination', p_destination, vnum, 'published', snap, p_change_summary, null, now(), auth.uid())
  returning * into cv;

  return cv;
end; $$;

-- Rollback: restore a prior version's content into a NEW DRAFT (never touches the
-- live snapshot — guests keep the last published version until this is published).
create or replace function public.rollback_destination(
  p_destination uuid,
  p_version uuid
) returns public.destinations
language plpgsql volatile security definer set search_path = '' as $$
declare snap jsonb; d public.destinations; cvrow public.content_versions;
begin
  if not platform.is_platform_admin() then
    raise exception 'only platform_admin may roll back destinations' using errcode = '42501';
  end if;

  select * into cvrow from public.content_versions
   where id = p_version and entity_type = 'destination' and entity_id = p_destination;
  if cvrow.id is null then
    raise exception 'version % not found for destination %', p_version, p_destination using errcode = 'P0002';
  end if;

  snap := cvrow.snapshot;
  update public.destinations set
     name               = coalesce(snap->>'name', name),
     slug               = coalesce(snap->>'slug', slug),
     country_code       = snap->>'country_code',
     region             = snap->>'region',
     destination_type   = coalesce((snap->>'destination_type')::public.destination_type, destination_type),
     timezone           = coalesce(snap->>'timezone', timezone),
     default_locale     = coalesce(snap->>'default_locale', default_locale),
     supported_locales  = coalesce(
       (select array_agg(value::text) from jsonb_array_elements_text(snap->'supported_locales')),
       supported_locales),
     latitude           = nullif(snap->>'latitude','')::numeric,
     longitude          = nullif(snap->>'longitude','')::numeric,
     short_description  = snap->>'short_description',
     seo_title          = snap->>'seo_title',
     seo_description    = snap->>'seo_description',
     source_type        = coalesce((snap->>'source_type')::public.content_source_type, source_type),
     source_name        = snap->>'source_name',
     source_url         = snap->>'source_url',
     last_verified_at   = nullif(snap->>'last_verified_at','')::timestamptz,
     verification_status= coalesce((snap->>'verification_status')::public.verification_status, verification_status),
     rights_notes       = snap->>'rights_notes',
     status             = 'draft',
     updated_by         = auth.uid()
   where id = p_destination
   returning * into d;

  return d;
end; $$;

-- History (platform_admin only — hotels never read destination version history).
create or replace function public.list_destination_versions(p_destination uuid)
returns table (
  id uuid, version_number integer, status public.content_status,
  change_summary text, created_by uuid,
  published_at timestamptz, created_at timestamptz, snapshot jsonb
)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not platform.is_platform_admin() then
    raise exception 'only platform_admin may read destination history' using errcode = '42501';
  end if;
  return query
    select v.id, v.version_number, v.status, v.change_summary, v.created_by,
           v.published_at, v.created_at, v.snapshot
      from public.content_versions v
     where v.entity_type = 'destination' and v.entity_id = p_destination
     order by v.version_number desc;
end; $$;

-- ── 6. Triggers on destinations ─────────────────────────────────────────────

-- Block direct publish: status may only reach 'published' via publish_destination
-- (which runs as the definer/postgres and thus bypasses this guard).
create or replace function platform.protect_destination_row_publish()
returns trigger language plpgsql as $$
begin
  if current_user not in ('postgres','supabase_admin')
     and new.status = 'published' and old.status is distinct from 'published' then
    raise exception 'direct publish is not allowed; use public.publish_destination()' using errcode = '42501';
  end if;
  return new;
end; $$;

drop trigger if exists trg_destinations_protect_publish on public.destinations;
create trigger trg_destinations_protect_publish
  before update on public.destinations
  for each row execute function platform.protect_destination_row_publish();

-- Audit create/update/publish/archive/restore/unpublish.
create or replace function platform.audit_destination()
returns trigger language plpgsql security definer set search_path = '' as $$
declare nj jsonb; oj jsonb; act public.audit_action; a_uid uuid;
begin
  a_uid := auth.uid();
  nj := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  oj := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  if tg_op = 'INSERT' then act := 'create';
  elsif tg_op = 'DELETE' then act := 'delete';
  elsif (nj->>'status') = 'published' and (oj->>'status') is distinct from 'published' then act := 'publish';
  elsif (nj->>'status') = 'archived'  and (oj->>'status') is distinct from 'archived'  then act := 'archive';
  elsif (oj->>'status') = 'archived'  and (nj->>'status') is distinct from 'archived'  then act := 'restore';
  elsif (oj->>'status') = 'published' and (nj->>'status') is distinct from 'published' then act := 'unpublish';
  else act := 'update';
  end if;
  insert into public.audit_log
    (actor_user_id, actor_type, hotel_id, entity_type, entity_id, action, before_state, after_state)
  values
    (a_uid, case when a_uid is not null then 'user'::public.actor_type else 'service'::public.actor_type end,
     null, 'destination', coalesce((nj->>'id'),(oj->>'id'))::uuid, act,
     case when oj is not null then jsonb_build_object('status',oj->>'status','slug',oj->>'slug','name',oj->>'name','verification_status',oj->>'verification_status') end,
     case when nj is not null then jsonb_build_object('status',nj->>'status','slug',nj->>'slug','name',nj->>'name','verification_status',nj->>'verification_status') end);
  return coalesce(new, old);
end; $$;

drop trigger if exists trg_destinations_audit on public.destinations;
create trigger trg_destinations_audit
  after insert or update or delete on public.destinations
  for each row execute function platform.audit_destination();

-- ── 7. Hardening ────────────────────────────────────────────────────────────

-- Archive-only: remove the hard-DELETE path for authenticated users entirely.
drop policy if exists destinations_admin_del on public.destinations;

-- New RPCs: authenticated + service_role only, never anon/PUBLIC.
revoke all on function public.publish_destination(uuid, text) from public, anon;
revoke all on function public.rollback_destination(uuid, uuid) from public, anon;
revoke all on function public.list_destination_versions(uuid) from public, anon;
grant execute on function public.publish_destination(uuid, text) to authenticated, service_role;
grant execute on function public.rollback_destination(uuid, uuid) to authenticated, service_role;
grant execute on function public.list_destination_versions(uuid) to authenticated, service_role;
