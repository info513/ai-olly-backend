# Antique Split — Migration Discovery (Airtable → Supabase, DEV)

**Sprint 9 · Part 1.** Source of truth for the DEV migration. Generated against the
production Airtable base **`appon9UYjX6KU9cr1`** (READ-ONLY) and the **aiolly-dev**
Supabase project (`mcgrccvvybgcozeqlisj`). Record counts are from the read-only export
snapshot (`migration/antique-split/manifests/export-manifest.json`).

> **This document does not authorize production cutover.** Airtable is read-only; imports
> target aiolly-dev only. No guest/stay/consent PII and no AI response logs are migrated.

## 0. Scope decisions

- **Tenant slug:** `antique-split` (single pilot hotel). A second slug `palace-trogir`
  appears in `AI_SLUG_SCOPE` but has **no content rows** in this base — out of scope.
- **Room authority:** the 8 **ROOM GUIDE** rows are the authoritative rooms (each carries a
  room `Access Token` + QR link). The 5 slugged **SOBE** rows are the room **types**. The
  other 20 SOBE rows are blank/other-hotel templates → **DROP**.
- **Media:** there are **zero attachments** in any content table (POI/ROUTES/ROOM GUIDE/
  SERVICES/PARTNERS all 0). Imagery is external/pending. The media manifest therefore lists
  no Airtable binaries to copy (see `ANTIQUE_SPLIT_MEDIA_MANIFEST_REPORT.md`).
- **PII:** GUESTS/STAYS/PRIVOLE/REQUESTS/FEEDBACK/PUSH_SUBSCRIPTIONS/AI_RESPONSE_LOGS are
  **count-only** in the export and are **never migrated** (locked boundary).

## 1. Source table inventory

| Airtable table | Table ID | Rows | Antique | Dest. Supabase table | Migrate? | PII |
|---|---|--:|--:|---|---|---|
| HOTELI | tblvDAXTN6kmeQt8o | 3 | 1 | `destinations` + `hotels` | Yes (1 real row; 2 blank → drop) | No |
| SOBE | tblbHFokE9BP1rkOf | 25 | 5 | `room_types` | Yes (5 types; 20 blank → drop) | No |
| ROOM GUIDE | tbls3oojfqN8pyYoJ | 8 | 8 | `rooms` (+ per-room overrides) | Yes (all 8; **tokens preserved**) | No (token = secret) |
| SERVICES | tbloZwmqS0vqrCSL9 | 108 | 94 | `hotel_services` + `service_categories` | Yes (active, deduped) | No |
| SERVICES (Out) | tblTu1AeUPaS7RN77 | 45 | 0 | `destination_pois`/knowledge (city services) | Deferred (1 active only) | No |
| POI | tbl5mNNhWjuFMOJva | 22 | 22 | `destination_pois` + `hotel_poi_settings` | Yes | No |
| ROUTES | tbl1IWdCiWIUqrtkH | 6 | 6 | `destination_routes` + `hotel_route_settings` | Yes (POI graph deferred) | No |
| PARTNERS | tblYvQnrS4Z70x7hM | 3 | 3 | `hotel_services` (Dining/partner) or knowledge | Manual review | No |
| EVENTS | tbl90CM2v6XY7xNYv | 11 | 11 | `destination_events` + `hotel_event_settings` | Yes | No |
| NOVOSTI | tblscuDZTJ8LEut5j | 0 | 0 | (hotel news) | N/A (empty) | No |
| Split Today Events | tbl3zaxUDfURrvHR6 | 49 | 0 | `destination_events` (city, dated) | Deferred (dynamic city feed) | No |
| AI_INTENT_PATTERNS | tbl6fZUo99dd2Y5kw | 617 | — | `knowledge_aliases` (subset) | Classify (see AI report) | No |
| AI_OUTPUT_RULES | tbl2cHJu94SCHmOtk | 6 | — | `ai_configs.response_formatting` | Yes (merge) | No |
| AI_CONTEXT | tbl9PF8mcEwOG7iGh | 5 | — | `ai_configs.persona`/`tone` | Yes (merge) | No |
| AI_DISAMBIGUATION | tblPJhMzIbjzpE1j5 | 5 | — | `ai_configs`/knowledge | Manual review | No |
| AI_FALLBACK | tblpwW4XF9XUbsS51 | 3 | — | `ai_configs.safe_handoff_text` | Yes | No |
| AI_SLUG_SCOPE | tblzcRXlr7kf0kgSj | 3 | 1 | (routing config) | Drop (v1 provider concern) | No |
| UNANSWERED_QUESTIONS | tblD97FfQMkkXSEW3 | 318 | 318 | `unanswered_questions` (aggregated) | Reference-only, non-PII fields | Borderline |
| GUESTS | tblzuEUTUpCQiNfPd | 1 | 1 | `guests` | **No** (PII) | **Yes** |
| STAYS | tbl1J16CqhqYopPJO | 2 | 2 | `stays` | **No** (PII) | **Yes** |
| PRIVOLE | tblJLmNCN8Ma1MGR0 | 4 | 4 | `consents` | **No** (PII/signature) | **Yes** |
| REQUESTS | tblYdzb9pRBFTRKFL | 30 | 23 | `guest_requests` | **No** (PII) | **Yes** |
| FEEDBACK | tblG7coH5JjaaWtJo | 0 | 0 | `feedback` | N/A (empty) | Yes |
| PUSH_SUBSCRIPTIONS | tblmy7YXI2dT4REbz | 8 | 8 | `push_subscriptions` | **No** (endpoint secrets) | **Yes** |
| AI_RESPONSE_LOGS | tbl3wXLAUoYamQ91Z | 1693 | 1693 | `ai_response_logs` | **No** (guest questions/PII) | **Yes** |

## 2. Field classification (per domain)

Legend: **DIRECT** copy · **TRANSFORM** reshape · **SPLIT** one→many · **MERGE** many→one ·
**DERIVED** computed · **DROP** intentionally omitted · **MANUAL** needs human review ·
**DEFERRED** later package.

### Tenancy — HOTELI → destinations + hotels
| Source field | Target | Class |
|---|---|---|
| Slug=`antique-split` | `hotels.slug`, `destinations.slug=split` | DIRECT / DERIVED |
| Hotel naziv | `hotels.name` | DIRECT |
| Adresa / Grad / Poštanski broj | `hotels.address_line`/`city`/`postal_code` | DIRECT (canonical values in Part 4) |
| Telefon (recepcija) | `hotels.reception_phone` | DIRECT |
| Mobitel (recepcija) | `hotels.reception_mobile` | DIRECT |
| Email / Notification Email | `hotels.reception_email` | DIRECT |
| Check-in / Check-out | `hotels.check_in_time=14:00`/`check_out_time=11:00` | TRANSFORM (text→time) |
| Persona Voice | `ai_configs.persona`/`tone` | TRANSFORM |
| Emergency/Medical Number | `hotels.settings.emergency` jsonb | TRANSFORM |
| Google Maps/Review/Instagram/WhatsApp | `hotels.settings` jsonb | TRANSFORM |
| STAT/INFO/REQUESTS/SERVICES(links)/ROOM GUIDE(links) | — | DROP (link scaffolding) |
| rows 2–3 (blank) | — | DROP |

### Rooms — SOBE → room_types ; ROOM GUIDE → rooms
| Source | Target | Class |
|---|---|---|
| SOBE Tip sobe | `room_types.name`/`slug` | TRANSFORM |
| SOBE View | `rooms.view_description_override` (per type) | TRANSFORM |
| SOBE Kapacitet/Kreveti/Kvadratura/Kat | `room_types.default_capacity`/`default_bed_configuration`, `rooms.floor` | DIRECT/DERIVED |
| ROOM GUIDE Naziv sobe (101…303) | `rooms.room_number` | DIRECT |
| ROOM GUIDE **Access Token** | `rooms.access_token` | DIRECT — **never logged/shown/committed** |
| ROOM GUIDE Room Type | link `rooms.room_type_id` | DERIVED (match to room_types) |
| ROOM GUIDE AI WELCOME | `room_types.ai_welcome` / `rooms.ai_welcome_override` | DIRECT |
| ROOM GUIDE WiFi/Upute Klima/TV/Sef | `room_types.wifi_instructions`/`ac_instructions`/`tv_instructions`/`safe_instructions` | DIRECT |
| ROOM GUIDE Smart Glass (only 101/201/301) | `room_types.smart_glass`/`smart_glass_instructions` + `rooms.smart_glass_override` | TRANSFORM |
| ROOM GUIDE Napomene / Room features | `room_types.room_notes[]`/`room_features[]` | SPLIT (text→array) |
| ROOM GUIDE QR LINK | `rooms` (derive) / DROP raw | DERIVED |
| ROOM GUIDE Vector fields / Include in Vector Store | — | DROP |
| SOBE AI_PROMPT/AI_INTENT/AI_SOURCE/AI_INTENT_PATTERNS | — | DROP (v1 routing) |

### Services — SERVICES → service_categories + hotel_services
| Source | Target | Class |
|---|---|---|
| Naziv usluge | `hotel_services.title` + `key` | DIRECT/DERIVED |
| Kategorija | `service_categories` (dedup) + `category_id` | TRANSFORM |
| Opis (wall-of-text) | `hotel_services.body_content` (structured blocks) | TRANSFORM (never invent headings) |
| Active | `hotel_services.active`/`status` | DIRECT |
| AI_SOURCE (WEB/PWA/BOTH) | `visible_in_web`/`visible_in_pwa`/`available_to_ai` | TRANSFORM |
| Radno vrijeme | body block / `extra` | TRANSFORM |
| (embedded prices) | `price_items` where structured (minibar/laundry/dry-clean lists) | SPLIT / MANUAL |
| AI_PROMPT/AI_INTENT/links | — | DROP |
| deprecated/duplicate rows | — | DROP (not into resolved output) |

### Destination — POI/ROUTES/EVENTS → destination_* + hotel_*_settings
| Source | Target | Class |
|---|---|---|
| POI Naziv/Opis/Adresa/Lat/Lng/Kategorije | `destination_pois.*` | DIRECT/TRANSFORM |
| POI Udaljenost/Sort Order/Aktivno | `hotel_poi_settings.walking_time_minutes`/`sort_order_override`/`visible` | TRANSFORM |
| ROUTES Ruta naziv/Opis/Trajanje/Tip | `destination_routes.name`/`short_description`/`duration_minutes`/`difficulty` | DIRECT/TRANSFORM |
| ROUTES Redoslijed (POI order text) | `destination_routes.waypoints` jsonb | TRANSFORM (text→ordered) — link graph **MANUAL** |
| EVENTS Naziv/Datum/Opis/Tip/Link | `destination_events.*` | DIRECT/TRANSFORM |
| Galerija attachments | — | N/A (none present) |

### AI — see `ANTIQUE_SPLIT_AI_MIGRATION_REPORT.md`
617 intent patterns are **not** migrated 1:1. 598 point at a service (→ retained as
`knowledge_aliases` for the migrated service where useful), 5 point at rooms (deterministic),
the rest are deterministic-in-code or obsolete. Persona/tone/output-rules/fallback → `ai_configs`.

### Pricing — SERVICES text → price_categories + price_items
Structured price lists exist as text in a few services (Mini Bar, Dry Cleaning, Laundry).
Amounts (e.g. `10,50 €`) are parsed where unambiguous; **VAT and validity are NOT inferred**
(Airtable has none) → `vat_included=null`, marked MANUAL. Extra-bed €40 is asserted in QA but
must be sourced from a service row; if absent it is flagged MANUAL, not invented.

## 3. Unresolved / manual-review items

1. **Route → POI graph** — relationships are encoded as ordering text, not linked records → `waypoints` text preserved; structured POI links **DEFERRED**.
2. **Embedded service pricing** — only list-style prices parse cleanly; per-service inline prices flagged MANUAL.
3. **PARTNERS** (3) — dining partners; map to services or knowledge → MANUAL.
4. **SERVICES (Out)** (45, 1 active) — city services (ferry/pharmacy/taxi/beaches); migrate the active one, rest DEFERRED.
5. **Split Today Events** (49) — dynamic dated city feed; DEFERRED (belongs to a scheduled feed, not static import).
6. **UNANSWERED_QUESTIONS** (318) — used only to *identify* useful knowledge gaps; not imported verbatim (guest-typed text may contain incidental PII).

## 4. Safety posture

- Airtable client is **GET-only** (`_lib.airtableGet`); no mutation method exists.
- Every Supabase-touching script calls `assertDevSupabase()` and aborts unless the ref is `mcgrccvvybgcozeqlisj`.
- `raw/`, `normalized/`, `manifests/`, `reports/` are **gitignored** (tokens + bulk production content).
- Room access tokens flow only from `raw/` → DEV `rooms.access_token` in memory; never logged, shown, committed, or placed in any report.
