# AI OLLY — Antique Split v1 Final Report

> Production release **v1.0.0-antique** (git tag on `main` @ `b158278`).
> Deployed: `https://app.aiolly.pressmax.net` · Assets **v30**.
> This report freezes the v1 state before Platform 2.0 work begins on `feature/ai-olly-platform-2`.
> Date: 2026-07-31.

---

## 1. Timeline of development

| Period | What happened (from git history + QA records) |
|---|---|
| **2025-11** | Project start — AI Olly backend + Airtable connection, `.gitignore`, first endpoints. |
| **2025-11 → 2026-04** | Backend foundation; PWA modules; deterministic + GPT-4o answer pipeline; reception/consent flow; web-push; Airtable content model. Pilot hotel Antique Split. |
| **2026-05** | PWA UI redesign — "Home V2" navy system promoted; Whispers of the Palace module (v2→v6, 12 chapters); Split Today (weather-aware, 3 tabs); Services taxonomy cleanup. |
| **2026-06** | SVG icon system; standardized screen heroes; POI/route detail heroes; premium bottom-nav dock; Split Today Events table; Dioclea answer stability. Last production UI commit `13b2a7c` (2026-06-12). |
| **2026-07 (this cycle)** | Repo audit + living documentation; Product Polish audit; **Hotel QA Round 1** (room data, services, structured rendering, AI alignment); **AI Acceptance Testing**; contact-info reconciliation; production gate → **v1 declared production-ready**; Platform 2.0 discovery. |

## 2. Major milestones

- Multi-tenant-by-slug architecture (fail-closed filtering) established early.
- Deterministic-first answer engine with GPT-4o fallback and two-tier safe-handoff.
- Full guest PWA ("AI Dioclea") — ~30 screens, live from Airtable.
- Reception GDPR consent flow with signature capture.
- Web-push notifications (request status, checkout, news broadcast).
- **QA Round 1**: all 8 rooms' data corrected; Smart Glass leak fixed; Hotel Services content reformatted; reusable structured-content renderer; AI answers aligned to hotel-confirmed facts.
- **Contact reconciliation**: single canonical telephone / mobile / address across HOTELI, config, and AI.
- **Production gate**: smoke test PASS, `eval:prod` **30/30**, tenant validation PASS → **v1.0.0-antique**.

## 3. Architecture summary

One **Express 5 (Node ESM)** server on Render hosts three static apps (`/pwa`, `/reception`, `/cathedra`) and ~30 JSON API endpoints. **Airtable** is the database/CMS (base `appon9UYjX6KU9cr1`). **OpenAI GPT-4o** provides fallback answer generation; there is **no vector store / RAG** — knowledge is injected inline. **Brevo** sends guest emails; **web-push (VAPID)** drives notifications.

```
Guest PWA / Web widget / Reception ──▶ Express API (Render) ──┬─▶ Airtable (DB/CMS)
                                                              ├─▶ OpenAI GPT-4o (fallback)
                                                              ├─▶ web-push → guest devices
                                                              └─▶ Brevo (email)
```

Answer pipeline: **deterministic handlers first** (room identity, WiFi, AC, TV, safe, smart glass, window, underfloor, extra bed, breakfast in-bed/bag, reception-help, emergency, etc.) → **intent routing** → **GPT-4o** with inline hotel/room context → **safe-handoff** to Reception when data is absent.

## 4. Production stack

| Layer | Technology |
|---|---|
| Backend | Node.js (ESM), Express 5, on **Render** (auto-deploy from `main`) |
| Guest frontend | Vanilla JS PWA (`pwa/`), Leaflet, Open-Meteo; no build step |
| Database / CMS | **Airtable** (`appon9UYjX6KU9cr1`) |
| AI | **OpenAI GPT-4o** (temp 0); deterministic classifiers in `server/classify.js` |
| Notifications | web-push (VAPID) |
| Email | Brevo |
| Consent storage | Airtable PRIVOLE + signature PNG via Airtable Content API |
| Versioning | Asset/SW cache marker **v30**; build = git SHA (surfaced at `/api/health`) |

## 5. Completed features

- **Guest PWA (AI Dioclea):** Home, Room Guide (WiFi/AC/TV/Safe/Smart Glass/Features/Notes), Hotel Services, Map/POI, Near Me (incl. Ferry Port + Bus Station), Routes, Split Today (weather-aware), Whispers (12 chapters), Ask Dioclea, Concierge, Help & Requests, Feedback, Hotel Info.
- **Web chat widget** (`/api/web-ask`).
- **AI engine:** deterministic + GPT-4o, two-tier safe-handoff, room-specific answers, persona.
- **Ops:** guest requests + Brevo email; post-checkout feedback; web-push (status/checkout/news); reception GDPR consent + signature.
- **Multi-tenant:** slug + AI_SOURCE (WEB/PWA/BOTH) + Active, fail-closed.
- **QA tooling:** `eval:prod` (30 cases), `lint:content`, `validate:tenant`, plus a Python eval set and unit tests.

## 6. AI Acceptance Testing summary

A room-by-room acceptance test (identity, view, window/tilt, smart glass, underfloor, AC-vs-thermostat, extra bed, breakfast in-bed/bag, reception help, contact, arrival, ferry/bus) was run across all 8 rooms + hotel-wide questions. All 8 rooms **PASS** on room-specific facts; issues found were fixed and re-verified:
- Extra-bed price-guard → deterministic per-room handler (€40 confirmed for 101/202/302).
- "Reach the hotel" → arrival guidance (not phone).
- Breakfast in-bed / bag → deterministic answers incl. "notify the hotel by the evening before".
- Reception-help → short assistance answer (no URL dump).
- Smart Glass → visible only for 101/201/301, no cross-room leak.
Details: `docs/AI_ANSWER_AUDIT_ROUND_1.md`, `docs/ANTIQUE_SPLIT_QA_ROUND_1.md`.

## 7. Production deployment summary

| | |
|---|---|
| Build hash | `b1582780b30e2c4f753a3eda600300ea025f6d5d` |
| URL | https://app.aiolly.pressmax.net |
| Assets | v30 |
| Smoke test | PASS (8 room links, Smart Glass matrix, extra bed, breakfast, reception phone+mobile, address, arrival, ferry, bus) |
| Tag | `v1.0.0-antique` |

## 8. Eval results

- **`eval:prod` = 30/30 (100%)** — Deterministic 5/5, Room/booking 5/5, Safe-handoff 5/5, Persona 5/5, Hotel-knowledge 5/5, Local/travel 5/5.
- **`lint:content`** — 152 findings, **0 Critical** (High/Med are pre-existing false-positive "possible Croatian text" flags on English copy containing Croatian dish/place names, and unlinked legacy intent patterns).
- **`validate:tenant`** — PASS (16 PASS / 7 WARN / 0 FAIL); warnings are manual checks + missing `BREVO_API_KEY` note.
- Note: 3 eval assertions were updated to match hotel-confirmed corrections (checkout 11:00; contact wording; taxi via Reception) — the product answers were already correct.

## 9. Known limitations

- **No app icons** — `pwa/icons/` holds 0-byte placeholders; install-to-homescreen + push icon are unpolished.
- **Hero imagery empty** — all `--hero-img` slots resolve to `none`; POI/route/Whispers photography pending.
- **No RAG / vector search** — knowledge is inline-context only; `create_vector_store.js` and `sync/*.js` are empty stubs.
- **Persona name inconsistency** — the AI identity answers still say "Olly" (eval expects it); the guest brand is "Dioclea". Tracked as Product Polish, intentionally not changed in v1.
- **In-memory state** — rate limiter, 60s cache, and push-subscription map are per-instance; safe on a single Render instance, must move to shared storage before horizontal scaling.
- **Single Airtable base** — no staging/prod separation for content; edits are live.

## 10. Technical debt

- Two parallel eval systems (Python `qa_eval/` local + JS `scripts/run-evals.js` prod).
- 9 of 12 unit tests orphaned from `npm test`.
- Dead scaffolding shipped in `pwa/` (`home-v2.*`, `home-menu-demo.*`, `mock/`, `story/`).
- 4 empty stub files implying an unbuilt sync/RAG layer.
- Airtable-coupled data access throughout `server/server.js` (to be abstracted for Supabase).
- A second product (**Cathedra**) shares the repo/server. See `docs/AI_OLLY_V1_CLEANUP_REPORT.md`.

## 11. Lessons learned

- **Deterministic-first pays off** — the most reliable, eval-stable answers are deterministic; GPT is the fallback, not the primary. Round 1 repeatedly resolved failures by adding deterministic handlers rather than tuning prompts.
- **The price-guard vs. real prices** — a guard that blocks "unknown prices" also blocks *confirmed* ones (extra-bed €40); per-room deterministic answers were the fix.
- **Content structure lives or dies in the renderer** — the wall-of-text bug was a single `_stripUrls` line collapsing newlines; structured rendering + clean source text solved it broadly.
- **Data + tests must move together** — hotel-confirmed corrections (checkout 11:00, contact) made "passing" tests fail; keep eval assertions in sync with the source of truth.
- **One canonical value per fact** — contact info drifted between HOTELI and config; reconcile to a single source.

## 12. What should NEVER be changed in v1 (frozen contract)

These are guest-facing or trust-critical and must not change without an explicit, tested migration:

1. **QR tokens & room links** — `/pwa/?slug=antique-split&room=<n>&token=<AccessToken>`; the 8 room Access Tokens. Printed in rooms.
2. **Room numbers, slug (`antique-split`), and record identity** anything a token/QR resolves to.
3. **Guest PWA UI/UX** — screens, navigation, heroes, bottom-nav dock, Room Guide/Services/Routes/Map/Whispers/Split Today.
4. **Token auth contract** — timing-safe comparison, fail-closed, 403 → "rescan QR".
5. **Deterministic answer contracts** — room identity/smart glass/window/underfloor/AC-thermostat/extra bed/breakfast in-bed+bag/reception-help wording that the eval suite locks.
6. **Canonical contact values** — Telephone `+385 21 785 208`, Mobile `+385 91 525 6985`, Address `Poljana Grgura Ninskog 1`.
7. **Check-in 14:00 / Check-out 11:00.**
8. **Safe-handoff policy** — answer only from data, else hand off to Reception (no hallucination).

Platform 2.0 must preserve all of the above behaviour even as the backend moves off Airtable.
