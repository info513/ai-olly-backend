# AI OLLY — Rentlio / PMS Integration, Phase R2 (Implementation)

**Status:** DONE (aiolly-dev). DEV-only. No production, no `DATA_PROVIDER` change, no real Rentlio
account, no merge to `main`. Synthetic adapter only — R2 proves the whole pipeline with fabricated,
PII-free data so that R3 needs nothing but a real key + property ID + confirmed unit→room mapping.

Builds on the R1 design contract: [`AI_OLLY_RENTLIO_INTEGRATION_ARCHITECTURE.md`](AI_OLLY_RENTLIO_INTEGRATION_ARCHITECTURE.md).

---

## 1. What R2 delivers

A **provider-agnostic PMS integration layer** + a **synthetic Rentlio adapter**, wired end-to-end:
connection config → unit/room mapping → initial sync (dry-run preview + real) → reconciliation →
webhook ingestion → normalized reservations mapped onto the existing `stays`/`guests`. Everything runs
against a synthetic in-memory Rentlio; **no network call is ever made**.

Core rule honoured throughout: **core AI OLLY code never imports Rentlio.** Only the adapter knows
Rentlio's shapes; the engine and the rest of the app see provider-neutral normalized types.

---

## 2. Database additions (forward-only, additive)

Migrations (aiolly-dev):

| Migration | Purpose |
|---|---|
| `20260825120000_pms_integration_foundation.sql` | 6 enums + 4 tables + RLS + grants |
| `20260825120100_pms_external_identity_unique.sql` | DB-level idempotency indexes on `stays`/`guests` external identity |
| `20260825120200_pms_service_role_grants.sql` | `service_role` DML on the 4 tables (server engine) |

**Tables** (no `rentlio_*` columns scattered across core tables):

- **`hotel_integrations`** — one PMS connection per `(hotel_id, provider)`. Holds `status`,
  `external_property_id`, a **`credential_ref`** (server-side secret *reference*, never the key) and a
  **`webhook_token_hash`** (sha256, never the raw token). `settings`, `last_synced_at`, `last_error`
  (redacted).
- **`external_entity_mappings`** — Rentlio unit / unit-type ↔ AI OLLY `room` / `room_type`.
  `room_id NULL` = **unmapped** (→ NEEDS_MAPPING at sync, never a wrong room). `UNIQUE(integration_id,
  entity_type, external_id)`; partial unique `(integration_id, room_id)` so one room backs at most one
  active unit.
- **`integration_events`** — webhook ingestion log. `UNIQUE(integration_id, provider_event_id)` makes a
  duplicate webhook a harmless no-op. Stores only a **sanitized** payload (no cards/docs/notes/contact).
- **`sync_runs`** — initial-sync / reconciliation run log (observability). No scheduler in R2.

**Reservations & guests reuse existing columns** — `stays.external_source` / `external_id`,
`guests.external_source` / `external_id`; `stay_status` already has `no_show`. No changes to Guests,
Stays, Rooms, or the QR/token architecture.

**RLS (authoritative, hotel-scoped):** config + mappings are SELECT/INSERT/UPDATE/DELETE for
`platform_admin` **or** `hotel_admin` only. `integration_events` / `sync_runs` are SELECT-only for those
roles; **writes are server/service-role only**. `anon` is fully revoked. Reception / editor / marketing /
read_only can never touch PMS.

---

## 3. Engine modules (`dashboard/src/server/pms/`, ESM `.mjs`)

`.mjs` so the **Next app and the node test harness import the identical logic** with no TS build
coupling.

- **`types.mjs`** — normalized types + safety helpers: `normalizeStatus` (Rentlio raw → stay status,
  unknown → `null`, never a silent default), PII allow/deny lists, `sanitizeGuest`,
  `sanitizeEventPayload`, `sha256`, constant-time token compare, `redactError`.
- **`rentlio-adapter.mjs`** — the only Rentlio-aware module. Injectable transport:
  `makeHttpTransport` (real, documented, unused in tests) and `makeSyntheticTransport` (in-memory,
  mutable store — re-fetch is authoritative). `normalizeReservation` is pure; `parseWebhook` validates
  `event.id`/`type`.
- **`fixtures.mjs`** — entirely synthetic Rentlio-shaped data (reserved `example.com` guests; one guest
  deliberately carries card/passport/notes/OIB to prove PII minimization; one unit intentionally
  unmapped).
- **`engine.mjs`** — provider-neutral core: `applyReservation` (idempotent upsert, dry-run aware),
  `initialSync`, `reconcile`, `processWebhook`, `webhookTokenMatches`.
- **`service.mjs`** — the **integration service boundary**: the only module the API routes call. Wires
  the (synthetic) adapter + engine + a server-only Postgres connection and returns **only safe view
  data** — never a credential, token, or PII.

### Lifecycle semantics
- **Reservation → stay:** same external reservation always updates the **same** stay (idempotent via
  `(hotel_id, external_source, external_id)` + DB unique index). Status map: confirmed→`reserved`,
  checked_in→`checked_in`, checked_out→`checked_out`, cancelled→`cancelled`, no_show→`no_show`.
- **Guest mapping:** upsert by external identity. A weak match (same email or name, no Rentlio id) is
  **never auto-merged** — a fresh guest is created and a row is added to the existing
  `guest_duplicate_suggestions` for staff review.
- **Unmapped unit → NEEDS_MAPPING:** the reservation is reported, **no stay is created**, never attached
  to a wrong room.
- **Consent boundary:** import **never** creates marketing/newsletter/signed consent or a signature.
- **Cancellation:** a **state transition** (`status='cancelled'`), never a delete. Reconciliation
  cancels reservations that disappear provider-side — also never deletes.
- **Webhook:** shared-token auth (constant-time vs. stored hash) → idempotent on `event.id` → **re-fetch
  the reservation from the adapter as the source of truth** (handles out-of-order delivery) → apply.
  Check-in/out events drive the lifecycle even if the reservation object lags. Room QR `access_token` is
  never touched by any PMS operation.

---

## 4. Dashboard surface

- **Settings → Integrations** (`/settings/integrations`) — `platform_admin` or `hotel_admin` only
  (reception/editor/marketing see “Hotel admins only”). Shows status, property ID, credential/webhook as
  **booleans only**, unit→room mapping table, dry-run **sync preview**, and recent webhook events.
  Never renders an API key, webhook token, or guest PII.
- **API routes** (`dashboard/src/app/api/pms/`, all `runtime=nodejs`, DEV-guarded):
  `GET/POST /integration` (view / synthetic connect), `POST /mappings`, `POST /sync-preview`,
  `POST /webhook` (token-auth, no JWT). Every JWT route calls `requirePmsAdmin(req, hotelId)` before any
  work; every query is explicitly hotel-scoped; RLS is defense-in-depth.

**Local requirement:** the webhook/sync routes use the engine's Postgres path, so the dashboard runtime
needs `SUPABASE_DB_URL` in `dashboard/.env.local` (gitignored) in addition to the existing
`SUPABASE_SERVICE_ROLE_KEY`. Not needed for build/typecheck.

---

## 5. Verification (wired into `rc1` / `rc1:strict`)

- **`verify:pms`** (`scripts/verify-pms-integration.mjs`) — 37 assertions against a throwaway synthetic
  tenant in aiolly-dev (created + cleaned up): idempotency, no duplicate stay, guest external identity,
  no weak-identifier auto-merge (+ suggestion), unmapped→NEEDS_MAPPING, date change, room reassignment,
  cancellation, check-in/out, no-show, duplicate webhook, out-of-order re-fetch, invalid token,
  unsupported event, re-fetch failure, PII minimization, **no consent creation**, manual-stay
  coexistence, **room QR token immutability**, safe error redaction, reconciliation cancels-not-deletes.
- **`audit:security-pms`** (`scripts/security-audit-rentlio.mjs`) — 37 assertions: RLS enabled, anon
  revoked, admin-only policies, event/run logs server-write-only, secret boundary (reference+hash, no
  raw-key column), role gating (editor ≠ hotel_admin), cross-tenant isolation, cross-hotel mapping
  rejection, DB uniqueness, and a built-bundle secret scan.
- **Full `rc1`:** 47 stages pass, incl. build. **Live browser E2E** confirmed against the running
  dashboard with a real JWT session: hotel_admin connect + map + preview, editor denied `403`, webhook
  processed/duplicate/`401`/skipped, and a real stay created by the webhook (then cleaned up).

---

## 6. Known limitations (intentional for R2)

- Synthetic adapter only — the real HTTP transport is written but unused; no network call is made.
- No scheduler / background worker — reconciliation is on-demand.
- No Rentlio Booking Engine, no production webhook registration, no PII migration.
- Rentlio raw status labels come from `GET /enums/reservation-statuses` in R3; R2 uses the documented
  lifecycle plus a fail-safe `unknown → null`.

---

## 7. Exact R3 requirements (real Rentlio connection)

R3 changes **only** the transport + credential resolution — the engine, schema, mapping, and UI stay as
they are. From Antique Split we need exactly:

1. **Rentlio API key** (stored server-side as a secret the `credential_ref` points to — never in the DB,
   never `NEXT_PUBLIC_*`, never returned by any route).
2. **Rentlio Property ID** (→ `hotel_integrations.external_property_id`).
3. **Confirmation of the 8 unit → room mappings** (rooms 101, 102, 201, 202, 203, 301, 302, 303) — i.e.
   the Rentlio unit IDs for those rooms. **No Rentlio username/password is ever needed.**

Then R3: swap `syntheticAdapter()` for `makeHttpTransport({ apiKey })`, verify connection, seed real
units, confirm mapping, run a read-only initial-sync **preview**, and register the production webhook.
