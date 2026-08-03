# Antique Split — Migration Plan (Airtable → Supabase)

**Sprint 9 · Part 20.** The repeatable, reversible DEV migration procedure. Companion to
[Discovery](ANTIQUE_SPLIT_MIGRATION_DISCOVERY.md). Production cutover is **out of scope**.

## Pipeline (all read-only against Airtable; writes only to aiolly-dev)

| Stage | Script | Effect | Safety |
|---|---|---|---|
| Export | `scripts/migration/export-airtable-antique.mjs` | Airtable → `raw/` (gitignored) | GET-only; PII tables count-only; tokens stay in raw |
| Normalize | `scripts/migration/normalize-antique.mjs` | `raw/` → `normalized/` | Pure transform; deterministic; no network |
| Import (dry-run) | `import-antique-to-supabase.mjs` | BEGIN…ROLLBACK | No writes persist; accurate counts |
| Import (apply) | `import-antique-to-supabase.mjs --apply` | Idempotent upsert → aiolly-dev | DEV-ref guard; ON CONFLICT; tokens exact |
| Compare | `compare-antique-providers.mjs` | Source ↔ Supabase parity → `reports/` | Read-only; hash-only token check |
| Reset | `rollback-antique-dev-import.mjs --apply` | Delete imported content only | Hotel-scoped; keeps tenant shell + guest data |

Dashboard equivalents run each stage server-side from **/platform/migration** (platform_admin only).

## Idempotency & reversibility

- Every entity upserts on a natural key (`slug`, `(hotel_id, key)`, `(destination_id, key)`,
  `(hotel_id, room_number)`) or `legacy_airtable_record_id`. A second apply updates in place —
  **proven**: first apply = 245 created; second = 245 updated, 0 created.
- Reset deletes only the imported content (scoped to the antique-split hotel + legacy-marked
  destination rows), then a re-import recreates it with **identical room tokens** (proven by
  SHA-256 comparison across a reset→reimport cycle).

## Ordering (FK-safe)

destination → hotel → room_types → rooms → service_categories → hotel_services →
destination_pois → hotel_poi_settings → destination_routes → hotel_route_settings →
destination_events → hotel_event_settings → price_categories → price_items → ai_configs.

## Guards

1. `assertDevSupabase()` aborts unless the Supabase ref is `mcgrccvvybgcozeqlisj` (aiolly-dev).
2. Airtable client exposes only `airtableGet` (GET); no mutation verb exists.
3. `raw/normalized/manifests/reports` are gitignored; room tokens never leave `raw`/`tokens.local`.
4. Dashboard routes require `is_platform_admin`; credentials never reach the browser.

## Verification

- `dashboard/scripts/verify-antique-migration.mjs` — 39 checks (counts, idempotency, token
  preservation without printing, Pattern C, scope). 
- `dashboard/scripts/security-audit-migration.mjs` — 32 checks + pre-existing-leak warning.
- `compare-antique-providers.mjs` — domain parity, room PASS/OPEN matrix, service classification.
