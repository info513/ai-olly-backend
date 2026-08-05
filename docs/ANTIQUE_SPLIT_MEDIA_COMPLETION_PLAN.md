# Antique Split — Media Completion Plan

**Media inventory + classification for the pilot.** Sources inspected (read-only): production
Airtable export (`raw/`), the v1 PWA repo (`pwa/`), and project docs. **Headline finding: there are
zero image binaries anywhere** — Airtable has 0 attachments across every content table, and the PWA
repo contains **0 image files** (icons are 0-byte `.gitkeep`; hero slots are `--hero-img: none`;
Whispers reference `story/*.jpg` that do not exist and fall back to CSS gradients). So **no asset was
uploaded** — every required image is *produce-and-upload*, not migrate. Nothing was fabricated.

## Part 1 — Media source inventory

| Asset group | Source found | Current URL/path | Type | Dims | Supabase asset type | Owner scope | Usage | Alt-text | Rights | Dup | Action |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Hotel logo | none in repo/Airtable | — | — | — | image | hotel (public-media) | branding | required | hotel-owned (to supply) | — | **NEEDS HOTEL FILE** |
| Hotel hero image(s) | `--hero-img: none` (PWA) | — | jpg/webp | — | image | hotel (public-media) | hero | required | to produce/license | — | **NEEDS NEW PRODUCTION** |
| Room images (per type) | none | — | jpg/webp | — | image | hotel (public-media) | room-type/room | required | hotel/photographer | — | **NEEDS NEW PRODUCTION** |
| POI images | none (POIs carry Google Maps **links**, not images) | Google Maps URL | — | — | image | destination (public-media) | POI card | required | licensing needed | — | **NEEDS NEW PRODUCTION** / category fallback |
| Route images | `ROUTES.Galerija` empty | — | — | — | image | destination | route card | required | to produce | — | **NEEDS NEW PRODUCTION** / fallback |
| Event images (11 hotel) | none | — | — | — | image | destination | event card | optional | to produce | — | category fallback |
| Split Today images (49) | none | — | — | — | image | destination | event card | optional | — | — | **category fallback (no per-event image)** |
| Whispers imagery (12) | referenced `story/*.jpg` — **absent**; gradient fallback | `pwa/story/*.jpg` | jpg | — | image | destination | chapter hero | optional | to produce | — | **NEEDS NEW PRODUCTION** (gradient works meanwhile) |
| Newsletter imagery | none | — | — | — | image | hotel | email header | optional | — | — | **NOT REQUIRED** (no sending in pilot) |
| Icons / illustrations | `pwa/icons/*.gitkeep` (0-byte) | — | png | 192/512 | image | hotel/public | PWA install icons | n/a | to produce | — | **NEEDS NEW PRODUCTION** |
| PDFs / documents | none static; consent PDFs generated at runtime (deferred) | — | pdf | — | document | private buckets | consent record | n/a | private (never use real guest docs) | — | **NOT REQUIRED** for pilot |

*No content with unclear ownership/source was downloaded or uploaded.*

## Part 2 — Classification & minimum pilot set

| Classification | Items |
|---|---|
| READY TO MIGRATE | **none** (no binaries exist in any source) |
| NEEDS HOTEL FILE | hotel logo |
| NEEDS NEW PRODUCTION | hero image(s), room-type images (5), POI images, route images, Whispers imagery (12), PWA icons (192/512) |
| EXTERNAL URL RETAINED | POI Google Maps links (kept as links, not images) |
| RIGHTS REVIEW | any third-party POI/city photography before use |
| NOT REQUIRED (pilot) | newsletter imagery (no sending), static PDFs |
| DUPLICATE | none |
| ARCHIVE | none |

### Minimum media set required for pilot launch
1. **Hotel logo** (branding across dashboard + guest app).
2. **PWA app icons** — `icon-192.png`, `icon-512.png` (install-to-home-screen; currently 0-byte).
3. **One hotel hero image** (guest app landing).
4. **Five room-type images** (one per type: deluxe-ground-floor, comfort-ground-floor, deluxe-room,
   superior-room, standard-room) — shared by type (see Part 4).
5. **A small POI category fallback set** (~6 category images: landmark/museum/beach/cafe/nature/other)
   — not one image per POI.

Everything else (per-POI photography, route/event/Whispers imagery) is **enhancement**, not launch-blocking;
gradients + category fallbacks cover the pilot.

## Part 3 — Safe dev media import

**Result: 0 assets imported.** There is no confirmed-source binary with clear rights to import, so
`assets`/`asset_usages` for Antique Split remain empty by design (fabricating placeholder images
would violate "no invention"). The import path is ready and idempotent (`complete-antique-media.mjs`
+ the Sprint-6 storage broker) — it just has nothing safe to load yet. When the hotel supplies the
minimum set, import into **public-media** (public hotel/content imagery) with alt text + rights
metadata + `asset_usages`; keep private buckets for genuinely private files only (never real guest
signatures/consent docs).

## Part 4 — Room media strategy

For the 8 rooms (101/102/201/202/203/301/302/303): use **per-room-type imagery**, not per-room —
rooms of the same type are visually equivalent, so one image per type (5 images) avoids needless
duplication. Resolution/fallback order:
```
room override image  →  room-type image  →  hotel hero fallback
```
Create `asset_usages` at the **room-type** level (entity=room_type); only add a per-room override if a
specific room genuinely differs. This yields 5 usages, not 8 duplicates.

## Part 5 — POI / route / event media strategy (explicit fallback logic)

- **22 POIs** — per-POI photography is enhancement; for the pilot use a **category fallback** image
  (POI `category` → landmark/museum/beach/…): `poi image → category image → destination fallback`.
- **6 routes** — a **route hero** or the first-POI's image; fallback to a "walking route" category image.
- **11 hotel/destination events** — category/seasonal fallback; per-event image optional.
- **49 Split Today events** — **do not require a unique image per time-sensitive event.** Use a
  **category fallback** keyed on the event `Kategorija` (Concert/Theatre/Gastro/Festival/…):
  `event image → category image → generic city-event image`. Rationale: these are dated, high-churn
  city events; unique imagery per event is unmaintainable and unnecessary.

## Summary

The **media layer is 0% migrated and 100% pending** — by reality, not omission: no source binaries
exist. This plan defines exactly what the hotel/production must supply (a small minimum set) and the
fallback logic that lets the pilot launch with partial imagery. All non-media content is migrated
(see the final readiness report).

---

*DEV-only planning + inventory — Airtable and the v1 PWA remained read-only; production and PII
untouched; no media of unclear rights was downloaded or uploaded.*
