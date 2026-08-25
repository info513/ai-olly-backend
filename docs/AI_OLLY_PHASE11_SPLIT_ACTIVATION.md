# AI OLLY — Phase 11 · Split Destination Activation (DEV / RC)

**Scope:** complete + verify **Split** as a canonical destination in the final Platform CMS
architecture and prove **Antique Split** consumes it via Hotel Presentation (Pattern B), in
**aiolly-dev** only. Architecture LOCKED. **No production, no Supabase provisioning, no deploy,
no `DATA_PROVIDER` change, no Airtable writes, no PII migration, no token rotation, no cutover,
no Rentlio.** Branch `feature/ai-olly-platform-2`.

**Canonical pair (verified, not the `(Dev)` fixtures):**
- Destination **Split** — `2cd0ab85-b9a7-4fd1-875c-94d57fe2ab5e` (slug `split`)
- Hotel **Antique Split** — `4a8e6860-068f-4412-b226-18942f63223c` (slug `antique-split`) → Split

The synthetic `Split (Dev)` (`3d03743b…`) + `dash-antique-split` are dashboard test fixtures and
were never confused with canonical Split.

**FINAL VERDICT: READY WITH HOTEL/OWNER INPUT.**
The canonical content layer is substantially complete, resolves correctly, and Pattern B works
end-to-end. What remains is **owner/hotel confirmation of facts** (coordinates, verification,
VAT, media licences) and one **design decision** (destination-level AI) — not further building.

---

## 1. Final source inventory (Part 1)
Sources used (all existing, read-only): production Antique Airtable **raw export** (`migration/
antique-split/raw/*` — 20 tables incl. poi/routes/events/split_today/services/rooms/ai_*), existing
aiolly-dev import, Platform CMS Split content, v1 PWA whispers (`pwa/whispers-data.js`), processed
image set. **No content, prices, coordinates or licences were invented.**

| Domain | aiolly-dev (Split/Antique) | Classification |
|---|---|---|
| Destination | 1 canonical Split (published, snapshot) | **COMPLETE** (coords/verif → MANUAL REVIEW) |
| POIs | 26 (26 published, 21 image, 22 coords) | **COMPLETE** (4 new coords → MANUAL REVIEW) |
| Routes | 6 (6 published, structured waypoints) | **COMPLETE** |
| Whispers | 12 (12 published, ordered ch01→ch12) | **COMPLETE** |
| Events | 60 (13 published-future, 47 archived-past) | **COMPLETE** |
| Live Feed | 49 `split_today` migrated as events (historical) | **COMPLETE** (no active items — expected) |
| Destination AI | 0 destination-scoped articles | **MANUAL REVIEW** (design decision) |
| Aliases | destination aliases 0 (hotel aliases present) | consistent with 0 dest articles |
| Media | 30 assets (29 destination-owned) | **COMPLETE** (licences pending → MANUAL REVIEW) |
| Hotel Presentation | POI 26·Route 6·Whisper 12·Event 11 settings | **COMPLETE** |
| Antique linkage | antique-split → canonical Split | **COMPLETE** |

## 2. Split destination (Part 2)
Exactly one canonical Split: name `Split`, slug `split`, country `HR`, tz `Europe/Zagreb`, default
locale `en`, status **published**, live snapshot present, source `manual`. **No duplicate created.**
Gaps → MANUAL REVIEW: destination-level **coordinates are null** (POIs carry coords), and
`verification_status = unverified`.

## 3. Required Split POIs (Part 3)
All 20 required POIs exist (naming variants normalized: *Voćni trg = Trg braće Radić = `vocni-trg-fruit-square`*).
16 came from the Airtable source; **4 were added canonically** with a safe factual minimum and **no
invented coordinates** (flagged): Grgur Ninski, Sv. Frane, Palace Walls (Zidine), Streets (Ulice).
26 POIs total, all **published** with snapshots, 21 with canonical image, 22 with coordinates.
Result per required item: **EXISTS** (16) / **ADDED** (4) / naming-variant normalized (Voćni trg).
No duplicate hotel-owned POI copies (Pattern B).

## 4. Split map + menu (Part 4)
22 POIs carry coordinates and plot on the destination map/search; the 4 canonical additions have
**no coordinates yet** (won't plot until confirmed — MANUAL REVIEW). Categories use the existing
generic POI enum — 7 `landmark`, 2 `nature`, **17 `other`**. A richer guest taxonomy (Palace &
Heritage / Squares & Streets / Waterfront / …) is **not** in the current schema; introducing it
would be new IA, so it is left as an **owner decision** (MANUAL REVIEW), not invented here.

## 5. Routes (Part 5) — matrix
6 canonical routes, all published, all with **structured, ordered waypoints** (`waypoints.{pois,
order,pois_linked=true}`) referencing real Split POIs (not free text):

| Route | Type | Stops (ordered POI keys) |
|---|---|---|
| Romantic Split (1–2 h) | walking | riva → matejuska → sustipan → marjan → prokurative |
| Inside the Palace (60 min) | walking | peristil → substructures → cathedral → vestibule → jupiter-baptistery |
| Relax & Green Split (2–3 h) | walking | đardin → marjan → sustipan |
| Local Taste & Traditions (2 h) | walking | pazar → fish-market → voćni-trg → riva → matejuska |
| History & Heritage (2 h+) | walking | golden-gate → palace → cathedral → pjaca → voćni-trg → prokurative |
| Split by Night (90 min) | walking | riva → peristil → pjaca → voćni-trg → marmont → prokurative |

Semantic verify confirms same-destination + identity-stable + order-consistent (Part 17).
MANUAL REVIEW: several `distance_km/duration_minutes` are placeholder (`1–2 min`).

## 6. Whispers (Part 6)
12 chapters, correct order ch01→ch12, titles preserved (Palace by the Sea … The Palace That Became),
all published, single channel. Source of truth = v1 PWA. No rewrite. No images supplied (fine).

## 7. Events (Part 7)
11 hotel events + 49 Split-Today items → 60 `destination_events`. **13 published (all future,
0 past) + 47 archived (all past)** — expiry/archival correct, no duplicates. Canonical vs live-feed
separated by `is_live_feed`.

## 8. Split Today / Live Feed (Part 8)
All 49 `split_today.json` records migrated (compare 49=49 MATCH), stored as destination events;
none are currently `is_live_feed=true` (the snapshot is historical 2024 data — a live feed would
need a live source, out of this phase). **No external API contacted.** → COMPLETE for existing data.

## 9. Destination AI (Part 9)
**0 destination-scoped `knowledge_articles`.** Destination facts (Peristil, heritage, ferry/bus
context) are currently carried by **POIs, routes and whispers**, which the resolver retrieves. No
Antique-specific fact was promoted to destination scope (verified: hotel facts stay hotel-scoped —
breakfast/check-in/wifi/parking/prices are all `hotel_id`-scoped). Whether to author dedicated
destination-level AI articles is an **owner decision** → MANUAL REVIEW.

## 10. Media inventory (Part 10)
30 assets, **29 destination-owned Split media** (POI canonical images + destination module heroes) +
hotel-owned Antique heroes; **no destination image duplicated per hotel**. Alt text present
(dashboard shows 0 missing alt). `source_credit = "Pressmax processed image set (AI OLLY)"`;
`license_type/rights_notes = "license metadata pending"` → MANUAL REVIEW (real source/author/licence).

## 11. Required hero images (Part 11)
Mapped from the processed set with ownership per the implemented architecture:
- **Destination/shared:** Split destination hero (`riva`), Pharmacy, Ferry/Bus, Supermarket, ATM,
  Gastro (local-area subjects → destination-owned, reusable by every Split hotel).
- **Hotel-specific (Antique-owned):** Room Guide, Hotel Services, Concierge, Help & Request.
No dedicated aerial/panorama in the set → destination hero uses the Riva (MANUAL REVIEW to upgrade).

## 12. Antique Split hotel content (Part 12)
- **Rooms / Room Guide:** 8 rooms (all active), 5 room types; **8/8 access tokens present (hash-only,
  never printed)**; structured smart-glass / minibar / kettle / blackout / underfloor per type.
- **Services:** 94 services (83 published/active), 21 categories, all `available_to_ai`.
- **Pricing:** 36 price items incl. **confirmed extra-bed €40/night**, minibar/laundry/dry-cleaning
  lists. **VAT** is set (`vat_included=true`) on all 36 — MANUAL REVIEW: confirm the rate is real,
  not a placeholder. No invented transfer/breakfast/room-service amounts.
- **Hotel AI:** 7 hotel-scoped articles, all published, resolve live.

## 13. Hotel Presentation / Pattern B (Part 13)
Antique presentation settings cover **26/26 Split POIs** (the 4 new POIs' settings were added this
phase), 6 routes, 12 whispers, 11 events, with visible/featured/order/recommendation/walking-time/
image-override controls. **Propagation proof (DEV, reversible):**
1. recorded Antique's Riva settings (visible, order=7, note "Glavna gradska šetnica");
2. edited + re-published the canonical Riva POI;
3. **canonical change propagated** to the published snapshot (PASS), `published_at` advanced (PASS);
4. **Antique presentation settings unchanged** (PASS);
5. original restored, no test content left (PASS).
Confirmed in-browser: Antique **Recommendations** shows canonical Split POIs with facts read-only
("can't be edited here") and hotel-controlled presentation ("customized").

## 14. Guest PWA content model (Part 14) — source of truth
| PWA area | Source of truth |
|---|---|
| Room Guide, Hotel Services, Prices, Hotel AI | **HOTEL** (`rooms`/`room_types`, `hotel_services`, `price_items`, hotel `knowledge_articles`) |
| POIs, Routes, Whispers, Events, Live Feed | **DESTINATION** (canonical Split `destination_*`) |
| Recommendations, per-hotel visibility/order/notes | **HOTEL PRESENTATION** (`hotel_*_settings`, Pattern B) |
| Destination media / module heroes | **PLATFORM/DESTINATION** media (`assets` destination-owned) |
| Pharmacy, ATM, Supermarket, Ferry/Bus (Near-Me) | live category lookups in the PWA (not canonical content) |

## 15. Current PWA provider boundary (Part 15)
**Today the production PWA reads: PWA → Render backend → Airtable** (`DATA_PROVIDER=airtable`).
This phase changed nothing about that. All verification here was done against the **Supabase
resolved layer** (`resolved_*` RPCs) and Platform CMS — **not** wired to the live PWA. There is **no
DEV Supabase-PWA preview**; the eventual full guest-PWA provider cutover to Supabase remains a
**separate phase** and was not started.

## 16. Compare result (Part 16)
`compare-antique-providers.mjs` (raw Airtable export ↔ aiolly-dev resolved, no live Airtable):

| Domain | Result |
|---|---|
| room_types 5·rooms 8·services 94·services_active 83·pois 22·routes 6·events 11·split_today 49·whispers 12·price_items 36 | **MATCH** |
| Rooms (8) structured 8/8 | **PASS** |
| Services semantic | MATCH 22 · **TRANSFORMED 2** (explained: structured blocks / normalized whitespace) · MISSING 0 |
| Room tokens | **TOKEN MATCH 8/8** (hash-only) |

The **+4 canonical POIs** (Grgur/Frane/Zidine/Ulice) are intentional **EXTRA** beyond the 22 Airtable
source POIs (required by Part 3). No unexplained mismatch remains.

## 17. Semantic verification (Part 17)
`verify:migration-semantic` — **12 passed / 0 failed**, and **strengthened this phase**: the route
check now reads the real `{pois,order}` key-based waypoints (previously it looked only for a `stops`
array and passed vacuously) → now verifies **6 routes**: same-destination, identity-stable, order-
consistent. Also verified: destination aliases destination-scoped; no alias collisions; live
retrieval returns published snapshots; draft edit does not change live (snapshot isolation);
Pattern B settings survive canonical re-publish; **8 room tokens hashed** (values never printed).

## 18. AI evaluation (Part 18) — retrieval vs generation
**Retrieval (resolver) eval: 18/21 PASS.** HOTEL (Wi-Fi, breakfast, check-in/out, parking, minibar,
transfer, luggage, extra-bed) all resolve; DESTINATION (Riva, Peristil, Sv. Duje, Grgur Ninski,
ferry/bus, supermarket, routes, whispers, events) all resolve; SAFETY safe-handoff **is configured**
(Croatian handoff text verified directly). The 3 non-matches are correct/expected: **Pharmacy & ATM**
are live Near-Me categories (not canonical content), and the safe-handoff item was an eval-harness
column artifact (configured on inspection). **MODEL GENERATION was NOT run** — it is the deferred
PWA/Render/LLM path; this phase verified retrieval only and does not claim generation was tested.

**Real gap found + fixed:** `resolved_hotel_services` returned 84 rows with **null titles** because
the import stored each service's `published_snapshot` as only its body (`{blocks,version}`) instead
of the full-row snapshot the resolver reads. Regenerated 83 published-service snapshots as full-row
(matching the POI/knowledge convention) → resolver now returns **84/84 titled**; no content changed.
(Production PWA is on Airtable, so guests were unaffected; this fixes the Supabase resolved path.)

## 19. Platform CMS browser QA (Part 19)
As platform_admin on **canonical Split** (context banner "EDITING Split", not `(Dev)`):
POIs (26 published, addresses + coords), Routes (6 with N-stop waypoints + durations), Media library
(30 assets, real images, 0 missing alt). Verification badges show **Unverified** across POIs
(MANUAL REVIEW). Destinations/Whispers/Events/AI Knowledge/Live-Feed present.

## 20. Antique hotel browser QA (Part 20)
On **canonical Antique Split · Split**: **Recommendations → Points of interest** shows canonical
Split POIs with facts read-only ("Maintained by AI OLLY Platform … can't be edited here") and hotel
controls (Shown/Feature/order/notes; "customized"). Hotel Content, Olly, Today/Guests reachable; no
canonical Platform editing controls exposed in the hotel workspace; no unexpected empty states.

## 21. Responsive QA (Part 21)
375 px: Antique Recommendations — banner, filters and POI cards (About/Address + Shown/Feature/
Presentation actions) usable, **no body overflow**, no clipped actions. (Split POI list and the
hotel dashboard were also verified overflow-free at 375 in the prior UX pass.)

## 22. Manual-review list (Part 22)
1. **Split destination coordinates** — null on the destination record (POIs have coords).
2. **Split verification status** — `unverified` → set once facts are confirmed.
3. **Coordinates for the 4 added POIs** — Grgur Ninski, Sv. Frane, Palace Walls, Streets.
4. **VAT rate** on the 36 price items — confirm real vs placeholder.
5. **Media licence metadata** — replace "license metadata pending" with real source/author/licence.
6. **Destination-level AI** — decide: author destination AI articles, or keep relying on POIs/whispers.
7. **Route distance/duration** — several are placeholder (`1–2 min`).
8. **Antique route visibility** — only 1 of 6 routes is visible to Antique; confirm intended.
9. **POI taxonomy** — 17 POIs are `other`; a guest-facing grouping is an owner IA decision.

## 23. Strict release gate (Part 23)
- `npm run rc1:strict` → **✅ PASS — 45 passed · 0 failed · 1 skipped** (lint; ESLint not configured).
  Integration + security + migration + semantic all ran (none skipped). `npm run rc1` (non-strict) is
  a subset and also green. No secrets/PII/room-token printed; no production writes.

## 24. Room-token hash verification
`compare` → **TOKEN MATCH 8/8**; semantic verify → **8 room tokens present, hashed, never printed**.
No token rotation performed.

---

## FINAL MATRIX

| Domain | Status |
|---|---|
| Split Destination | **PENDING** (coords + verification → owner) |
| POIs | **PASS** (4 new coords → owner) |
| Map | **PASS** (22/26 plot; 4 need coords) |
| Routes | **PASS** (durations placeholder → owner) |
| Whispers | **PASS** |
| Events | **PASS** |
| Live Feed | **PASS** (historical; no active items) |
| Destination AI | **PENDING** (design decision) |
| Media | **PASS** (licences pending → owner) |
| PWA Hero Mapping | **PASS** |
| Antique Rooms | **PASS** (8 rooms + 8 hashed tokens) |
| Antique Services | **PASS** (snapshots repaired) |
| Antique Pricing | **PASS** (VAT → owner) |
| Hotel AI | **PASS** |
| Hotel Presentation | **PASS** (Pattern B proven) |
| PWA Source Mapping | **PASS** (documented; boundary unchanged) |
| AI Retrieval | **PASS** (18/21; generation deferred) |
| Compare | **PASS** (all MATCH; token match) |
| Security | **PASS** (rc1:strict green) |
| Responsive | **PASS** |

## FINAL VERDICT
**READY WITH HOTEL/OWNER INPUT.** Split is a complete, resolving canonical destination and Antique
consumes it correctly through Pattern B. Moving on to Rentlio is gated only on the short owner/hotel
confirmations above (coordinates, verification, VAT, licences) and the destination-AI decision —
none of which are further engineering. **No production cutover was performed.**

## Reproduce
```bash
node scripts/migration/phase11-activate.mjs        # idempotent DEV completions (POI settings + service snapshots)
node scripts/migration/compare-antique-providers.mjs
npm run verify:migration-semantic
npm run rc1:strict
```
