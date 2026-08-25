-- ============================================================================
-- Rentlio / PMS integration foundation (Phase R2) — provider-agnostic.
-- ----------------------------------------------------------------------------
-- Additive only. Adds a generic PMS integration layer WITHOUT scattering
-- rentlio_* columns across core tables:
--   • hotel_integrations      — one PMS connection per hotel-provider (config + health).
--   • external_entity_mappings — Rentlio unit/unit-type ↔ AI OLLY room/room_type.
--   • integration_events       — webhook ingestion log (idempotency + dead-letter).
--   • sync_runs                — initial-sync / reconciliation run log (observability).
-- Reservations & guests keep using the existing stays.external_source/external_id and
-- guests.external_source/external_id (no new columns there). stay_status already has
-- 'no_show'. No production, no DATA_PROVIDER change. Forward-only, aiolly-dev.
--
-- Security: SELECT/WRITE restricted to platform_admin + hotel_admin (reception/editor/
-- marketing/read_only never manage PMS). integration_events/sync_runs are written only
-- by the server (service-role bypasses RLS); authenticated clients get read-only. No raw
-- credential or webhook token is stored — only a server-side secret *reference* and a
-- token *hash*. RLS is authoritative and hotel-scoped (no cross-hotel access).
-- ============================================================================

-- ── enums ────────────────────────────────────────────────────────────────────
create type public.pms_provider as enum ('rentlio');
create type public.pms_integration_status as enum ('disconnected','needs_mapping','syncing','healthy','degraded','error');
create type public.pms_mapping_entity as enum ('room','room_type');
create type public.pms_event_status as enum ('received','processed','skipped','error','dead_letter');
create type public.pms_sync_type as enum ('initial','manual','reconcile');
create type public.pms_run_status as enum ('running','completed','failed');

-- ── hotel_integrations ────────────────────────────────────────────────────────
create table public.hotel_integrations (
  id uuid primary key default gen_random_uuid(),
  hotel_id uuid not null references public.hotels(id) on delete cascade,
  provider public.pms_provider not null,
  status public.pms_integration_status not null default 'disconnected',
  external_property_id text,
  credential_ref text,        -- server-side secret REFERENCE (never the API key itself)
  webhook_token_hash text,    -- sha256 of the per-hotel webhook shared token (never the raw token)
  settings jsonb not null default '{}'::jsonb,
  last_synced_at timestamptz,
  last_error text,            -- safe, redacted summary only
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  unique (hotel_id, provider) -- one integration per hotel-provider
);
create index hotel_integrations_hotel_idx on public.hotel_integrations (hotel_id);

-- ── external_entity_mappings ──────────────────────────────────────────────────
create table public.external_entity_mappings (
  id uuid primary key default gen_random_uuid(),
  integration_id uuid not null references public.hotel_integrations(id) on delete cascade,
  hotel_id uuid not null references public.hotels(id) on delete cascade,   -- denormalized for RLS
  entity_type public.pms_mapping_entity not null,
  external_id text not null,          -- Rentlio unit id / unit-type id
  external_name text,                 -- provider display (may be renamed provider-side)
  room_id uuid references public.rooms(id) on delete set null,        -- when entity_type='room' (null = unmapped)
  room_type_id uuid references public.room_types(id) on delete set null,  -- when entity_type='room_type'
  active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (integration_id, entity_type, external_id)  -- provider identity unique within integration
);
create index external_entity_mappings_integration_idx on public.external_entity_mappings (integration_id);
-- One AI OLLY room may back at most one active external unit (no accidental double-map):
create unique index external_entity_mappings_room_unique
  on public.external_entity_mappings (integration_id, room_id) where room_id is not null and active;

-- ── integration_events (webhook ingestion) ────────────────────────────────────
create table public.integration_events (
  id uuid primary key default gen_random_uuid(),
  integration_id uuid not null references public.hotel_integrations(id) on delete cascade,
  hotel_id uuid not null references public.hotels(id) on delete cascade,
  provider public.pms_provider not null,
  provider_event_id text not null,    -- Rentlio event.id (UUIDv4)
  event_type text not null,
  external_entity_id text,            -- reservation id
  status public.pms_event_status not null default 'received',
  attempt_count int not null default 0,
  safe_error text,
  payload_digest text,                -- sha256 of the raw payload
  payload jsonb,                      -- PII-minimized sanitized payload (no cards/docs/notes)
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  unique (integration_id, provider_event_id)  -- idempotency: duplicate webhook is harmless
);
create index integration_events_integration_idx on public.integration_events (integration_id, received_at desc);

-- ── sync_runs (observability) ─────────────────────────────────────────────────
create table public.sync_runs (
  id uuid primary key default gen_random_uuid(),
  integration_id uuid not null references public.hotel_integrations(id) on delete cascade,
  hotel_id uuid not null references public.hotels(id) on delete cascade,
  sync_type public.pms_sync_type not null,
  status public.pms_run_status not null default 'running',
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  records_seen int not null default 0,
  records_created int not null default 0,
  records_updated int not null default 0,
  records_skipped int not null default 0,
  records_failed int not null default 0,
  needs_mapping int not null default 0,
  safe_error text,
  created_at timestamptz not null default now()
);
create index sync_runs_integration_idx on public.sync_runs (integration_id, started_at desc);

-- ── RLS ───────────────────────────────────────────────────────────────────────
alter table public.hotel_integrations       enable row level security;
alter table public.external_entity_mappings enable row level security;
alter table public.integration_events       enable row level security;
alter table public.sync_runs                enable row level security;

-- Config + mappings: platform_admin OR hotel_admin only (never reception/editor/marketing/read_only).
do $mig$
declare t text;
begin
  foreach t in array array['hotel_integrations','external_entity_mappings'] loop
    execute format($f$
      create policy %1$s_select on public.%1$I for select to authenticated
        using ( platform.is_platform_admin()
                or platform.has_hotel_role(hotel_id, array['hotel_admin']::public.hotel_member_role[]) );
      create policy %1$s_ins on public.%1$I for insert to authenticated
        with check ( platform.is_platform_admin()
                     or platform.has_hotel_role(hotel_id, array['hotel_admin']::public.hotel_member_role[]) );
      create policy %1$s_upd on public.%1$I for update to authenticated
        using ( platform.is_platform_admin()
                or platform.has_hotel_role(hotel_id, array['hotel_admin']::public.hotel_member_role[]) )
        with check ( platform.is_platform_admin()
                     or platform.has_hotel_role(hotel_id, array['hotel_admin']::public.hotel_member_role[]) );
      create policy %1$s_del on public.%1$I for delete to authenticated
        using ( platform.is_platform_admin()
                or platform.has_hotel_role(hotel_id, array['hotel_admin']::public.hotel_member_role[]) );
    $f$, t);
  end loop;

  -- Event + run logs: read-only for platform_admin + hotel_admin; writes are server-only
  -- (service-role bypasses RLS). No insert/update/delete policy for authenticated => denied.
  foreach t in array array['integration_events','sync_runs'] loop
    execute format($f$
      create policy %1$s_select on public.%1$I for select to authenticated
        using ( platform.is_platform_admin()
                or platform.has_hotel_role(hotel_id, array['hotel_admin']::public.hotel_member_role[]) );
    $f$, t);
  end loop;
end $mig$;

-- ── grants (anon fully denied; authenticated gated by RLS above) ───────────────
revoke all on public.hotel_integrations, public.external_entity_mappings, public.integration_events, public.sync_runs from anon;
grant select, insert, update, delete on public.hotel_integrations       to authenticated;
grant select, insert, update, delete on public.external_entity_mappings to authenticated;
grant select on public.integration_events to authenticated;
grant select on public.sync_runs to authenticated;

comment on table public.hotel_integrations is 'Per-hotel PMS (Rentlio) connection config + health. Credentials are a server-side reference/hash only — never the raw key/token.';
comment on table public.external_entity_mappings is 'Rentlio unit/unit-type ↔ AI OLLY room/room_type mapping. room_id NULL = unmapped unit (reservation sync yields NEEDS_MAPPING, never a wrong room).';
comment on table public.integration_events is 'Webhook ingestion log. UNIQUE(integration_id, provider_event_id) makes duplicate webhook processing idempotent.';
comment on table public.sync_runs is 'Initial-sync / reconciliation run log for observability. No scheduler in R2.';
