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

## Change log
- 2026-07-30: Ledger created; field map + Batch-1 target values authored. Applied R-TYPE (102, 303) Room Type + AI Welcome corrections to Airtable (see Batch 1 progress). Remaining Batch 1 fields + Batches 2–5 OPEN.
