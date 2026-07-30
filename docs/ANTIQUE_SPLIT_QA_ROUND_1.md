# Antique Split — Hotel QA Round 1

> Consolidated hotel-verified corrections for rooms **101, 102, 201, 202, 203, 301, 302, 303**, sourced from the feedback in this working session.
> **Scope guardrails:** Airtable + PWA must stay aligned · no room data may leak between rooms · **do not** change QR tokens/links · **do not** implement Product Polish backlog items (app icons, floating bubble, "Ask Olly"→"Ask Dioclea" button, etc.) in this round · commits are focused per batch.
> Base `appon9UYjX6KU9cr1` · ROOM GUIDE table `tbls3oojfqN8pyYoJ` · SERVICES table `tbloZwmqS0vqrCSL9`.
> Status legend: **OPEN** / **IN PROGRESS** / **DONE**. Date opened: 2026-07-30.

## Authoritative field map (ROOM GUIDE → PWA/AI)

| UI section / use | Airtable field | Field ID | Server key |
|---|---|---|---|
| Room type (splash/home + AI) | `Room Type` | fldF6mdTLTVpPfAnu | `tipSobe` |
| WiFi | `WiFi` | fldJv6VJLsA0JzcXL | `wifi` |
| Air Conditioning | `Upute Klima` | fldD6t5G6qq2DAnbY | `klimaUpute` |
| TV | `Upute TV` | fld0krAkkJ3J0sBqS | `tvUpute` |
| Safe | `Upute Sef` | fldUCtR3FARKdqaYb | `sefUpute` |
| **Room Features** | `Room features/Communication` | fldRa9E81u86BFUx2 | `roomFeatures` |
| **Room Notes** | `Napomene` | fldCvd9okiDUcdfy4 | `napomene` |
| Smart Glass Window | **(none — must be added)** | — | `smartGlass` (missing) |
| AI Welcome | `AI WELCOME` | fldxlqj6iWj1a1ZGJ | `aiWelcome` |
| Access Token (do NOT touch) | `Access Token` | fldP0RArnOWtOHdWP | `accessToken` |

The AI answer path (`buildRoomContext`, server.js:1786–1791) reads `roomFeatures`, `wifi`, `klimaUpute`, `tvUpute`, `sefUpute`, `napomene` — so correcting these fields also corrects Ask Dioclea's room answers (Batch 4 is largely automatic once data is fixed).

---

## Cross-cutting findings discovered during audit

1. **Smart Glass leak (Critical).** The PWA Smart Glass section (app.js:249) reads `roomGuideData.smartGlass`, but `/api/pwa-room-guide` never returns that key. So **every** room shows the generic fallback "Your room is equipped with a smart glass window system." — including rooms **without** smart glass (102, 202, 203, 302, 303). Fix requires: a `Smart Glass` field + server read/return + frontend hide-when-empty. → Batch 1 (data) + Batch 3 (code).
2. **Room Type errors.** Room 102 `Room Type` = "Deluxe Ground Floor" (should be **Comfort Ground Floor**); Room 303 = "Comfort Room" (should be **Standard Room**). Both also mislabeled in their AI Welcome text.
3. **Room 101 view.** Current text claims "Cathedral **and Peristil**" view; hotel says **no Peristyle view**. Assumption applied: 101 keeps the Cathedral of St Domnius / bell-tower view, Peristyle removed. (Flagged for hotel confirmation.)
4. **Wall-of-text rendering.** Room-guide + service detail render raw text in a single block; bullet lists and line breaks are lost. → Batch 3.

---

## A. Global changes

| ID | Requested change | Affected | Airtable/code | Status | Verification |
|---|---|---|---|---|---|
| G1 | Check-out time = **11:00** everywhere | all | HOTELI `Check-out` (fldUPYGMVuiP5YeTN) = "Until 11:00"; SERVICES text; config.js | OPEN | pending |
| G2 | Verify check-in wording vs Hotel Info; flag exact wrong text before changing | all | HOTELI `Check-in`; SERVICES | OPEN | pending |
| G3 | "Key card" → **"Key fob"** | all | SERVICES text (grep) | OPEN | pending |
| G4 | "R1 invoice" → **"Business invoice"**; remove "R1" from EN titles/text | all | SERVICES text (grep "R1") | OPEN | pending |
| G5 | Correct spelling: **controlled, satellite, Wi-Fi** (do not preserve email typos) | all rooms | ROOM GUIDE features/notes | IN PROGRESS (Batch 1) | pending |
| G6 | Structured content renders correctly (bullets, line breaks, headings, price lists); no wall-of-text; remove duplicated dark-brown short description under detail heroes | all | app.js renderer | OPEN | pending |

## B. Room-specific changes (Batch 1)

Target values authored below (Batch 1 table). One row per room; fields corrected: Room Type, View, Extra bed, Smart Glass (+switch), Window mode, Underfloor heating, AC note, Room Features (bullets), Room Notes (bullets).

| ID | Room(s) | Requested change | Field(s) | Status | Verification |
|---|---|---|---|---|---|
| R-TYPE | 102, 303 | Fix official room type (102→Comfort Ground Floor, 303→Standard Room) | `Room Type`, `AI WELCOME` | DONE | re-fetch confirms |
| R-FEAT | all 8 | Rebuild Room Features as clean bullet list (type/view/window/heating/smart glass/extra bed/amenities) | `Room features/Communication` | OPEN | pending |
| R-NOTE | all 8 | Rebuild Room Notes as clean bullet list | `Napomene` | OPEN | pending |
| R-SG | 101,201,301 (present); 102,202,203,302,303 (absent) | Smart Glass presence + switch instructions ("above sink, left side of window"); no smart-glass claim for rooms without it | new `Smart Glass` field | OPEN | pending |
| R-WIN | all 8 | Window mode: 101/102 open sideways (no tilt); 201/202/203/301/302/303 open + tilt | `Room features/Communication` | OPEN | pending |
| R-HEAT | 101,102,201,202,203 (underfloor yes); 301,302,303 (no) | Underfloor heating by room | `Room features/Communication` | OPEN | pending |
| R-AC | 101,102,201,202,203 only | Append: "The air conditioning is not controlled by the thermostat on the wall. The thermostat regulates floor heating exclusively." (NOT for 301/302/303) | `Upute Klima` | OPEN | pending |
| R-BED | 101,202,302 | Extra bed available (€40/night); do not claim for others | `Room features/Communication` | OPEN | pending |
| R-VIEW | 101 (Cathedral only, no Peristyle), 201/301 (Cathedral + Peristyle) | Corrected views | `Room features/Communication`, `AI WELCOME` | IN PROGRESS | pending |

## C. Hotel Services changes (Batch 2)

| ID | Requested change | Airtable | Status |
|---|---|---|---|
| S1 | "Key card"→"Key fob" | SERVICES | OPEN |
| S2 | "R1 invoice"→"Business invoice"; strip "R1" | SERVICES | OPEN |
| S3 | Arrival Guidance order: 1) hotel-arranged transfers 2) Uber/Bolt 3) trusted local taxi company only | SERVICES (Arrival) | OPEN |
| S4 | Beauty & Wellness spelling; restructure price list (headings, spacing, line breaks) | SERVICES | OPEN |
| S5 | Additional Service: remove "beach towels" from short description | SERVICES | OPEN |
| S6 | Move iron & ironing board, sewing kit, shoe-cleaning kit: Housekeeping → Additional Service | SERVICES | OPEN |
| S7 | Format Laundry & Dry Cleaning cleanly; Dry Cleaning "Trousers" on its own line | SERVICES | OPEN |
| S8 | Breakfast bags wording: "Please notify the hotel by the evening before." | SERVICES (Breakfast) | OPEN |
| S9 | Remove "Breakfast Experience" duplicate | SERVICES | OPEN |
| S10 | Format Breakfast Menu & Kids' Breakfast Menu with sections + bullets | SERVICES | OPEN |
| S11 | Rename "House Rules 2" → "Additional Requests" | SERVICES | OPEN |
| S12 | Check-out 11:00 in all service text | SERVICES | OPEN |

## D. AI-answer changes (Batch 4)

Verify Ask Dioclea answers per corrected data. Manual test set per room: *What room am I in? · Does my room have smart glass? · How do I use the window? · Does my room have underfloor heating? · How do I control the air conditioning? · Can I request an extra bed? · What is the view from my room?* Plus policy: check-out 11:00, key fob, business invoice, transfer-first arrival guidance, no arbitrary local taxi recommendations.

| ID | Requested change | Area | Status |
|---|---|---|---|
| AI1 | Answers match corrected room data (smart glass, window, heating, AC vs thermostat, view, extra bed) | ROOM GUIDE data (auto via buildRoomContext) | OPEN |
| AI2 | Check-out 11:00; key fob; business invoice | SERVICES data + any handler text | OPEN |
| AI3 | Transfer-first arrival guidance; no arbitrary taxi companies | SERVICES + classify handlers | OPEN |

## E. UI formatting changes (Batch 3)

| ID | Requested change | Code area | Status |
|---|---|---|---|
| U1 | Preserve paragraphs/line breaks; detect & render bullet lists; separate headings from body; format price lists; no wall-of-text | app.js `renderRoomSection` + service-detail render | OPEN |
| U2 | Remove duplicated dark-brown short description under detail heroes when it repeats the body's opening sentence | app.js detail render | OPEN |
| U3 | Smart Glass section: hide when room has no smart glass (no generic leak) | app.js:248–252 + server API | OPEN |

## F. Map & Near Me changes (Batch 5)

| ID | Requested change | Area | Status |
|---|---|---|---|
| M1 | Remove generic Taxi category/search (arbitrary companies) | app.js near-me categories | OPEN |
| M2 | Split Ferry and Bus Stop into separate categories/actions | app.js near-me | OPEN |
| M3 | Pharmacy description includes duty-pharmacy locations: **Osječka ulica**, **Super Konzum**; do not invent exact addresses — flag for confirmation | POI/SERVICES data | OPEN |
| M4 | Audit Google My Maps request for Beaches/Landmarks; report implementation requirements before replacing current module | design note | OPEN |

## G. Concierge & Hotel Info changes (Batch 5)

| ID | Requested change | Area | Status |
|---|---|---|---|
| C1 | Fix empty Concierge "Dining" content or hide until content exists | PARTNERS data / app.js concierge | OPEN |
| C2 | Ensure Hotel Info shows hotel address from HOTELI data | HOTELI `Adresa` + Info screen (currently config.js) | OPEN |
| C3 | Do NOT change POI coordinates in this task | — | N/A (guardrail) |

---

## Batch 1 — authored target values (per room)

Spelling normalized (controlled / satellite / Wi-Fi). Bullets use "• ". "Room Features" = physical facts; "Room Notes" = stay notes. AC note appended only where underfloor heating exists.

**101 — Deluxe Ground Floor** · Smart Glass: YES · Window: sideways (no tilt) · Underfloor: YES · Extra bed: YES · View: Cathedral (no Peristyle)
- Features: • Deluxe Ground Floor room • View of the Cathedral of St Domnius and its bell tower (no Peristyle view) • Window opens sideways only — no tilt (handle down = closed, handle to the side = open) • Underfloor heating in the bathroom • Smart glass bathroom window • King-size bed (twin or triple on request) • Extra bed available on request (€40/night) • Air conditioning (controlled by remote) • Minibar, kettle, safe, satellite TV, free Wi-Fi • Walk-in shower, L'Occitane toiletries
- Notes: • Ground floor of the hotel (first floor of the building); no elevator — staff assist with luggage • Double-paned windows for quiet • Blackout system available
- AC note: appended.

**102 — Comfort Ground Floor** (type FIXED) · Smart Glass: NO · Window: sideways (no tilt) · Underfloor: YES
- Features: • Comfort Ground Floor room • Window opens sideways only — no tilt (handle down = closed, handle to the side = open) • Underfloor heating in the bathroom • King-size bed (twin on request) • Air conditioning (controlled by remote) • Minibar, kettle, safe, satellite TV, free Wi-Fi • Walk-in shower • Hardwood floors
- Notes: • Located in the Old Town, steps from the landmarks • Blackout system available
- AC note: appended.

**201 — Deluxe Room** · Smart Glass: YES · Window: open + tilt · Underfloor: YES · View: Cathedral + Peristyle
- Features: • Deluxe First Floor room • Direct view of the Cathedral of St Domnius and the Peristyle • Window opens fully and tilts • Underfloor heating in the bathroom • Smart glass bathroom window • King-size bed (twin on request), sofa • Air conditioning (controlled by remote) • Minibar, kettle, safe, satellite TV, free Wi-Fi
- Notes: • Double-paned windows for quiet • Blackout system • Bathrobe and slippers
- AC note: appended.

**202 — Superior Room** · Smart Glass: NO · Window: open + tilt · Underfloor: YES · Extra bed: YES
- Features: • Superior First Floor room • Window opens fully and tilts • Underfloor heating in the bathroom • King-size bed (twin on request) • Extra bed available on request (€40/night) — sleeps up to three adults • Air conditioning (controlled by remote) • Minibar, kettle, safe, satellite TV, free Wi-Fi • Walk-in shower, L'Occitane toiletries
- Notes: • Double-paned windows for quiet • Blackout system
- AC note: appended.

**203 — Standard Room** · Smart Glass: NO · Window: open + tilt · Underfloor: YES
- Features: • Standard First Floor room • Ancient stone walls • Window opens fully and tilts • Underfloor heating in the bathroom • King-size bed (twin on request) • Air conditioning (controlled by remote) • Minibar, kettle, safe, satellite TV, free Wi-Fi • Walk-in shower, L'Occitane toiletries
- Notes: • Double-paned windows for quiet • Blackout system
- AC note: appended.

**301 — Deluxe Room** · Smart Glass: YES · Window: open + tilt · Underfloor: NO · View: Cathedral + Peristyle
- Features: • Deluxe Second Floor room • Panoramic view of the Cathedral of St Domnius and the Peristyle • Window opens fully and tilts • No underfloor heating • Smart glass bathroom window • King-size bed (twin on request), sofa • Air conditioning (controlled by remote) • Minibar, kettle, safe, satellite TV, free Wi-Fi
- Notes: • Double-paned windows for quiet • Blackout system
- AC note: NOT appended.

**302 — Superior Room** · Smart Glass: NO · Window: open + tilt · Underfloor: NO · Extra bed: YES
- Features: • Superior Second Floor room • Window opens fully and tilts • No underfloor heating • King-size bed (twin on request) • Extra bed available on request (€40/night); baby cot free on request — sleeps up to three adults • Air conditioning (controlled by remote) • Minibar, kettle, safe, satellite TV, free Wi-Fi • Walk-in shower, L'Occitane toiletries
- Notes: • Overlooks a picturesque square • Double-paned windows for quiet • Blackout system
- AC note: NOT appended.

**303 — Standard Room** (type FIXED) · Smart Glass: NO · Window: open + tilt · Underfloor: NO
- Features: • Standard Second Floor room • Ancient stone walls • Window opens fully and tilts • No underfloor heating • King-size bed (twin on request) • Air conditioning (controlled by remote) • Minibar, kettle, safe, satellite TV, free Wi-Fi • Walk-in shower, L'Occitane toiletries
- Notes: • Old Town location, steps from the landmarks • Double-paned windows for quiet • Blackout system
- AC note: NOT appended.

---

## Batch 1 — DONE (verified 2026-07-30)

All B-section items (R-TYPE, R-FEAT, R-NOTE, R-SG, R-WIN, R-HEAT, R-AC, R-BED, R-VIEW) and G5 (spelling) are **DONE**. E-section U3 (hide Smart Glass when absent) and the room-guide part of U1 (bullet rendering) **DONE** via commit `4318bb2`.

Airtable records changed (ROOM GUIDE): rec F Az2YGmW6Jecct (101), rec3qHDdoXOMpXn0q (102), rec0lHP301GragCLj (201), recNpT3t70mVawqrA (202), recdpPa3vO3ji5cc7 (203), recHKG7eyKJVgESID (301), recs7uTBMo9FpypxA (302), recROKEUVvzUt9TaD (303). New field created: `Smart Glass` (fldNMMbJHEPvzQOIL). Old values recoverable from git/session history.

| Room | Type | Smart Glass | Window | Underfloor | Extra Bed | View | Room Guide | AI (data) |
|---|---|---|---|---|---|---|---|---|
| 101 | Deluxe Ground Floor | Yes (switch above sink) | Sideways, no tilt | Yes (+AC note) | Yes €40 | Cathedral, **no Peristyle** | ✅ | ✅ via context |
| 102 | **Comfort Ground Floor** (fixed) | No (tile hidden) | Sideways, no tilt | Yes (+AC note) | — | — | ✅ | ✅ |
| 201 | Deluxe Room | Yes | Open + tilt | Yes (+AC note) | — | Cathedral + Peristyle | ✅ | ✅ |
| 202 | Superior Room | No (tile hidden) | Open + tilt | Yes (+AC note) | Yes €40 | — | ✅ | ✅ |
| 203 | Standard Room | No (tile hidden) | Open + tilt | Yes (+AC note) | — | — | ✅ | ✅ |
| 301 | Deluxe Room | Yes | Open + tilt | **No** (no AC note) | — | Cathedral + Peristyle | ✅ | ✅ |
| 302 | Superior Room | No (tile hidden) | Open + tilt | **No** (no AC note) | Yes €40 + baby cot | — | ✅ | ✅ |
| 303 | **Standard Room** (fixed) | No (tile hidden) | Open + tilt | **No** (no AC note) | — | — | ✅ | ✅ |

Live verification: API returns per-room `smartGlass` (201 populated, 102 empty); 102 room type = "Comfort Ground Floor"; PWA hides Smart Glass tile for 102 and renders Room Features as a bullet list (screenshots taken). AC underfloor note present in 101/102/201/202/203, absent in 301/302/303. QR tokens untouched.

> **AI (data)** = correct because Ask Dioclea reads these ROOM GUIDE fields via `buildRoomContext`. A live per-room Q&A pass (Batch 4 manual test set) + `npm run eval:prod` remain to be run.

## Still OPEN
- Batch 2 (Hotel Services content: S1–S12) — requires editing SERVICES records.
- Batch 3 remainder: service-detail renderer (U1 for services), remove duplicated dark-brown short description under detail heroes (U2).
- Batch 4: live per-room Ask Dioclea test set + policy checks (check-out 11:00, key fob, business invoice, transfer-first arrival) + `npm run eval:prod`.
- Batch 5: Map (taxi removal, Ferry/Bus split, Pharmacy duty locations), Concierge Dining, Hotel Info address from HOTELI.
- Global G1–G4, G6.
- Tests to run: `npm run eval:prod`, `npm run lint:content`, `TENANT_SLUG=antique-split npm run validate:tenant`.

## Batch 2 — Hotel Services content — DONE (2026-07-30)

SERVICES table `tbloZwmqS0vqrCSL9`. Old values recoverable from session tool-result dumps / Airtable history.

| Record | ID | Change (old → new) |
|---|---|---|
| Check-out Procedure | recPkGjUqiAioYEBc | check-out **10:00 → 11:00**; "key card → key fob"; "R1 invoice → business invoice" |
| Check-In & Check-out + Quiet Hours | recCqeLW0XFwULUHm | check-out **10:00 → 11:00** (check-in 14:00 verified, unchanged) |
| Payments & Invoice (R1) | recUYcxxPnUSvvCRd | renamed **"Payments & Invoice (R1)" → "Payments & Invoice"**; "including R1 → including a business invoice" |
| Arrival Guidance | recbYuAjNJL84bwkr | reordered: **1) hotel transfer 2) Uber/Bolt 3) trusted local taxi**; no arbitrary taxi companies |
| Beauty and Wellnes Service | rec4roIAl6PScEmWc | renamed **"Wellnes → Wellness"**; reformatted (headings, bullets, price rows, single intro) |
| Additional Service | recIwDyNtU4NGiFGE | removed **Beach Towels**; added **Iron & Ironing Board, Sewing Kit, Shoe-Cleaning Kit** (moved from Housekeeping) |
| Housekeeping | recWI2EehqHIzMXhI | converted to bullet list; removed iron/sewing/shoe items (now in Additional Service) |
| Laundry Service – Price List | recTHitXvySnGmN8P | bulleted price rows + clean spacing |
| Dry Cleaning – Price List | reck0WIDLTcf9cdCi | bulleted price rows; Trousers on its own line |
| Breakfast (Hours & Policy) | rec40VSZALgLJaGZd | separated Allergies/Bags/In-bed; bags wording **"Please notify the hotel by the evening before."** |
| Breakfast (Menu) | recQCSihEWQbWOQAg | Buffet + À la carte as bullets; Dietary options as its own section |
| Kids' Breakfast Menu | recvEbhiAGsOcDY40 | sections EGGS / PANCAKES & CREPES / TOAST / OTHER with bullets |
| Breakfast Experience | recx1a76rZeH0Mhfp | **deactivated** (Active=false) — duplicate removed (soft-delete, reversible) |
| House rules 2 | rectB4jAmAh7PUfSb | renamed **"House rules 2" → "Additional Requests"** |
| HOTELI (hotel core) | recEJNvEuRU8gatcU | check-out **"10:00 AM" → "11:00"**; check-in **"14:00 PM" → "14:00"** (malformed format fixed; time unchanged) |

WEB/PWA visibility (AI_SOURCE) preserved on all edited records. No AI knowledge deleted (Beach Towels still covered by "Nearest Beach & Beach Towels"). Local verification: `/api/pwa-services` returns corrected text; hotel-core answer now returns "Check-out: 11:00".

## Batch 3 — Structured content rendering — DONE (commit `fe93ab3`)

Files: `pwa/app.js`, `pwa/style.css`, `pwa/index.html`, `pwa/sw.js`.
- Root cause fixed: `_stripUrls` was collapsing `\n\n` → space (destroyed all paragraph/list structure). Now preserves newlines.
- `_renderMarkdown` rewritten (line-based): section headings, bullet lists, aligned price rows (`Label — 0,00 €`), paragraphs. Reusable, not record-specific.
- Service detail: opening line dropped from the body when shown as the hero subtitle (removes duplicated short description). Meaningful multi-sentence intros are kept.
- Local verification (mobile viewport): Beauty (headings + aligned prices), Breakfast Menu (Buffet/À la carte/Dietary headings + 13 bullets, hero deduped), no console errors.

## Batch 4 — AI answer alignment — LOCAL verification (not eval:prod)

Local `/api/pwa-ask` against localhost:8080 (LOCAL ONLY — never production). Room answers read corrected ROOM GUIDE fields via `buildRoomContext`, so data fixes propagate automatically.

| Room | Question | Result |
|---|---|---|
| 201/102/303 | What room am I in? | ✅ "Deluxe Room" / "Comfort Ground Floor" / "Standard Room" |
| 201 | Smart glass? | ✅ Yes, switch above sink, left of window |
| 202 | Smart glass? | ✅ "I do not have information about smart glass" (no leak) |
| 301 | Smart glass? | ✅ Yes |
| 101 | Window? | ✅ opens sideways only, no tilt |
| 201 | Window? | ✅ opens fully and tilts |
| 201 | Underfloor heating? | ✅ Yes (bathroom) |
| 301 | Underfloor heating? | ✅ No |
| 101 | Control the AC? | ✅ remote + **thermostat regulates floor heating only** note present |
| 301 | Control the AC? | ✅ remote, **no** thermostat note (correct — no underfloor) |
| 101 | View? | ✅ Cathedral of St Domnius + bell tower (no Peristyle) |
| 201 | View? | ✅ Cathedral + Peristyle |
| 201 | Check-out time? | ✅ **11:00** (after HOTELI fix) |
| 201 | Business invoice? | ✅ contact Reception, business invoice |
| 201 | Transport to hotel? | ✅ transfer first, then Uber/Bolt, then trusted taxi |
| 202 | Extra bed? | ⚠️ price-guard replied "price not available, contact Reception" — safe but does not clearly confirm availability (see OPEN) |

## Batch 5 — Map / Concierge / Hotel Info — DONE (commit `a87c9d8`)

- **Near Me**: removed generic Taxi; split into **Ferry Port** + **Bus Station** categories (verified: categories = Landmarks, Beach, Pharmacy, ATM, Supermarket, Ferry Port, Bus Station; no taxi).
- **Pharmacy**: results now note duty-pharmacy locations **Osječka ulica** and **Super Konzum** (names only — no invented street numbers; Reception confirms today's duty pharmacy).
- **Concierge Dining**: hidden entirely until verified partner content exists (was showing an empty message).
- **Google My Maps (Beaches/Landmarks)**: audited, **not** replaced (see requirements below).
- **Hotel Info address**: currently shown from `CONFIG.address` = "Ul. Dioklecijanova 1, 21000 Split". **HOTELI.Adresa = "Poljana Grgura Ninskog 1"** — the two conflict. NOT wired to HOTELI to avoid displaying a possibly-wrong address. **Flagged for hotel confirmation** (see OPEN).

### Google My Maps — requirements (report only)
To replace the current Google Maps *search* links (Beaches/Landmarks) with a curated hotel map, the hotel must provide: (1) a published **Google My Maps** map (Share → "Anyone with the link") and its **map ID / embed URL**; (2) confirmation the layers (Beaches, Landmarks) are populated with verified pins. Implementation would then embed `https://www.google.com/maps/d/embed?mid=<MAP_ID>` in an iframe on the map screen. Not implemented tonight (needs the hotel's map ID; current search links remain safe).

## Still OPEN (after tonight)
- **Extra-bed answer quality** (202/302): price-guard mutes the €40/availability. Candidate for a small deterministic extra-bed handler reading `roomFeatures`. Left OPEN to avoid rushing a handler; info is present in data.
- **Hotel Info address conflict**: CONFIG "Ul. Dioklecijanova 1" vs HOTELI "Poljana Grgura Ninskog 1" — confirm correct address, then wire Info to HOTELI.
- **Google My Maps**: needs hotel's map ID (above).
- **Production gate** (tomorrow, after Render resumes) — see below.
- Full 8×10 AI matrix + `eval:prod` (deferred — Render suspended).

## PRODUCTION VERIFICATION — PENDING (Render suspended)
Do not mark production PASS. Run tomorrow after Render resumes:
1. `git push` already done through Batch 1; push Batches 3/5 code commits (`fe93ab3`, `a87c9d8`) if not yet pushed, then confirm Render deploy shows the latest build and assets at **v30**.
2. Load all 8 room links on production; verify Room Guide, Smart Glass matrix (101/201/301 visible; 102/202/203/302/303 hidden), bullet rendering, Hotel Services formatting, check-out 11:00.
3. `npm run eval:prod` → target 30/30.

## Change log
- 2026-07-30: Ledger created; **Batch 1** implemented + verified (8 ROOM GUIDE records + Smart Glass field; commit `4318bb2`). Docs `8de9c45`.
- 2026-07-30 (offline, Render suspended): **Batch 2** SERVICES + HOTELI content corrections (15 records). **Batch 3** structured renderer (commit `fe93ab3`). **Batch 4** local AI verification (LOCAL only, no eval:prod). **Batch 5** Map/Concierge/Info (commit `a87c9d8`). Production verification PENDING.
