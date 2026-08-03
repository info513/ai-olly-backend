# Antique Split — DEV Migration Result

**Sprint 9 · Part 20.** Outcome of the import into **aiolly-dev** (`mcgrccvvybgcozeqlisj`).
Production Supabase/Render/PWA/Airtable were untouched; Airtable was read-only throughout.

## Rows imported (idempotent)

| Table | Rows | Source |
|---|--:|---|
| destinations | 1 | Split |
| hotels | 1 | Antique Split (canonical address/phone/mobile/check-in-out) |
| room_types | 5 | Deluxe Ground Floor, Comfort Ground Floor, Deluxe Room, Superior Room, Standard Room |
| rooms | 8 | 101,102,201,202,203,301,302,303 — **access tokens preserved exactly** |
| service_categories | 21 | deduped from services |
| hotel_services | 94 | 83 published / 11 draft |
| destination_pois | 22 | canonical Split POIs |
| hotel_poi_settings | 22 | per-hotel presentation |
| destination_routes | 6 | themed walks (POI graph = waypoint text, deferred) |
| hotel_route_settings | 6 | |
| destination_events | 11 | |
| hotel_event_settings | 11 | |
| price_categories | 1 | Hotel Services |
| price_items | 35 | minibar / laundry / dry-cleaning lists (VAT+validity flagged for review) |
| ai_configs | 1 | persona / tone / output rules / safe-handoff |
| **Total** | **245** | across 15 tables |

## Idempotency

- 1st apply: **245 created**. 2nd apply: **245 updated, 0 created** → no duplication.
- Reset → re-import: **all 8 room tokens identical** (SHA-256 verified, values never printed).

## Not migrated (by design / locked boundary)

- **PII/guest data** — GUESTS (1), STAYS (2), PRIVOLE (4), REQUESTS (23), PUSH (8),
  AI_RESPONSE_LOGS (1693), FEEDBACK (0): count-only in export, never imported.
- **AI routing model** — 617 intent patterns not imported 1:1 (see AI report).
- **Deferred** — city services (SERVICES Out), Split Today feed (49), route→POI link graph.

## Verification snapshot

- verify-antique-migration.mjs: **39 passed / 0 failed**.
- security-audit-migration.mjs: **32 passed / 0 failed / 1 warning** (pre-existing token in a
  v1 doc, out of scope — flagged for owner action).
- compare: **all 8 domains MATCH**, 8/8 rooms structured-PASS, **TOKEN MATCH**, services 22
  match / 2 transformed / 0 missing.
