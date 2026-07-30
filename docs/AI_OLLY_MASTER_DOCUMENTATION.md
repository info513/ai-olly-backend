# AI OLLY — Master Documentation

> **Canonical, single source of truth for AI OLLY.**
> This is an internal engineering + product document, not marketing material.
> **Rule:** every significant change to AI OLLY must be reflected here *first*. No feature is "done" until this document is updated (see [§15 Development Rules](#15-development-rules)).

| | |
|---|---|
| **Product** | AI OLLY — digital hotel concierge (guest PWA "AI Dioclea" + website chat widget) |
| **Version** | v27 (service-worker / asset cache marker); package `1.0.0` |
| **Last updated** | 2026-07-30 |
| **Production URL** | `https://app.aiolly.pressmax.net` (API + static apps) |
| **Repository** | `github.com/info513/ai-olly-backend` — local `/Users/ivansimic/Documents/GitHub/ai-olly-backend/` |
| **Current branch** | `main` (== `origin/main`, clean) |
| **Latest commit** | `13b2a7c` — "Replace bottom nav with fixed premium dark navy dock" (2026-06-12) |
| **Pilot hotel** | Hotel Antique Split — Airtable base `appon9UYjX6KU9cr1`, slug `antique-split` |

---

## Table of contents
1. [Executive Summary](#1-executive-summary)
2. [Product Vision](#2-product-vision)
3. [Current Architecture](#3-current-architecture)
4. [PWA Modules](#4-pwa-modules)
5. [AI](#5-ai)
6. [Airtable](#6-airtable)
7. [API](#7-api)
8. [QR System](#8-qr-system)
9. [UX / Design System](#9-ux--design-system)
10. [Production Status](#10-production-status)
11. [Changelog](#11-changelog)
12. [Known Issues](#12-known-issues)
13. [Future Roadmap](#13-future-roadmap)
14. [Repository Notes](#14-repository-notes)
15. [Development Rules](#15-development-rules)

---

## 1 Executive Summary

**AI OLLY is a digital hotel concierge delivered as a Progressive Web App.** A guest scans a QR code in their room and instantly opens a personalised, in-room assistant — branded **"AI Dioclea"** — that answers questions, explains room features, recommends what to do in the city, and lets them message reception, all without installing anything. A lighter **website chat widget** serves prospective guests browsing the hotel's public site.

**Who it is for.** Two audiences: (1) **hotel guests** during their stay, who want fast, reliable, in-room answers in their language; and (2) the **hotel / reception team**, who want fewer repetitive phone calls, a structured request inbox, and a GDPR-compliant digital consent flow.

**Current status.** The product is **functionally complete and live in production** for the pilot hotel (Antique Split). The backend, all guest-facing PWA modules, the AI answer pipeline (deterministic + live GPT-4o), push notifications, guest requests, post-checkout feedback, and the reception consent flow are all built, committed, pushed, and deployed on Render. Everything runs against Airtable as the CMS/database.

**Production readiness.** Software is production-ready. The remaining blockers are **content/asset**, not code: the PWA app icons are still placeholder (0-byte), and the standardized hero image slots ship empty (text-only). These affect polish and installability, not core function. A new senior developer can run and extend the system today; a hotel could be onboarded once its Airtable content and QR codes are populated.

---

## 2 Product Vision

### Purpose
Replace the printed room directory and reduce reception load with an always-available, multilingual, trustworthy in-room assistant that answers from the hotel's own verified data and hands off gracefully to humans when it doesn't know.

### Target users
| User | Need AI OLLY serves |
|---|---|
| In-house guest | Instant answers (WiFi, AC, breakfast, safe, check-out), local recommendations, a way to reach reception |
| Prospective guest (website) | Pre-booking questions answered by the public chat widget |
| Reception / hotel staff | Structured request inbox, push updates, digital GDPR consent, fewer repeat calls |
| Hotel owner (SaaS buyer) | A branded, multi-tenant concierge configured entirely through Airtable |

### Guest journey
1. **Scan** the room QR → PWA opens with `slug + room + token` in the URL.
2. **Splash** greets the guest by room ("Room 201"), room type loads from the backend.
3. **Permissions** screen offers location + notifications (optional, friendly).
4. **Home** shows a time-aware greeting, quick tiles, nearby POIs, today's weather-aware ideas, and a cultural series.
5. Guest explores modules (Room Guide, Services, Map, Routes, Split Today, Whispers) or asks **Ask Dioclea** a free-text question.
6. Guest submits a **request** (housekeeping, concierge) → reception is notified → guest gets a **push** when status changes.
7. At **checkout**, a push deep-links to a **feedback** screen (and a Google review link).

### Reception workflow
- Reception (or a lobby tablet) creates a **consent session**, the guest signs on a device, and a GDPR consent record + signature image are stored.
- Guest requests land in Airtable; status changes trigger guest push notifications via webhook.
- News/broadcasts can be pushed to all subscribed guests of a hotel.

### Business model
Multi-tenant **SaaS**: one backend serves many hotels, each isolated by `slug`, each configured through its own Airtable content. Antique Split is the paid pilot; onboarding a new hotel is a content + configuration exercise, not a code fork.

### Future expansion
Second and subsequent hotels (multi-tenant is already the design), richer media (photography, video), consolidated evaluation tooling, and optional retrieval (RAG) if inline-context prompting hits limits. See [§13 Future Roadmap](#13-future-roadmap).

---

## 3 Current Architecture

**One Node/Express 5 server** (ESM) hosts everything: it serves static front-ends and exposes the JSON API. **Airtable is the database and CMS.** **OpenAI GPT-4o** provides the fallback answer generation. Hosting is **Render**, deployed by `git push`.

```
Guest device (PWA)  ─┐
Website widget      ─┼─▶  Express server (Render)  ─┬─▶  Airtable (base appon9UYjX6KU9cr1)
Reception device    ─┘        /api/*                └─▶  OpenAI GPT-4o (fallback only)
                                                    └─▶  web-push → guest devices
```

| Layer | Implementation |
|---|---|
| **Frontend (guest)** | Vanilla JS PWA in `pwa/` — single shell `index.html` + `app.js` + `style.css` + `whispers-data.js` + `config.js`. Leaflet for maps, Open-Meteo for weather. No framework, no build step. |
| **Frontend (reception)** | Static consent pages in `reception/`. |
| **Backend** | `server/server.js` (~4,700 lines) + `server/classify.js` (deterministic intent classifiers) + `server/filters.js` (fail-closed tenant/source filters). |
| **Airtable** | Base `appon9UYjX6KU9cr1`. ~20 tables via env-overridable `TABLE_*` constants. 60-second in-memory cache. |
| **OpenAI** | `gpt-4o`, temperature 0. Used for intent routing (JSON mode) and answer generation — **only when no deterministic handler fires**. No vector store / RAG. |
| **Reception** | Consent-session tokens (2-hour TTL), signature PNG upload via Airtable Content API. |
| **Notifications** | `web-push` (VAPID). Subscriptions stored in Airtable; Airtable Automations call webhooks that send pushes. |
| **Deployment** | Render, auto-deploy on push to `main`. No CI, no Dockerfile. Build marker = git commit SHA, exposed at `/api/health`. |
| **Domains** | API + apps on `app.aiolly.pressmax.net`; PWA served under `/pwa`, reception under `/reception`. `config.apiBase = ''` → same-origin. |
| **Service Worker** | `pwa/sw.js`, `CACHE_NAME = 'antique-split-v27'`. **Push-only** (handles `push` + `notificationclick`); does *not* cache the app shell. Assets are cache-busted with `?v=v27`. |

---

## 4 PWA Modules

All screens are `<div id="screen-…">` in `index.html`, activated by an in-app navigation stack. Data comes from same-origin `POST /api/*` calls (body `{slug, room, token, …}`) unless noted.

### Home
- **Purpose:** landing hub after splash — orient the guest and surface the best of everything.
- **Status:** ✅ Live (the "Home V2" navy redesign is in production).
- **Main screens:** `home`.
- **Dependencies:** `/api/pwa-welcome` (room type, greeting), `/api/pwa-pois` (nearby scroller), Open-Meteo (weather pill/card), `whispers-data.js` (cultural card), Split Today teaser.
- **Current UX:** time-based greeting ("Good morning… at Hotel Antique Split"), weather pill, room + checkout strip, tile grid (Room Guide, Hotel Services, Near Me, Concierge, Routes, Help & Requests), "Steps from your door" POI scroller, Split Today card, Cultural Series card.
- **Known limitations:** hero background image slot empty; relies on Open-Meteo availability for weather.

### Room Guide
- **Purpose:** in-room operational reference (how everything in the room works).
- **Status:** ✅ Live.
- **Main screens:** `room-guide`, `room-guide-section`.
- **Dependencies:** `/api/pwa-room-guide` (token-gated).
- **Current UX:** section list — WiFi, AC, TV, Safe, Smart Glass, Room Features, Notes — each opening a detail screen from the room's own record.
- **Known limitations:** content completeness varies per room; empty sections are hidden.

### Hotel Services
- **Purpose:** what the hotel offers (breakfast, housekeeping, arrival/departure, room comfort, etc.).
- **Status:** ✅ Live (taxonomy cleaned to fixed groups).
- **Main screens:** `services`, `services-category`, `service-detail`.
- **Dependencies:** `/api/pwa-services`.
- **Current UX:** category grid → section-list rows → detail (with emergency/booking CTAs and `tel:` links to 112/194 where relevant).
- **Known limitations:** grouping depends on correct Airtable category tagging.

### Near Me
- **Purpose:** find nearby places by category using the guest's location.
- **Status:** ✅ Live.
- **Main screens:** `near-me`, `near-me-results`.
- **Dependencies:** `/api/pwa-pois` + browser Geolocation.
- **Current UX:** category picker → results list ordered by proximity.
- **Known limitations:** requires location permission; POI coordinates must be accurate.

### Map
- **Purpose:** visual city map of hotel POIs.
- **Status:** ✅ Live.
- **Main screens:** `city-map-welcome`, `city-map`, `poi-detail`.
- **Dependencies:** `/api/pwa-pois`, Leaflet.
- **Current UX:** intro slideshow → Leaflet map with POI markers and mini-cards → POI detail with a "Navigate" (external maps) button.
- **Known limitations:** POI coordinate refinement pending for some entries.

### Routes
- **Purpose:** curated Split walking routes.
- **Status:** ✅ Live.
- **Main screens:** `routes`, `route-detail`, `route-map`.
- **Dependencies:** `/api/pwa-routes`, Leaflet.
- **Current UX:** route list (category heroes) → stops/description → route map.
- **Known limitations:** hero imagery empty.

### Split Today
- **Purpose:** weather-aware "what to do today", plus events and always-on ideas.
- **Status:** ✅ Live.
- **Main screens:** `events`, `event-detail`.
- **Dependencies:** `/api/pwa-split-today-events` (grouped today/thisWeek/upcoming), `/api/pwa-events`, Open-Meteo.
- **Current UX:** three tabs — **Weather Picks** (swaps to covered venues when rainy), **Events**, **Always On** (Airtable-driven, `alwaysOn`/`sortOrder`). Dynamic weather badge.
- **Known limitations:** depends on Open-Meteo + Events table being populated.

### Whispers of the Palace
- **Purpose:** editorial cultural series about Diocletian's Palace / Split.
- **Status:** ✅ Live — **12 chapters** (final production order).
- **Main screens:** `whispers-intro`, `whispers-list`, `whispers-detail`.
- **Dependencies:** `whispers-data.js` (fully client-side, no API).
- **Current UX:** cinematic intro → editorial split-card chapter list → chapter reader with prev/next.
- **Known limitations:** text-only; imagery pending.

### Ask Dioclea
- **Purpose:** free-text Q&A assistant for the stay.
- **Status:** ✅ Live (deterministic + GPT-4o).
- **Main screens:** `ask`.
- **Dependencies:** `POST /api/pwa-ask` (token-gated).
- **Current UX:** chat screen titled "Ask Dioclea", empty-state prompt and quick chips; floating "Ask Dioclea" bubble on other screens.
- **Known limitations:** answers only from hotel data + guarded general knowledge; unknown hotel facts trigger a reception handoff by design.

### Concierge
- **Purpose:** premium requests and partner services (e.g. restaurant reservations).
- **Status:** ✅ Live.
- **Main screens:** `concierge`, `concierge-form`, `restaurant-detail`.
- **Dependencies:** `/api/pwa-partners`, `/api/pwa-request`.
- **Current UX:** concierge hub → partner detail ("Reserve a Table") → request form.
- **Known limitations:** partner content depends on the Partners table.

### Help & Requests
- **Purpose:** contact reception and submit service/issue requests.
- **Status:** ✅ Live.
- **Main screens:** `help`, `request`, `contact`, `request-sent`.
- **Dependencies:** `/api/pwa-request` (+ Brevo email), `config.js` (phone/WhatsApp).
- **Current UX:** help hub → request/issue form → confirmation; direct phone/WhatsApp links.
- **Known limitations:** none significant.

### Hotel Info
- **Purpose:** static hotel facts.
- **Status:** ✅ Live.
- **Main screens:** `info`.
- **Dependencies:** `config.js` (name, address, phone, check-in/out).
- **Current UX:** simple info list; a root nav tab.
- **Known limitations:** static per-hotel config file.

### Feedback (post-checkout)
- **Purpose:** capture star ratings + comment after checkout, then route to a public review.
- **Status:** ✅ Live.
- **Main screens:** `feedback`, `feedback-done`.
- **Dependencies:** `/api/pwa-feedback`, `googleReviewUrl` from `/api/pwa-welcome`.
- **Current UX:** star ratings (overall, room, staff, location, cleanliness) + comment → thank-you with Google review link. Reached via a checkout push (`?feedback=1`).
- **Known limitations:** depends on the checkout webhook firing.

### Consent (Reception)
- **Purpose:** GDPR consent capture with a signature.
- **Status:** ✅ Live (reception-side, served under `/reception`).
- **Main screens:** `reception/consent.html`, `reception/start-consent.html`.
- **Dependencies:** `/api/reception/*` endpoints, Airtable PRIVOLE + signature upload.
- **Current UX:** token-scoped consent form, on-screen signature, stored as an Airtable attachment.
- **Known limitations:** not part of the guest PWA shell; separate static pages.

### POI Detail / Room Guide Detail / Service Detail
These are the **detail sub-screens** of Map, Room Guide, and Hotel Services respectively (`poi-detail`, `room-guide-section`, `service-detail`). Each renders a single record with the standardized hero header and contextual actions (navigate / call / book). Status ✅ Live; limitation: hero images empty.

---

## 5 AI

### Persona
The assistant is **"Dioclea"** in guest-facing copy (a nod to Diocletian, whose palace is Split's old town). The internal codebase/CSS uses "Olly" (product name and `--olly-*` tokens). Identity answers are locked ("Ask Dioclea", "I'm here for your stay").

> ⚠️ **Known persona leak (found 2026-07-30 live audit):** the internal name "Olly" is **not** fully hidden — the Room Guide section screens (e.g. WiFi) render an **"Ask Olly"** button. This must be corrected to "Ask Dioclea" before v1.0. Tracked as Critical item C1 in [AI_OLLY_PRODUCT_POLISH.md](AI_OLLY_PRODUCT_POLISH.md).

### Deterministic handlers (first line)
The core design is **deterministic-first**. Every question runs through an ordered chain of classifiers (`server/classify.js`) before any AI call. Each handler that matches answers immediately with a curated response and marks the answer deterministic. Handlers include: emergency/medical, identity, capabilities, check-in time, room number, maintenance report, WhatsApp, contact/hotel-core, breakfast hours, housekeeping hours, extra towels, WiFi, pet policy, AC, TV, safe/valuables, city activity, plus web-only room-type/amenity/bed/view handlers. Ordering is deliberate (e.g. maintenance and WhatsApp precede the contact card because "call"/"contact" would otherwise absorb them).

### GPT fallback
If nothing deterministic fires, the request goes to **GPT-4o** (`OPENAI_MODEL = 'gpt-4o'`, temperature 0):
1. **Intent routing** — a JSON-mode GPT call picks an intent; if it fails or is low-confidence, a heuristic scoring fallback takes over (so routing survives an OpenAI outage).
2. **Answer generation** — `generateAnswer` (web) / `generateAnswerPwa` (in-room, with room + persona context) produce the reply from hotel data injected inline into the prompt.

> **Important:** the GPT path is **live**, not a stub. There is no `501` fallback in the server. (This corrects an earlier note that claimed GPT was stubbed / credit-blocked.)

### Safe handoff
The system prompt enforces a **two-tier truth policy**:
- **Tier 1 — hotel-specific facts:** answer *only* from the provided Airtable data. If the data isn't there, emit an exact handoff string ("I don't have confirmed information about that, but Reception will be happy to help." / Croatian equivalent). No guessing about the hotel.
- **Tier 2 — city / travel:** general knowledge allowed, but hedged.

`isSafeHandoffAnswer` detects these strings to classify logs and populate the unanswered-questions table.

### Current prompt strategy
No RAG / vector store. Knowledge is composed **inline**: a `HOTEL CORE` block (persona voice, contact, policies) plus filtered `RECORD` blocks (services, rooms, room-guide fields) built fresh from Airtable per request, then handed to GPT with the two-tier policy and an output-rule style. Prices are guarded post-generation.

### Hotel knowledge
Comes entirely from Airtable, filtered by tenant `slug`, `AI_SOURCE` (WEB/PWA/BOTH), and `Active`. In-room answers additionally weave in the room's own ROOM GUIDE fields (WiFi, AC/TV/safe instructions, notes).

### Identity logic
Identity and capability questions are answered by stable, eval-locked deterministic handlers so the persona never drifts and never leaks the "Olly" internal name.

### Ask Dioclea
The guest-facing surface of all of the above (`/api/pwa-ask`), token-gated and room-aware. Language auto-detected (HR/EN).

### Current eval strategy
Two parallel systems (see also [§12](#12-known-issues)):
- **Python `qa_eval/`** — 40 canonical cases (EN+HR) fired at the local `web-ask` endpoint, nuanced grading, results written to Airtable `QA_EVAL`.
- **JS `scripts/run-evals.js`** (`npm run eval:prod`) — Airtable-driven test list (`AI_EVAL_TESTS`) fired at **production** `pwa-ask` with real room tokens, substring + safe-handoff grading, non-zero exit on failure.
- **Unit tests** (`tests/`, `node --test`) — classifier/filter/routing coverage; only 3 of 13 files are wired into `npm test`.

---

## 6 Airtable

Airtable is both the **database and the CMS**. All table names are **env-overridable `TABLE_*` constants**, so the same code serves any hotel by pointing at a different base. Reads are cached in memory for **60 seconds**; empty results are never cached (to avoid caching a transient failure).

### Core content tables
| Table | Purpose | Key relationships |
|---|---|---|
| `HOTELI` | Hotel core record: persona voice, contact, policies | Root of a tenant; referenced by slug |
| `SOBE` | Room types | Linked from services/room guide |
| `ROOM GUIDE` | Per-room operational data + **Access Token** | One per room; drives in-room answers & auth |
| `SERVICES` | Hotel services (content for answers) | Linked to intents; filtered by AI_SOURCE |
| `POI` | Points of interest (map, near-me, home scroller) | Used by routes |
| `ROUTES` | Curated walking routes | Link to POIs |
| `PARTNERS` | Concierge partner businesses | Concierge module |
| `EVENTS` / `Split Today Events` | Hotel + city events | Split Today module |

### AI / routing tables
| Table | Purpose |
|---|---|
| `AI_INTENT_PATTERNS` | Intent-matching patterns, split into WEB and PWA buckets |
| `AI_OUTPUT_RULES` | Output style/format rules injected into GPT |
| `AI_RESPONSE_LOGS` | Every answered question logged |
| `UNANSWERED_QUESTIONS` | Safe-handoff / unanswered captures |

### Operational tables
| Table | Purpose |
|---|---|
| `REQUESTS` | Guest service requests + notification status |
| `FEEDBACK` | Post-checkout ratings + comment |
| `PUSH_SUBSCRIPTIONS` | Web-push subscriptions (per slug+room) |
| `NOVOSTI` | News broadcasts to guests |
| `PRIVOLE` | GDPR consent records + signature attachment |
| `GUESTS` / `STAYS` | Guest master + stay records (room/guest resolution) |

### Eval / QA tables
`QA_EVAL`, `AI_EVAL_TESTS`, `AI_CONTENT_LINT`, `AI_TENANT_ONBOARDING`.

### Filtering & AI_SOURCE (the architecture that matters)
Filtering is **fail-closed** (`server/filters.js`):
- **Tenant isolation** — every content read requires an exact `slug` match; a record with no/mismatched slug is invisible.
- **`AI_SOURCE`** — each content record declares where it may appear: `WEB`, `PWA`, or `BOTH`. The web widget only sees `WEB|BOTH`; the PWA only sees `PWA|BOTH`. **Empty `AI_SOURCE` never passes** — content is hidden until explicitly enabled.
- **`Active`** — must be exactly `true`.
- Intent patterns are cached in **separate WEB and PWA buckets** so the two surfaces never cross-contaminate.

> No field-by-field dump by design — the architecture is: *slug isolates the tenant, `AI_SOURCE` isolates the surface, `Active` gates visibility, and everything fails closed.*

---

## 7 API

Base URL: `https://app.aiolly.pressmax.net`. All bodies JSON; PWA content endpoints expect `{slug, room, token}`; rate limit 12 requests / 20s per IP. Token-gated endpoints validate the room token with a timing-safe comparison and return **403** on mismatch.

### Guest / content
| Endpoint | Input | Output | Depends on |
|---|---|---|---|
| `POST /api/pwa-ask` | `{slug, room, token, question}` | `{ok, answer, meta}` (deterministic or GPT) | ROOM GUIDE (auth), classifiers, GPT-4o, Airtable |
| `POST /api/web-ask` | `{slug, question}` | `{ok, answer, meta}` | classifiers, GPT-4o, Airtable (WEB filter) |
| `POST /api/pwa-welcome` | `{slug, room, token}` | `{roomType, googleReviewUrl, branding…}` | HOTELI, ROOM GUIDE |
| `POST /api/pwa-room-guide` | `{slug, room, token}` | room-guide fields | ROOM GUIDE |
| `POST /api/pwa-services` | `{slug, room, token}` | services list | SERVICES (PWA filter) |
| `POST /api/pwa-pois` | `{slug}` | POI list | POI |
| `POST /api/pwa-routes` | `{slug}` | routes list | ROUTES |
| `POST /api/pwa-partners` | `{slug}` | partners list | PARTNERS |
| `POST /api/pwa-events` | `{slug}` | hotel events | EVENTS |
| `GET /api/pwa-split-today-events` | `?slug` | `{today, thisWeek, upcoming}` | Split Today Events |

### Requests / feedback / notifications
| Endpoint | Input | Output | Depends on |
|---|---|---|---|
| `POST /api/pwa-request` | `{slug, room, token, category, message, priority?}` | `{ok}` (+ REQUESTS record + Brevo email) | REQUESTS, Brevo |
| `POST /api/pwa-feedback` | `{slug, room, token, scores 1–5, comment}` | `{ok}` (+ FEEDBACK record) | FEEDBACK |
| `POST /api/pwa-push-subscribe` | `{slug, room, token, subscription}` | `{ok}` | PUSH_SUBSCRIPTIONS, VAPID |
| `GET /api/pwa-push-key` | — | VAPID public key (503 if unset) | VAPID |
| `POST /api/webhook/request-status` | Airtable payload + `WEBHOOK_SECRET` | sends status push | PUSH_SUBSCRIPTIONS, web-push |
| `POST /api/webhook/checkout` | Airtable payload + secret | sends feedback deep-link push | web-push |
| `POST /api/webhook/novosti` | Airtable payload + secret | broadcasts push to all hotel subs | NOVOSTI, web-push |

### Reception / consent
| Endpoint | Input | Output |
|---|---|---|
| `POST /api/reception/create-consent-session` | `{stayId…}` + `WEBHOOK_SECRET` | `{consentUrl, token}` (2h TTL) |
| `POST /api/reception/init-consent` | `{stayId}` + `RECEPTION_PIN` | `{consentUrl, token}` |
| `GET /api/reception/consent-context` | `?token` | session context (404/410/409 states) |
| `POST /api/reception/save-guest` | guest fields + secret | upserts GUESTS |
| `POST /api/reception/save-consent` | consent + signature PNG (base64) | PRIVOLE record + signature attachment |

### Ops
| Endpoint | Purpose |
|---|---|
| `GET /api/health` | liveness + build SHA |
| `GET /api/debug` | record counts / field-key diagnostics for a slug |

> The server also exposes `/api/cathedra/*` endpoints for an unrelated product — see [§14 Repository Notes](#14-repository-notes). Not part of AI OLLY.

---

## 8 QR System

### Room tokens
Each room has a unique **Access Token** stored on its `ROOM GUIDE` record. The room QR encodes a URL of the form:
```
/pwa/?slug=antique-split&room=201&token=<AccessToken>
```

### Room mapping
The PWA reads `slug`, `room`, `token` from the query string on load. `slug` defaults to `antique-split` if absent. Every per-room request carries all three in the POST body; the backend resolves the room via its `ROOM GUIDE` record.

### Security
- Server-side, the supplied token is compared to the stored Access Token with a **timing-safe** comparison.
- **Fail-closed:** an empty stored token always fails; a mismatch returns **403**.
- The token is a bearer credential in the URL — it identifies "this room's guest" but is not a per-guest login. Rotating a room's token invalidates old QR codes.

### Room context
Once authenticated, answers are room-aware: the splash greets by room number, `/api/pwa-welcome` returns the room type, and Ask Dioclea weaves the room's own guide fields (WiFi, AC/TV/safe instructions, notes) into responses. "What room am I in?" is answered deterministically from context.

### Current status
✅ Working in production. Token auth is live and enforced on all room-scoped endpoints.

### Testing
- Client error mapping is unit-tested (`tests/fix-13-pwa-ask-ux`): **403 → "Your room link has expired. Please scan the QR code in your room again."**; missing params → incomplete-link warning.
- Room-handler classifiers are tested (`fix-11`), and the JS production eval fires real per-room tokens loaded from ROOM GUIDE.

---

## 9 UX / Design System

### Typography
- **Display:** Fraunces (headlines, heroes). Legacy editorial serif **Cormorant Garamond** still present.
- **Body:** Geist. **Mono:** Geist Mono. Loaded from Google Fonts.

### Colours
Two token layers coexist; the **navy "olly" system** is the current production look:
| Token | Value | Use |
|---|---|---|
| `--olly-navy-deep` | `#14222d` | deep backgrounds, dock |
| `--olly-navy` | `#1a3445` | primary surface |
| `--olly-cream` | `#e8d4a0` | accent / frames |
| `--olly-green` | `#22c55e` | success/status |
| `--accent` (legacy) | `#2c1f14` | espresso, theme color |
| `--gold` (legacy) | `#9e7228` | legacy accent |

### Hero system
A **standardized hero header** opens nearly every non-home screen: `.screen-hero__tag / __title / __sub`, with per-screen modifiers (`--room-guide`, `--services`, `--poi`, `--routes`, `--near-me`, `--help`, `--info`, `--concierge`, `--events`…) that swap a background image via a `--hero-img` CSS custom property. Whispers and POI/restaurant/event details have their own hero variants. **All `--hero-img` slots currently resolve to `none`** — the system is wired but photography is pending.

### Navigation
In-app **navigation stack**: `pushScreen` / `popScreen` / `gotoRoot`, with forward/back slide animations (`_activateScreen`). Root screens: `home`, `city-map`, `ask`, `info`. Deep screens use their own `.screen-header` back button.

### Bottom navigation
Current bottom nav is a **fixed, full-width premium dark-navy dock** (`#bottom-nav`) with 4 tabs — **Home / Map / Ask / Info**. Hidden on splash and permissions screens; deep screens (POI detail, near-me, route map) map their active state back to the Map tab.

### Cards
Home uses `v2-*` components (`v2-hero`, `v2-tile`, `v2-section`, `v2-poi-scroll`, `v2-today-card`, `v2-whispers-card`) on the navy/cream palette. Services/Routes/Room Guide share a common **section-list row** pattern; Split Today uses tabbed cards; Whispers uses editorial split-cards.

### Icons
Migrated from emoji to an **inline SVG icon system** (commit `7db59af`). **App icons (`icon-192.png` / `icon-512.png`) are still placeholder 0-byte files** — see [§12](#12-known-issues).

### Spacing & patterns
Radii `16 / 10 / 24` (navy system); consistent hero → content → actions vertical rhythm; escaped dynamic HTML; loading states on async screens; friendly permission prompts. No screenshots are committed to the repo, so none are linked here.

---

## 10 Production Status

### ✅ Completed
- Full guest PWA (all modules in [§4](#4-pwa-modules)), navy redesign, standardized heroes, SVG icons, bottom-nav dock.
- Backend API, deterministic + **live GPT-4o** answer pipeline, safe handoff.
- Push notifications (subscribe + status/checkout/broadcast webhooks).
- Guest requests + Brevo email; post-checkout feedback + Google review link.
- Reception GDPR consent flow with signature capture.
- Airtable multi-tenant filtering (slug / AI_SOURCE / Active, fail-closed).
- Deployed on Render; `main` == `origin/main`; unit tests + two eval systems exist.

### 🔄 In Progress
- Content refinement (POI coordinates/photos, service taxonomy edge cases).
- Eval coverage (only 3 of 13 unit-test files wired into `npm test`).

### ⛔ Blocked (content/asset, not code)
- **App icons** — placeholder 0-byte files; needed for install-to-homescreen polish.
- **Hero photography** — all hero image slots empty.

### ⬜ Not Started
- Consolidated single eval pipeline.
- Optional RAG / vector retrieval (the `sync/*` and `create_vector_store.js` stubs are empty 0-byte placeholders).
- Second hotel onboarding.

---

## 11 Changelog

Reverse chronological, derived from git history (no fabricated entries). "Force redeploy" commits are omitted as operational noise.

| Date | Summary | Modules / files | Reason | Outcome |
|---|---|---|---|---|
| 2026-06-12 | Bottom nav → fixed premium dark-navy dock (`13b2a7c`); earlier same day, full-width global tab bar and finalize nav + detail heroes | PWA nav, `app.js`, `style.css`, `index.html` | Replace floating dock with a stable global tab bar | Current production nav |
| 2026-06-11 | Premium POI detail heroes; standardized screen heroes; route category heroes; stabilize Dioclea help + identity responses; Split Today link/grouping fixes; Home menu preview mode | PWA heroes, Ask Dioclea, Split Today | Visual consistency + answer stability | Standardized hero system live |
| 2026-06-10 | Hotel Services + Room Comfort taxonomy cleanup; screen-hero polish; home menu demo | Hotel Services, `style.css` | Fix messy Airtable-derived categories | Fixed service groups |
| 2026-06-08 | Replace PWA emoji with SVG icon system | icon system, `app.js`/`style.css` | Consistent iconography | SVG icons live |
| 2026-06-07 | Always-On tab from Airtable POI data; POI navigation/category fixes; Whispers expanded 9→12 chapters; Split Today Events table connected (3-tab rebuild) | Split Today, Whispers, Map | Data-driven content | 12 chapters + live events |
| 2026-06-01 | Split Today clarity — weather-aware copy, tab rename, empty-state copy | Split Today | UX clarity | Weather-aware Split Today |
| 2026-05-31 | Home V2 promoted to production; 5-day weather card; fixed Services to 7 fixed groups; Services/Routes match Room Guide list pattern | Home, Hotel Services, Routes | Premium redesign | Navy Home V2 live |
| 2026-05-18–30 | Whispers module v2→v6 (cinematic redesign, editorial list, prev/next, final content) | Whispers | New cultural module | Whispers shipped |
| 2025-11 → 2026-05 | Backend foundation, PWA modules, Airtable integration, evals/tests, reception consent, push notifications | Full stack | Build the product | Production system |
| 2025-11-01 | Initial commit — AI Olly backend (`5960ad0`) | repo | Project start | Repo created |

---

## 12 Known Issues

| # | Priority | Description | Suggested solution |
|---|---|---|---|
| 1 | **High** | **App icons are placeholder 0-byte files.** `pwa/icons/` contains only `.gitkeep`; `manifest.json` and `sw.js` reference `icon-192.png` / `icon-512.png` that don't exist → broken install-to-homescreen + notification icon. | Produce real 192/512 PNGs (hotel logo on navy/`#2c1f14`), commit to `pwa/icons/`. |
| 2 | **Medium** | **Hero image slots ship empty.** All `--hero-img` custom properties resolve to `none`; screens render text-only. | Source photography per screen/POI, populate `--hero-img`. |
| 3 | **Medium** | **Two divergent eval systems** (Python→`QA_EVAL` local vs JS→`AI_EVAL_TESTS` prod) with no single source of truth. | Consolidate to one pipeline (prefer the production JS runner) or clearly document the split. |
| 4 | **Medium** | **10 of 13 unit-test files are orphaned** from `npm test` (only fix-01-02, fix-03, fix-04 wired in). | Add fix-07…15 to the `test` script or a `test:all` script. |
| 5 | **Low** | **Empty stub files imply a sync/RAG pipeline that doesn't exist** (`sync/airtable_fetch.js`, `sync/sync_runner.js`, `sync/vector_upload.js`, `scripts/create_vector_store.js` — all 0 bytes). | Delete the stubs, or implement if RAG is on the roadmap. |
| 6 | **Low** | **Dead demo scaffolding still shipped** in `pwa/` (`home-v2.*`, `home-menu-demo.*`, `mock/`, `story/`) — not referenced by `index.html`. | Remove to reduce confusion and bundle size. |
| 7 | **Low** | **README.md is empty**; no CI/deploy config in repo. | Add a short README pointing to this document; consider a minimal deploy note. |

*No issue listed here is already solved — each was verified against the repository on 2026-07-30.*

---

## 13 Future Roadmap

### Near term
- Ship real **app icons** and **hero photography** (unblocks install polish and visual completeness).
- **Consolidate evals** into one pipeline; wire all unit tests into `npm test`.
- Remove dead scaffolding and empty stubs; add a real README.

### Medium term
- **Onboard hotel #2** end-to-end (validate the multi-tenant path via `validate:tenant`, content-lint, and per-tenant Airtable base).
- Whispers/Routes **media** (imagery, possibly short video).
- Harden observability (structured logs, eval dashboards from Airtable).

### Long term
- Optional **RAG / retrieval** if inline-context prompting hits size/quality limits.
- Broader language coverage beyond HR/EN.
- Self-serve tenant onboarding tooling for the SaaS model.

---

## 14 Repository Notes

This repository also contains additional projects unrelated to AI OLLY (e.g. **Cathedra**, a separate driving-school exam-registration product served via `/api/cathedra/*` and the `cathedra/` front-end, on its own Airtable base). Those projects are intentionally **out of scope** for this document and are not maintained here.

---

## 15 Development Rules

The agreed workflow for AI OLLY:

**ChatGPT** owns: product architecture, UX, planning, reviews, specifications.
**Claude Code** owns: implementation, refactoring, testing, git, deployments.

**Every new feature follows this lifecycle:**
1. **Specification** — agree what and why.
2. **Implementation** — build it.
3. **Review** — verify against the spec and the codebase.
4. **Testing** — unit tests and/or eval cases pass.
5. **Documentation update** — this document is updated.

> **No feature is considered finished until this document has been updated.**
> Repository reality always wins: if the code and this document disagree, fix the document.

---

*End of AI OLLY Master Documentation.*
