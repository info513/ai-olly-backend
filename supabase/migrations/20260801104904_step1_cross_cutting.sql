-- ============================================================================
-- AI OLLY Platform 2.0 — Migration Step 1: cross-cutting schema
-- ----------------------------------------------------------------------------
-- Scope: ENUMS, translations, content_versions, audit_log, retention_policies,
-- helper trigger functions, RLS + privileges. NO business-domain tables.
-- Target: aiolly-dev only. Fail-closed by default.
-- Idempotent: safe to re-run / rebuild via `supabase db reset`.
-- ============================================================================

-- ── ENUMS ────────────────────────────────────────────────────────────────────
-- Only cross-cutting enums. No speculative domain enums (rooms/services/etc.).

do $$ begin
  -- content lifecycle state (Draft -> Preview -> Published -> Archived)
  if not exists (select 1 from pg_type where typname = 'content_status') then
    create type public.content_status as enum ('draft','preview','published','archived');
  end if;
  -- audit action verbs
  if not exists (select 1 from pg_type where typname = 'audit_action') then
    create type public.audit_action as enum
      ('create','update','publish','unpublish','archive','restore','delete','login','export');
  end if;
  -- retention action to apply when a policy fires
  if not exists (select 1 from pg_type where typname = 'retention_action') then
    create type public.retention_action as enum ('delete','anonymize','archive');
  end if;
  -- who performed an audited action (backend service vs a dashboard user vs system job)
  if not exists (select 1 from pg_type where typname = 'actor_type') then
    create type public.actor_type as enum ('service','user','system');
  end if;
end $$;

-- ── Helper trigger functions ─────────────────────────────────────────────────
-- Reuse platform.set_updated_at() from the foundation migration.

-- Normalize locale to lowercase/trimmed so the unique key is stable.
create or replace function platform.normalize_locale()
returns trigger
language plpgsql
as $$
begin
  new.locale := lower(btrim(new.locale));
  return new;
end;
$$;

-- Append-only guard: block any UPDATE on immutable tables (content_versions,
-- audit_log). DELETE is controlled via privileges (not granted to app roles);
-- the table owner retains a path for future, controlled retention jobs.
create or replace function platform.block_row_update()
returns trigger
language plpgsql
as $$
begin
  raise exception 'Table %.% is append-only; UPDATE is not permitted',
    tg_table_schema, tg_table_name using errcode = '0A000';
end;
$$;

-- Integrity: set a sha256 checksum of the snapshot on insert if not supplied.
create or replace function platform.set_content_version_checksum()
returns trigger
language plpgsql
as $$
begin
  if new.checksum is null then
    new.checksum := encode(
      extensions.digest(convert_to(new.snapshot::text, 'UTF8'), 'sha256'), 'hex'
    );
  end if;
  return new;
end;
$$;

-- ── translations (generic localization) ──────────────────────────────────────
create table if not exists public.translations (
  id          uuid primary key default gen_random_uuid(),
  entity_type text not null,
  entity_id   uuid not null,
  field_key   text not null,
  locale      text not null,
  value       text not null,                    -- text: ordinary translated strings (justified in docs)
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid,
  updated_by  uuid,
  constraint translations_locale_format check (locale ~ '^[a-z]{2}(-[a-z]{2})?$'),
  constraint translations_unique unique (entity_type, entity_id, field_key, locale)
);

create index if not exists translations_entity_idx on public.translations (entity_type, entity_id);

drop trigger if exists trg_translations_normalize_locale on public.translations;
create trigger trg_translations_normalize_locale
  before insert or update on public.translations
  for each row execute function platform.normalize_locale();

drop trigger if exists trg_translations_set_updated_at on public.translations;
create trigger trg_translations_set_updated_at
  before update on public.translations
  for each row execute function platform.set_updated_at();

-- ── content_versions (immutable snapshots) ───────────────────────────────────
create table if not exists public.content_versions (
  id                        uuid primary key default gen_random_uuid(),
  entity_type               text not null,
  entity_id                 uuid not null,
  version_number            integer not null,
  status                    public.content_status not null default 'draft',
  snapshot                  jsonb not null,
  translations_snapshot     jsonb,
  change_summary            text,
  checksum                  text,
  hotel_id                  uuid,                 -- nullable until tenancy (Step 2)
  restored_from_version_id  uuid references public.content_versions(id),
  published_at              timestamptz,
  created_at                timestamptz not null default now(),
  created_by                uuid,
  constraint content_versions_unique unique (entity_type, entity_id, version_number),
  constraint content_versions_vnum_positive check (version_number > 0)
);

create index if not exists content_versions_entity_idx on public.content_versions (entity_type, entity_id);
create index if not exists content_versions_status_idx on public.content_versions (status);

drop trigger if exists trg_content_versions_checksum on public.content_versions;
create trigger trg_content_versions_checksum
  before insert on public.content_versions
  for each row execute function platform.set_content_version_checksum();

drop trigger if exists trg_content_versions_immutable on public.content_versions;
create trigger trg_content_versions_immutable
  before update on public.content_versions
  for each row execute function platform.block_row_update();

-- ── audit_log (append-only) ──────────────────────────────────────────────────
create table if not exists public.audit_log (
  id             uuid primary key default gen_random_uuid(),
  occurred_at    timestamptz not null default now(),
  actor_user_id  uuid,
  actor_type     public.actor_type not null default 'system',
  hotel_id       uuid,                            -- nullable until tenancy (Step 2)
  entity_type    text not null,
  entity_id      uuid,
  action         public.audit_action not null,
  before_state   jsonb,                           -- app layer MUST redact secrets/tokens
  after_state    jsonb,                           -- app layer MUST redact secrets/tokens
  metadata       jsonb,
  correlation_id text,
  ip_address     inet,
  user_agent     text
);

create index if not exists audit_log_entity_idx    on public.audit_log (entity_type, entity_id);
create index if not exists audit_log_hotel_idx     on public.audit_log (hotel_id);
create index if not exists audit_log_occurred_idx  on public.audit_log (occurred_at);
create index if not exists audit_log_actor_idx     on public.audit_log (actor_user_id);

drop trigger if exists trg_audit_log_immutable on public.audit_log;
create trigger trg_audit_log_immutable
  before update on public.audit_log
  for each row execute function platform.block_row_update();

-- ── retention_policies (configurable; NO assumed legal periods) ───────────────
create table if not exists public.retention_policies (
  id             uuid primary key default gen_random_uuid(),
  data_type      text not null,
  hotel_id       uuid,                            -- null = platform default; set = hotel override (Step 2)
  jurisdiction   text,
  effective_from date not null default current_date,
  effective_to   date,
  retention_days integer,                         -- null = indefinite
  action         public.retention_action not null,
  configuration  jsonb,
  active         boolean not null default true,
  legal_basis    text,
  notes          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  created_by     uuid,
  updated_by     uuid,
  constraint retention_days_nonneg check (retention_days is null or retention_days >= 0),
  constraint retention_effective_range check (effective_to is null or effective_to >= effective_from)
);

create index if not exists retention_policies_data_type_idx on public.retention_policies (data_type);
create index if not exists retention_policies_hotel_idx     on public.retention_policies (hotel_id);
create index if not exists retention_policies_active_idx    on public.retention_policies (active);

drop trigger if exists trg_retention_set_updated_at on public.retention_policies;
create trigger trg_retention_set_updated_at
  before update on public.retention_policies
  for each row execute function platform.set_updated_at();

-- NOTE: no rows seeded — no assumed legal retention periods (decision Q3).

-- ── RLS + privileges (fail-closed) ───────────────────────────────────────────
-- Phase-1 posture: RLS enabled, NO permissive policies (deny anon + authenticated).
-- Privileges revoked from anon/authenticated/PUBLIC; granted narrowly to service_role.
-- service_role has bypassrls; the backend connects as service_role. Tenant-aware
-- policies + grants to authenticated are ADDED in Step 2 (no table recreation).

alter table public.translations       enable row level security;
alter table public.content_versions   enable row level security;
alter table public.audit_log          enable row level security;
alter table public.retention_policies enable row level security;

-- Belt-and-braces: remove any default grants to public/anon/authenticated.
revoke all on public.translations,
              public.content_versions,
              public.audit_log,
              public.retention_policies
  from public, anon, authenticated;

-- Backend (service_role) grants — least privilege per table.
grant select, insert, update, delete on public.translations       to service_role;  -- translations are editable
grant select, insert                 on public.content_versions   to service_role;  -- append-only (no update/delete)
grant select, insert                 on public.audit_log          to service_role;  -- append-only (no update/delete)
grant select, insert, update         on public.retention_policies to service_role;  -- editable; deactivate via `active` (no delete)
