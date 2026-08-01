# Database Migration — Package A (Steps 5, 6, 7)

**Destination Content · Presentation Layer · Pricing**

**Branch:** `feature/ai-olly-platform-2` · **Target:** `aiolly-dev` (mcgrccvvybgcozeqlisj) only
**Status:** applied to dev, verified **90/90**. No production writes. `DATA_PROVIDER=airtable`.

One implementation package delivering the shared-destination content model, the per-hotel
presentation overlay, and the pricing model — all wired into the Step 1 cross-cutting spine
(`content_versions`, `audit_log`, `retention_policies`) with **no duplicated version systems**.
Guest PWA, `server/server.js`, production Render/Airtable/`main` untouched.

## Migrations
- `20260802100000_step5_destination_content.sql` — canonical POIs/Routes/Whispers/Events.
- `20260802100100_step6_presentation_layer.sql` — hotel presentation settings + resolved destination models.
- `20260802100200_step7_pricing.sql` — price categories/items, resolution, publishing/versioning.

## Architecture at a glance
```
destinations (Step 2)
   │  1:N (platform-owned, canonical)
   ├── destination_pois ──┐
   ├── destination_routes ─┤   Pattern B overlay (no field-level merge)
   ├── destination_whispers┤        │
   └── destination_events ─┘        │  hotel_{poi,route,whisper,event}_settings (hotel_id + content_id)
                                     ▼
                     resolved_destination_{pois,routes,whispers,events}(hotel)

price_categories ──1:N── price_items   Pattern A (platform default → hotel override)
                                     ▼
                          resolved_price_items(hotel)   (+ computed net/gross)
```

---

## STEP 5 — Destination Content (canonical, platform-owned)

### Tables
- **`destination_pois`** — `destination_id`, `key` (unique per destination), `name`, `category`
  (`poi_category` enum), `short_description`, structured `body_content jsonb`, `latitude`/`longitude`
  (bounded), `address`, `status` (`content_status`), `active`, `sort_order`, `published_at`, legacy id.
- **`destination_routes`** — `+ difficulty` (`route_difficulty` enum), `distance_km`, `duration_minutes`,
  `waypoints jsonb`.
- **`destination_whispers`** — curated local tips keyed by `channel_key` (stable machine key; the
  12-channel model is data, not schema — no enum to guess), `title`, `body_content`.
- **`destination_events`** — `title`, `starts_at`/`ends_at` (range-checked), `all_day`,
  `location_name`, `latitude`/`longitude`, `recurrence` (optional).

All four reuse `platform.is_valid_service_body()` for structured JSONB block bodies (same typed-block
format as Step 4 — no raw HTML). Enums added: `poi_category`, `route_difficulty`.

### Ownership & publishing
Destination content is **platform-owned — hotels never edit it**. Only `platform_admin` writes
(RLS). `public.publish_destination_content(entity_type, entity_id, change_summary)` (SECURITY
DEFINER, `platform_admin` only) flips `status='published'`, stamps `published_at`, and writes an
immutable `content_versions` snapshot (dynamic table by **whitelisted** entity_type — no injection).
`platform.protect_destination_publish()` blocks direct `status='published'` UPDATEs so every publish
produces a version. Redacted audit via shared `platform.audit_destination_content()` (entity_type
derived from `TG_TABLE_NAME`).

---

## STEP 6 — Presentation Layer (Pattern B)

### Tables (one per canonical type)
`hotel_poi_settings`, `hotel_route_settings`, `hotel_whisper_settings`, `hotel_event_settings` —
each `unique (hotel_id, <content>_id)` with presentation-only fields: `visible`, `featured`,
`sort_order_override`, and (where relevant) `walking_time_minutes`, `hotel_recommendation`,
`hotel_photo_url`, `hotel_short_description`.

**Pattern B, no field-level merge:** hotels never change canonical text. They toggle visibility,
feature, re-order, and attach **their own separate** recommendation/photo/short-description/walking
time. `platform.check_presentation_destination()` rejects settings that target content outside the
hotel's own destination (no cross-destination leakage). Redacted audit via
`platform.audit_presentation_settings()`.

### Resolved models
`resolved_destination_{pois,routes,whispers,events}(p_hotel)` (SECURITY INVOKER → caller RLS applies)
join the hotel → its destination's **published + active** canonical rows, overlay the hotel's
settings, exclude `visible=false`, order by `sort_order_override → canonical sort`. Events also
require `ends_at` null or in the future. Canonical fields are returned verbatim (name/description
never merged); no authoring metadata is exposed. Deterministic and tenant-safe (an other-hotel
admin resolving a foreign hotel gets an empty set — proven).

---

## STEP 7 — Pricing (Pattern A)

### Tables
- **`price_categories`** — `hotel_id` NULL = platform default; set = hotel scope. Per-scope unique
  `key` (two partial unique indexes).
- **`price_items`** — `hotel_id` NULL = platform default; set + `override_of_price_item_id` = a hotel
  **override** of a platform default (Pattern A). `amount numeric(12,2)`, `currency` (ISO check),
  `vat_rate` (0–100), `vat_included` (is `amount` gross?), `billing_unit` (`price_billing_unit`
  enum: per_night / per_person / per_person_per_night / per_stay / per_item / per_use / per_hour /
  flat), `status`, `active`, `source_type` (derived; reuses `service_source_type`),
  `valid_from`/`valid_to`, `published_at`, **`pms_metadata jsonb` (future PMS fields — NOT
  integrated)**, legacy id.

### Integrity, protection, publishing
`platform.normalize_price_item()` derives `source_type`; `platform.check_price_relations()` enforces
override-target = platform default and category scope; `platform.protect_price_item_columns()` locks
tenancy/link/key/`published_at` for non-privileged callers and blocks direct publish.
`public.publish_price_item(item, change_summary)` (SECURITY DEFINER; `platform_admin` for platform
defaults, `hotel_admin`/`editor` for own-hotel) writes an immutable `content_versions` snapshot.
Redacted audit via `platform.audit_price_item()` / `platform.audit_price_category()`.

### Resolved pricing
`resolved_price_items(p_hotel)` (SECURITY INVOKER): published + active + within validity window;
hotel override wins over its platform default (no duplicates); returns **computed** `net_amount` and
`gross_amount` from `amount`/`vat_rate`/`vat_included`
(`net = amount/(1+vat/100)` or `gross = amount*(1+vat/100)` as appropriate, rounded to 2 dp).
Verified: VAT-included 35.00 → net 28.00 / gross 35.00; VAT-excluded 20.00 → net 20.00 / gross 25.00.

---

## Inheritance strategy (summary)
| Domain | Pattern | Resolution |
|---|---|---|
| Destination content (POI/route/whisper/event) | **B** — canonical shared + hotel presentation | canonical verbatim + settings overlay; `visible=false` hides; no field merge |
| Pricing (price_items) | **A** — platform default ↔ hotel override | override replaces default; no field merge; no duplicates |

Both are **deterministic** and **tenant-safe** via SECURITY INVOKER resolved functions that inherit
the caller's RLS.

## RLS matrix
| Table(s) | SELECT | Write |
|---|---|---|
| `destination_*` (canonical) | `platform_admin`; else published+active AND `has_destination_access` | `platform_admin` only |
| `hotel_*_settings` (presentation) | `platform_admin` or hotel member | `platform_admin` or `hotel_admin`/`editor` of that hotel |
| `price_categories` | platform-scope: member; hotel-scope: member | platform: `platform_admin`; hotel: `hotel_admin`/`editor` |
| `price_items` | authors see all statuses; members see published; published platform defaults visible to any member | platform: `platform_admin`; hotel: `hotel_admin`/`editor`; no hard delete (archive) |
| `anon` / no-membership / suspended | — | — |
| `service_role` (Render) | select/insert/update (settings also delete) | — |

Every table: RLS enabled from row one; **REVOKE ALL** then precise GRANT; no anonymous access;
cross-tenant isolation (canonical by destination access, everything else by hotel membership);
platform defaults protected; hotel overrides editable only by assigned roles.

## Versioning & audit integration
Publishing (destination content, price items) writes **Step 1 `content_versions`** — immutable
snapshots keyed by `(entity_type, entity_id, version_number)`; append-only trigger blocks historical
mutation. All create/update/publish/archive/restore events append **redacted** rows to Step 1
`audit_log` (no secrets/tokens/PII). `retention_policies` remains the single retention config surface;
these new `entity_type`/`data_type` values (`destination_poi`, `destination_route`,
`destination_whisper`, `destination_event`, `price_item`, `hotel_*_settings`) are valid targets — no
parallel version/retention system was introduced.

## Synthetic seed
`supabase/seed.sql` (dev only): Split Test destination gets two published POIs, a route, a whisper,
and a future event; Demo Hotel presentation features the palace (5-min walk + recommendation) and
hides the Riva; pricing gets a platform-default airport transfer, a Demo Hotel override (35 vs 40),
and a native late-checkout. No Antique Split / production data.

## Future Airtable mapping (documentation only; nothing migrated)
- Airtable POI/attraction rows → `destination_pois` (category → `poi_category`, description →
  structured blocks, coordinates → lat/lng, record id → `legacy_airtable_record_id`).
- Whisper channels → `destination_whispers.channel_key`; events → `destination_events`.
- Per-hotel tweaks (walking time, "our tip", hero photo) → `hotel_*_settings` (never canonical).
- Airtable price lists → `price_items` (+ `price_categories`); VAT/unit → `vat_rate`/`vat_included`/
  `billing_unit`; hotel-specific prices → overrides. Resolved functions later back the existing
  Render response contracts (filtered per channel) — **no endpoint changed here**.

## Known limitations (R1)
- Multi-locale text (translations join) deferred to the i18n step.
- No PMS integration — `pms_metadata` is a nullable placeholder only.
- Whisper channels are data-driven (`channel_key`), not a fixed enum — a channel registry can be
  added later if canonicalization is required.
- Recurrence on events is a free-text placeholder (no RRULE expansion engine in R1).

## Rollback / rebuild
Forward-only. Rebuild dev with `supabase db reset` (re-applies all migrations + seed). No manual
dashboard edits were made.

## Architectural discoveries
1. **Dynamic-but-safe publish across 4 canonical tables** — a single SECURITY DEFINER
   `publish_destination_content()` uses `format(%I)` on a **whitelisted** table name, avoiding four
   near-identical functions while staying injection-proof.
2. **Shared audit via `to_jsonb(NEW)`** — one trigger function serves multiple tables by extracting
   fields with `->>` (a shared plpgsql trigger can't reference table-specific columns statically);
   `TG_TABLE_NAME` maps to the audit `entity_type`.
3. **Pattern B vs A confirmed distinct** — presentation (B) never touches canonical text, so no
   column guard on canonical is needed beyond platform-only RLS; pricing (A) reuses the Step 4
   override/dedup resolution shape, confirming that shape generalizes across domains.

## Test evidence
- `npm run verify:supabase:step567` → **90 passed, 0 failed** (real Auth users `*@verify.local`):
  catalog/RLS/anon-deny, canonical cross-tenant isolation, platform-only canonical writes,
  direct-publish block + RPC publish + versioning, presentation overlay/hide/scope, resolved
  destination models (tenant-safe, validity), price override/dedup, net/gross VAT math, price
  validity/visibility, publish/version, column protection, audit. Synthetic data + users cleaned up;
  no secrets logged.
- Regressions: Step 1 **35/0**, Step 2 **50/0**, Step 3 **40/0**, Step 4 **76/0**.
- Server boots (HTTP 200 on `/api/health`) with `DATA_PROVIDER=airtable`; `server/server.js` and
  `pwa/` unchanged from `v1.0.0-antique`; `main` frozen at `b158278`.
