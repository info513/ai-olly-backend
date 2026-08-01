# Database Migration — Step 4 (Hotel Services & Operational Content)

**Branch:** `feature/ai-olly-platform-2` · **Target:** `aiolly-dev` (mcgrccvvybgcozeqlisj) only
**Status:** applied to dev, verified **76/76**. No production writes. `DATA_PROVIDER=airtable`.

Hotel-owned operational content (Arrival & Departure, Guest Services, Breakfast &
Food, Transport & Parking, Policies & Safety, Minibar, Transfers, Wellness, Parking,
…) with a **Draft → Preview → Published → Live** workflow. Published content feeds
the guest PWA, the AI agent, the web assistant and the reception dashboard — with **no
deploy** required for content changes. Guest PWA and `server/server.js` untouched.

## Migrations
- `20260801213959_step4_hotel_services.sql` — schema, enums, validation, RLS, guards, audit, resolution.
- `20260801215014_step4_expose_publish_rpc.sql` — moves `publish/rollback` into `public` so PostgREST rpc can reach them (finding, below).

## Objects created

### Enum
- `public.service_source_type` — `platform` | `hotel` | `override` (derived, never user-set).
  Lifecycle status **reuses** Step 1's `public.content_status` (draft/preview/published/archived) — no new status enum.

### Tables
- **`public.service_categories`** — `hotel_id` NULL = platform default; set = hotel-specific/override
  (complete logical record, **no field-level merge**). Stable machine `key`, `sort_order`,
  `active`. **Key unique per scope** via two partial unique indexes (`key WHERE hotel_id IS NULL`;
  `(hotel_id, key) WHERE hotel_id IS NOT NULL`).
- **`public.hotel_services`** — the operational content. `hotel_id` NULL = platform default;
  set + `override_of_service_id` = a complete hotel **override** of a platform default (Pattern A).
  Structured `body_content jsonb` (validated), `status`, `active`, explicit visibility
  (`visible_in_pwa`, `visible_in_web`, `available_to_ai`), `sort_order`, `is_critical`,
  `source_type` (derived), `published_at` (server-set), `valid_from`/`valid_to`, critical-ack
  metadata, `legacy_airtable_record_id`. Same per-scope key uniqueness.
- **`public.hotel_service_settings`** — **presentation only** (`visible`, `featured`,
  `sort_order_override`, `category_override_id`). Justified: lets a hotel **hide** an inherited
  platform default, re-order, feature, or re-categorize **without cloning** the service. Never
  overrides title/body — content override remains a complete `hotel_services` record (Task 6).

### Structured content format (Task 2)
Canonical `body_content` is a **typed block document**, never raw HTML:
```json
{ "version": 1, "blocks": [
  { "type": "paragraph", "text": "…" },
  { "type": "heading", "level": 2, "text": "…" },
  { "type": "bullet_list", "items": ["…"] },
  { "type": "price_list", "items": [{ "label": "…", "price": "…", "note": "…" }] },
  { "type": "callout", "style": "info|warning", "text": "…" },
  { "type": "link", "label": "…", "url": "…" },
  { "type": "contact_action", "action": "call|email|whatsapp", "value": "…" },
  { "type": "divider" }
] }
```
Enforced by `CHECK (body_content IS NULL OR platform.is_valid_service_body(body_content))`:
must be an object with a `blocks` array where every block is an object carrying a known
`type`. **Why blocks, not HTML:** safe (no injected markup), portable (the renderer maps
blocks → guest HTML for PWA/web and → plain text for the AI), and queryable. Raw HTML strings,
typeless blocks, and unknown block types are rejected (verified).

## Visibility model (Task 3)
Airtable's implicit `AI_SOURCE` semantics are replaced by **four independent, explicitly
editable** booleans: `visible_in_pwa`, `visible_in_web`, `available_to_ai`, `active`.
Conceptual mapping: PWA = `visible_in_pwa`; WEB = `visible_in_web`; BOTH = both true;
AI availability is configured independently of channel. No Airtable values migrated.

## Publishing lifecycle (Tasks 4, 8, 11)
`public.publish_hotel_service(p_service, p_change_summary, p_acknowledge_critical)` (SECURITY
DEFINER) is the **only** publish path:
1. authorizes caller — `platform_admin` (any) or `hotel_admin`/`editor` (own hotel);
2. **critical content** (`is_critical`) requires `p_acknowledge_critical = true` — no one may
   silently publish critical content; **editors cannot bypass** the acknowledgement;
3. flips `status='published'`, stamps `published_at`, records `last_critical_ack_at/by`;
4. writes an **immutable** `content_versions` snapshot (`entity_type='hotel_service'`,
   next `version_number`, full JSON `snapshot`, `hotel_id`, `change_summary`, `created_by`).

Direct `status='published'` via a plain UPDATE is **blocked** by the column-guard trigger
(`use platform.publish_hotel_service()`), guaranteeing every publish produces a version.

`public.rollback_hotel_service(p_service, p_version)` loads a prior snapshot into the current
record as a **new draft** (content fields only); historical versions are never mutated, and a
new version is created only on the next publish.

## Platform default → hotel override resolution (Task 5, Pattern A)
- Hotel override wins when active/published (`override_of_service_id` → platform default);
- otherwise the platform default is used; **no field-level merge**;
- an inherited service is hidden for a hotel via `hotel_service_settings.visible = false`
  (the chosen hide mechanism — no duplicate content record needed).

`public.resolved_hotel_services(p_hotel)` (SECURITY INVOKER → caller RLS applies) returns the
deterministic **live** set for a hotel: published + active + within validity window; override
replaces its platform default (no duplicates); hidden services excluded; `featured`/`sort`/
`category` resolved from settings; source labelled; **no authoring metadata**. Drafts, previews,
archived, future-dated and expired rows are excluded.

## Validity & operational content (Task 7)
`valid_from`/`valid_to` (timestamptz). **Permanent/evergreen** = both NULL; **temporary/seasonal**
= a bound set (e.g. seasonal transfers, breakfast schedules, temporary parking notices). The
resolved model enforces the window. Critical **evergreen** facts (check-in/out, safety,
emergency) must keep `valid_to = NULL` so they never silently expire; the seed demonstrates a
permanent critical service and a separately-dated seasonal one.

## RLS matrix (Task 9)
| Scope / Role | SELECT | Write |
|---|---|---|
| **Platform defaults** (`hotel_id` NULL) — `platform_admin` | full | full |
| Platform defaults — hotel users (any active member) | published + active only | **none** |
| **Hotel-owned** — `platform_admin` | full | full |
| Hotel-owned — `hotel_admin` | all statuses | create/update/publish/archive |
| Hotel-owned — `editor` | all statuses | create/update/preview/publish; not tenancy/link/key; cannot bypass critical ack |
| Hotel-owned — `reception` | published only | none |
| Hotel-owned — `marketing` | published only | none (read-only in R1; future non-critical-edit split documented) |
| Hotel-owned — `read_only` | published only | none |
| `anon` / authenticated-without-membership / suspended | none | none |
| `service_role` (Render) | select/insert/update (no hard delete of services/categories) | — |

Uses Step 2 membership helpers + a new `platform.has_any_membership()` (so platform defaults are
visible only to users who belong to some hotel). No DELETE policy on services/categories —
**archive, never hard-delete** (Task 8).

## Column protection (Task 10)
`platform.protect_hotel_service_columns()` (guard trigger): for non-privileged callers,
`hotel_id`, `override_of_service_id`, `legacy_airtable_record_id`, `created_by`, `key`,
`published_at`, and critical-ack metadata are restored to their old values; direct publish is
blocked; `is_critical` is togglable only by `hotel_admin`. `platform.protect_service_category_columns()`
protects `hotel_id`/`key`/legacy/`created_by`. `source_type` is always derived by
`platform.normalize_hotel_service()`. Cross-row integrity
(`platform.check_service_relations()`, `check_service_settings_scope()`): override target must be
a platform default, only hotel services may override, category must be platform or same-hotel.

## Versioning integration (Task 11)
Publishing writes `public.content_versions` (Step 1) — immutable snapshots keyed by
`(entity_type='hotel_service', entity_id, version_number)`. Rollback reads a snapshot and
produces a new draft; the append-only trigger blocks any historical mutation (verified).

## Audit (Task 12)
SECURITY DEFINER triggers append **redacted** rows to Step 1 `audit_log` for
`hotel_service` (create/update/publish/archive/restore/delete + critical-ack flag),
`service_category` (create/update/delete) and `hotel_service_settings` (visibility/presentation).
`actor_type` = `user` when `auth.uid()` is present, else `service`. Snapshots carry only
non-secret status/flag/title fields — no tokens, no unnecessary personal data.

## Synthetic seed (Task 13)
`supabase/seed.sql` (dev only): five platform-default categories; a platform-default **critical**
check-in/out service; a Demo Hotel **override** of it (override wins); a **temporary/valid-dated**
breakfast service; an **AI-only** concierge-notes service; a **PWA+AI** airport transfer; and an
**archived** parking notice. No Antique Split / production data.

## Future Airtable mapping (documentation only; nothing migrated)
- `SERVICES.Name/Title` → `hotel_services.title`; a slugified stable name → `key`.
- Rich text/description → structured `body_content` blocks (renderer inverse for legacy import).
- `AI_SOURCE` (PWA/WEB/BOTH/AI) → the four explicit booleans (`visible_in_pwa`, `visible_in_web`,
  `available_to_ai`, `active`).
- Airtable category/grouping → `service_categories` (+ `hotel_service_settings.category_override`).
- Airtable record id → `legacy_airtable_record_id` for reconciliation.
- Current Render `/api/... services` responses will later be served from
  `resolved_hotel_services(hotel_id)` filtered by channel flag (PWA vs web vs AI) — the response
  contract stays the same shape; **no endpoint is changed in Step 4**.

## Known limitations (R1)
- `marketing` is read-only (documented future split to allow non-critical promotional edits).
- Multi-locale service text (translations join) deferred to the i18n step.
- Pricing is a nullable future reference only (no pricing engine in Step 4).
- `content_versions` remains service-role/function-only (dashboard lists versions via the backend).

## Rollback / rebuild
Forward-only. Rebuild dev from scratch with `supabase db reset` (re-applies all migrations +
seed). No manual dashboard edits were made.

## Architectural finding
Functions in the private `platform` schema are **not reachable via PostgREST rpc** (only
`public`/`graphql_public` are exposed). The publish/rollback primitives were therefore moved to
`public` (still SECURITY DEFINER, still authz-guarded internally; `anon` has no EXECUTE, so
PostgREST denies anonymous callers) via `20260801215014_step4_expose_publish_rpc.sql`.

## Test evidence
- `npm run verify:supabase:step4` → **76 passed, 0 failed** (real Auth users `*@verify.local`;
  RLS/tenant isolation, body validation, key uniqueness, override resolution & dedup, validity
  windows, independent visibility flags, publish/versioning, critical acknowledgement, rollback,
  column protection, settings authority, audit; synthetic data & users cleaned up; no secrets logged).
- Regressions: Step 1 **35/0**, Step 2 **50/0**, Step 3 **40/0**.
- Server boots (HTTP 200 on `/api/health`) with `DATA_PROVIDER=airtable`; `server/server.js` and
  `pwa/` unchanged from `v1.0.0-antique`; `main` frozen at `b158278`.
