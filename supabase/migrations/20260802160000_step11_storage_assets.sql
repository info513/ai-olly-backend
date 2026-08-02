-- ============================================================================
-- AI OLLY Platform 2.0 — Migration Step 11: Storage & Asset Manager
-- ----------------------------------------------------------------------------
-- assets (metadata over Storage objects / external video) + asset_usages
-- ("where is this asset used?"). Three buckets: public-media (public read),
-- private-documents & consent-files (backend/service-role only, signed URLs).
-- Per-type size limits (DB check), tenant path validation, usage-scope guards,
-- soft-delete blocked while active usages exist, redacted audit. RLS from row one.
-- aiolly-dev only. Idempotent; rebuildable via `supabase db reset`.
-- ============================================================================

do $$ begin
  if not exists (select 1 from pg_type where typname='asset_type') then
    create type public.asset_type as enum
      ('hotel_image','room_image','poi_image','route_image','whisper_image','whisper_audio',
       'short_video','logo','icon','news_image','newsletter_asset','document',
       'consent_signature','consent_pdf','other');
  end if;
  if not exists (select 1 from pg_type where typname='asset_status') then
    create type public.asset_status as enum ('pending','ready','archived');
  end if;
  if not exists (select 1 from pg_type where typname='owner_scope') then
    create type public.owner_scope as enum ('platform','destination','hotel');
  end if;
end $$;

-- Per-type max upload size (bytes) — enforced by CHECK + finalize fn + bucket limit.
create or replace function platform.asset_max_bytes(t public.asset_type)
returns bigint language sql immutable set search_path = '' as $$
  select (case
    when t = 'short_video'                     then 100
    when t = 'whisper_audio'                    then 50
    when t in ('document','consent_pdf')        then 25
    when t = 'consent_signature'                then 5
    else 15 end * 1024 * 1024)::bigint;   -- images/logos/icons/news/newsletter -> 15 MB
$$;

-- Which bucket a logical type belongs to (private types must land in a private bucket).
create or replace function platform.asset_is_private_type(t public.asset_type)
returns boolean language sql immutable set search_path = '' as $$
  select t in ('consent_signature','consent_pdf','document');
$$;

-- ── assets ───────────────────────────────────────────────────────────────────
create table if not exists public.assets (
  id                        uuid primary key default gen_random_uuid(),
  hotel_id                  uuid references public.hotels(id) on delete cascade,
  destination_id            uuid references public.destinations(id) on delete cascade,
  owner_scope               public.owner_scope not null default 'hotel',   -- derived by trigger
  bucket_name               text,                    -- null for external (video) assets
  storage_path              text,
  external_provider         text,                    -- 'vimeo' | 'youtube' | null
  external_url              text,
  external_id               text,
  original_filename         text,
  display_name              text,
  asset_type                public.asset_type not null default 'other',
  mime_type                 text,
  file_size_bytes           bigint,
  width                     integer,
  height                    integer,
  duration_seconds          integer,
  checksum                  text,
  alt_text                  text,
  caption                   text,
  source_credit             text,
  rights_owner              text,
  rights_notes              text,
  license_type              text,
  status                    public.asset_status not null default 'pending',
  public_access             boolean not null default false,
  uploaded_by               uuid,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  deleted_at                timestamptz,
  legacy_airtable_record_id text,
  metadata                  jsonb,
  constraint assets_scope_excl   check (hotel_id is null or destination_id is null),
  constraint assets_size_limit   check (file_size_bytes is null or file_size_bytes <= platform.asset_max_bytes(asset_type)),
  constraint assets_location     check ( (bucket_name is not null and storage_path is not null)
                                          or (external_provider is not null and external_url is not null) ),
  constraint assets_bucket_valid check ( bucket_name is null
                                          or bucket_name in ('public-media','private-documents','consent-files') ),
  constraint assets_private_bucket check ( bucket_name is null
      or not (platform.asset_is_private_type(asset_type) and bucket_name = 'public-media') )  -- private types never in public bucket
);
create index if not exists assets_hotel_idx on public.assets (hotel_id);
create index if not exists assets_dest_idx  on public.assets (destination_id);
create index if not exists assets_type_idx  on public.assets (asset_type);
create index if not exists assets_status_idx on public.assets (status) where deleted_at is null;

-- ── asset_usages (reuse-aware; "where is this used?") ────────────────────────
create table if not exists public.asset_usages (
  id           uuid primary key default gen_random_uuid(),
  asset_id     uuid not null references public.assets(id) on delete cascade,
  hotel_id     uuid references public.hotels(id) on delete cascade,
  entity_type  text not null,
  entity_id    uuid not null,
  usage_role   text not null,          -- e.g. hero, card, logo, header, signature, pdf
  sort_order   integer not null default 0,
  created_at   timestamptz not null default now(),
  created_by   uuid,
  constraint asset_usages_unique unique (asset_id, entity_type, entity_id, usage_role)
);
create index if not exists asset_usages_asset_idx  on public.asset_usages (asset_id);
create index if not exists asset_usages_entity_idx on public.asset_usages (entity_type, entity_id);

create trigger trg_assets_updated_at before update on public.assets for each row execute function platform.set_updated_at();

-- ── Integrity: derive owner_scope; validate public/private consistency ───────
create or replace function platform.normalize_asset()
returns trigger language plpgsql as $$
begin
  new.owner_scope := case when new.hotel_id is not null then 'hotel'::public.owner_scope
                          when new.destination_id is not null then 'destination'::public.owner_scope
                          else 'platform'::public.owner_scope end;
  -- private types are never publicly accessible
  if platform.asset_is_private_type(new.asset_type) then new.public_access := false; end if;
  -- public_access only meaningful in the public bucket
  if new.bucket_name is distinct from 'public-media' then new.public_access := false; end if;
  return new;
end; $$;
create trigger trg_assets_normalize before insert or update on public.assets
  for each row execute function platform.normalize_asset();

-- usage must be same-hotel unless the asset is platform/destination shared
create or replace function platform.check_asset_usage_scope()
returns trigger language plpgsql as $$
declare a public.assets;
begin
  select * into a from public.assets where id = new.asset_id;
  if a.id is null then raise exception 'asset % not found', new.asset_id using errcode='23503'; end if;
  if a.owner_scope = 'hotel' then
    if new.hotel_id is null or new.hotel_id <> a.hotel_id then
      raise exception 'hotel asset % may only be used within hotel %', new.asset_id, a.hotel_id using errcode='23514';
    end if;
  end if;  -- platform/destination assets may be reused by any authorized hotel
  return new;
end; $$;
create trigger trg_asset_usages_scope before insert or update on public.asset_usages
  for each row execute function platform.check_asset_usage_scope();

-- soft-delete blocked while active usages exist (protect history)
create or replace function platform.protect_asset_delete()
returns trigger language plpgsql as $$
begin
  if new.deleted_at is not null and old.deleted_at is null then
    if exists (select 1 from public.asset_usages where asset_id = old.id) then
      raise exception 'cannot delete asset % while it has active usages (detach first)', old.id using errcode='23514';
    end if;
  end if;
  -- tenancy/link columns are not editable by non-privileged callers
  if current_user not in ('service_role','postgres','supabase_admin') and not platform.is_platform_admin() then
    new.hotel_id := old.hotel_id; new.destination_id := old.destination_id;
    new.bucket_name := old.bucket_name; new.storage_path := old.storage_path;
    new.legacy_airtable_record_id := old.legacy_airtable_record_id; new.uploaded_by := old.uploaded_by;
  end if;
  return new;
end; $$;
create trigger trg_assets_protect before update on public.assets
  for each row execute function platform.protect_asset_delete();

-- ── Redacted audit (no binary/paths-as-secrets) ──────────────────────────────
create or replace function platform.audit_asset()
returns trigger language plpgsql security definer set search_path = '' as $$
declare nj jsonb; oj jsonb; act public.audit_action; a_uid uuid;
begin
  a_uid := auth.uid();
  nj := case when tg_op<>'DELETE' then to_jsonb(new) end; oj := case when tg_op<>'INSERT' then to_jsonb(old) end;
  act := case when tg_op='INSERT' then 'create' when tg_op='DELETE' then 'delete'
              when (nj->>'deleted_at') is not null and (oj->>'deleted_at') is null then 'archive'
              when (nj->>'status')='ready' and (oj->>'status') is distinct from 'ready' then 'update'
              else 'update' end::public.audit_action;
  insert into public.audit_log (actor_user_id, actor_type, hotel_id, entity_type, entity_id, action, before_state, after_state, metadata)
  values (a_uid, case when a_uid is not null then 'user'::public.actor_type else 'service'::public.actor_type end,
     coalesce((nj->>'hotel_id'),(oj->>'hotel_id'))::uuid, 'asset', coalesce((nj->>'id'),(oj->>'id'))::uuid, act,
     case when oj is not null then jsonb_build_object('status',oj->>'status','asset_type',oj->>'asset_type','deleted',(oj->>'deleted_at') is not null) end,
     case when nj is not null then jsonb_build_object('status',nj->>'status','asset_type',nj->>'asset_type','deleted',(nj->>'deleted_at') is not null,'public_access',nj->>'public_access') end,
     jsonb_build_object('bucket', coalesce(nj->>'bucket_name', oj->>'bucket_name')));  -- bucket name only, never a signed URL
  return coalesce(new, old);
end; $$;
create trigger trg_assets_audit after insert or update or delete on public.assets
  for each row execute function platform.audit_asset();

create or replace function platform.audit_asset_usage()
returns trigger language plpgsql security definer set search_path = '' as $$
declare nj jsonb; oj jsonb; a_uid uuid;
begin
  a_uid := auth.uid();
  nj := case when tg_op<>'DELETE' then to_jsonb(new) end; oj := case when tg_op<>'INSERT' then to_jsonb(old) end;
  insert into public.audit_log (actor_user_id, actor_type, hotel_id, entity_type, entity_id, action, after_state, metadata)
  values (a_uid, case when a_uid is not null then 'user'::public.actor_type else 'service'::public.actor_type end,
     coalesce((nj->>'hotel_id'),(oj->>'hotel_id'))::uuid, 'asset_usage', coalesce((nj->>'asset_id'),(oj->>'asset_id'))::uuid,
     case when tg_op='INSERT' then 'create' when tg_op='DELETE' then 'delete' else 'update' end::public.audit_action,
     jsonb_build_object('entity_type', coalesce(nj->>'entity_type', oj->>'entity_type'), 'usage_role', coalesce(nj->>'usage_role', oj->>'usage_role')),
     jsonb_build_object('note','asset usage'));
  return coalesce(new, old);
end; $$;
create trigger trg_asset_usages_audit after insert or update or delete on public.asset_usages
  for each row execute function platform.audit_asset_usage();

-- ── Finalize upload (metadata -> ready) ──────────────────────────────────────
create or replace function public.finalize_asset(
  p_asset uuid, p_size bigint default null, p_checksum text default null,
  p_width integer default null, p_height integer default null, p_duration integer default null
) returns public.assets language plpgsql volatile security definer set search_path = '' as $$
declare a public.assets;
begin
  select * into a from public.assets where id = p_asset;
  if a.id is null then raise exception 'asset % not found', p_asset using errcode='P0002'; end if;
  if not ( platform.is_platform_admin()
           or (a.hotel_id is not null and platform.has_hotel_role(a.hotel_id, array['hotel_admin','editor','marketing']::public.hotel_member_role[])) ) then
    raise exception 'insufficient privilege to finalize asset %', p_asset using errcode='42501';
  end if;
  if p_size is not null and p_size > platform.asset_max_bytes(a.asset_type) then
    raise exception 'asset % exceeds size limit for type %', p_asset, a.asset_type using errcode='23514';
  end if;
  update public.assets set status='ready',
     file_size_bytes=coalesce(p_size,file_size_bytes), checksum=coalesce(p_checksum,checksum),
     width=coalesce(p_width,width), height=coalesce(p_height,height), duration_seconds=coalesce(p_duration,duration_seconds),
     updated_at=now()
   where id=p_asset returning * into a;
  return a;
end; $$;
revoke all on function public.finalize_asset(uuid,bigint,text,integer,integer,integer) from public;
grant execute on function public.finalize_asset(uuid,bigint,text,integer,integer,integer) to authenticated, service_role;

-- "Where is this asset used?" (tenant-safe; SECURITY INVOKER -> caller RLS applies)
create or replace function public.asset_usage_report(p_asset uuid)
returns table (entity_type text, entity_id uuid, usage_role text, hotel_id uuid, sort_order integer)
language sql stable security invoker set search_path = '' as $$
  select entity_type, entity_id, usage_role, hotel_id, sort_order
  from public.asset_usages where asset_id = p_asset order by entity_type, sort_order;
$$;
revoke all on function public.asset_usage_report(uuid) from public;
grant execute on function public.asset_usage_report(uuid) to authenticated, service_role;

-- ── RLS + GRANTS on assets/asset_usages ──────────────────────────────────────
alter table public.assets       enable row level security;
alter table public.asset_usages enable row level security;
revoke all on public.assets, public.asset_usages from public, anon, authenticated, service_role;

grant select, insert, update on public.assets       to service_role;
grant select, insert, update, delete on public.asset_usages to service_role;
grant select, insert, update on public.assets       to authenticated;
grant select, insert, update, delete on public.asset_usages to authenticated;

-- assets: platform/destination assets read by accessing members, managed by platform_admin;
-- hotel assets managed by hotel_admin/editor/marketing; PRIVATE assets (consent/document)
-- restricted to platform_admin/hotel_admin/reception. No hard delete (soft-delete only).
create policy assets_select on public.assets for select to authenticated
  using ( platform.is_platform_admin()
          or ( platform.asset_is_private_type(asset_type)
               and hotel_id is not null
               and platform.has_hotel_role(hotel_id, array['hotel_admin','reception']::public.hotel_member_role[]) )
          or ( not platform.asset_is_private_type(asset_type) and (
                 (hotel_id is not null and platform.has_hotel_membership(hotel_id))
                 or (destination_id is not null and platform.has_destination_access(destination_id))
                 or (hotel_id is null and destination_id is null and platform.has_any_membership()) ) ) );
create policy assets_ins on public.assets for insert to authenticated
  with check ( (hotel_id is null and platform.is_platform_admin())
               or (hotel_id is not null and (platform.is_platform_admin()
                     or platform.has_hotel_role(hotel_id, array['hotel_admin','editor','marketing']::public.hotel_member_role[]))) );
create policy assets_upd on public.assets for update to authenticated
  using ( (hotel_id is null and platform.is_platform_admin())
          or (hotel_id is not null and (platform.is_platform_admin()
                or platform.has_hotel_role(hotel_id, array['hotel_admin','editor','marketing']::public.hotel_member_role[]))) )
  with check ( (hotel_id is null and platform.is_platform_admin())
               or (hotel_id is not null and (platform.is_platform_admin()
                     or platform.has_hotel_role(hotel_id, array['hotel_admin','editor','marketing']::public.hotel_member_role[]))) );

create policy asset_usages_select on public.asset_usages for select to authenticated
  using ( platform.is_platform_admin()
          or (hotel_id is not null and platform.has_hotel_membership(hotel_id))
          or exists (select 1 from public.assets a where a.id = asset_id and a.hotel_id is null) );
create policy asset_usages_write on public.asset_usages for all to authenticated
  using ( platform.is_platform_admin()
          or (hotel_id is not null and platform.has_hotel_role(hotel_id, array['hotel_admin','editor','marketing']::public.hotel_member_role[])) )
  with check ( platform.is_platform_admin()
               or (hotel_id is not null and platform.has_hotel_role(hotel_id, array['hotel_admin','editor','marketing']::public.hotel_member_role[])) );

-- ── Storage buckets (single set; tenant-aware paths, not per-hotel buckets) ──
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
 ('public-media','public-media', true,  104857600, array['image/jpeg','image/png','image/webp','image/gif','image/svg+xml','video/mp4','audio/mpeg','audio/mp4']),
 ('private-documents','private-documents', false, 26214400, array['application/pdf','image/png','image/jpeg']),
 ('consent-files','consent-files', false, 5242880,  array['application/pdf','image/png','image/jpeg','image/svg+xml'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- Safe tenant path check for public-media writes (no trust of client path alone).
-- Path convention: platform/… | destinations/{destination_id}/… | hotels/{hotel_id}/…
create or replace function platform.can_manage_media(p_name text)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare parts text[]; hid uuid;
begin
  if platform.is_platform_admin() then return true; end if;
  parts := string_to_array(coalesce(p_name,''), '/');
  if array_length(parts,1) >= 3 and parts[1] = 'hotels' then
    begin hid := parts[2]::uuid; exception when others then return false; end;
    return platform.has_hotel_role(hid, array['hotel_admin','editor','marketing']::public.hotel_member_role[]);
  end if;
  return false;   -- platform/destinations paths require platform_admin (handled above)
end; $$;
revoke all on function platform.can_manage_media(text) from public;
grant execute on function platform.can_manage_media(text) to authenticated, service_role;

-- Storage object policies:
--  • public-media: anyone may READ; writes require can_manage_media(path).
--  • private-documents / consent-files: NO anon/authenticated access at all — the
--    backend (service_role, bypasses RLS) reads/writes and mints signed URLs.
drop policy if exists pkgc_public_media_read   on storage.objects;
drop policy if exists pkgc_public_media_write   on storage.objects;
drop policy if exists pkgc_public_media_update  on storage.objects;
drop policy if exists pkgc_public_media_delete  on storage.objects;
create policy pkgc_public_media_read on storage.objects for select
  using ( bucket_id = 'public-media' );
create policy pkgc_public_media_write on storage.objects for insert to authenticated
  with check ( bucket_id = 'public-media' and platform.can_manage_media(name) );
create policy pkgc_public_media_update on storage.objects for update to authenticated
  using ( bucket_id = 'public-media' and platform.can_manage_media(name) )
  with check ( bucket_id = 'public-media' and platform.can_manage_media(name) );
create policy pkgc_public_media_delete on storage.objects for delete to authenticated
  using ( bucket_id = 'public-media' and platform.can_manage_media(name) );
-- (No policies for private-documents / consent-files => authenticated & anon are denied.)
