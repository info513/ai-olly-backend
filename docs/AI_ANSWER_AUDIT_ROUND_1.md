# AI Answer Audit — Hotel QA Round 1 (Antique Split)

> AI acceptance test of Ask Dioclea against corrected room data + hotel feedback.
> **LOCAL ONLY** — all answers captured against `localhost:8080/api/pwa-ask`. `eval:prod` NOT run (Render suspended). **No production claims.**
> Source of truth: ROOM GUIDE, SERVICES, HOTELI, deterministic handlers. No hotel info invented; missing info reported, not hallucinated.
> Date: 2026-07-30.

## Method
42-question set. **Room-variant questions** (identity, view, window, smart glass, floor heating, AC-vs-thermostat, extra bed — where the answer legitimately differs per room) were run for **all 8 rooms** (101, 102, 201, 202, 203, 301, 302, 303). **Room-invariant + hotel-wide questions** (Q3, Q11, Q15–42) were run once (room 201) because they do not depend on the room. Full transcripts captured in session logs.

## Result summary
Room-specific answers were **almost entirely correct** after Batches 1–5 (types, views, window/tilt, smart-glass presence with **no cross-room leak**, underfloor heating by room, AC thermostat note only for underfloor rooms). Failures found and their disposition:

| # | Failure | Rooms | Disposition |
|---|---|---|---|
| F1 | Extra bed: price-guard hid availability/€40 | 101, 202, 302 (have); inconsistent handoff for others | **FIXED** (deterministic handler) |
| F2 | "How should I reach the hotel?" → returned phone, not arrival guidance | all (hotel-wide) | **FIXED** (contact-core guard) |
| F3 | "Breakfast in bed?" / "Breakfast bag?" → handoff despite info in SERVICES | all (hotel-wide) | **OPEN** (intent linking) |
| F4 | "Can Reception help me?" → raw contact-card dump incl. URLs; exposes phone/address that conflict with config | all (hotel-wide) | **OPEN** (data + prompt) |
| F5 | Toiletries (Q20) → handoff for 201 (its features omit the brand) | 201 | **OPEN** (minor, honest — data gap) |

---

## Failed answers (detail)

### F1 — Extra bed availability & price  →  FIXED
- **Questions:** "Can I request an extra bed?" (Q13) / "How much does it cost?" (Q14)
- **Rooms:** 101, 202, 302 have an extra bed (€40/night); 102, 201, 203, 301, 303 do not.
- **Current answer (before):** 101/202/302 → *"The price is not available in the system. Please contact reception for a quote and availability."* (the GPT price-guard blocked the €40). Others → generic safe handoff.
- **Problem:** Factually incomplete/inconsistent — rooms that DO have an extra bed did not confirm it, and the confirmed €40 rate (present in ROOM GUIDE features) was suppressed.
- **Correct answer:** Rooms with an extra bed → *"Yes — an extra bed is available in your room on request for €40 per night. Please contact Reception to arrange it."* Rooms without → *"Your room does not offer an extra bed. For other options, Reception will be happy to help."*
- **Where fixed:** **deterministic handler** — `isExtraBedQuestion` (server/classify.js) + `renderExtraBedAnswer` reading `ROOM GUIDE` "Room features/Communication" (server/server.js), wired into the PWA deterministic chain before the GPT price-guard.
- **Re-test:** 101/202/302 → "€40 per night" ✅; 201/303 → "does not offer an extra bed" ✅.

### F2 — "How should I reach the hotel?"  →  FIXED
- **Room:** hotel-wide (tested 201).
- **Current answer (before):** *"You can reach us at +385992140829"* (routed to the contact card via the word "reach").
- **Problem:** Factually wrong for the intent — the guest asked how to travel to the hotel; expected order is hotel transfer → Uber/Bolt → trusted taxi.
- **Correct answer:** *"The easiest way to reach Hotel Antique Split is by arranging a private transfer through Reception. Alternatively, you can use ride-hailing apps like Uber or Bolt, or take a taxi from the ranks near the Riva…"*
- **Where fixed:** **deterministic handler / routing** — `isContactCoreQuestion` (server/classify.js) now excludes arrival-context "reach"/"get to" + hotel/airport/transfer, so the question routes to the **Arrival Guidance** SERVICES record.
- **Re-test:** ✅ returns transfer-first arrival guidance in the correct order.

### F3 — "Breakfast in bed?" / "Breakfast bag?"  →  OPEN
- **Room:** hotel-wide (tested 201).
- **Current answer:** *"I don't have confirmed information about breakfast in bed, but Reception will be happy to help."* (same for breakfast bag).
- **Problem:** Incomplete — both are answered in the **Breakfast (Hours & Policy)** SERVICES record ("Breakfast in bed: order by dialing 100…"; "Breakfast bags: notify the hotel by the evening before"), but the intent router did not surface that record, so GPT had no context and safe-handed-off.
- **Correct answer:** Breakfast in bed → *"You may order breakfast to your room by dialing 100 and choosing from the À la carte menu."* Breakfast bag → *"If you're departing before 7:30, breakfast bags can be prepared — please notify the hotel by the evening before."*
- **Where it should be fixed:** **SERVICES / AI_INTENT_PATTERNS** — add "breakfast in bed", "breakfast bag", "room service breakfast" phrases to the breakfast intent so the Breakfast (Hours & Policy) record is linked into GPT context (or split into dedicated records). Not fixed tonight (Airtable intent-routing change; needs careful phrase tuning to avoid mis-routing).

### F4 — "Can Reception help me?"  →  OPEN (data + prompt)
- **Room:** hotel-wide (tested 201).
- **Current answer:** a raw hotel-core card dump: *"Antique Split Address: Poljana Grgura Ninskog 1 Reception phone: +385992140829 Email:… Google Maps: https://… Google Reviews: https://… Instagram: https://…"*.
- **Problem:** (a) Awkward — a wall of contact data + raw URLs for a simple yes/no; (b) **data conflict** — HOTELI phone **+385992140829** and address **"Poljana Grgura Ninskog 1"** differ from `config.js` (phone **+38521785208**, address **"Ul. Dioklecijanova 1, 21000 Split"**).
- **Correct answer:** a short *"Yes — Reception is here 24/7. Call +[correct number] or use Help & Requests."* without raw URLs.
- **Where it should be fixed:** **HOTELI (data)** — confirm the correct phone and address, reconcile HOTELI vs config.js; **prompt/handler** — the hotel-core card should not dump raw review/Instagram URLs for a generic help question. Not fixed tonight — needs the hotel to confirm the correct phone/address first (do not guess).

### F5 — Toiletries (Q20), room 201  →  OPEN (minor)
- **Current answer:** *"I don't have confirmed information about the toiletries provided, but Reception will be happy to help."*
- **Problem:** 201's "Room features" line does not list a toiletries brand (other rooms mention L'Occitane), so the AI honestly hands off. Not wrong — just a data gap.
- **Where it should be fixed:** **ROOM GUIDE** — optionally add the toiletries brand to 201's features if confirmed by the hotel. Left OPEN (do not invent).

---

## Room-by-room result (room-specific facts)

After fixes, every room passes the room-specific set (identity, type, view, window/tilt, smart glass, floor heating, AC-vs-thermostat, extra bed):

| Room | Identity/Type | View | Window/Tilt | Smart Glass | Floor Heating | AC vs thermostat | Extra Bed | Verdict |
|---|---|---|---|---|---|---|---|---|
| 101 | ✅ Deluxe Ground Floor | ✅ Cathedral, no Peristyle | ✅ sideways, no tilt | ✅ yes | ✅ yes | ✅ note present | ✅ €40 | **PASS** |
| 102 | ✅ Comfort Ground Floor | ✅ none (honest) | ✅ sideways, no tilt | ✅ none (no leak) | ✅ yes | ✅ note present | ✅ not offered | **PASS** |
| 201 | ✅ Deluxe | ✅ Cathedral + Peristyle | ✅ opens + tilts | ✅ yes | ✅ yes | ✅ note present | ✅ not offered | **PASS** |
| 202 | ✅ Superior | ✅ none (honest) | ✅ opens + tilts | ✅ none (no leak) | ✅ yes | ✅ note present | ✅ €40 | **PASS** |
| 203 | ✅ Standard | ✅ none (honest) | ✅ opens + tilts | ✅ none (no leak) | ✅ yes | ✅ note present | ✅ not offered | **PASS** |
| 301 | ✅ Deluxe | ✅ Cathedral + Peristyle | ✅ opens + tilts | ✅ yes | ✅ no | ✅ no note (correct) | ✅ not offered | **PASS** |
| 302 | ✅ Superior | ✅ picturesque square | ✅ opens + tilts | ✅ none (no leak) | ✅ no | ✅ no note (correct) | ✅ €40 | **PASS** |
| 303 | ✅ Standard | ✅ none (honest) | ✅ opens + tilts | ✅ none (no leak) | ✅ no | ✅ no note (correct) | ✅ not offered | **PASS** |

**Hotel-wide questions:** check-in 14:00 / check-out 11:00 ✅, late check-out ✅, business invoice ✅, key fob ✅, arrival guidance ✅ (F2 fixed), breakfast hours/allergies/gluten-free ✅, extra towels/pillows/iron/shoe-cleaning ✅, ferry/bus ✅, sunset/beach/restaurant ✅. **OPEN:** breakfast in bed/bag (F3), "Can Reception help me?" raw dump + phone/address conflict (F4), 201 toiletries (F5).

## Round-1 follow-up (2026-07-31) — closing F3, F4 (help part), F5

### F3 — Breakfast in bed / breakfast bag  →  FIXED
- An AI_INTENT_PATTERNS entry for this already existed (`rec2w3ojg1xoUOyPH`, phrases incl. "breakfast in bed"/"breakfast bag") linked to *Room Service & In-Room Breakfast*, but GPT routing across 617 patterns did not reliably surface it, so the questions still handed off. Per the "deterministic if routing can't be made reliable" rule, added **deterministic handlers** `isBreakfastInBedQuestion` / `isBreakfastBagQuestion` (fire before the breakfast-hours handler), sourced from the verified **Breakfast (Hours & Policy)** record. No duplicate service records created; no AI_INTENT_PATTERNS changed.
- Answers: in bed → *"…order breakfast to your room by dialing 100 and choosing from the À la carte menu."*; bag → *"…if you are departing before 7:30, a breakfast bag can be prepared. **Please notify the hotel by the evening before.**"*

### F4 (help answer) — "Can Reception help me?"  →  FIXED
- Added deterministic `isReceptionHelpQuestion` (fires before the contact card) → short assistance answer, **no URLs/phone/address**. Guarded `isCapabilitiesQuestion` to defer to it when "reception" is mentioned. Contact-detail requests ("how can I contact reception?") still return contact info via the existing hotel-core handler. **Phone/address values were NOT changed** (see Task 4 / OPEN below).

### F5 — Room 201 toiletries  →  FIXED
- Added "• L'Occitane toiletries" to ROOM GUIDE **201** (`rec0lHP301GragCLj`) `Room features/Communication`. Other rooms with hotel-supplied L'Occitane (101, 202, 203, 302, 303) retain it. Q "What toiletries are provided?" (201) now returns L'Occitane.

### Local re-test (LOCAL ONLY — localhost, not production)
| # | Question | Room | Result | Class |
|---|---|---|---|---|
| 1 | Can I request breakfast in bed? | 201 | dial 100, À la carte | **PASS** |
| 2 | Can I request a breakfast bag? | 201 | "…notify the hotel by the evening before." | **PASS** |
| 3 | When should I request a breakfast bag? | 201 | same (not the hours handler) | **PASS** |
| 4 | What toiletries are provided? | 201 | "L'Occitane toiletries" | **PASS** |
| 5 | Can Reception help me? | 201 | short assistance answer, no URLs | **PASS** |
| 6 | What can Reception help with? | 201 | short assistance answer (not capabilities) | **PASS** |
| 7 | How can I contact Reception? | 201 | contact via hotel-core handler | **PASS** |

Regression: "What can you help me with?" (no "reception") still → capabilities handler ✅.

## Remaining OPEN
- **F4 (data) — HOTEL CONFIRMATION REQUIRED — do not pick a winner:**
  - **Phone:** config.js `+38521785208` vs HOTELI `+385992140829`.
  - **Address:** config.js `Ul. Dioklecijanova 1` vs HOTELI `Poljana Grgura Ninskog 1`.
  - Not changed. Once the hotel confirms the correct values, reconcile HOTELI ↔ config.js. (The contact handler currently surfaces the HOTELI phone.)

## Production verification — PENDING (Render suspended). Do NOT run `eval:prod` yet.
