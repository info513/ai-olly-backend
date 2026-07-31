# AI OLLY Platform 2.0 — Supabase Discovery

> **Phase 2 — Architecture planning only.** No code, no SQL, no migrations, no changes to the stable guest PWA in this phase.
> **Purpose of this document:** capture every decision I need from you *before* any architecture is designed. Nothing here is a proposal yet.
> **How to read it:** each item is either **[KNOWN]** (a fact I've already verified in the current system — confirm or correct) or **[DECIDE]** (an open question only you can answer). Please answer the **[DECIDE]** items; correct any **[KNOWN]** item that's wrong.
> Date: 2026-07-31. Source of truth for [KNOWN] items: the live Airtable base `appon9UYjX6KU9cr1`, `server/server.js`, and the QA/architecture docs already in `docs/`.

---

## 0. Scope & guardrails (confirm first)

- **[KNOWN]** The guest PWA (guest UI/UX, Room Guide, Services, Routes, Maps, QR/tokens, heroes, AI behaviour) is **frozen** for Phase 2. Supabase work is backend/data only until you say otherwise.
- **[DECIDE] The second product ("Cathedra").** This repo already serves a *separate* product — a driving-school / exam-registration app (`/api/cathedra/*`, `cathedra/` frontend, its own Airtable base `CATHEDRA_AIRTABLE_*`). Is Cathedra:
  1. **In scope** for the Supabase platform (same multi-tenant DB, different vertical), or
  2. **Out of scope** (stays on its own Airtable, untouched), or
  3. **To be spun out** into its own repo/service entirely?
- **[DECIDE] What is the tenant of the platform?** A "hotel" only, or a generic "tenant/property" that could later be a hostel, apartment group, or the driving-school vertical? This decides whether the schema is hotel-specific or property-generic.
- **[DECIDE] Primary goal ranking** (pick the top 2): fastest path off Airtable · cleanest long-term schema · self-serve hotel onboarding · a sellable dashboard product · analytics/newsletter revenue. This steers every trade-off.
- **[DECIDE] Timeline & appetite.** Is this a background migration over months (dual-run Airtable+Supabase), or a hard cutover on a deadline? Any launch date driving it?
- **[DECIDE] Budget constraints** for Supabase tier, OpenAI, Brevo, and any new infra (vector DB, Redis, CDN). Rough monthly ceiling?

---

## 1. Current database (Airtable)

**[KNOWN] Base `appon9UYjX6KU9cr1` contains ~30 tables.** My assessment of production vs legacy is below — please confirm the **[DECIDE]** column (Keep / Migrate / Legacy / Remove).

| Table | What it is (verified) | My assessment | [DECIDE] |
|---|---|---|---|
| HOTELI | Hotel/tenant config (name, contact, check-in/out, persona) | Production — becomes `tenants`/`hotels` | Keep→migrate? |
| SOBE | Room types (View/Beds/Amenities/Kapacitet) | Production | Keep→migrate? |
| ROOM GUIDE | Per-room content + Access Token + Smart Glass | Production (guest core) | Keep→migrate? |
| SERVICES | Hotel services (AI knowledge + guest lists) | Production | Keep→migrate? |
| POI | 21 points of interest | Production | Keep→migrate? |
| ROUTES | Walking routes | Production | Keep→migrate? |
| PARTNERS | Concierge partners (restaurants) | Production | Keep→migrate? |
| EVENTS | Hotel events | Production | Keep→migrate? |
| Split Today Events | City events (hardcoded table name) | Production | Keep→migrate? |
| AI_INTENT_PATTERNS | 617 rows — intent→service/room routing | Production (AI) | Keep? redesign? |
| AI_OUTPUT_RULES | GPT output style rules | Production (AI) | Keep? |
| AI_CONTEXT | Tone/Do-Don't | Production (AI) | Keep? |
| AI_DISAMBIGUATION / AI_FALLBACK | Scenario→response | Production (AI) | Keep? |
| AI_SLUG_SCOPE | Slug→scope/base mapping | Production (multi-tenant routing) | Keep? |
| REQUESTS | Guest service requests | Production (ops) | Keep→migrate? |
| FEEDBACK | Post-checkout ratings | Production (ops) | Keep→migrate? |
| PUSH_SUBSCRIPTIONS | Web-push subs | Production (ops) | Keep→migrate? |
| NOVOSTI | News broadcasts | Production (ops) | Keep→migrate? |
| PRIVOLE | GDPR consent + signature | Production (ops/legal) | Keep→migrate? |
| GUESTS | Guest master records | Production (ops) | Keep→migrate? |
| STAYS | Stays (check-in/out, PIN) | Production (ops) | Keep→migrate? |
| AI_RESPONSE_LOGS | Every AI answer logged | Production (analytics) | Keep? retention? |
| UNANSWERED_QUESTIONS | Safe-handoff captures | Production (analytics) | Keep? |
| QA_EVAL | 40-case Python eval dataset | Dev/QA tooling | Migrate or leave? |
| AI_EVAL_TESTS | JS production eval suite | Dev/QA tooling | Migrate or leave? |
| AI_CONTENT_LINT | Content-lint findings | Dev/QA tooling | Migrate or leave? |
| AI_TENANT_ONBOARDING | Onboarding checklist | Dev/QA tooling | Migrate or leave? |
| SERVICES (Out) | Apparent duplicate/export of SERVICES | **Suspected legacy** | Remove? |
| Table 15 | Generic "Name/Notes/Assignee/Status" | **Suspected scratch/legacy** | Remove? |

- **[DECIDE]** Confirm which of the "dev/QA tooling" tables move to Supabase vs stay as throwaway tooling.
- **[DECIDE]** Confirm **SERVICES (Out)** and **Table 15** are legacy and safe to drop (I will not touch them without confirmation).
- **[DECIDE] Attachments/media in Airtable:** PRIVOLE signature PNGs, any images? Where should these live in Supabase Storage, and do we migrate historical attachments or start fresh?
- **[DECIDE] Historical data:** migrate all existing REQUESTS/FEEDBACK/GUESTS/STAYS/PRIVOLE/logs, or only active/recent (e.g. last N months) with an archive of the rest?
- **[DECIDE] Data ownership/PII:** GUESTS/STAYS/PRIVOLE hold personal data. Any legal/retention constraints (GDPR erasure, data residency — EU region for Supabase?) I must design around?

---

## 2. Current API (Express on Render)

**[KNOWN] Endpoints (verified in `server/server.js`).** My KEEP / CHANGE / UNKNOWN is a starting point — confirm.

| Endpoint | Purpose | My mark | [DECIDE] |
|---|---|---|---|
| GET `/api/health`, `/api/debug` | liveness/diagnostics | KEEP | ok? |
| POST `/api/web-ask` | website widget Q&A | KEEP | ok? |
| POST `/api/pwa-ask` | in-room guest Q&A | KEEP (guest-frozen) | ok? |
| POST `/api/pwa-welcome` | room welcome + type | KEEP | ok? |
| POST `/api/pwa-room-guide` | room content | KEEP | ok? |
| POST `/api/pwa-services` `/pwa-pois` `/pwa-routes` `/pwa-partners` `/pwa-events` | content lists | KEEP | ok? |
| GET `/api/pwa-split-today-events` | city events | KEEP | ok? |
| POST `/api/pwa-request` | guest request → REQUESTS + Brevo | KEEP | ok? |
| POST `/api/pwa-feedback` | feedback | KEEP | ok? |
| POST `/api/pwa-push-subscribe`, GET `/api/pwa-push-key` | web-push | KEEP | ok? |
| POST `/api/webhook/request-status` `/checkout` `/novosti` | Airtable-automation webhooks | **CHANGE** (Airtable automations disappear with Supabase) | replace with? |
| POST `/api/reception/create-consent-session` `/init-consent`, GET `/consent-context`, POST `/save-guest` `/save-consent` | reception consent flow | KEEP/CHANGE (auth model changes) | ok? |
| GET `/api/cathedra/subjects`, POST `/api/cathedra/exam-registration` | Cathedra product | UNKNOWN (depends on §0 scope) | in/out? |

- **[DECIDE] API shape going forward.** Do we keep the current bespoke `/api/pwa-*` REST endpoints (backend reads Supabase instead of Airtable — smallest change, PWA untouched), OR move the PWA to read Supabase directly via the Supabase client/PostgREST + RLS (bigger change, but you said PWA is frozen → probably not now)? My assumption: **keep the Express API surface, swap Airtable→Supabase underneath.** Confirm.
- **[DECIDE] The Airtable-automation webhooks** (request-status, checkout, novosti) are currently triggered by Airtable Automations. In Supabase these become Supabase triggers / Edge Functions / a job runner. Do you want push/email side-effects driven by **Supabase triggers**, a **queue/worker**, or kept as **Express endpoints the dashboard calls**?
- **[DECIDE]** Any **external integrations** currently hitting these endpoints that I must not break (reception software, Airtable interfaces, Zapier, etc.)?

---

## 3. Current features — status

**[KNOWN] Implemented (verified live):** guest PWA (Room Guide incl. Smart Glass, Services, Map/POI, Routes, Split Today, Whispers, Ask Dioclea, Concierge, Help/Requests, Feedback, Info); web chat widget; deterministic + GPT-4o answer pipeline with safe-handoff; web-push notifications; reception GDPR consent flow with signature; multi-tenant-by-slug filtering; Brevo request emails; QA/eval/lint tooling.

- **[DECIDE] Planned (near-term) — confirm the list and priority:** hotel **dashboard/CMS** (edit content without Airtable), **newsletter** product (Brevo campaigns), **analytics** dashboards, self-serve **hotel onboarding**, RAG/vector search for AI.
- **[DECIDE] Future (later) — confirm:** guest accounts/loyalty, payments/upsells, booking integration, mobile app, additional verticals, white-label/reseller.
- **[DECIDE] Anything implemented today that you intend to REMOVE** in 2.0 (e.g. the Python eval system, `web-ask` widget, Whispers, any service category)?

---

## 4. Multi-tenant model

- **[DECIDE] Tenant hierarchy.** Is it flat (`hotel` = tenant), or is there a **group/brand → hotel → room** hierarchy (chains with multiple properties under one owner/billing account)?
- **[DECIDE] Cross-tenant users.** Can one person (e.g. a regional manager, or you as platform operator) belong to **multiple** hotels? Can a hotel have multiple owners?
- **[DECIDE] Tenant identity.** Today tenants are keyed by **slug** (`antique-split`). Keep slug as the public identifier, and add a UUID tenant id internally? Any constraints on slug format/changes?
- **[DECIDE] Isolation strength.** Required posture: (a) **row-level** isolation in one shared Postgres via RLS (recommended default), (b) **schema-per-tenant**, or (c) **database-per-tenant**? Any contractual/compliance reason a hotel's data must be physically separated?
- **[DECIDE] Roles.** Proposed set — confirm/edit: **Platform Admin** (you), **Hotel Admin/Owner**, **Editor** (content only), **Reception/Staff** (ops only), **Guest** (token, no account). Do you need finer granularity (e.g. "Newsletter manager", "Read-only analyst")?
- **[DECIDE] Permissions model.** Role-based (simple, recommended) or fine-grained per-resource permissions? Any actions that must be restricted (e.g. only Hotel Admin can edit pricing, only Platform Admin can create tenants)?
- **[DECIDE] Billing.** Is billing per-hotel (subscription) part of 2.0, or out of scope for now? If in, who is the billable entity?

---

## 5. Authentication

- **[DECIDE] Guests.** Confirm guests stay **unauthenticated**, identified only by the room **QR token** (no Supabase Auth account). Any desire for optional guest accounts/email capture during the stay?
- **[DECIDE] Staff/dashboard auth.** Supabase Auth with **email+password**, **magic link**, **Google/Microsoft SSO**, or a mix? Any requirement for 2FA for admins?
- **[DECIDE] Reception device auth.** Today reception uses a **PIN** (`RECEPTION_PIN`) + a shared secret. In 2.0 should reception staff have **real user accounts**, a shared **device login**, or keep a PIN per hotel? (Affects consent-flow redesign.)
- **[DECIDE] Onboarding of staff.** Who creates hotel users — Platform Admin invites Hotel Admin, who invites their own staff (recommended)? Confirm the invite flow ownership.
- **[DECIDE] Session/security requirements.** Password policy, session length, IP allow-listing for admin, audit-log retention period?
- **[DECIDE] Existing identities.** Any current logins to preserve (reception people, your own admin), or greenfield?

---

## 6. Newsletter

- **[DECIDE] Ownership of sending.** Does newsletter remain **Brevo** (Supabase stores subscribers/segments/campaign metadata, Brevo sends), or do you want Supabase to become the source of truth with Brevo purely as an SMTP/ESP relay?
- **[DECIDE] Subscribers source.** Who is a subscriber — guests who consented (from PRIVOLE/consent), website signups, imported lists? One list per hotel, or a platform-wide list with hotel tags?
- **[DECIDE] Segments.** What segmentation do hotels actually need (by stay dates, room type, language, marketing-consent, past guests, etc.)? Give the real cases.
- **[DECIDE] Templates & campaigns.** Do hotels design their own templates (dashboard editor) or pick from platform templates? Who approves/sends — Hotel Admin only?
- **[DECIDE] Statistics.** Which stats matter (sends, opens, clicks, unsubscribes, bounces) and do they live in the dashboard pulled from Brevo, or mirrored into Supabase for analytics?
- **[DECIDE] Compliance.** Double opt-in required? Unsubscribe/erasure handling? Per-hotel sender identity/domain (DKIM) — who owns deliverability?

---

## 7. Consent (marketing / privacy / cookies)

- **[KNOWN]** Today: reception-side GDPR consent flow → PRIVOLE record + signature PNG (GDPR/Marketing/Newsletter booleans). Guest PWA has no cookie/consent banner.
- **[DECIDE] Consent scope in 2.0.** Keep consent **reception-collected** (signature at desk), add **in-PWA** consent capture, or both? (You froze guest UI — so in-PWA consent is likely future.)
- **[DECIDE] Consent → newsletter link.** Should a "Newsletter" consent automatically create a Brevo subscriber? What's the exact legal basis flow you want (opt-in source recorded, timestamp, IP/signature)?
- **[DECIDE] Cookies.** Does the guest PWA or the dashboard use cookies/analytics that need a **cookie-consent banner** (dashboard is staff-facing — maybe exempt; PWA is guest-facing — maybe needed)? Confirm whether cookie consent is in scope now.
- **[DECIDE] Data-subject rights.** How should erasure/export requests be handled operationally (self-serve, or reception request)? Retention period for consent records?
- **[DECIDE] Signature capture.** Keep the drawn-signature model, or move to checkbox + timestamp + identity as sufficient legal proof? (Affects storage/complexity.)

---

## 8. Reception (operations)

- **[KNOWN]** Today: guest **REQUESTS** inbox in Airtable; **STAYS** (check-in/out, PIN); status changes trigger **push**; consent flow; Brevo emails.
- **[DECIDE] Reception dashboard.** What does reception actually need day-to-day — a live **requests queue** (new/in-progress/resolved, assignee, notes), **active guests** list (who's in-house), **check-in/out** management, **task assignment**? Rank by importance.
- **[DECIDE] Requests workflow.** Statuses and transitions you want (current: Acknowledged/In Progress/Resolved). Who can change status, SLA timers, escalation?
- **[DECIDE] Active guests / check-in.** Is check-in data entered by reception, imported from a **PMS** (property management system), or from a booking channel? Any PMS we must integrate (this heavily affects the data model)?
- **[DECIDE] Notifications.** Where do reception staff get notified of new requests — dashboard real-time (Supabase Realtime), email, mobile push, or a channel like WhatsApp/Slack? Guests currently get web-push on status change — keep?
- **[DECIDE] Tasks.** Do you want a general **task/ticketing** system beyond guest requests (housekeeping tasks, maintenance), or is "requests" enough for 2.0?

---

## 9. Content (CMS to replace Airtable)

- **[KNOWN]** Content lives in Airtable: ROOM GUIDE, SOBE, SERVICES, POI, ROUTES, PARTNERS, EVENTS, and the AI_* routing/knowledge tables. Whispers is static in the PWA bundle.
- **[DECIDE] Who edits, and how technical are they?** Non-technical reception staff, or a marketing person? This decides how much hand-holding the CMS UI needs (form-based vs rich editor).
- **[DECIDE] Content model fidelity.** Migrate the current field structure 1:1, or **redesign** the content model (e.g. structured Room Guide sections, typed Service records, FAQ as a first-class type)? You said "if something should be redesigned, say so" — my instinct is the AI routing tables (617 intent patterns) should be **redesigned/simplified**; confirm you want options here.
- **[DECIDE] FAQ.** There is no dedicated FAQ table today (FAQ-like answers are spread across SERVICES + AI tables). Do you want a **first-class FAQ** type in 2.0? What's the relationship between FAQ and the AI knowledge base?
- **[DECIDE] AI knowledge source.** Should the AI read the **same** CMS records staff edit (single source of truth, recommended), or a separate "AI knowledge" store staff also maintain? Do you want **RAG/vector search** (embeddings) in 2.0, or keep the current deterministic + inline-context approach (no vector store)?
- **[DECIDE] Localization.** Answers are HR/EN today. Is multi-language content (fields per locale) a 2.0 requirement, or English-first with on-the-fly translation?
- **[DECIDE] Versioning/workflow.** Do you need draft→publish, edit history, and rollback on content (recommended for a CMS), or is direct-edit acceptable? Should content have soft-delete + audit fields (who changed what, when)?
- **[DECIDE] Media.** Hero images, POI/route photos (currently empty). Managed in Supabase Storage with per-tenant folders? Any DAM requirements (crops, alt text)?
- **[DECIDE] Recommendations.** "Recommendations" (restaurants/POI/routes) — is this just PARTNERS+POI, or a new curated-recommendation type with rules (weather-aware, time-of-day like Split Today)?

---

## 10. Non-functional & operational (I need these to design properly)

- **[DECIDE] Environments.** Do you want proper **dev / staging / production** Supabase projects (recommended), or a single project? (Render currently deploys one service from `main`.)
- **[DECIDE] Region.** Supabase region (EU recommended for GDPR — e.g. `eu-central`). Confirm.
- **[DECIDE] Realtime.** Do you want Supabase **Realtime** (live dashboard updates, reception queue) as a first-class requirement, or is polling fine initially?
- **[DECIDE] Analytics.** What decisions should analytics drive (guest questions volume, unanswered rate, request response times, feedback scores, newsletter performance)? Dashboards in-app, or export to a BI tool?
- **[DECIDE] Search.** Do you need full-text search (Postgres FTS) over content/knowledge, and/or vector search? Expected scale.
- **[DECIDE] Backups/DR.** Recovery expectations (RPO/RTO), and whether Supabase's built-in backups suffice.
- **[DECIDE] Migration risk tolerance.** Dual-run (Airtable remains readable, Supabase becomes writer, then flip) vs one-shot cutover per hotel? Rollback appetite.
- **[DECIDE] Success criteria.** How will we know Phase 2 is "done" — Airtable fully removed, dashboard shipped, N hotels onboarded, or a specific milestone?

---

## What I already know (so you don't have to re-explain)

The current system, tenant filtering (slug + AI_SOURCE + Active, fail-closed), the endpoint list, the AI pipeline (deterministic → GPT-4o, no vector store), the reception/consent flow, push/webhooks, and the full Airtable table inventory are documented in `docs/AI_OLLY_MASTER_DOCUMENTATION.md`, `docs/ANTIQUE_SPLIT_QA_ROUND_1.md`, and `docs/AI_ANSWER_AUDIT_ROUND_1.md`. I will build the architecture on those facts plus your answers here.

---

## 11. Follow-up discovery — raised by the confirmed Phase-2 directions

> You've now confirmed these directions: **Supabase is the sole CMS · Airtable is fully retired · all hotel media in Supabase Storage · dynamic hotel content (news, prices, events) · the dashboard is the only content-editing interface · the AI knowledge model is redesigned (no more intent-patterns) · Render stays as the backend API · vector search/embeddings is a future capability.**
> Each **[CONFIRMED]** below records that direction (so it supersedes the matching open item earlier in this doc). Everything tagged **[DECIDE]** here is a *new* question those directions raise. I am not answering them.

### 11.1 Supabase as the sole CMS
- **[CONFIRMED]** Supabase is the single content backend; nothing is authored in Airtable anymore.
- **[DECIDE]** **Draft → publish workflow:** does every content type support draft/scheduled/published states with **preview against the live PWA** before going live, or is save = live? (Recommended: draft+publish for guest-facing content.)
- **[DECIDE]** **Save-time validation:** the current `lint-content` checks (e.g. English-only guest text, room-type/number consistency, required fields) — should these become **blocking validations in the dashboard at save**, warnings, or a background report?
- **[DECIDE]** **Concurrent editing:** do two staff ever edit the same hotel's content at once? Need record locking / "last-writer-wins" / conflict warnings?
- **[DECIDE]** **Bulk operations:** initial per-hotel content load and ongoing bulk edits — CSV/JSON import, duplicate-from-template, copy-from-another-hotel?
- **[DECIDE]** **Content types that need rich text vs structured fields** (Room Guide sections, Service descriptions with price lists, FAQ, Whispers, News) — which are WYSIWYG, which are structured/typed?
- **[DECIDE]** **Non-guest static apps** (`reception/` consent pages, `cathedra/`) — are these edited through the CMS too, or out of the CMS entirely?

### 11.2 Complete Airtable retirement
- **[CONFIRMED]** Airtable is removed entirely once Supabase + dashboard are in place.
- **[DECIDE]** **Retirement sequencing:** the dashboard (only editor) must exist **before** a hotel's Airtable is retired. Confirm the order: build dashboard → migrate hotel → verify → cut over → decommission Airtable. Per-hotel, or all at once for the single pilot?
- **[DECIDE]** **Who edits Airtable today?** Do you/reception currently edit Airtable directly (grid/Interfaces)? Any **Airtable Interfaces** in daily use that the dashboard must replace before retirement?
- **[DECIDE]** **Airtable Automations** (the 3 webhook triggers: request-status, checkout, novosti) — confirm they're replaced by **Supabase triggers / Edge Functions / scheduled jobs**, and that no other Airtable automation exists that I haven't seen.
- **[DECIDE]** **Tooling & logs tables** (QA_EVAL, AI_EVAL_TESTS, AI_CONTENT_LINT, AI_TENANT_ONBOARDING, AI_RESPONSE_LOGS, UNANSWERED_QUESTIONS) — migrate to Supabase, rebuild differently, or drop with Airtable?
- **[DECIDE]** **Cathedra's separate Airtable base** — retired on the same timeline, a different timeline, or left alone (ties back to §0 scope)?
- **[DECIDE]** **Final export/backup** of every Airtable base before deletion — required as an archive? Where kept, for how long?
- **[DECIDE]** **API-key decommission:** confirm removing `AIRTABLE_API_KEY`/base IDs from Render env is part of "done", and nothing external still calls Airtable.

### 11.3 Supabase Storage for all hotel media
- **[CONFIRMED]** All hotel media lives in Supabase Storage.
- **[DECIDE]** **Bucket & path model:** one bucket with per-tenant folders, or a bucket per tenant? Public buckets for guest media vs private for sensitive (signatures)?
- **[DECIDE]** **Access control:** guest-facing images public/CDN-cached; **consent signature PNGs private** with signed URLs + RLS — confirm this split and who may read signatures.
- **[DECIDE]** **Image pipeline:** use Supabase **image transformations** (on-the-fly resize/format) or pre-generate sizes (hero, card, thumbnail)? WebP/AVIF? Max upload size and allowed MIME types?
- **[DECIDE]** **Historical attachments:** migrate existing PRIVOLE signature PNGs (and any Airtable images), or start fresh with an archive of the old ones?
- **[DECIDE]** **Metadata & rights:** required alt text, captions, credit/licensing per image (who owns the photography)? Any DAM-style tagging?
- **[DECIDE]** **Video:** Whispers media / hero loops — stored in Supabase Storage or hosted externally (YouTube/Vimeo/Cloudflare Stream)? Size/bandwidth expectations.
- **[DECIDE]** **CDN & cost:** acceptable to serve directly from Supabase, or front with a CDN? Any egress/bandwidth ceiling.

### 11.4 Dynamic hotel content (news, prices, events)
- **[CONFIRMED]** News, prices, and events are dynamic, hotel-managed content.
- **[DECIDE] Prices — the big one.** *Which* prices are dynamic: room **rates**, service prices (laundry/beauty/minibar price lists), extra-bed surcharge, city tax? What is the **source of truth** — the dashboard, or an external **PMS/channel manager** we must sync? (If a PMS is involved it changes the whole model.)
- **[DECIDE]** **Pricing detail:** currency, VAT/tax handling, seasonal/date-ranged pricing, per-room-type rates? Do rates even belong in 2.0, or only service price-lists?
- **[DECIDE]** **Price ↔ AI consistency:** guests ask "how much is X". Should the AI quote the *live* price from the dynamic store (and how do we prevent the old "price not available" guard from muting confirmed prices)? Single source of truth for a price shown in UI and quoted by AI.
- **[DECIDE]** **News (NOVOSTI):** scheduling (publish/expire dates), auto **push-on-publish** to subscribed guests, per-hotel vs platform-wide news, categories?
- **[DECIDE]** **Events:** distinguish **hotel events** (per-hotel) from **city "Split Today" events** (shared across Split hotels?). Who maintains city events — each hotel, or the platform centrally? Recurring events, date ranges, timezone.
- **[DECIDE]** **Scheduling & timezone:** all time-based content (news expiry, event dates, price seasons) — one hotel timezone field driving everything (Europe/Zagreb today)?

### 11.5 Dashboard as the only content-editing interface
- **[CONFIRMED]** The dashboard is the sole editing surface; no direct DB/Airtable editing.
- **[DECIDE]** **Dashboard app & hosting:** is the dashboard the existing **Next.js** app (frontend), a new Next.js app, and where hosted — **Render, Vercel, or Supabase-adjacent**? Same repo or separate?
- **[DECIDE]** **Auth wiring:** Supabase Auth directly in the Next.js dashboard (RLS-enforced reads/writes), or does the dashboard go through the Express API? (Affects where authorization lives.)
- **[DECIDE]** **Edit permissions granularity:** which roles can edit which content types (e.g. only Hotel Admin edits prices, Editors edit Room Guide/POI, Reception edits nothing)? Confirm the matrix.
- **[DECIDE]** **Audit & history:** every edit recorded (who/when/before→after) with the ability to view history and roll back — confirm this is required for the dashboard.
- **[DECIDE]** **Device support:** must the dashboard (esp. reception modules) work on **tablets/phones** at the desk? Any offline requirement?
- **[DECIDE]** **Real-time:** do editors/reception need live updates (Supabase Realtime) in the dashboard, or is refresh acceptable initially?

### 11.6 AI Knowledge redesign (replacing the intent-pattern model)
- **[CONFIRMED]** The 617-row AI_INTENT_PATTERNS model is replaced by a redesigned knowledge layer.
- **[DECIDE] Target model:** what replaces intent-patterns — a **structured knowledge base** (typed Q&A / articles / FAQ) with retrieval, a **tag/category** routing over CMS content, or **retrieval over the same CMS records staff already edit** (single source of truth)? (I'll propose options; I need your preference/constraints.)
- **[DECIDE] Deterministic handlers:** the room-specific deterministic answers built in Round 1 (room identity, smart glass, window, underfloor, AC-thermostat, extra bed, breakfast in-bed/bag, reception-help, WiFi, safe, etc.) — **keep as a deterministic layer** in front of the new knowledge model, or fold into the knowledge base? (These are the guaranteed-accurate, eval-locked answers.)
- **[DECIDE] Authoring:** who writes AI knowledge — hotel staff in the dashboard, platform-curated defaults per hotel, or both (platform base + per-hotel overrides)? What about **shared knowledge** (city info, general travel) vs hotel-specific?
- **[DECIDE] Safe-handoff & guardrails:** the two-tier "answer only from data, else hand off to Reception" policy — preserved and how enforced in the new model (prompt config per tenant)?
- **[DECIDE] Persona & output rules:** keep AI_CONTEXT (tone/Do-Don't), AI_OUTPUT_RULES, AI_DISAMBIGUATION, AI_FALLBACK, per-hotel Persona Voice — migrate as **per-tenant prompt configuration**, or redesign?
- **[DECIDE] Eval after redesign:** how do we keep answer accuracy measurable (the QA_EVAL / AI_EVAL_TESTS suites) once the knowledge model changes — rebuilt against the new store?
- **[DECIDE] Change propagation:** when staff edit knowledge in the dashboard, how fast must the AI reflect it (cache invalidation strategy; today there's a 60s in-memory cache)?
- **[DECIDE] Languages:** knowledge stored per-locale (HR/EN…) or English-first with translation?

### 11.7 Render remaining as the backend API
- **[CONFIRMED]** Render stays the host for the Express API; Supabase is the DB behind it.
- **[DECIDE] Connection model:** Express connects to Supabase via the **service-role key** (bypasses RLS, app enforces tenant scoping) or via **per-request user JWT** (RLS-enforced)? For guest PWA calls (no user) vs dashboard calls (a user), likely different — confirm the split.
- **[DECIDE] Connection pooling:** use the Supabase **connection pooler (PgBouncer)** — important once Render runs multiple instances. Confirm expected concurrency.
- **[DECIDE] Logic boundary:** where does business logic live — **Express (Render)** vs **Supabase Edge Functions** vs **Postgres functions/RLS**? I'll propose a boundary; any hard preference (e.g. "keep all logic in Express")?
- **[DECIDE] Stateful concerns that break at scale:** current in-memory **rate limiter**, **60s cache**, and **push-subscription map** are per-instance. When Render scales horizontally these must move to Supabase/Postgres or Redis. Is horizontal scaling expected in Phase 2, and is adding Redis acceptable?
- **[DECIDE] Background jobs / cron:** scheduled work (newsletter sends, event refresh, retention cleanup) — run on **Render (cron/worker)** or **Supabase scheduled functions**?
- **[DECIDE] Secrets & environments:** confirm secrets stay in Render env; do you want separate Render services per environment (dev/staging/prod) matching separate Supabase projects?

### 11.8 Future vector search / embeddings
- **[CONFIRMED]** Vector search/embeddings is a **future** capability — designed-for now, not built now.
- **[DECIDE] Engine:** **pgvector inside Supabase** (recommended, keeps everything in one DB with RLS) vs an external vector DB? Any reason to prefer external?
- **[DECIDE] What gets embedded:** all CMS/knowledge content per tenant? Chunking strategy and which fields? Re-embedding trigger on content edit.
- **[DECIDE] Embedding provider/cost:** OpenAI embeddings (matches current stack) vs open-source; budget for embedding + storage at 10/100/1000 hotels.
- **[DECIDE] Hybrid search:** combine Postgres **full-text search** + vector (recommended) or vector-only? Do we need FTS in Phase 2 even if vector is later?
- **[DECIDE] Tenant isolation in retrieval:** confirm every vector/FTS query is tenant-scoped (no cross-hotel leakage — same principle as the current fail-closed filtering).
- **[DECIDE] Scope boundary:** for Phase 2, do we only **provision the schema/columns** to accept embeddings later, or stand up a working (if unused) pipeline?

### 11.9 Cross-cutting (arising from the combination)
- **[DECIDE] Stable identifiers through migration:** the QR/token system and room references are frozen. Content must migrate to Supabase with **stable IDs/slugs** so existing room tokens and PWA references keep resolving. Confirm nothing guest-facing (tokens, room numbers, slugs) may change — I'll design ID mapping accordingly.
- **[DECIDE] Multi-tenant defaults vs overrides:** with a real platform, do new hotels start from a **template/seed** (default services, POI categories, AI persona, consent text) they then customize? Who maintains the template?
- **[DECIDE] Onboarding a new hotel end-to-end:** what's the intended flow (Platform Admin creates tenant → seed content → staff invited → content filled in dashboard → QR generated → go live)? This shapes the dashboard and schema.
- **[DECIDE] Definition of done for Phase 2:** e.g. "Airtable removed, dashboard live, pilot hotel fully on Supabase, second hotel onboardable without code" — confirm the milestone.

## Next step (do NOT proceed until answered)

Once you answer the **[DECIDE]** items above, I will prepare **`docs/SUPABASE_PLATFORM_ARCHITECTURE.md`** with the 10 requested sections (High-Level Architecture, Database, Multi-Tenant, CMS, Dashboard, AI Layer, Migration Strategy, Security, API, Future — each ending with **KEEP / CHANGE / REMOVE**). **I will not start it, write any SQL, or touch the PWA until you've answered.**

> **Status: WAITING FOR YOUR ANSWERS.** No architecture, code, SQL, or migrations produced. This document is uncommitted — tell me if you'd like it committed.
