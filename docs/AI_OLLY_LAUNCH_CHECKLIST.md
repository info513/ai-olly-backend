# AI OLLY — v1.0 Launch Checklist

> Everything remaining before AI OLLY reaches **Version 1.0** for the pilot hotel (Antique Split).
> Derived from the live guest-experience audit — see [AI_OLLY_PRODUCT_POLISH.md](AI_OLLY_PRODUCT_POLISH.md) for detail and [AI_OLLY_MASTER_DOCUMENTATION.md](AI_OLLY_MASTER_DOCUMENTATION.md) for the system reference.
> **Legend:** 🔴 blocker · 🟠 should-fix · 🟢 nice-to-have. Date: 2026-07-30.

---

## 1. Technical
- [ ] 🔴 Real app icons `icon-192.png` / `icon-512.png` (+ maskable) committed — currently 0-byte (breaks install + push icon).
- [ ] 🔴 Fix "Ask Olly" persona leak → "Ask Dioclea" (Polish C1).
- [ ] 🔴 Floating bubble no longer overlaps content/CTAs; hidden on onboarding (Polish C2).
- [ ] 🟠 One canonical colour system across splash / permissions / chat / heroes (Polish H4).
- [ ] 🟠 Single primary/secondary button style (Polish H5).
- [ ] 🟠 Bottom-nav active state correct on every screen (Polish M3).
- [ ] 🟠 Permissions screen full-bleed (no left-edge clip) (Polish M2).
- [ ] 🟠 Loading/typing indicators verified for GPT answers and data fetches (Polish L6).
- [ ] 🟠 Confirm safe-handoff string fires correctly for unknown hotel facts (spot-check Ask Dioclea).
- [ ] 🟢 Remove dead scaffolding from `pwa/` (`home-v2.*`, `home-menu-demo.*`, `mock/`, `story/`).
- [ ] 🟢 Remove empty stub files (`sync/*.js`, `scripts/create_vector_store.js`) or implement.
- [ ] 🟢 Wire orphaned tests (fix-07…15) into `npm test`; run `npm run eval:prod` green.
- [ ] 🟢 Bump service-worker / asset version (`v27` → next) on release; add a short README.
- [ ] 🟢 Verify `config.js` `apiBase` and CORS origins for the production PWA host.

## 2. Content
- [ ] 🟠 Remove hero-subtitle ↔ body duplication (POI, Service detail) (Polish H3).
- [ ] 🟠 Fix service body formatting / lost line breaks (Polish H6).
- [ ] 🟠 Restructure Breakfast & Food: dedupe kids' breakfast, move babysitting/baby cot out, shorten long title (Polish D).
- [ ] 🟠 Remove duplicated screen titles (top bar + hero) (Polish H2).
- [ ] 🟠 Distinct route-category subtitles (not "Curated routes in this category." ×N).
- [ ] 🟢 Canonical POI names; consistent area taxonomy; drop route duration from titles.
- [ ] 🟢 Copy pass for eyebrow labels, tile subtitles, and awkward phrasings.
- [ ] 🟢 Verify all SERVICES / POI / ROUTES records have `AI_SOURCE` + `Active` set correctly (nothing hidden or wrongly exposed).

## 3. Media
- [ ] 🔴 App/brand icons (see Technical).
- [ ] 🟠 Hero photography for every screen (all currently empty).
- [ ] 🟠 POI photography (~21) — scroller cards + detail heroes.
- [ ] 🟠 Route photography (categories + details).
- [ ] 🟢 Whispers chapter imagery (12).
- [ ] 🟢 Concierge/partner + Split Today event photography.
- [ ] 🟢 Decide on any hero/loop video (optional).
- [ ] 🟢 Optimize all images (size, format, lazy-load) for mobile/data.

## 4. QR
- [ ] 🔴 Generate a QR per room → `/pwa/?slug=antique-split&room=<n>&token=<AccessToken>` (8 rooms: 101,102,201,202,203,301,302,303).
- [ ] 🟠 Confirm each room's `ROOM GUIDE.Access Token` is set and matches its QR (token auth is live; room 201 verified = `‹redacted — see Airtable; rotate if exposed›`).
- [ ] 🟠 Test the expired/invalid-token path shows the "rescan QR" message (403 handling verified in tests).
- [ ] 🟢 Design printed QR cards/table tents (branded) for each room.
- [ ] 🟢 Decide token rotation policy (rotating a token invalidates old QR prints).

## 5. Reception
- [ ] 🟠 End-to-end test the consent flow: create session (PIN/secret) → guest signs → PRIVOLE record + signature PNG stored.
- [ ] 🟠 Confirm `RECEPTION_PIN` / `WEBHOOK_SECRET` set in production and not default values.
- [ ] 🟠 Verify request-status, checkout, and novosti webhooks are wired in Airtable Automations and reach subscribed devices.
- [ ] 🟠 Confirm push subscriptions persist and 410-expired subs auto-deactivate.
- [ ] 🟢 Train reception on the request inbox + consent tablet flow.
- [ ] 🟢 Confirm Brevo guest-request emails send with correct sender identity.

## 6. Guest Testing
- [ ] 🔴 Real-device test: iOS Safari + Android Chrome — scan QR, add to home screen, full journey.
- [ ] 🟠 Test each module with a real room token (welcome, room guide, services, POIs, routes, split today).
- [ ] 🟠 Ask Dioclea test set: WiFi, breakfast, AC, TV, safe, parking, a city question, and an unknown hotel fact (handoff).
- [ ] 🟠 Test push: submit a request → change status in Airtable → receive push → deep-link opens.
- [ ] 🟠 Test checkout → feedback deep-link → submit → Google review link.
- [ ] 🟢 Test with notifications/location **denied** ("Maybe later") — nothing should break.
- [ ] 🟢 Bilingual check (HR + EN) across deterministic + GPT answers.
- [ ] 🟢 Offline / poor-network behaviour (weather, maps, API failures show graceful states).

## 7. Deployment
- [ ] 🟠 Deploy release to Render; confirm `/api/health` build SHA matches the intended commit.
- [ ] 🟠 Confirm all production env vars present (OpenAI, Airtable, VAPID, secrets, Brevo).
- [ ] 🟠 Verify custom domain, HTTPS, and service-worker scope on the production host.
- [ ] 🟢 Smoke-test all `/api/pwa-*` endpoints in production with a real token.
- [ ] 🟢 Basic monitoring/alerting on the Render service and OpenAI error rate.

## 8. Marketing
- [ ] 🟢 Final brand pass: consistent "AI Dioclea" naming in all guest-facing copy.
- [ ] 🟢 In-room collateral (QR cards, "Scan to meet Dioclea" messaging).
- [ ] 🟢 Screenshots / short demo of the finished PWA (post-media) for the sales deck.
- [ ] 🟢 One-page hotel-facing explainer (what it does, how guests use it).
- [ ] 🟢 SaaS onboarding note for hotel #2 (multi-tenant path via `validate:tenant`).

---

### v1.0 exit criteria (the minimum to launch)
All 🔴 items closed, plus §4 QR, §5 reception consent, §6 real-device journey, and §7 production deploy verified. 🟠 items strongly recommended before guest-facing launch; 🟢 items can follow in a fast-follow release.

*Checklist only — no functionality, backend, Airtable, or configuration was changed, and no commits were made.*
