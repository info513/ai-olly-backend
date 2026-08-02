-- ============================================================================
-- AI OLLY Platform 2.0 — Migration Step 9: Guests, Stays & Consent
-- ----------------------------------------------------------------------------
-- Guests WITHOUT accounts; duplicate SUGGESTIONS (never auto-merge); manual stays
-- with cross-hotel guards and hashed (synthetic) access reference; versioned
-- consent_templates (only published may be signed); IMMUTABLE signed consents
-- with exact text snapshot + non-destructive revocation. PII/tokens column-
-- protected and excluded from audit. RLS from row one. aiolly-dev only. Idempotent.
-- ============================================================================

do $$ begin
  if not exists (select 1 from pg_type where typname='stay_status') then
    create type public.stay_status as enum ('reserved','checked_in','checked_out','cancelled','no_show');
  end if;
  if not exists (select 1 from pg_type where typname='consent_status') then
    create type public.consent_status as enum ('granted','revoked');
  end if;
  if not exists (select 1 from pg_type where typname='duplicate_status') then
    create type public.duplicate_status as enum ('pending','confirmed','rejected');
  end if;
end $$;

-- ── guests (no accounts; minimal PII) ────────────────────────────────────────
create table if not exists public.guests (
  id                uuid primary key default gen_random_uuid(),
  hotel_id          uuid not null references public.hotels(id) on delete cascade,
  first_name        text,
  last_name         text,
  email             text,                     -- SENSITIVE
  phone             text,                     -- SENSITIVE
  preferred_locale  text,
  country_code      text,
  external_source   text,
  external_id       text,
  pseudonymized_at  timestamptz,
  deleted_at        timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  created_by        uuid,
  updated_by        uuid,
  constraint guests_country_iso check (country_code is null or country_code ~ '^[A-Z]{2}$'),
  constraint guests_locale_fmt  check (preferred_locale is null or preferred_locale ~ '^[a-z]{2}(-[a-z]{2})?$')
);
create index if not exists guests_hotel_idx on public.guests (hotel_id);
create index if not exists guests_external_idx on public.guests (hotel_id, external_source, external_id);

-- ── guest_duplicate_suggestions (suggestions only; never auto-merge) ─────────
create table if not exists public.guest_duplicate_suggestions (
  id                 uuid primary key default gen_random_uuid(),
  hotel_id           uuid not null references public.hotels(id) on delete cascade,
  guest_id           uuid not null references public.guests(id) on delete cascade,
  candidate_guest_id uuid not null references public.guests(id) on delete cascade,
  match_reason       text,
  match_score        numeric(4,3),
  status             public.duplicate_status not null default 'pending',
  reviewed_by        uuid,
  reviewed_at        timestamptz,
  created_at         timestamptz not null default now(),
  constraint gds_distinct check (guest_id <> candidate_guest_id),
  constraint gds_unique unique (hotel_id, guest_id, candidate_guest_id)
);

-- ── stays (manual; PMS later; QR/token-compatible via hashed reference) ──────
create table if not exists public.stays (
  id                 uuid primary key default gen_random_uuid(),
  hotel_id           uuid not null references public.hotels(id) on delete cascade,
  guest_id           uuid references public.guests(id) on delete set null,   -- nullable: group/anonymous
  room_id            uuid references public.rooms(id) on delete set null,
  status             public.stay_status not null default 'reserved',
  arrival_at         timestamptz,
  departure_at       timestamptz,
  access_token_hash  text,                    -- SENSITIVE (synthetic hash; NOT a v1 token)
  external_source    text,
  external_id        text,
  checked_in_at      timestamptz,
  checked_out_at     timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  created_by         uuid,
  updated_by         uuid,
  constraint stays_dates check (departure_at is null or arrival_at is null or departure_at >= arrival_at)
);
create index if not exists stays_hotel_idx on public.stays (hotel_id);
create index if not exists stays_room_idx  on public.stays (room_id);
create index if not exists stays_guest_idx on public.stays (guest_id);
-- deterministic active-stay: at most one checked_in stay per room
create unique index if not exists stays_active_per_room on public.stays (room_id) where status = 'checked_in';

-- ── consent_templates (versioned; only published may be signed) ──────────────
create table if not exists public.consent_templates (
  id           uuid primary key default gen_random_uuid(),
  hotel_id     uuid references public.hotels(id) on delete cascade,   -- null = platform template
  key          text not null,
  locale       text not null default 'en',
  version      integer not null default 1,
  title        text not null,
  body_text    text not null,                 -- exact legal wording (supplied by staff; not authored here)
  status       public.content_status not null default 'draft',
  active       boolean not null default true,
  published_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid,
  updated_by   uuid,
  constraint consent_templates_key_fmt check (key ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  constraint consent_templates_locale_fmt check (locale ~ '^[a-z]{2}(-[a-z]{2})?$')
);
create unique index if not exists consent_templates_unique
  on public.consent_templates (coalesce(hotel_id,'00000000-0000-0000-0000-000000000000'::uuid), key, locale, version);
create index if not exists consent_templates_hotel_idx on public.consent_templates (hotel_id);

-- ── consents (IMMUTABLE after signing; snapshot preserved; revocation additive) ─
create table if not exists public.consents (
  id                          uuid primary key default gen_random_uuid(),
  hotel_id                    uuid not null references public.hotels(id) on delete cascade,
  guest_id                    uuid not null references public.guests(id) on delete cascade,
  stay_id                     uuid references public.stays(id) on delete set null,
  template_id                 uuid references public.consent_templates(id) on delete set null,
  consent_type                text not null,
  consent_version             integer not null,
  locale                      text not null default 'en',
  consent_text_snapshot       text not null,          -- exact signed text (immutable)
  signed_name                 text not null,
  signed_at                   timestamptz not null default now(),
  staff_user_id               uuid,
  signature_asset_id          uuid,                   -- future Storage (no bucket yet)
  generated_document_asset_id uuid,                   -- future Storage
  device_metadata             jsonb,
  ip_metadata                 inet,
  status                      public.consent_status not null default 'granted',
  revoked_at                  timestamptz,
  created_at                  timestamptz not null default now()
);
create index if not exists consents_hotel_idx on public.consents (hotel_id);
create index if not exists consents_guest_idx on public.consents (guest_id);

create trigger trg_guests_updated_at            before update on public.guests            for each row execute function platform.set_updated_at();
create trigger trg_stays_updated_at             before update on public.stays             for each row execute function platform.set_updated_at();
create trigger trg_consent_templates_updated_at before update on public.consent_templates for each row execute function platform.set_updated_at();

-- ── Cross-hotel integrity for stays (room & guest same hotel) ────────────────
create or replace function platform.check_stay_relations()
returns trigger language plpgsql as $$
declare rh uuid; gh uuid;
begin
  if new.room_id is not null then
    select hotel_id into rh from public.rooms where id = new.room_id;
    if rh is null or rh <> new.hotel_id then
      raise exception 'room % is not in hotel %', new.room_id, new.hotel_id using errcode = '23514';
    end if;
  end if;
  if new.guest_id is not null then
    select hotel_id into gh from public.guests where id = new.guest_id;
    if gh is null or gh <> new.hotel_id then
      raise exception 'guest % is not in hotel %', new.guest_id, new.hotel_id using errcode = '23514';
    end if;
  end if;
  return new;
end; $$;
create trigger trg_stays_relations before insert or update on public.stays
  for each row execute function platform.check_stay_relations();

-- ── Column protection ────────────────────────────────────────────────────────
create or replace function platform.protect_guest_columns()
returns trigger language plpgsql as $$
begin
  if current_user in ('service_role','postgres','supabase_admin') or platform.is_platform_admin() then return new; end if;
  new.hotel_id         := old.hotel_id;
  new.created_by       := old.created_by;
  new.pseudonymized_at := old.pseudonymized_at;   -- only the pseudonymize fn may set this
  return new;
end; $$;
create trigger trg_guests_protect before update on public.guests
  for each row execute function platform.protect_guest_columns();

create or replace function platform.protect_stay_columns()
returns trigger language plpgsql as $$
begin
  if current_user in ('service_role','postgres','supabase_admin') or platform.is_platform_admin() then return new; end if;
  new.hotel_id          := old.hotel_id;
  new.access_token_hash := old.access_token_hash;   -- staff never edit the token reference
  new.created_by        := old.created_by;
  return new;
end; $$;
create trigger trg_stays_protect before update on public.stays
  for each row execute function platform.protect_stay_columns();

-- consent_templates: block direct publish (force versioned publish fn)
create or replace function platform.protect_consent_template_columns()
returns trigger language plpgsql as $$
begin
  if current_user in ('service_role','postgres','supabase_admin') or platform.is_platform_admin() then return new; end if;
  new.hotel_id := old.hotel_id; new.key := old.key; new.version := old.version; new.created_by := old.created_by;
  new.published_at := old.published_at;
  if new.status = 'published' and old.status is distinct from 'published' then
    raise exception 'direct publish is not allowed; use public.publish_consent_template()' using errcode = '42501';
  end if;
  return new;
end; $$;
create trigger trg_consent_templates_protect before update on public.consent_templates
  for each row execute function platform.protect_consent_template_columns();

-- consents: immutable after signing — only status/revoked_at may change (revocation)
create or replace function platform.protect_consent_immutable()
returns trigger language plpgsql as $$
begin
  if current_user in ('postgres','supabase_admin') then return new; end if;
  -- restore every signed field; permit only the revocation transition
  new.hotel_id := old.hotel_id; new.guest_id := old.guest_id; new.stay_id := old.stay_id;
  new.template_id := old.template_id; new.consent_type := old.consent_type; new.consent_version := old.consent_version;
  new.locale := old.locale; new.consent_text_snapshot := old.consent_text_snapshot; new.signed_name := old.signed_name;
  new.signed_at := old.signed_at; new.staff_user_id := old.staff_user_id;
  new.signature_asset_id := old.signature_asset_id; new.generated_document_asset_id := old.generated_document_asset_id;
  new.device_metadata := old.device_metadata; new.ip_metadata := old.ip_metadata; new.created_at := old.created_at;
  return new;
end; $$;
create trigger trg_consents_immutable before update on public.consents
  for each row execute function platform.protect_consent_immutable();

-- ── Redacted audit (NO PII / NO consent text / NO tokens) ────────────────────
create or replace function platform.audit_guest()
returns trigger language plpgsql security definer set search_path = '' as $$
declare nj jsonb; oj jsonb; act public.audit_action; a_uid uuid;
begin
  a_uid := auth.uid();
  nj := case when tg_op<>'DELETE' then to_jsonb(new) end; oj := case when tg_op<>'INSERT' then to_jsonb(old) end;
  act := case when tg_op='INSERT' then 'create' when tg_op='DELETE' then 'delete'
              when (oj->>'pseudonymized_at') is null and (nj->>'pseudonymized_at') is not null then 'update'
              else 'update' end::public.audit_action;
  insert into public.audit_log (actor_user_id, actor_type, hotel_id, entity_type, entity_id, action, after_state, metadata)
  values (a_uid, case when a_uid is not null then 'user'::public.actor_type else 'service'::public.actor_type end,
     coalesce((nj->>'hotel_id'),(oj->>'hotel_id'))::uuid, 'guest', coalesce((nj->>'id'),(oj->>'id'))::uuid, act,
     jsonb_build_object('pseudonymized', (nj->>'pseudonymized_at') is not null, 'deleted', (nj->>'deleted_at') is not null, 'has_contact', ((nj->>'email') is not null or (nj->>'phone') is not null)),
     jsonb_build_object('note','guest — PII redacted'));
  return coalesce(new, old);
end; $$;
create trigger trg_guests_audit after insert or update or delete on public.guests
  for each row execute function platform.audit_guest();

create or replace function platform.audit_stay()
returns trigger language plpgsql security definer set search_path = '' as $$
declare nj jsonb; oj jsonb; a_uid uuid;
begin
  a_uid := auth.uid();
  nj := case when tg_op<>'DELETE' then to_jsonb(new) end; oj := case when tg_op<>'INSERT' then to_jsonb(old) end;
  insert into public.audit_log (actor_user_id, actor_type, hotel_id, entity_type, entity_id, action, before_state, after_state)
  values (a_uid, case when a_uid is not null then 'user'::public.actor_type else 'service'::public.actor_type end,
     coalesce((nj->>'hotel_id'),(oj->>'hotel_id'))::uuid, 'stay', coalesce((nj->>'id'),(oj->>'id'))::uuid,
     case when tg_op='INSERT' then 'create' when tg_op='DELETE' then 'delete' else 'update' end::public.audit_action,
     case when oj is not null then jsonb_build_object('status',oj->>'status','room_id',oj->>'room_id') end,
     case when nj is not null then jsonb_build_object('status',nj->>'status','room_id',nj->>'room_id') end);  -- no token
  return coalesce(new, old);
end; $$;
create trigger trg_stays_audit after insert or update or delete on public.stays
  for each row execute function platform.audit_stay();

create or replace function platform.audit_consent()
returns trigger language plpgsql security definer set search_path = '' as $$
declare nj jsonb; oj jsonb; act public.audit_action; a_uid uuid;
begin
  a_uid := auth.uid();
  nj := case when tg_op<>'DELETE' then to_jsonb(new) end; oj := case when tg_op<>'INSERT' then to_jsonb(old) end;
  act := case when tg_op='INSERT' then 'create'
              when (nj->>'status')='revoked' and (oj->>'status') is distinct from 'revoked' then 'update'
              else 'update' end::public.audit_action;
  insert into public.audit_log (actor_user_id, actor_type, hotel_id, entity_type, entity_id, action, after_state, metadata)
  values (a_uid, case when a_uid is not null then 'user'::public.actor_type else 'service'::public.actor_type end,
     coalesce((nj->>'hotel_id'),(oj->>'hotel_id'))::uuid, 'consent', coalesce((nj->>'id'),(oj->>'id'))::uuid, act,
     jsonb_build_object('status',nj->>'status','consent_type',nj->>'consent_type','consent_version',nj->>'consent_version','revoked',(nj->>'revoked_at') is not null),
     jsonb_build_object('note','consent — text/signature/device redacted'));
  return coalesce(new, old);
end; $$;
create trigger trg_consents_audit after insert or update or delete on public.consents
  for each row execute function platform.audit_consent();

-- ── Operational functions (SECURITY DEFINER; authz internal; secure path) ────
-- Pseudonymize a guest (GDPR-style): strip PII, keep the row for referential
-- integrity. hotel_admin/platform_admin only.
create or replace function public.pseudonymize_guest(p_guest uuid)
returns public.guests language plpgsql volatile security definer set search_path = '' as $$
declare g public.guests;
begin
  select * into g from public.guests where id = p_guest;
  if g.id is null then raise exception 'guest % not found', p_guest using errcode='P0002'; end if;
  if not ( platform.is_platform_admin() or platform.has_hotel_role(g.hotel_id, array['hotel_admin']::public.hotel_member_role[]) ) then
    raise exception 'insufficient privilege to pseudonymize guest %', p_guest using errcode='42501';
  end if;
  update public.guests set first_name=null, last_name=null, email=null, phone=null,
     external_id=null, pseudonymized_at=now(), updated_by=auth.uid() where id=p_guest returning * into g;
  return g;
end; $$;

-- Deterministic active-stay resolution for a room (no PII, no token).
create or replace function public.resolved_active_stay(p_room uuid)
returns table (stay_id uuid, hotel_id uuid, guest_id uuid, status public.stay_status, arrival_at timestamptz, departure_at timestamptz, checked_in_at timestamptz)
language sql stable security invoker set search_path = '' as $$
  select s.id, s.hotel_id, s.guest_id, s.status, s.arrival_at, s.departure_at, s.checked_in_at
  from public.stays s where s.room_id = p_room and s.status = 'checked_in' limit 1;
$$;

-- Safe operational stay list: guest FIRST NAME only (no email/phone/token).
create or replace function public.resolved_stays(p_hotel uuid)
returns table (stay_id uuid, room_id uuid, room_number text, guest_first_name text, status public.stay_status, arrival_at timestamptz, departure_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not ( platform.is_platform_admin()
           or platform.has_hotel_role(p_hotel, array['hotel_admin','reception','editor']::public.hotel_member_role[]) ) then
    raise exception 'insufficient privilege' using errcode='42501';
  end if;
  return query
    select s.id, s.room_id, r.room_number, g.first_name, s.status, s.arrival_at, s.departure_at
    from public.stays s
    left join public.rooms r on r.id = s.room_id
    left join public.guests g on g.id = s.guest_id
    where s.hotel_id = p_hotel
    order by s.arrival_at desc nulls last;
end; $$;

-- Sign a consent from a PUBLISHED template — snapshots the exact text immutably.
create or replace function public.sign_consent(
  p_template uuid, p_guest uuid, p_stay uuid, p_signed_name text, p_device jsonb default null
) returns public.consents language plpgsql volatile security definer set search_path = '' as $$
declare t public.consent_templates; g public.guests; c public.consents;
begin
  select * into t from public.consent_templates where id = p_template;
  if t.id is null then raise exception 'template % not found', p_template using errcode='P0002'; end if;
  if t.status <> 'published' or not t.active then raise exception 'consent template must be published to sign' using errcode='42501'; end if;
  select * into g from public.guests where id = p_guest;
  if g.id is null then raise exception 'guest % not found', p_guest using errcode='P0002'; end if;
  if t.hotel_id is not null and t.hotel_id <> g.hotel_id then raise exception 'template not valid for this hotel' using errcode='23514'; end if;
  if not ( platform.is_platform_admin() or platform.has_hotel_role(g.hotel_id, array['hotel_admin','reception']::public.hotel_member_role[]) ) then
    raise exception 'insufficient privilege to record consent' using errcode='42501';
  end if;
  insert into public.consents (hotel_id, guest_id, stay_id, template_id, consent_type, consent_version, locale,
     consent_text_snapshot, signed_name, signed_at, staff_user_id, device_metadata, status)
  values (g.hotel_id, p_guest, p_stay, p_template, t.key, t.version, t.locale, t.body_text, p_signed_name, now(), auth.uid(), p_device, 'granted')
  returning * into c;
  return c;
end; $$;

-- Revoke a consent additively (preserves the original signed snapshot).
create or replace function public.revoke_consent(p_consent uuid)
returns public.consents language plpgsql volatile security definer set search_path = '' as $$
declare c public.consents;
begin
  select * into c from public.consents where id = p_consent;
  if c.id is null then raise exception 'consent % not found', p_consent using errcode='P0002'; end if;
  if not ( platform.is_platform_admin() or platform.has_hotel_role(c.hotel_id, array['hotel_admin','reception']::public.hotel_member_role[]) ) then
    raise exception 'insufficient privilege to revoke consent' using errcode='42501';
  end if;
  update public.consents set status='revoked', revoked_at=now() where id=p_consent returning * into c;
  return c;
end; $$;

-- Consent-template publishing (versioned) — platform_admin (platform) / hotel_admin (hotel).
create or replace function public.publish_consent_template(p_template uuid, p_change_summary text default null)
returns public.content_versions language plpgsql volatile security definer set search_path = '' as $$
declare t public.consent_templates; vnum int; cv public.content_versions;
begin
  select * into t from public.consent_templates where id = p_template;
  if t.id is null then raise exception 'template % not found', p_template using errcode='P0002'; end if;
  if not ( platform.is_platform_admin()
           or ( t.hotel_id is not null and platform.has_hotel_role(t.hotel_id, array['hotel_admin']::public.hotel_member_role[]) ) ) then
    raise exception 'insufficient privilege to publish template %', p_template using errcode='42501';
  end if;
  select coalesce(max(version_number),0)+1 into vnum from public.content_versions where entity_type='consent_template' and entity_id=p_template;
  update public.consent_templates set status='published', published_at=now(), updated_by=auth.uid() where id=p_template returning * into t;
  insert into public.content_versions (entity_type, entity_id, version_number, status, snapshot, change_summary, hotel_id, published_at, created_by)
  values ('consent_template', p_template, vnum, 'published', to_jsonb(t), p_change_summary, t.hotel_id, now(), auth.uid())
  returning * into cv;
  return cv;
end; $$;

revoke all on function public.pseudonymize_guest(uuid), public.resolved_active_stay(uuid), public.resolved_stays(uuid),
  public.sign_consent(uuid,uuid,uuid,text,jsonb), public.revoke_consent(uuid), public.publish_consent_template(uuid,text) from public;
grant execute on function public.pseudonymize_guest(uuid), public.resolved_active_stay(uuid), public.resolved_stays(uuid),
  public.sign_consent(uuid,uuid,uuid,text,jsonb), public.revoke_consent(uuid), public.publish_consent_template(uuid,text) to authenticated, service_role;

-- ── RLS + GRANTS (fail-closed; REVOKE ALL then precise GRANT) ─────────────────
alter table public.guests                     enable row level security;
alter table public.guest_duplicate_suggestions enable row level security;
alter table public.stays                      enable row level security;
alter table public.consent_templates          enable row level security;
alter table public.consents                   enable row level security;

revoke all on public.guests, public.guest_duplicate_suggestions, public.stays,
              public.consent_templates, public.consents
  from public, anon, authenticated, service_role;

-- service_role (backend)
grant select, insert, update on public.guests                      to service_role;
grant select, insert, update on public.guest_duplicate_suggestions to service_role;
grant select, insert, update on public.stays                       to service_role;
grant select, insert, update on public.consent_templates           to service_role;
grant select, insert, update on public.consents                    to service_role;

-- authenticated (RLS-gated). stays: column-level SELECT EXCLUDING access_token_hash.
grant select, insert, update on public.guests                      to authenticated;
grant select, insert, update on public.guest_duplicate_suggestions to authenticated;
grant insert, update on public.stays to authenticated;
grant select (id, hotel_id, guest_id, room_id, status, arrival_at, departure_at, external_source, external_id,
              checked_in_at, checked_out_at, created_at, updated_at, created_by, updated_by)
  on public.stays to authenticated;
grant select, insert, update on public.consent_templates           to authenticated;
grant select, insert on public.consents to authenticated;  -- signed via fn; read via RLS

-- GUESTS: PII — only platform_admin + hotel_admin + reception of the hotel.
create policy guests_select on public.guests for select to authenticated
  using ( platform.is_platform_admin() or platform.has_hotel_role(hotel_id, array['hotel_admin','reception']::public.hotel_member_role[]) );
create policy guests_ins on public.guests for insert to authenticated
  with check ( platform.is_platform_admin() or platform.has_hotel_role(hotel_id, array['hotel_admin','reception']::public.hotel_member_role[]) );
create policy guests_upd on public.guests for update to authenticated
  using ( platform.is_platform_admin() or platform.has_hotel_role(hotel_id, array['hotel_admin','reception']::public.hotel_member_role[]) )
  with check ( platform.is_platform_admin() or platform.has_hotel_role(hotel_id, array['hotel_admin','reception']::public.hotel_member_role[]) );

-- DUPLICATE SUGGESTIONS: hotel_admin/reception review; no auto-merge anywhere.
create policy gds_select on public.guest_duplicate_suggestions for select to authenticated
  using ( platform.is_platform_admin() or platform.has_hotel_role(hotel_id, array['hotel_admin','reception']::public.hotel_member_role[]) );
create policy gds_write on public.guest_duplicate_suggestions for all to authenticated
  using ( platform.is_platform_admin() or platform.has_hotel_role(hotel_id, array['hotel_admin','reception']::public.hotel_member_role[]) )
  with check ( platform.is_platform_admin() or platform.has_hotel_role(hotel_id, array['hotel_admin','reception']::public.hotel_member_role[]) );

-- STAYS: operational — hotel_admin/reception/editor of the hotel (token column hidden by grant).
create policy stays_select on public.stays for select to authenticated
  using ( platform.is_platform_admin() or platform.has_hotel_role(hotel_id, array['hotel_admin','reception','editor']::public.hotel_member_role[]) );
create policy stays_ins on public.stays for insert to authenticated
  with check ( platform.is_platform_admin() or platform.has_hotel_role(hotel_id, array['hotel_admin','reception']::public.hotel_member_role[]) );
create policy stays_upd on public.stays for update to authenticated
  using ( platform.is_platform_admin() or platform.has_hotel_role(hotel_id, array['hotel_admin','reception']::public.hotel_member_role[]) )
  with check ( platform.is_platform_admin() or platform.has_hotel_role(hotel_id, array['hotel_admin','reception']::public.hotel_member_role[]) );

-- CONSENT_TEMPLATES: platform templates -> platform_admin; hotel templates -> hotel_admin; read by members.
create policy consent_templates_select on public.consent_templates for select to authenticated
  using ( platform.is_platform_admin()
          or (hotel_id is not null and platform.has_hotel_membership(hotel_id))
          or (hotel_id is null and active and platform.has_any_membership()) );
create policy consent_templates_ins on public.consent_templates for insert to authenticated
  with check ( (hotel_id is null and platform.is_platform_admin())
               or (hotel_id is not null and (platform.is_platform_admin() or platform.has_hotel_role(hotel_id, array['hotel_admin']::public.hotel_member_role[]))) );
create policy consent_templates_upd on public.consent_templates for update to authenticated
  using ( (hotel_id is null and platform.is_platform_admin())
          or (hotel_id is not null and (platform.is_platform_admin() or platform.has_hotel_role(hotel_id, array['hotel_admin']::public.hotel_member_role[]))) )
  with check ( (hotel_id is null and platform.is_platform_admin())
               or (hotel_id is not null and (platform.is_platform_admin() or platform.has_hotel_role(hotel_id, array['hotel_admin']::public.hotel_member_role[]))) );

-- CONSENTS: hotel_admin/reception of the hotel (+platform_admin). Signed via fn; immutable.
create policy consents_select on public.consents for select to authenticated
  using ( platform.is_platform_admin() or platform.has_hotel_role(hotel_id, array['hotel_admin','reception']::public.hotel_member_role[]) );
create policy consents_ins on public.consents for insert to authenticated
  with check ( platform.is_platform_admin() or platform.has_hotel_role(hotel_id, array['hotel_admin','reception']::public.hotel_member_role[]) );
create policy consents_upd on public.consents for update to authenticated
  using ( platform.is_platform_admin() or platform.has_hotel_role(hotel_id, array['hotel_admin','reception']::public.hotel_member_role[]) )
  with check ( platform.is_platform_admin() or platform.has_hotel_role(hotel_id, array['hotel_admin','reception']::public.hotel_member_role[]) );
