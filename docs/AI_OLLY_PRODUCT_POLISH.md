# AI OLLY — Product Polish Report & Backlog

> **Phase:** Product Polish (architecture is frozen — no backend / Airtable / routing changes in scope).
> **Method:** the app was experienced as a real guest would, live, from the QR entry point (`/pwa/?slug=antique-split&room=201&token=…`) on a 375×812 mobile viewport, with the real backend + Airtable data. Findings are observations of the running product, not code review.
> **Companion docs:** [AI_OLLY_MASTER_DOCUMENTATION.md](AI_OLLY_MASTER_DOCUMENTATION.md) (source of truth) · [AI_OLLY_LAUNCH_CHECKLIST.md](AI_OLLY_LAUNCH_CHECKLIST.md).
> **Date:** 2026-07-30. **Nothing was changed** — this is audit-only.

---

## Guest journey walked

QR entry → Splash → Permissions → Home (incl. POI scroller, Split Today, Whispers card) → POI Detail → Room Guide → Room Guide Section (WiFi) → Hotel Services → Services Category (Breakfast & Food) → Service Detail → Ask Dioclea (with a live Q&A) → Help & Requests → Routes → Hotel Info.

Screens assessed from structure/snapshot only (not reached live this pass, flagged where relevant): City Map (Leaflet), Near Me results, Concierge form, Restaurant detail, Whispers reader, Feedback, Reception Consent.

> **Note on the flow diagram:** the requested journey lists *Consent* right after the QR scan. In the built product, **guest consent is a reception-side flow** (`/reception/*`), not part of the in-room guest PWA. The guest path is QR → Splash → Permissions → Home. Consent is covered separately in the Launch Checklist.

---

## Part A — Overall impression

The product already has a **strong, distinctive editorial identity**: Fraunces/Cormorant serifs, a warm-to-navy palette, and genuinely premium components (the **Split Today** card and the **Whispers** card are the high-water marks — they look shippable today). Deterministic answers in Ask Dioclea are fast and clean.

The gap to v1.0 is **consistency and finish**, not features. Three themes recur across almost every screen:

1. **The persona name leaks** ("Ask Olly" appears in-product while everything else is "Dioclea").
2. **The floating assistant bubble covers content** on nearly every screen, including CTAs.
3. **Everything looks like a placeholder** because the standardized hero system ships with **no imagery** — every hero is a flat grey/taupe block.

Add pervasive **title/description duplication** and **three competing colour worlds** (warm onboarding, navy shell, taupe heroes) and the app reads as "excellent bones, unfinished surface."

---

## Part B — Prioritized backlog

Effort: **S** ≤ half-day · **M** ~1–2 days · **L** > 2 days. UX impact: how much a guest notices.

### 🔴 Critical — blocks a credible v1.0

| # | Problem | Suggested solution | Effort | UX impact |
|---|---|---|---|---|
| C1 | **Persona leak: "Ask Olly".** The Room Guide section screens (e.g. WiFi) show an **"Ask Olly"** button, while the whole product is branded **Dioclea** (splash, chat, bubble). Two names for the same assistant breaks trust and brand. | Global find-and-replace of guest-facing "Olly" → "Dioclea"; keep "Olly" only in code/CSS token names. Audit every button/label/placeholder. | S | High |
| C2 | **Floating "Ask Dioclea" bubble overlaps content and CTAs.** Observed covering "Enter the Palace" (Whispers card), "Contact Reception" (service detail), the "Steps from your door" scroller, and last rows of lists. It also appears on **Splash and Permissions**, before the guest is even in the app. | Add safe-area bottom padding so content never sits under the bubble; hide the bubble on onboarding (splash/permissions) and on any screen with a primary bottom CTA; nudge it above the bottom-nav dock. | M | High |
| C3 | **App icons are missing (0-byte placeholders).** `pwa/icons/` contains only `.gitkeep`; manifest + service worker reference `icon-192.png` / `icon-512.png` that don't exist → broken install-to-homescreen and blank push-notification icon. | Produce real 192/512 PNGs (+ maskable) on brand background; commit to `pwa/icons/`. | S | High |

### 🟠 High — strongly undermines the "premium" promise

| # | Problem | Suggested solution | Effort | UX impact |
|---|---|---|---|---|
| H1 | **Empty hero imagery everywhere.** Every `screen-hero` and POI/route card renders as a flat grey/taupe block (`--hero-img: none`). It makes the whole app look unfinished. | Populate hero image slots for every screen + POI + route (see Media Audit). Until media lands, consider a richer gradient/texture fallback instead of flat taupe. | L (mostly content) | High |
| H2 | **Screen title duplicated.** List/detail screens show the title in the top bar **and again** in the hero (Room Guide, Hotel Services, Help & Requests, Routes, Info all say their name twice on one screen). | Pick one: keep the hero title and reduce the top bar to just "← Back", or drop the hero title. Apply consistently. | S | Med |
| H3 | **Body text duplicates the hero subtitle.** On POI Detail and Service Detail the hero subtitle is repeated **verbatim** as the first sentence of the body (e.g. breakfast "served 7:30–10:30, included in room rate" appears twice). | Render the short description **or** the long body, not both; if both are needed, ensure the body starts after the summary sentence. | S–M | Med |
| H4 | **Three competing colour worlds.** Onboarding (splash, permissions) and chat bubbles use the legacy **espresso/warm** palette; the app shell + nav use **navy**; heroes use **taupe/grey**. The journey doesn't feel like one app. | Commit to the navy "olly" system as canonical; restyle splash, permissions, and chat bubbles to match; make heroes navy-tinted (not taupe). | M | High |
| H5 | **No single primary-button style.** White pills (onboarding), taupe pills ("Open in Maps", "Reception", "Contact Reception"), and gold text-CTAs (cards) all coexist. | Define one primary and one secondary button in the design system; replace all ad-hoc pills. | M | Med |
| H6 | **Service body formatting is broken.** Sub-labels ("Allergies & intolerances:", "Kids' menu:", "Breakfast bags:", "Breakfast in bed:") run inline into the preceding paragraph — a wall of text from lost line breaks. | Render structured sub-sections (bold label + line break), or normalize the source text's newlines in the view layer (presentation-only, no data change). | M | Med |

### 🟡 Medium — noticeable inconsistencies

| # | Problem | Suggested solution | Effort | UX impact |
|---|---|---|---|---|
| M1 | **Concierge home tile** is a dark filled card among white tiles — it looks selected/active and dominates the grid; its subtitle ("Human assistance & arrangements") is low-contrast grey on navy. | Either make all tiles consistent, or intentionally style Concierge as a *single* feature card with readable contrast. | S | Med |
| M2 | **Permissions screen not full-bleed** — a cream left-edge strip shows the screen behind (clipping/transition artifact). | Ensure the permissions screen background covers the full viewport width. | S | Med |
| M3 | **Bottom-nav active state is unreliable.** Help & Requests highlighted the **Ask** tab; Room Guide highlighted **no** tab. | Define an explicit active-tab mapping for every non-root screen (or clear it consistently). | S | Low |
| M4 | **Redundant stacked subtitles.** Routes shows two near-identical descriptions back-to-back ("…experiences around Split." then "…excursions from the hotel."); Info repeats a similar pattern. | Keep one subtitle per screen. | S | Low |
| M5 | **Icon semantics muddled.** The sparkle (the AI/Ask symbol) is used for *Housekeeping*; the bell (notifications/Concierge) is used for *Arrival & Departure*; every Breakfast item uses an identical coffee-cup. | Assign category-appropriate icons; reserve the sparkle for AI/Ask only. | M | Low |
| M6 | **Two assistant entry points, two names.** "Ask Olly" button (Room Guide) vs "Ask Dioclea" bubble/screen — same feature, different name and styling. | Unify to one "Ask Dioclea" entry pattern and styling. (Overlaps C1.) | S | Med |
| M7 | **Route duration shown twice.** Row titles embed the duration *and* repeat it in the meta line ("Romantic Split (1–2 h)" + "⏱ 1–2 h"). | Drop duration from the title; keep it in the meta line only. | S | Low |
| M8 | **Screens feel empty.** WiFi, POI Detail, and Help have large blank areas below short content. | Add supporting content (related links, "Ask Dioclea about this", nearby actions) or vertically centre short content. | M | Med |

### 🟢 Low — refinement

| # | Problem | Suggested solution | Effort | UX impact |
|---|---|---|---|---|
| L1 | **Header layout differs** — some screens put the title inline next to "← Back", others only in the hero. | Standardize the header pattern. (Pairs with H2.) | S | Low |
| L2 | **Naming drift.** Home tile "Map & Near Me" vs nav "Map"; "Reception" vs "Contact Reception"; hero eyebrows ("HOTEL", "ANTIQUE SPLIT", "YOUR ROOM", "EXPLORE SPLIT", "WE'RE HERE TO HELP") have no system. | Align labels; define an eyebrow-label convention. | S | Low |
| L3 | **Splash balance** — large vertical gap between the top "Room 201 / Deluxe Room" label and the centred logo; feels unbalanced. | Tighten vertical rhythm / re-centre. | S | Low |
| L4 | **Weather card** "TAP FOR 5-DAY" all-caps mono reads more technical than premium. | Soften to sentence case / lighter treatment. | S | Low |
| L5 | **Card top-right arrows** ("→") float disconnected from their labels. | Tie the affordance to the card (whole-card tap already works) or align the arrow. | S | Low |
| L6 | **Loading states** — deterministic answers are instant, but confirm a typing/loading indicator exists for slower GPT answers and for POI/route/map data fetches. | Verify and add skeletons/typing indicator where missing. | S | Low |

---

## Part C — Media Audit (checklist — no media generated)

Every hero image slot currently resolves to `none`; POI/route cards render as gradient placeholders. Assets still required:

### App / brand
- [ ] `pwa/icons/icon-192.png` (real, replaces 0-byte)
- [ ] `pwa/icons/icon-512.png` (real, replaces 0-byte)
- [ ] Maskable icon variants (safe-zone padded)
- [ ] Brand logo mark for splash (currently only a gold sparkle + wordmark)

### Screen hero backgrounds (all empty)
- [ ] Home hero
- [ ] Room Guide hero
- [ ] Room Guide section/detail hero
- [ ] Hotel Services hero
- [ ] Service Detail hero
- [ ] POI Detail hero
- [ ] Routes hero + each route-category hero
- [ ] Route Detail hero
- [ ] Near Me hero
- [ ] Help & Requests hero
- [ ] Hotel Info hero
- [ ] Concierge hero
- [ ] Split Today / Events hero
- [ ] Whispers intro/detail hero

### POI photography (≈21 POIs)
- [ ] Hero image per POI (used in both the "Steps from your door" scroller and the POI Detail hero) — currently brown gradient placeholders

### Route photography
- [ ] Image per route category (Romantic, Gastronomic, …)
- [ ] Image per route detail

### Whispers (12 chapters)
- [ ] Chapter imagery for the list cards and the reader (currently text-only)

### Other
- [ ] Concierge / partner (restaurant) photography
- [ ] Split Today event imagery
- [ ] Empty-state illustration for Ask Dioclea (currently a bare sparkle) — optional
- [ ] Video: none present — **decide** whether any hero/loop video is wanted (optional, not required for v1.0)

---

## Part D — Content Audit (improvement list)

Presentation/content wording only — **no Airtable schema changes**; source-text edits happen in Airtable content, view fixes in the frontend.

**Persona & terminology**
- [ ] Replace guest-facing **"Ask Olly" → "Ask Dioclea"** everywhere (C1/M6).
- [ ] Unify area naming: "Hotel Services" vs category "Breakfast & Food" vs hero eyebrow "FOOD AND BEVERAGE" — pick one taxonomy per level.
- [ ] "Map & Near Me" (home) vs "Map" (nav); "Reception" vs "Contact Reception" — align.
- [ ] POI names: "Peristyle (Peristil)" vs "Peristyle"; "Cathedral of St Domnius" vs "Saint Domnius" — one canonical form each.

**Duplication**
- [ ] Remove hero-subtitle ↔ body first-sentence duplication (POI Detail, Service Detail).
- [ ] Remove route duration from titles (keep in meta) — "Romantic Split (1–2 h)" → "Romantic Split".
- [ ] Remove the double subtitle on Routes / Info.
- [ ] Section header "Cultural Series" immediately followed by a card labelled "CULTURAL SERIES" — drop one.

**Breakfast & Food category (structural content)**
- [ ] "Children & Family — Baby Cot, Kids Breakfast, Babysitting" is far longer than siblings and reads like a raw field concatenation — split/shorten.
- [ ] Babysitting / baby cot are miscategorized under **Breakfast & Food** — move to Guest Services / a Family section.
- [ ] "Kids' Breakfast Menu" duplicates the kids' breakfast content already inside the "Children & Family" row — dedupe.
- [ ] "Mini Bar Price list" capitalization ("Price list" vs "Menu") — normalize.

**Weak / generic copy**
- [ ] "Curated routes in this category." repeats on every route category — write distinct subtitles or drop.
- [ ] Service body sub-labels need real structure (see H6).
- [ ] Review tile subtitles and hero eyebrows for a consistent voice.

---

## Part E — What already shines (protect these)

- **Split Today** card — weather-aware copy, clean list with distances. Reference-quality.
- **Whispers of the Palace** card + 12-chapter series — strong editorial concept.
- **Ask Dioclea** deterministic answers — fast, concise, on-brand empty state; bubble correctly hidden on the chat screen.
- **List/label-value card pattern** (Room Guide sections, WiFi network/password, Info) — clean and consistent; use it as the template elsewhere.

---

*Audit only. No product code, Airtable data, or configuration was modified. No commits were made.*
