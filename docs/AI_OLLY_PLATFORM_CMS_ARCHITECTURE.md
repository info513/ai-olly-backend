# AI OLLY Platform CMS — Destination Content Architecture

**Planning only. No code, schema, migration, dashboard, PWA, backend, or Airtable was modified.**
This designs the Platform CMS for **shared destination content**, maintained centrally by
PRESSMAX / platform administrators. Hotels never author canonical destination facts — they control
only *presentation*. The design supports Split, Dubrovnik, Zadar, Hvar, Rovinj, Rome, Vienna,
Prague, and future destinations without a redesign.

> **Grounding — what already exists (do not re-invent):** the data layer already implements the core
> of this design. `destinations`, `destination_pois`, `destination_routes`, `destination_events`,
> `destination_whispers` (canonical) + `hotel_poi_settings`, `hotel_route_settings`,
> `hotel_event_settings`, `hotel_whisper_settings` (presentation) = **Pattern B, live.**
> `knowledge_articles` already carries a 3-scope model (`hotel_id` / `destination_id` / platform via
> `source_type ∈ {platform,destination,hotel,override}`) + `knowledge_aliases`. A **generic
> `translations`** table exists. `assets` (public-media / private buckets) + `asset_usages` exist.
> RLS is fail-closed; `is_platform_admin` gates platform tooling; publish is draft/live via
> `content_versions` + `published_snapshot`. **The gap is mostly the Platform CMS *UI*, the
> destination roles, source-provenance fields, the live-feed pipeline, Destination Health, and
> propagation tooling — not the tenancy model.**

---

## Part 1 — Product model

**Recommended hierarchy:**
```
Platform
  → Country            (attribute: country_code on destination — no separate table for R1)
    → Region           (OPTIONAL, nullable attribute; not a table for R1)
      → Destination    (the unit hotels attach to; canonical content lives here)
        → Destination content (POIs, routes, whispers, events, live feed, knowledge, media)
          → Hotel presentation (per-hotel visibility/order/recommendation/override)
```

- **Region is OPTIONAL.** Model it as a nullable `region` label on the destination for R1 (grouping
  + filtering), not a first-class table. Promote to a table only when editorial teams need region-
  level ownership (post-R1). *Rationale: avoids an empty hierarchy layer for single-city launches.*
- **A Destination represents any tourism unit** — city, island, resort area, municipality, or wider
  region — distinguished by an optional `destination_type` enum (`city | island | resort | region`).
  Split = city; Hvar = island; both are "destinations". One flexible entity, no subtype tables.
- **Hotel → destination assignment:** `hotels.destination_id` (already exists) — a single FK.
- **One primary destination per hotel for R1** (locked decision). Multi-destination is a future
  `hotel_destinations` join (many-to-many) — explicitly out of R1 (Part 18, D-4).

---

## Part 2 — Ownership model

| Content | Owner (edit) | Notes |
|---|---|---|
| Destination identity/slug/country/region/tz/locales/coords/status/SEO | **platform_admin** | canonical |
| Canonical POIs / routes / whispers / destination events | **platform_admin** | canonical facts |
| Split Today / local live feed | **platform_admin** (+ optional automated import) | canonical, time-sensitive |
| Destination images/videos, categories, destination AI knowledge, translations, canonical emergency/local info | **platform_admin** | canonical |
| Rooms, services, prices, hotel news/offers, hotel assets, hotel AI facts, newsletter | **hotel_admin / hotel editor** | hotel-owned |
| **Hotel presentation settings** for shared destination content | **hotel_admin / hotel editor** | the only hotel control over destination content |

**Hard rule:** hotels **cannot** edit canonical destination facts. Enforced at the data layer (RLS):
`destination_*` write policies allow only `is_platform_admin`; hotels get read on *published*
destination content + write on their own `hotel_*_settings`.

---

## Part 3 — Content domains (Platform CMS modules)

Each canonical record adds a common **provenance block** (new fields, Part 10): `source_type`,
`source_name`, `source_url`, `imported_at`, `last_verified_at`, `verification_status`, `rights_notes`.

- **Destinations** — identity, slug, country_code, region?, destination_type, timezone, locales
  (default + supported), latitude/longitude, status, SEO/basic metadata. *(table exists; add
  region/type/SEO/locales.)*
- **POIs** — category (`poi_category` enum, exists), title, canonical + short description, coords,
  address, map URL, opening info, accessibility, website, phone, price/entry info, validity, status +
  provenance. *(`destination_pois` exists; add opening/accessibility/website/phone/entry/provenance.)*
- **Routes** — title, description, route type, difficulty (`route_difficulty`, exists), distance,
  duration, start/end, **ordered POI waypoints** (already modeled as `waypoints` jsonb with linked POI
  keys, done for Split), map/polyline ref, safety notes, accessibility, seasonality, status.
- **Whispers** — chapter key, order, title, story (`body_content`), "Did you know" (callout), source,
  media, visibility, status + `channel_key` (collection, e.g. "whispers-of-the-palace"). *(exists.)*
- **Destination events** — title, category, venue/location, dates, recurrence, description, source,
  media, status, expiry/archive. *(exists.)*
- **Local live feed** — the Split-Today equivalent: source, import vs manual mode, start/end,
  category, status, **automatic expiry** (past → archived), **duplicate detection**. Stored in
  `destination_events` with a `feed_source` marker + an import job (new pipeline, Part 10).
- **Media** — images/video/documents, rights, source, alt text, captions, usage, archive.
  *(`assets` + `asset_usages` exist; add locale captions + transform presets + rights-expiry.)*
- **Destination AI knowledge** — canonical local facts (transport, safety, emergency, etiquette,
  local rules), destination FAQs, approved answers, aliases, validity, critical flags. *(modeled as
  `knowledge_articles` with `destination_id` set + `source_type='destination'`; `knowledge_aliases`.)*
- **Translations** — localized title/descriptions/captions/AI answers, locale status, completeness.
  *(generic `translations` table exists — Part 8.)*

---

## Part 4 — Hotel presentation layer (Pattern B)

Canonical `destination_*` record **+** `hotel_*_settings` row (already the schema). A hotel may set:

| Setting | Status |
|---|---|
| visible / hidden | exists (`visible`) |
| featured | exists (`featured`) |
| display order / priority | exists (`sort_order_override`) |
| walking time from hotel | exists (`walking_time_minutes`) — populated for Split |
| distance from hotel | add (or reuse walking time) |
| hotel recommendation | exists (`hotel_recommendation`) |
| hotel-specific short intro | exists (`hotel_short_description`) |
| hotel-specific photo override | exists (`hotel_photo_url`) → evolve to an `asset_id` reference (Part 5) |
| hotel-specific CTA | add (`cta_label` / `cta_action`) |
| hotel-specific note | reuse recommendation, or add `hotel_note` |
| audience suitability | add (`audience` enum/array — families/couples/accessibility) |
| seasonal visibility | add (`visible_from` / `visible_to`) |

**A hotel may NOT change** canonical title, coordinates, factual/historical description, ownership, or
source/rights.

**Presentation-setting governance:** presentation settings are **lightweight, live (not draft/live),
audited** (updated_by), and **inherited by default** (absent row ⇒ canonical defaults: visible=true
by policy, canonical order). Rationale: presentation is low-risk personalization edited frequently by
hotel staff; a full publish workflow would be friction. Canonical records keep the draft/live +
history workflow (Part 6). *(Contrast: services/knowledge/whispers content = draft/live + snapshot;
presentation settings = direct-edit + audit.)*

---

## Part 5 — Media model

- **Ownership tiers:** *platform-owned* (`assets.hotel_id IS NULL`, global — logos, generic category
  fallbacks), *destination-owned* (a destination-scoped asset — POI/route/whisper imagery), *hotel-
  owned override* (a hotel's own asset selected for presentation).
- **Reuse, don't copy:** one asset → many entities via **`asset_usages`** (`entity_type`,
  `entity_id`, `role`). A POI image shared across the POI card, a route that includes it, and a
  Whisper is **one asset, three usages** — never duplicated. Hotels *select* an approved asset for a
  presentation override (store `asset_id`, not a copy).
- **Public vs private:** destination/POI imagery = `public-media` (public); private buckets remain for
  genuinely private files (never real guest signatures/consent docs).
- **Metadata:** alt text, **locale-specific captions** (via `translations` on the asset), source
  credit, **rights + rights-expiry** (`rights_notes`, `rights_expires_at` — flag when expiring),
  **image transform presets** (thumbnail/card/hero via Supabase transform URLs — the audit's M8),
  **external video references** (store URL, no binary), archive (soft-delete, blocked while in use).

---

## Part 6 — Publishing model

Apply the existing **Draft → Preview → Publish → Live → History → Rollback** (content_versions +
published_snapshot) to canonical **POIs, routes, whispers, events, destination knowledge, and media
metadata** (destination_* currently have `status` but not all have snapshots — add the snapshot +
version workflow to them, mirroring services/knowledge).

- **Who may publish:** `platform_admin` (R1); later `destination_publisher` (Part 9).
- **Critical-content acknowledgement:** required to publish a change flagged critical (emergency
  numbers, safety, closures) — same `is_critical` + ack pattern as services/knowledge.
- **Scheduled publication + expiry:** `published_at` (future) + `valid_to`/`ends_at` → auto-archive.
- **Emergency correction:** publish-now bypassing schedule, always audited, may trigger notification.
- **Rollback:** restore a prior `content_versions` snapshot (destination-scoped).
- **Audit log:** every publish/rollback/critical-change recorded (existing `audit_log`, redacted).
- **Propagation:** because hotels read the **canonical** record, a canonical publish is **live for
  every hotel** immediately, *unless* a hotel presentation rule hides it. Presentation rows are
  untouched by a canonical edit (Part 14).

---

## Part 7 — Destination AI resolution

**Resolution order (already the intended knowledge model):**
```
1. hotel-specific operational fact        (knowledge_articles/services, hotel_id set, source_type hotel/override)
2. hotel-specific presentation/recommendation  (hotel_*_settings.hotel_recommendation / intro)
3. destination canonical knowledge        (knowledge_articles, destination_id set, source_type destination)
4. platform / global safe knowledge       (knowledge_articles, source_type platform)
5. safe handoff                           (ai_configs.safe_handoff_text → "ask reception")
```

- **Scopes:** hotel > destination > platform (a hotel override wins over destination canonical, which
  wins over platform). **Source priority + validity + critical** break ties; expired content is
  excluded; critical content is boosted.
- **Aliases:** `knowledge_aliases` (phrase → article) improve matching at each scope.
- **Conflict resolution:** narrowest scope wins; within a scope, higher `priority`, then most-recent
  published; **deterministic handlers** (in code) cover safety/emergency/contact regardless.
- **No hallucination:** the model answers only from retrieved approved content; unknown → safe
  handoff, never invention (the v1 two-tier safe-handoff policy is preserved).
- **No duplication:** hotels do not copy destination knowledge — they add a hotel fact only when it is
  a genuine hotel-specific override/recommendation.

---

## Part 8 — Localization (from day one)

Use the **existing generic `translations`** table — **never** `title_en/title_hr/title_de` columns.

- **Model:** `translations(entity_type, entity_id, field, locale, value, status)` — per-field, per-
  locale rows for any canonical entity (POI/route/whisper/event/knowledge/media-caption).
- **Canonical locale:** `destination.default_locale` (e.g. `en` for Split). Canonical fields hold the
  default-locale value; translations layer over them.
- **Workflow:** author canonical → request translations → `status ∈ {missing, draft, in_review,
  published}` per field/locale.
- **Fallback:** requested locale field → default-locale canonical → (never blank). Missing-translation
  = graceful fallback + flagged in completeness reporting.
- **Coverage:** **locale-completeness report** per destination (% of required fields translated per
  locale) surfaced in Destination Health.
- Covers titles, descriptions, captions, and **AI approved answers** (translate the article's
  approved_answer per locale).

---

## Part 9 — Roles & permissions

| Role | Scope |
|---|---|
| **platform_admin** | full canonical destination edit + publish, all destinations, migration tools |
| **destination_editor** | edit (not publish) canonical content for assigned destination(s) — **future** |
| **destination_publisher** | publish/critical-ack for assigned destination(s) — **future** |
| **destination_read_only** | read canonical + health, no writes — **future** |

**R1 recommendation:** **`platform_admin` only** for canonical editing + publishing (editor/publisher/
read_only are **capabilities to add later**, not R1 roles). Hotels: **read published destination
content**, **manage their own presentation settings**, **never edit canonical**.

**RLS implications (conceptual, no SQL):**
- `destination_*` + destination-scoped `knowledge_articles`: **SELECT** allowed to any authenticated
  member of a hotel in that destination *when status = published* (+ platform_admin any); **INSERT/
  UPDATE/DELETE** allowed to **platform_admin only**.
- `hotel_*_settings`: SELECT/UPSERT scoped to the owning hotel's admins/editors (existing pattern).
- Platform CMS routes gated by `is_platform_admin` (existing pattern; extend with the future
  destination-role check).

---

## Part 10 — Content sources

Every canonical record retains provenance (new common fields): `source_type`, `source_name`,
`source_url`, `imported_at`, `last_verified_at`, `verification_status ∈ {unverified, verified,
stale}`, `rights_notes`.

**Supported `source_type`:** `manual` · `airtable_import` · `official_tourism` · `city_event_feed` ·
`external_api` · `partner` · `hotel_suggestion` · `ai_assisted_draft`.

- **AI-assisted drafts** are allowed (draft only) but **AI may never auto-publish** — a platform admin
  must review + publish.
- **hotel_suggestion** = a hotel can *propose* destination content (e.g. "add this new café"), routed
  to platform review — hotels still can't publish canonical.
- **city_event_feed / external_api** feed the live feed (Part 3) with import mode + dedup + expiry.

---

## Part 11 — Quality & governance — Destination Health

Rules: factual verification + source requirement (no source ⇒ flag), stale-content review
(`last_verified_at` older than N months), expiry (past `valid_to`/`ends_at` → archive), duplicate
detection (title+coords proximity), broken-link detection (website/map/source URLs), missing media,
missing alt text, missing translation (per required locale), invalid coordinates (out of destination
bounds), outdated price/opening info, content completeness, critical-content review.

**Destination Health** = a set of **explainable dimensions** (never one opaque score — mirror Hotel
Health): *Source coverage · Freshness/staleness · Link health · Media completeness · Alt-text ·
Translation completeness · Coordinate validity · Expiry hygiene · Critical-content review*. Each →
Healthy / Needs attention / Critical + reasons + fix links + a visible formula version. No dimension
is hidden; every number shows its formula.

---

## Part 12 — Platform CMS dashboard

```
Platform  (visible only to platform_admin; separate from the hotel workspace)
 ├ Destinations     ├ Whispers      ├ Media         ├ Content Health
 ├ POIs             ├ Events        ├ AI Knowledge  └ Settings
 ├ Routes           ├ Live Feed     ├ Translations
```

Per module: **list screen** (+ filters: status/category/verification/locale-completeness) · **detail/
editor** (canonical fields + provenance + block body) · **preview** (guest render + resolved) ·
**publish workflow** (draft→preview→publish, critical-ack) · **history + rollback** · **bulk actions**
(publish/archive/verify/assign-category) · **search** (cross-module within a destination) · **empty
states** · **warnings** (missing source/media/translation/critical-review).

- **Destination switcher** — separate from the hotel switcher; sets the active *destination* context.
- **Context clarity (critical):** a persistent banner/breadcrumb always states whether the admin is
  editing **Platform** (global), a **Destination** (e.g. Split), or a **Hotel** — with distinct
  colour/badge — to **prevent accidental cross-context edits**. Destructive/publish actions confirm
  the context ("Publishing to the **Split destination** — affects all Split hotels").

---

## Part 13 — Hotel CMS experience (destination content, hotel side)

Inside the Hotel CMS, shared destination content appears **read-only for facts, editable for
presentation**. Hotels see: available shared content, enabled/disabled, featured, ordering, walking
time, recommendation, hotel intro, selected image, and **preview-as-guest**. Hotels do **not** see
canonical editing controls.

Every such surface shows two clear labels:
- **"Maintained by AI OLLY Platform"** (on the canonical facts), and
- **"Your hotel controls presentation only."** (on the settings the hotel can change).

This makes the boundary obvious and prevents support confusion ("why can't I edit this description?").

---

## Part 14 — Content propagation

When the platform updates a canonical record (e.g. a museum's opening hours):
- The update **becomes live for every hotel** using it (hotels read the canonical record). **Immediate
  propagation** by default; **scheduled** via `published_at`.
- Hotel **visibility/order/recommendation/image override remain unchanged** (separate `hotel_*_settings`
  rows are untouched).
- **Critical changes** (safety/closure/emergency) → **notification** to affected hotels (derived feed
  + optional email later).
- **Preview impact / affected-hotel report:** before publishing, show *which hotels currently present
  this record* (have it visible) so the editor understands blast radius; after publish, an audit
  entry lists affected hotels.
- **Rollback impact:** rolling back a canonical record reverts the fact for all hotels; presentation
  rows stay put.

---

## Part 15 — Migration of Split content (conceptual — do not execute)

**Largely already done** (Sprint 9 + content-completion): Split canonical content is migrated and
Antique Split is linked via `hotels.destination_id → Split`. This task formalizes the model:

| Source | Classification | Target |
|---|---|---|
| Airtable POIs (22) | **canonical Split** | `destination_pois` (+ provenance) |
| Airtable routes (6) | **canonical Split** | `destination_routes` (+ waypoint POI graph — done) |
| Airtable events (11) | **canonical Split** | `destination_events` |
| Split Today (49) | **canonical Split live feed** | `destination_events` (feed-marked; expired archived — done) |
| v1 PWA Whispers (12) | **canonical Split** | `destination_whispers` (done) |
| Destination knowledge (transport/safety/etc.) | **canonical Split** | `knowledge_articles` (destination scope) — *to author* |
| Hotel rooms/services/prices/hotel-facts | **hotel-specific Antique** | hotel-scoped tables (done) |
| Visibility/order/walking-time/recommendation | **hotel presentation** | `hotel_*_settings` (done) |
| Inactive SERVICES-Out / duplicate rows | **deprecated / manual review** | excluded / owner decision |
| Imagery | **media pending** | produce + upload (no source binaries) |

**Antique Split stays linked** to the shared **Split** destination via its `destination_id`; it reads
canonical Split content and layers its `hotel_*_settings` — the exact Pattern B this architecture
generalizes. A second Split hotel would reuse the same canonical content with its own presentation.

---

## Part 16 — New-destination onboarding

```
Create destination → configure locale/timezone/country/region/type
 → add categories → add emergency/local basics (critical knowledge)
 → add core POIs → add routes → add media → add AI knowledge
 → translate (required locales) → QA (Destination Health) → publish → assign first hotel
```

**Minimum viable destination-content set** before a hotel may use it:
- Destination identity + locale/timezone + **emergency/local basics** (critical knowledge).
- **≥ ~8–12 core POIs** published (with source + coords + category).
- **≥ 1 route** (optional but recommended).
- **Destination knowledge** for transport + safety + etiquette basics.
- Category **fallback media** (real per-POI imagery can follow).
- Default-locale complete; at least the guest's primary locale translated for critical content.
- **Destination Health = no Critical dimensions.**

---

## Part 17 — Scaling model

| Scale | What holds / what to add |
|---|---|
| 1 dest / 1 hotel | Pattern B as-is (Split/Antique today) |
| 10 dest / 100 hotels | Platform CMS + destination switcher; canonical reuse (1 POI → many hotels); **shared media reuse** via asset_usages; add the **analytics/health refresh scheduler**; pagination/virtualization |
| 100 dest / 1,000 hotels | **destination_editor/publisher roles** + editorial teams per destination; cross-destination search index; publish queues; audit at scale; translation vendor workflow; AI retrieval stays hotel>dest>platform (indexed) |
| Multiple countries | country/region grouping; locale packs per country; legal/emergency info per country |

- **Tenant isolation:** unchanged — RLS per hotel; destination content read-shared within a
  destination, write-locked to platform.
- **Content/media reuse:** canonical once, presented many — the core scaling lever (no per-hotel copies).
- **Search / publishing / audit / translations / AI:** all scale on the existing patterns; the new
  work at scale is editorial *roles*, *queues*, and *scheduling*, not schema redesign.

---

## Part 18 — Open decisions

| # | Decision | Options | Recommendation | Consequence | Blocks impl.? |
|---|---|---|---|---|---|
| D-1 | destination_editor/publisher now or later | (a) platform_admin only R1 (b) add roles now | **(a) R1** | simpler RLS; editorial teams later | No |
| D-2 | Region as table or attribute | table / nullable field | **attribute (field) R1** | promote to table when needed | No |
| D-3 | destination_* draft/live snapshots | reuse services/knowledge pattern / status-only | **reuse snapshot+version** | consistent publish/rollback; small migration | Partially (needed for Part 6 rollback) |
| D-4 | One vs many destinations per hotel | single FK / join table | **single (R1 locked)** | multi-dest = future join | No |
| D-5 | Live feed source | manual / city API / hybrid | **manual + optional import job** | automation later; dedup+expiry needed | No (manual works R1) |
| D-6 | Presentation settings draft/live | direct-edit+audit / full publish | **direct-edit + audit** | low friction for hotels | No |
| D-7 | hotel photo override: URL vs asset_id | keep `hotel_photo_url` / migrate to `asset_id` | **evolve to asset_id** | proper reuse + rights tracking | No (URL works interim) |
| D-8 | Provenance fields scope | all canonical / POIs only | **all canonical** | governance completeness | No |
| D-9 | Destination knowledge authoring for Split | now / at destination onboarding | **author during onboarding** | Split knowledge currently hotel-fact + services | No |
| D-10 | AI auto-draft from sources | allow draft-only / disallow | **draft-only, never auto-publish** | speeds authoring, keeps control | No |

None **hard-block** implementation; D-3 is the main schema addition (snapshots on destination_*).

---

## Part 19 — Implementation roadmap

| Phase | Goal | Dependencies | Risks | Expected result | Acceptance |
|---|---|---|---|---|---|
| **0 — Confirm architecture + roles** | Sign off this doc + D-1..D-10 | — | scope creep | agreed model | owner sign-off; decisions closed |
| **1 — Platform CMS shell + destination context** | `/platform/*` section, destination switcher, context banner, RLS-gated | is_platform_admin | context confusion | admins navigate destinations safely | switcher works; context always visible; hotel roles denied |
| **2 — POIs** | Canonical POI CMS (list/editor/preview/publish/history) + provenance | Phase 1 | data-model completeness | POIs authored + published centrally | POI publish→live for hotels; health flags |
| **3 — Routes** | Route CMS + ordered POI waypoint editor | Phase 2 (POIs) | waypoint UX | routes with linked POIs | route resolves with POIs; rollback works |
| **4 — Whispers** | Whisper chapter CMS (channel, order, story, media) | Phase 1 | editorial tooling | whispers authored centrally | order/text parity; publish/rollback |
| **5 — Events / Live Feed** | Event CMS + live-feed import/manual + dedup + auto-expiry | Phase 1 | feed dedup/expiry | current + dated events | expired auto-archived; no dupes |
| **6 — Shared media** | Asset picker, reuse via usages, transforms, rights/alt/captions | Phases 2–5 | rights tracking | one asset, many usages | no duplicate assets; alt/rights enforced |
| **7 — Destination AI knowledge** | Destination-scope knowledge + aliases + resolution | Phases 2–5 | conflict resolution | AI answers from destination scope | resolution order correct; no hallucination |
| **8 — Translations + Health** | Generic translations UI + Destination Health dashboard | Phases 2–7 | completeness at scale | multilingual + governance | completeness report; explainable health |
| **9 — Hotel presentation controls** | Hotel-side shared-content UI (visible/order/rec/override/preview) + labels | Phases 2–7 | boundary clarity | hotels present, don't edit | canonical read-only; presentation editable + audited |
| **10 — Split migration + verification** | Finalize Split canonical + Antique presentation + compare/verify | all above | parity | Split fully on the CMS | compare MATCH; Antique linked; health green |

---

## Final output

1. **Recommended final hierarchy:** `Platform → Country (attr) → Region (optional attr) → Destination
   (city/island/resort/region) → Destination content → Hotel presentation`.
2. **Platform CMS modules (11):** Destinations, POIs, Routes, Whispers, Events, Live Feed, Media, AI
   Knowledge, Translations, Content Health, Settings.
3. **Canonical vs hotel responsibility:** platform_admin owns all `destination_*` + destination
   knowledge + translations + platform/destination media; hotels own rooms/services/prices/news/
   offers/hotel-assets/hotel-facts/newsletter **+ presentation settings only**. Hotels never edit
   canonical facts (RLS-enforced).
4. **Hotel presentation capabilities:** visible, featured, order/priority, walking time, distance,
   recommendation, intro, image override (→ asset), CTA, note, audience suitability, seasonal
   visibility — direct-edit + audited; canonical facts locked.
5. **AI resolution order:** hotel fact → hotel presentation → destination canonical → platform global
   → safe handoff (scopes hotel>dest>platform; validity/critical/priority tie-breaks; no hallucination).
6. **Role model:** R1 = **platform_admin only** for canonical edit/publish; hotels read published +
   manage presentation; destination_editor/publisher/read_only = post-R1 capabilities.
7. **Split migration approach:** Split canonical content already migrated (POIs/routes/whispers/events/
   live feed); Antique Split linked via `destination_id`; layer `hotel_*_settings`; author destination
   knowledge during onboarding; imagery pending. **Do not re-migrate — formalize.**
8. **New screens/routes (est.):** **~26–30** (11 modules × list+editor ≈ 22, + destination switcher,
   Content Health, Settings, preview, history, live-feed importer).
9. **Reusable components (est.):** **~16–20** (destination switcher, canonical editor shell reusing
   BlockEditor/publish/history, presentation-settings panel, provenance panel, translation panel,
   media picker/usage panel, health cards, live-feed importer, context banner, affected-hotel report).
10. **Implementation effort:** **XL** — multi-sprint (Phases 0–10). Rough order ~8–12 sprints; the
    heaviest are POIs (2), Media reuse (6), AI knowledge (7), and Hotel presentation (9). Much of the
    *data model* is reused, so effort is concentrated in the **Platform CMS UI + governance**.
11. **Highest risks:** (a) **context confusion** (editing Platform vs Destination vs Hotel) — mitigate
    with the persistent context banner + confirmations; (b) **critical-change propagation** to many
    hotels without notification; (c) **media reuse vs duplication** at scale; (d) **translation
    completeness**; (e) **live-feed dedup/expiry**; (f) RLS for destination-read shared across hotels.
12. **Blocking decisions:** only **D-3** (add draft/live snapshots to `destination_*` for Part-6
    rollback) is a real prerequisite; D-1/D-2/D-4/D-6 have clear R1 defaults; the rest don't block.
13. **Recommended first implementation phase:** **Phase 1 — Platform CMS shell + destination context**
    (the `/platform/*` section, destination switcher, and the always-visible context banner), because
    it is the foundation every module sits on and it directly de-risks the #1 risk (context mistakes)
    before any canonical editing exists.

---

*Architecture/product planning only — no code, database, migration, dashboard, PWA, backend,
Airtable, or approved documentation was modified; no Split content was migrated.*
