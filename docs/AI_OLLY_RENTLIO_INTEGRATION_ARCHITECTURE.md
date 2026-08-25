# AI OLLY — Rentlio Integration · Phase R1 (Architecture + API Contract)

**Analysis / design only.** No implementation, no migrations, no Antique connection, no real
credentials, no production change, no `DATA_PROVIDER` change, no deploy, no merge to main.
Branch `feature/ai-olly-platform-2`. All API facts below come from the **current official Rentlio
docs** (`docs.rentl.io`, `api.rentl.io/v1`), not memory.

**Goal:** make Rentlio the reservation/stay source so hotels don't hand-enter guests/stays — fitting
the *existing* AI OLLY data model (not a competing PMS). AI OLLY keeps consent, requests, feedback,
QR room tokens and content.

**Verdict: READY WITH QUESTIONS** (see §21) — the API covers everything we need, the schema is
largely ready, and a clean adapter design exists; a short list of account-specific unknowns is
resolved at connection time, none blocking the foundation.

---

## 1. Official API findings (Part 1)
- **Base URL:** `https://api.rentl.io/v1/` · **version** in the path (`v1`).
- **Auth:** API key — header `apikey: <key>` **or** query `?apikey=<key>` (§2).
- **Rate limits:** **15 req/s** and **10,000 req/hour**; `429` on breach; headers
  `x-ratelimit-remaining-second|hour`. Max request body 1 MB; availrates updates capped at 365 days.
- **Pagination:** `page`, `perPage` (≤100), `order_by`, `order_direction`.

**Endpoints we use** (exact paths):

| Concept | Endpoint(s) |
|---|---|
| Current user / subscription | `GET /users/me`, `GET /users/subscriptions/active` |
| Properties | `GET /properties` |
| Unit types | `GET /properties/{id}/unit-types` |
| Units (physical) | `GET /properties/{id}/units` |
| Reservations (list/detail) | `GET /reservations` (rich filters), `GET /reservations/{id}/details` |
| Reservations today | `GET /properties/{propertyId}/reservations/today`, `GET /units/{unitId}/reservations/today` |
| Check-in / check-out | `PUT /reservations/{id}/checkin`, `PUT /reservations/{id}/checkout` |
| Reservation note | `PUT /reservations/{id}/add-note` |
| Cancel | `DELETE /reservations/{id}` |
| Create (Phase 2+) | `POST /reservations` |
| Guests | `GET /reservations/{id}/guests`, `GET/POST/PUT/DELETE /reservation-guests`, `GET /guests/checked-in` |
| Reference enums | `GET /enums/reservation-statuses`, `/enums/countries`, `/enums/genders`, … |
| Webhooks (list) | `GET /webhooks` (created in the web app, not via API) |

Not needed for R1 scope: invoices, rate-plans/availrates, sales-channels, fiscalization, partners.

## 2. Authentication (Part 2)
- A hotel connects by generating an **API key** in the Rentlio web app "developers" section, plus its
  **property id** (from `GET /properties`). We store the key **server-side only** (§15) and the
  property id as the scope.
- **Open questions (confirm at connection):** whether one API key spans **multiple properties** or is
  property-scoped; key **rotation** behaviour. The docs show account-level user endpoints (`/users/me`)
  and property-scoped resources, which suggests an **account key that can list several properties** —
  so our model stores `{apiKey, selectedPropertyId}` per hotel and never assumes one-key-one-property.
- **Webhook auth:** a **shared `token`** you set when creating the webhook, echoed in every payload —
  **there is no HMAC signature** (§12, §15).

## 3. Webhook events (Part 3/8)
Exact event `type` values: `reservation-created`, `reservation-updated`, `reservation-canceled`,
`ota-reservation-received`, `ota-reservation-modified`, `ota-reservation-canceled`,
`guest-checkedIn-on`, `guest-checkedIn-off`, `guest-checkedOut-on`, `guest-checkedOut-off`.
Payload: `{ token, event: { type, id (UUIDv4), payload } }`; reservation payload carries reservation
id, property id, unit id, arrival/departure (**UTC Unix**), occupancy (adults, children ≥12 / <12),
nights, notes, guest (id + name), status. **Dedup on `event.id`.** Retry 5× at 1-hour intervals if
response ≥ 300; **suspended after 50 cumulative failures** (staff reactivation). Registered in the
web app's development settings; `GET /webhooks` lists configured hooks.

## 4. Source-of-truth matrix (Part 3)
| Field / concept | Authoritative |
|---|---|
| Reservation existence, arrival, departure, booking status, source/channel, assigned unit, occupancy, primary guest details | **Rentlio** |
| Check-in / check-out state | **Rentlio** (via webhook / `PUT …/checkin|checkout`), mirrored in AI OLLY |
| Consent records, marketing opt-in, signatures | **AI OLLY** (never derived from Rentlio) |
| Guest requests, feedback, Olly interaction state | **AI OLLY** |
| Hotel content, room guide, prices | **AI OLLY** |
| **Room QR access token** | **AI OLLY** (Rentlio never supplies/replaces it) |
| Internal operational notes not from Rentlio | **AI OLLY** |

Rentlio-sourced fields become **read-only** in AI OLLY (§17); AI OLLY operational fields stay editable.

## 5. Rentlio → AI OLLY mapping (Part 4)
| Rentlio | AI OLLY table | Key |
|---|---|---|
| property | `hotels` (1 hotel ↔ 1 property) | integration config holds `property_id` |
| unit type | `room_types` | mapping (unit-type → room_type), optional |
| unit (physical) | `rooms` | **explicit unit↔room mapping (critical, §10)** |
| reservation | `stays` | `stays.external_source='rentlio'`, `stays.external_id=reservationId` |
| reservation status + check-in/out | `stays.status` (+ `checked_in_at`/`checked_out_at`) | see §6 |
| holder / primary guest | `guests` | `guests.external_source='rentlio'`, `guests.external_id=guestId` |
| booking source/channel | stay metadata (Rentlio direct vs OTA) | `external_source` = `rentlio` / `rentlio_ota` |

**The current `stays` and `guests` schema already carries `external_source` + `external_id`**, and
`stay_status` already has `reserved / checked_in / checked_out / cancelled / no_show` — so reservations
and guests map with **no new columns**. Only rooms/hotels need external identity (§14).

## 6. Reservation lifecycle (Part 7)
| Rentlio event / state | AI OLLY mutation (no destructive history) |
|---|---|
| `reservation-created` / `ota-reservation-received` | upsert guest (dedupe §7) → upsert `stays` (status `reserved`), map unit→room; if unit unmapped → hold in a pending/needs-mapping state, do **not** guess a room |
| `reservation-updated` / `ota-reservation-modified` | re-fetch `/reservations/{id}/details`; update arrival/departure/room/occupancy; **date change** = update arrival/departure; **room change** = re-point `room_id` to the newly-mapped room (keep prior `request`/history); **guest detail change** = update guest fields (never re-key identity) |
| `reservation-canceled` / `ota-reservation-canceled` | set `stays.status='cancelled'` (**never delete**); keep requests/consent/feedback for records |
| `guest-checkedIn-on` | `stays.status='checked_in'`, `checked_in_at=now` | 
| `guest-checkedIn-off` | revert to `reserved` (undo mistaken check-in) |
| `guest-checkedOut-on` | `stays.status='checked_out'`, `checked_out_at=now` |
| `guest-checkedOut-off` | revert to `checked_in` |
| no-show (via `reservation-updated` status = no-show enum) | `stays.status='no_show'` |
Every webhook is a **trigger**; the source of truth is re-read from the API before mutating (defense
against spoofed/stale payloads). Status is derived from `reservation-statuses` enum + check-in/out
events (exact Rentlio labels resolved from `GET /enums/reservation-statuses` at implementation).

## 7. Guest deduplication (Part 10)
Identity key = `(hotel_id, external_source='rentlio', external_id=rentlioGuestId)` — **never** email/name.
Flow: match on Rentlio guest id first (idempotent upsert); if absent, look for an existing AI OLLY guest
by strong signals and **suggest** (not auto-merge) via the existing `guest_duplicate_suggestions` table
(`match_reason`, `match_score`, `status`). One guest → many stays. **No auto-merge on weak identifiers.**

## 8. PII minimization (Part 11)
| IMPORT | OPTIONAL (only if operationally needed) | DO NOT IMPORT |
|---|---|---|
| first/last name, Rentlio guest id, reservation id, arrival, departure, status, unit id, adults/children counts | email, phone, locale/language, country | payment-card data, billing/invoice details, ID/passport/document data, tourist-tax/fiscal data, arbitrary PMS notes, smart-card ids, any field Olly doesn't use |
The webhook payload only carries guest **id + name**; email/phone are fetched **on demand** from
`/reservations/{id}/guests` **only when operationally required**, minimizing PII at rest.

## 9. Consent boundary (Part 12)
**A reservation/stay MUST NOT imply consent.** Rentlio may create/update `guests` and `stays` only.
It **never** writes `consents`, marketing opt-in, or signed consent. The existing AI OLLY consent
capture flow stays the sole author of consent. (Reception still captures consent contextually as today.)

## 10. Room / unit mapping (Part 6 — critical)
Rentlio **unit names ≠ AI OLLY room numbers**, and unit-type ≠ physical unit. Design:
- **Explicit mapping** `rentlio_unit_id → rooms.id`, created during initial setup (§9), stored in
  `external_entity_mappings` (§14). Never inferred from names.
- **States:** mapped / **unmapped** (reservation held in needs-mapping, not assigned to a wrong room) /
  **renamed** (unit renamed in Rentlio → mapping by id survives) / **reassigned** (room change re-points
  the mapping). A preview screen lists every Rentlio unit beside AI OLLY rooms for the admin to confirm.
- Validation: warn if a Rentlio unit maps to an inactive/nonexistent room; block sync of reservations
  whose unit is unmapped (surfaced as `NEEDS_MAPPING`, §16).

## 11. Idempotency (Part 5)
- Entity idempotency: upsert by `(hotel_id, provider, external_id)` for stays/guests/units.
- Event idempotency: **dedupe on webhook `event.id` (UUIDv4)** via `integration_events` (§14); a repeat
  event.id is a no-op. **Out-of-order** handled by always re-fetching current state from the API and by
  storing a `source_updated_at`/version marker so an older payload never overwrites a newer state.
- Persist `last_synced_at` per entity/hotel.

## 12. Webhook + reconciliation design (Part 8)
**Webhook-first + periodic reconciliation.**
- Ingestion: a server-only endpoint validates the shared `token` (constant-time), records the event in
  `integration_events` (dedupe by `event.id`), then processes by re-fetching from the API.
- Duplicates → no-op (event.id seen). Out-of-order → version/`source_updated_at` guard. Failures →
  ret/dead-letter row in `integration_events` (status `error`) for the platform owner.
- **Reconciliation job** (design only; scheduler built later): periodically `GET /reservations`
  (future + active window) per connected hotel and diff against AI OLLY stays — repairs missed/failed
  webhooks and detects reservations that disappeared (mark `cancelled`, never delete). Cadence e.g.
  every 15–30 min + a nightly full future-window pass.

## 13. PMS adapter contract (Part 19)
Provider-agnostic interface; **Rentlio is the first adapter** (multi-hotel, §18):
```
interface PMSAdapter {
  verifyConnection(cfg): { ok, propertyName, error? }
  getProperty(cfg): NormalizedProperty
  listUnits(cfg): NormalizedUnit[]              // + unit types
  listReservations(cfg, window): NormalizedReservation[]
  getReservation(cfg, externalId): NormalizedReservation
  normalizeReservation(raw): NormalizedReservation   // → { externalId, unitExternalId, arrival, departure, status, guest{externalId,firstName,lastName,email?,phone?}, adults, children[], source, sourceUpdatedAt }
  processWebhook(cfg, event): { eventId, kind, mutation }
  reconcile(cfg, window): ReconcileResult
}
```
Kept intentionally small; no over-engineering. Booking-engine handoff (§17) is a separate, non-PMS-sync
concern.

## 14. DB-change recommendation (Part 20) — *design only, do NOT create yet*
The schema already carries `stays.external_source/external_id`, `guests.external_source/external_id`,
`stay_status.no_show`, and `guest_duplicate_suggestions`. **Minimum additive set (future phase):**
| Table (new) | Purpose |
|---|---|
| `hotel_integrations` | per-hotel PMS connection: `hotel_id`, `provider` ('rentlio'), `status` (§16), `external_property_id`, secret **reference** (not the key), `webhook_token_hash`, `last_synced_at`, `settings jsonb`. **One row per hotel-provider.** |
| `external_entity_mappings` | generic `hotel_id`, `provider`, `local_type` ('room'|'room_type'), `local_id`, `external_id`, `external_type`, `last_synced_at` — solves the unit↔room mapping cleanly (rooms lack inline external ids). |
| `integration_events` | webhook log for idempotency/dead-letter: `event_id (unique)`, `hotel_id`, `provider`, `type`, `payload`, `status`, `attempts`, `processed_at`. |
| `sync_runs` | reconciliation/observability: `hotel_id`, `provider`, `kind`, `started/finished`, `processed`, `failed`, `mismatches`. |
Prefer these four additive tables over scattering `rentlio_*` columns across core tables. **No column
on `hotels`/`rooms` is required** beyond the mapping table. RLS: every table `hotel_id`-scoped, mirroring
existing policies. **No migration is written in R1.**

## 15. Security model (Part 21)
- API key: **server-only**, stored via the platform's secrets mechanism (env/secret manager), a
  **reference** in `hotel_integrations` — never in the browser, never in an API response, never logged.
- Webhook: validate the per-hotel shared `token` with a **constant-time compare**; because there is **no
  HMAC**, add **defense-in-depth by re-fetching** the reservation from the API before mutating (a spoofed
  payload can't fabricate real reservation state). Rotate the token if leaked.
- **Hotel isolation:** every sync/webhook is scoped by `hotel_integrations.hotel_id`; a connection may
  only ever write that hotel's `guests/stays/rooms`. Reconciliation queries are per-hotel. Cross-hotel
  writes are impossible by construction + RLS.

## 16. Error / health states (Part 22)
`DISCONNECTED → CONNECTED → NEEDS_MAPPING → SYNCING → HEALTHY → DEGRADED → ERROR`. Staff see a plain
badge ("Connected · syncing", "Needs room mapping", "Temporarily degraded — we're on it"); the platform
owner sees diagnostics (last error, failed event ids, unmapped units). **Never surface raw API/HTTP
errors to hotel staff.**

## 17. Booking Engine strategy (Part 24/25) + manual vs Rentlio (Part 17)
- **v1 = prefilled handoff, no payments, no booking API.** AI OLLY collects arrival/departure/adults/
  children, then opens the hotel's Rentlio Booking Engine:
  `https://{property}.book.rentl.io/?from=DD-MM-YYYY&to=DD-MM-YYYY&adults=N&children=age1,age2&rooms=N&language=xx`.
  No card data ever touches AI OLLY.
- **Direct creation** (`POST /reservations`) **exists** but is classified **FUTURE / Phase 2+** — we do
  not want AI OLLY to become a booking/payment engine.
- **Manual stays stay first-class:** `stays.external_source` = `manual` (today) vs `rentlio`. Rentlio is
  **never mandatory**; hotels without a PMS keep manual entry. Field ownership (§4): Rentlio-sourced
  fields are read-only in the UI for Rentlio stays; AI OLLY operational fields stay editable — no two
  systems writing the same field.

## 18. Multi-hotel architecture (Part 18)
Not Antique-specific. Each hotel independently is: no-PMS / Rentlio / (future) another PMS. PMS logic
lives behind the **adapter** (§13) + `hotel_integrations`, never hardwired into Guests/Stays/Rooms UI.
Adding "Trogir Palace", "PalmaRooms", etc. is a config row, not code.

## 19. Antique connection requirements (Part 26)
To make the **real** Antique Split connection later we need:
1. **Rentlio API key** (generated in Antique's Rentlio → developers).
2. **Property id / code** for Antique Split (from `GET /properties`).
3. **Webhook setup access** — someone with Rentlio access to register the webhook URL + shared token in
   Antique's development settings (or confirmation the platform owner can).
4. **Unit → room mapping confirmation** — Antique confirms which Rentlio unit is which AI OLLY room
   (101…303). **No username/password** is needed (Rentlio uses an API key, not basic auth).

## 20. Existing-system impact (Part 29)
| Area | Impact |
|---|---|
| `guests`, `stays` schema | **NO CHANGE** (external ids already present) |
| `rooms`, `hotels` | **NO CHANGE** (mapping lives in `external_entity_mappings`) |
| Today / Reception, Guest profile | **SMALL CHANGE** later — show reservation source / read-only Rentlio fields (Guest profile header already has source/external-id slots from Phase D) |
| Consent, Requests, Feedback, AI, PWA, room QR | **NO CHANGE** (boundaries preserved) |
| — | **NEW INTEGRATION LAYER**: PMS adapter, `hotel_integrations`/`external_entity_mappings`/`integration_events`/`sync_runs`, webhook endpoint, reconciliation job |
Stable modules are untouched; all new behaviour is additive behind the adapter.

## 21. Risks / open questions (Part 30)
1. **Reservation-status enum values** — exact Rentlio labels come from `GET /enums/reservation-statuses`; enumerated once we have a key (mapping to `stay_status` is otherwise clear).
2. **API-key scope** — one key across multiple properties vs property-scoped; rotation. (Design already assumes `{key, propertyId}` per hotel.)
3. **Webhook has no signature** — only a shared token; mitigated by constant-time compare + API re-fetch, but weaker than HMAC — accept as a documented risk.
4. **Webhook registration** is web-app-only (not via API) — Antique/owner must set it up manually.
5. **Guest field availability** — which of email/phone/locale Rentlio actually returns per reservation (fetched on demand; confirm at connection).
6. **OTA vs direct** nuances — OTA reservations may carry masked/relay guest emails; treat channel guests carefully for PII.
7. **Reconciliation window** — confirm a useful historical import window (recommend **active + future only**, plus a small recent-past window for in-house guests; avoid bulk historical PII).

---

## FINAL OUTPUT
- **API capabilities:** full REST for properties/units/unit-types/reservations/guests + check-in/out +
  cancel + create; 10 webhook events; reference enums; booking-engine prefill URLs. Rate-limited
  (15/s, 10k/hr), `apikey` auth, v1.
- **Endpoints/webhooks required:** `GET /properties`, `GET /properties/{id}/units` (+ `/unit-types`),
  `GET /reservations`(+`/{id}/details`, `/…/today`), `PUT …/checkin|checkout`, `DELETE /reservations/{id}`,
  `GET /reservations/{id}/guests`; webhooks `reservation-created|updated|canceled`, `ota-reservation-*`,
  `guest-checkedIn-on|off`, `guest-checkedOut-on|off`.
- **Access required from Antique:** Rentlio **API key** + **property id** + **webhook setup** + **unit↔room
  mapping confirmation**. No username/password. No card data.
- **Proposed mapping:** property→hotel, unit→room (explicit mapping table), unit-type→room_type,
  reservation→stay (`external_id`), guest→guest (`external_id`), status→`stay_status`.
- **DB changes needed:** 4 additive tables (`hotel_integrations`, `external_entity_mappings`,
  `integration_events`, `sync_runs`) — **not built in R1**. No changes to core guest/stay/room columns.
- **Is current Guests/Stays schema sufficient?** **Yes** for reservations & guests (external ids +
  `no_show` already present); only the **unit↔room mapping** + **connection config** need new (additive)
  storage.
- **Security/privacy risks:** webhook has no HMAC (token-only) → mitigate with API re-fetch; strict
  server-only key handling; PII-minimized import; consent never derived from reservations.
- **Recommended phases:** **R2** adapter + synthetic-Rentlio tests → **R3** Antique key + unit mapping +
  read-only initial sync → **R4** webhooks → **R5** Reception/Guest context → **R6** Booking-engine handoff.
- **Estimated effort (rough):** R2 ≈ 3–5 d (adapter + 4 tables + fixtures + tests), R3 ≈ 2–3 d, R4 ≈ 2–3 d,
  R5 ≈ 2 d, R6 ≈ 1 d. Total ≈ **10–14 dev-days** for a read-first, webhook-driven integration.
- **Blockers:** none hard. Soft: need a Rentlio **sandbox/real key** to enumerate the status enum and
  confirm guest-field availability + unit names before R3.

## FINAL VERDICT
**READY WITH QUESTIONS** — the Rentlio API supports the full read-first, webhook-driven model; the AI
OLLY schema is largely ready (external ids + `no_show` already exist); the adapter + 4 additive tables
give a clean, multi-hotel, provider-agnostic foundation. Remaining questions (§21) are account-specific
and resolved at connection time, not architectural blockers.

---
_Sources: official Rentlio docs — https://docs.rentl.io/ , https://docs.rentl.io/webhooks/ ; Booking
Engine URL parameters — https://help.rentl.io/en/articles/766823-how-to-implement-rentlio-booking-engine-to-your-website_
