-- ============================================================================
-- AI OLLY Platform 2.0 — Foundation migration (Phase 1)
-- ----------------------------------------------------------------------------
-- PURPOSE: prove the migration workflow only. This is the SMALLEST safe
-- foundation — NO business schema (no hotels/rooms/guests/services/POIs/consent).
-- Those arrive in the Database phase after the discovery questions are answered.
--
-- SAFE TO RUN on an EMPTY development project. Contains no data, no PII.
-- Reversible: `supabase db reset` rebuilds from scratch (dev only).
-- ============================================================================

-- Required extensions (idempotent) --------------------------------------------
create extension if not exists "pgcrypto" with schema "extensions";   -- gen_random_uuid()
-- NOTE: pgvector is intentionally NOT enabled yet (Phase 9 / future).

-- Private platform schema -----------------------------------------------------
-- Server-only helpers and metadata. NOT exposed via PostgREST (see config.toml
-- api.schemas). The guest PWA and browser clients can never reach this schema.
create schema if not exists platform;

comment on schema platform is
  'AI OLLY Platform internal helpers/metadata. Server-only; not exposed via PostgREST.';

-- Reusable audit helper (used by future tables' updated_at triggers) ----------
create or replace function platform.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

comment on function platform.set_updated_at() is
  'Trigger helper: sets updated_at = now() on row update. Reused by future tables.';

-- Foundation metadata (single-row marker so we can verify the migration ran) --
create table if not exists platform.foundation_meta (
  id           smallint primary key default 1,
  bootstrapped boolean  not null default true,
  phase        text     not null default 'phase-1-foundation',
  created_at   timestamptz not null default now(),
  constraint foundation_meta_singleton check (id = 1)
);

insert into platform.foundation_meta (id) values (1)
  on conflict (id) do nothing;

-- Health-check function (harmless; no data). Exposed in `public` so the
-- server-side connection test can call it via PostgREST RPC. Returns only a
-- status object — no rows, no PII.
create or replace function public.platform_health()
returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'ok', true,
    'phase', 'phase-1-foundation',
    'ts', now()
  );
$$;

comment on function public.platform_health() is
  'Connectivity health check for AI OLLY Platform 2.0. Returns status only, no data.';

-- Allow the app roles to execute the health check (bootstrap test only).
grant execute on function public.platform_health() to anon, authenticated, service_role;
