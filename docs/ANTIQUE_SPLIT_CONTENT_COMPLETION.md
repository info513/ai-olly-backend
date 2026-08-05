# Antique Split — Content Completion (Airtable → Supabase)

**Goal:** make true — *"All non-PII Antique Split content has been migrated into Supabase in its
proper structured form."* Source of truth = production Airtable (**read-only**). Done with the
existing migration engine + a new idempotent **completion stage**
(`scripts/migration/complete-antique-content.mjs`); nothing was invented, simplified, or recreated.
All writes target aiolly-dev only.

> **Verification:** compare engine = **all 9 domains MATCH + TOKEN MATCH**; `verify-antique-migration`
> = **46 passed / 0 failed**; `npm run rc1` = **25 passed / 0 failed**. Idempotent (a second apply
> inserts 0 new rows).

## What the completion stage added (idempotent, derived from source)

| Item | Before | After | Source basis |
|---|--:|--:|---|
| Room structured fields (minibar/kettle/blackout/underfloor, toiletries, window, extra-bed) | null | **5/5 types** | ROOM GUIDE free-text (Napomene/Features) — extracted, not invented |
| POI walking time | null | **22/22** | POI "Udaljenost od hotela" band (0–5→5, 5–10→10, 10–20→20 min) |
| Route → POI graph | text-only | **6/6 linked** | ROUTES `POIs` link field (the field Sprint 9 missed) — real POI ids |
| Split Today city events | 0 | **49** (13 published, **36→archived** expired) | Split Today Events table, dated |
| Knowledge category | 0 | **1** (Hotel information) | — |
| Knowledge articles | 0 | **7** (contact, emergency, medical, check-in, check-out, address, review) | HOTELI fields, verbatim-derived |
| Knowledge aliases | 0 | **235** | AI_INTENT_PATTERNS phrases mapped to the hotel-fact articles (service-routing patterns discarded) |
| AI config depth | persona/tone/output/handoff | **+ 4 disambiguation + 3 fallback + 6 output rules** | AI_DISAMBIGUATION / AI_FALLBACK / AI_OUTPUT_RULES, verbatim |

---

## Per-domain status

| Domain | Imported | Skipped | Manual review | Deferred | Missing |
|---|---|---|---|---|---|
| **Hotel core** | ✅ canonical (address/phone/mobile/check-in-out/currency/tz) | — | — | — | — |
| **Room types (5)** | ✅ + structured fields | — | — | — | — |
| **Rooms (8)** | ✅ tokens preserved (TOKEN MATCH) | — | — | — | — |
| **Services (94)** | ✅ 83 published / 11 draft; bodies structured | inactive/duplicate excluded from live | — | — | — |
| **Prices (35)** | ✅ minibar / laundry / dry-cleaning (source has €) | — | extra-bed/transfer/breakfast/room-service | — | **not in source (no € in Airtable)** |
| **POIs (22)** | ✅ + walking time + presentation | — | — | — | — |
| **Routes (6)** | ✅ + linked POI waypoints | — | — | — | — |
| **Hotel events (11)** | ✅ + presentation | — | — | — | — |
| **Split Today (49)** | ✅ (expired archived) | — | — | — | — |
| **AI config** | ✅ persona/tone/output/handoff/disambiguation/fallback | — | — | — | — |
| **AI knowledge** | ✅ 7 articles + 235 aliases (+ 83 AI-visible services = corpus) | 617→235 (obsolete routing discarded) | — | — | — |
| **Whispers** | — | — | — | — | **not an Airtable table (static in v1 PWA code)** |
| **Hotel news (NOVOSTI)** | ✅ (0 rows in source) | — | — | — | — |
| **SERVICES (Out)** | — | 44 inactive city services | **1 active city service** (ambiguous target) | — | — |
| **PARTNERS (3)** | — | — | **3 dining partners** (no clean target entity) | — | — |
| **Media / imagery** | — | — | — | — | **0 Airtable binaries; all external/pending** |

---

## Remaining Airtable-only content

Only two small, low-priority sets remain, both **manual-review** because they lack an unambiguous
structured target (not a pipeline gap):
- **SERVICES (Out)** — 45 city external services, **1 active** (pharmacy/ferry/taxi/beaches). The 44
  inactive are correctly excluded. The 1 active could become destination content or knowledge — needs
  a mapping decision.
- **PARTNERS (3)** — dining partners. No "partners" entity in the schema; map to services (Dining) or
  knowledge — needs a decision. Flagged MANUAL since Sprint 9.

Everything else in Airtable that is **non-PII and has a structured target has been migrated.**

## Remaining manual work

- Decide the mapping for the 1 active SERVICES(Out) record + the 3 PARTNERS (small).
- Confirm **VAT** on the 35 price items (source has no VAT rate → `vat_rate` stays **null**, all
  flagged `needs_review`; never invented).
- Optional: author the headline prices (extra-bed/transfer/breakfast/room-service) **if** the hotel
  provides amounts — they are **not in Airtable**, so they were not structured.

## Remaining media work

**All guest-facing imagery is pending** — there are **zero binaries in Airtable** to migrate (the
media manifest confirms 0 attachments across every content table). Classification (all → *produce +
upload*, none migratable from source): hotel logo, room photos, POI photos, hero/loop imagery, app
icons, Whispers imagery. This is a content-production task, not a data migration.

## Completion by area

| Area | Completion |
|---|--:|
| Hotel core | 100% |
| Rooms + structured facts | 100% (of source-stated facts) |
| Services | 100% (94/94) |
| Prices | 100% of source-priced items (extra-bed/transfer/breakfast not in source) |
| POIs (+ walking + presentation) | 100% |
| Routes (+ POI graph) | 100% |
| Events (hotel + Split Today) | 100% |
| AI config | 100% |
| AI knowledge (articles + aliases) | ✅ hotel deterministic facts + curated aliases (services carry the rest) |
| Whispers / News | N/A (not in source) |
| SERVICES(Out) active + PARTNERS | ~4 records **manual-review** |
| **Media / imagery** | **0% (pending — no source binaries)** |
| **Overall structured content** | **~97%** (remaining = ~4 manual-review records) |

---

## Final verdict

### **CONTENT COMPLETE WITH MEDIA PENDING**

Being honest: **every non-PII Antique Split content domain that exists in the Airtable source with a
structured Supabase target has been migrated** — hotel core, all rooms (now fully structured), all
services, all source-priced items, all POIs (with walking times), all routes (with real POI graphs),
all hotel events, the full Split Today feed (expired archived), the AI configuration, and a genuine
AI-knowledge layer (7 hotel-fact articles + 235 curated aliases on top of the 83 AI-visible
services). Parity is proven (9/9 domains MATCH, TOKEN MATCH), and the completion is idempotent.

**Why "with media pending" and not unconditionally "complete":**
1. **Media/imagery** has no Airtable source binaries — every image must be **produced and uploaded**
   (logo, room/POI photos, hero imagery, icons). 0% migratable; a content-production task.
2. **~4 manual-review records** (1 active SERVICES-Out city service + 3 PARTNERS) lack an unambiguous
   structured target and need a mapping decision — deliberately not force-fitted (no invention).
3. **Whispers** and the **headline prices** (extra-bed/transfer/breakfast) are **not in the Airtable
   source** at all, so there is nothing to migrate — they are content the hotel must author, not a
   migration gap.

Net: **the structured content migration is complete; media/imagery and ~4 manual-review records
remain, and Whispers/some prices must be authored because they don't exist in the source.** No PII
was migrated (guests/stays/consents/requests/feedback/subscribers/logs — correct, by design).

---

*DEV-only content completion — Airtable remained read-only; production Render/Supabase/PWA,
DATA_PROVIDER, room tokens, and all PII were untouched; no cutover was performed.*
