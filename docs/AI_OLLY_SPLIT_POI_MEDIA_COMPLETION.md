# AI OLLY — Split POI + PWA Media Completion (DEV-only)

**Scope:** complete the canonical Split visual/content layer in the Platform CMS from the
supplied processed image set. **Environment:** `aiolly-dev` only (`mcgrccvvybgcozeqlisj`).
**Branch:** `feature/ai-olly-platform-2`. **No production, no `DATA_PROVIDER` change, no Airtable
writes, no guest PII, no cutover.**

**Final verdict: READY WITH MANUAL REVIEW.**
Canonical Split POIs + media are complete and verified in the Supabase Platform CMS. Two items
need a human before this is "COMPLETE": (1) coordinates for the 4 newly-created POIs, and (2)
license metadata for the image set. The live guest PWA does not yet show any of this — it reads
Airtable via Render (see the boundary section) — so nothing here is guest-visible until a separate,
out-of-scope cutover.

---

## 1. Image inventory → subject → entity → usage (Part 1)

Source folder: `AI OLLY - Fotografije Split/obrađene slike` (30 unique images; 31 files including
one exact duplicate `srebrena vrat.jpg` == `srebrena_vrata.jpg`). Every image was inspected
visually — filenames were **confirmed truthful**, not trusted blindly. Originals were copied
verbatim (byte-for-byte) into an ASCII working path before upload (the folder name's Croatian "đ"
is stored NFD on disk and is invisible to Node's `readdirSync` under macOS TCC).

- **21 → POI cards / canonical images** (17 existing POIs + 4 newly-created POIs).
- **1 → destination hero** (`riva.jpg`; no dedicated aerial/panorama exists in the set — see §7).
- **5 → destination-shared module heroes** (`pharmacy`, `ferry_bus`, `supermarket`, `atm`, `gastro`).
- **4 → hotel-owned module heroes** for Antique Split (`room_guide`, `hotel_services`,
  `concierge`, `help&request`).
- **1** exact duplicate ignored (`srebrena vrat.jpg`).

## 2. POI audit + completion (Parts 2–4)

- **16 required POIs already existed** and received their canonical image + republish.
- **4 POIs were genuinely missing and were created** with a *safe factual minimum only* — a short
  description, a paragraph, `category = landmark`, and their image. **No coordinates, hours,
  prices, accessibility, or historical claims were invented.** Their coordinates are left NULL and
  explicitly flagged **MANUAL REVIEW**:
  - `grgur-ninski` — Grgur Ninski (Gregory of Nin)
  - `church-of-st-francis-sv-frane` — Church of St Francis (Sv. Frane)
  - `palace-walls-zidine` — Palace Walls (Zidine palače)
  - `streets-of-diocletians-palace-ulice` — Streets of Diocletian's Palace (Ulice)
- `vocni-trg-fruit-square` is the existing canonical POI for **Trg braće Radić / Voćni trg** — the
  `trg_brace_radic.jpg` image was assigned there (naming variant, **not** a duplicate POI).
- **5 existing POIs have coordinates but no supplied image** and were left unchanged:
  `bacvice-beach`, `diocletian-palace`, `marjan-hill`, `the-brass-gate`, `the-iron-gate`.

## 3. Content QA matrix — all Split POIs (Part 13)

Legend: Map = has lat/long. Image = canonical_asset_id set. Src = source image verified visually.

| Canonical POI (key) | Exists | Map | Menu | Image | Published | Src verified | Notes | Result |
|---|---|---|---|---|---|---|---|---|
| the-riva-waterfront | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | also destination hero | PASS |
| the-golden-gate | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | | PASS |
| the-silver-gate | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | | PASS |
| the-brass-gate | ✓ | ✓ | ✓ | — | ✓ | n/a | no image supplied | PASS |
| the-iron-gate | ✓ | ✓ | ✓ | — | ✓ | n/a | no image supplied | PASS |
| temple-of-jupiter-baptistery | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | krstionica | PASS |
| peristyle-peristil | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | | PASS |
| vestibule | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | | PASS |
| the-substructures | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | podrumi | PASS |
| cathedral-of-saint-domnius | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | sv. Duje | PASS |
| pjaca-peoples-square | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | | PASS |
| vocni-trg-fruit-square | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | = Trg braće Radić | PASS |
| prokurative-republic-square | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | | PASS |
| marmont-street | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | | PASS |
| the-fish-market | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ribarnica | PASS |
| pazar-green-market | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | | PASS |
| matejuska-port | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | | PASS |
| strossmayers-park-ardin | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | Đardin | PASS |
| sustipan-park | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | | PASS |
| diocletian-palace | ✓ | ✓ | ✓ | — | ✓ | n/a | overall palace, no single image | PASS |
| bacvice-beach | ✓ | ✓ | ✓ | — | ✓ | n/a | no image supplied | PASS |
| marjan-hill | ✓ | ✓ | ✓ | — | ✓ | n/a | no image supplied | PASS |
| grgur-ninski | ✓ (new) | ✗ | ✓ | ✓ | ✓ | ✓ | **coords MANUAL REVIEW** | MANUAL REVIEW |
| church-of-st-francis-sv-frane | ✓ (new) | ✗ | ✓ | ✓ | ✓ | ✓ | **coords MANUAL REVIEW** | MANUAL REVIEW |
| palace-walls-zidine | ✓ (new) | ✗ | ✓ | ✓ | ✓ | ✓ | **coords MANUAL REVIEW** | MANUAL REVIEW |
| streets-of-diocletians-palace-ulice | ✓ (new) | ✗ | ✓ | ✓ | ✓ | ✓ | **coords MANUAL REVIEW** | MANUAL REVIEW |

**Totals:** 26 POIs, 26 published, 22 with coordinates, 21 with canonical image.
Map markers: the 22 coordinate-bearing POIs plot; the 4 new POIs will not appear on the map until
coordinates are added (MANUAL REVIEW).

## 4. Media QA matrix (Part 14)

All uploads are DESTINATION-owned Split media (or Antique-owned for hotel module heroes) — **no
per-hotel duplication of destination assets**. Every asset carries
`source_credit = "Pressmax processed image set (AI OLLY)"` and
`license_type = "license metadata pending"` (Part 6 preserves provenance; true license is a MANUAL
REVIEW item). Public URLs return HTTP 200 `image/jpeg` (spot-checked).

| Group | Owner scope | Count | Usage | License | Result |
|---|---|---|---|---|---|
| POI canonical images | destination (Split) | 21 | `canonical_asset_id` + `asset_usages(poi/card)` | pending | PASS |
| Destination hero | destination (Split) | 1 (`riva.jpg`) | `asset_usages(destination/hero)` | pending | PASS — no aerial available (MANUAL REVIEW to upgrade) |
| Module heroes — area/destination | destination (Split) | 5 | `asset_usages(destination/module_hero:*)` | pending | PASS |
| Module heroes — hotel | hotel (Antique Split) | 4 | `asset_usages(hotel/module_hero:*)` | pending | PASS |

**Module-hero classification (Part 8):**
- **Destination/area-shared** (reusable by every Split hotel): Pharmacy, Ferry/Bus, Supermarket,
  ATM, Gastro. These are local-area subjects, not hotel property.
- **Hotel-specific** (Antique Split only): Room Guide, Hotel Services, Concierge, Help & Request.
  These depict hotel property/staff/service and are correctly hotel-owned.

## 5. Pattern B — Antique Split consumption (Part 10)

**PASS.** Antique Split consumes canonical Split POIs by *reference* (published canonical POIs +
`canonical_asset_id` pointing at destination-owned assets). Verified: **0 hotel-owned `poi_image`
copies exist** for Antique Split. Antique's only hotel-owned assets are the 4 legitimately
hotel-specific module heroes (plus its pre-existing logo/room hero). The POI editor UI reinforces
this — the media picker labels the selection "reference only, no per-hotel copy."

## 6. Gastro (Part 9)

Imagery + navigation linkage only: `gastro.jpg` assigned as the destination-shared Gastro module
hero via `asset_usages(destination/module_hero:gastro)`. **No new editorial content** was created.

## 7. Destination hero (Part 7)

`riva.jpg` is the single canonical Split destination hero. The supplied set contains **no aerial or
panoramic** frame; the Riva waterfront is the most representative wide establishing shot available.
**MANUAL REVIEW:** replace with a dedicated aerial/panorama if/when one is provided.

## 8. PWA data-provider boundary (Part 11)

`DATA_PROVIDER=airtable`. The **live guest PWA reads Airtable via the Render backend**; it does
**not** read Supabase. Everything completed here lives in the Supabase Platform CMS and was verified
via the Platform CMS UI + direct DB checks. **There is no DEV PWA-on-Supabase preview**, so guest-PWA
breakpoint QA of *this* content is not possible by design — it would show Airtable content, not these
canonical records. This work does not, and must not, alter that boundary. Making this content
guest-visible is a separate, out-of-scope cutover.

## 9. Visual QA (Part 12)

Verified in the Platform CMS (the Supabase-backed surface) via the in-app browser:
- **POI list** (Split) — desktop 1280 and mobile 375: all 26 POIs listed, Published, no horizontal
  overflow, nav collapses to a hamburger on mobile.
- **POI detail** (`grgur-ninski`) — the created record renders with its safe description, full
  content, Draft/Live preview, and the **canonical image thumbnail loads** (naturalWidth 1899).
- **Console:** no errors.

**Fix made during QA:** the Platform CMS media picker (`usePublicAssets`) previewed only
`external_url`, so storage-uploaded public assets (whose URL derives from `storage_path`) showed a
placeholder. Corrected to fall back to the `public-media` public URL — benefits *all* storage-backed
public assets, not just this set. File: `dashboard/src/data/platform-pois.ts`.

## 10. Reproduce

```bash
# DEV-only, idempotent. Reads keys from ../.env; refuses any non-aiolly-dev URL.
node scripts/split-poi-media-completion.mjs
```

## 11. Manual-review checklist (before "COMPLETE")

1. **Coordinates** for the 4 new POIs (`grgur-ninski`, `church-of-st-francis-sv-frane`,
   `palace-walls-zidine`, `streets-of-diocletians-palace-ulice`) — from a trusted source; do not guess.
2. **License metadata** for the Pressmax image set (replace `"license metadata pending"`).
3. **Destination hero** — swap `riva.jpg` for a dedicated aerial/panorama if one becomes available.
4. **Cutover** (separate, out-of-scope): decide how/whether this canonical content reaches the
   guest PWA given the Airtable boundary.
