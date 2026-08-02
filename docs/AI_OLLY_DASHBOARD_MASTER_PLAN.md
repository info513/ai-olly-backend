# AI OLLY — Dashboard Master Plan

**Status:** design specification (no code). **Scope:** the AI OLLY Dashboard — the operating
system hotels use to run AI OLLY and, eventually, retire Airtable entirely.
**Foundation:** the completed Supabase data layer (Steps 1–13). This document does **not** change
the database, RLS, migrations, or the Render backend — all are treated as **stable**. It designs the
product that sits on top of them.

> Design principle for this document: the schema is the contract. Every screen below maps to tables,
> `resolved_*` read models, `publish_*`/`rollback_*`/`refresh_*` RPCs, RLS roles, and Storage buckets
> that **already exist**. The Dashboard is a thin, beautiful, opinionated surface over that contract —
> not a new source of truth.

---

## Section 1 — Dashboard Vision

### What it is
The AI OLLY Dashboard is a multi-tenant **hotel operating system**: a single, premium web app where
a hotel manages everything the AI concierge and guest PWA present — rooms, services, destination
content, AI knowledge, media, guests, reception operations, newsletters, and analytics. It is the
authoring and operations layer; the guest PWA ("AI Dioclea") is the consumption layer.

It is explicitly **not** an admin/database panel. Nobody edits rows. People do jobs: "update
check‑in time", "answer a guest request", "publish the summer transfer info", "see why the AI
handed off yesterday". The database is invisible.

### Who uses it
Mapped 1:1 to the existing membership roles (`public.hotel_member_role`):

| Persona | Role | What they come to do |
|---|---|---|
| Platform operator (AI OLLY team) | `platform_admin` | Manage destinations, platform-default content/knowledge, onboard hotels, cross-tenant oversight |
| Hotel manager / owner | `hotel_admin` | Run the hotel: content, staff, publishing, analytics, everything |
| Front desk | `reception` | Requests, arrivals/departures, guest data, feedback, consent capture |
| Content editor | `editor` | Author & publish rooms/services/knowledge/POI for the hotel |
| Marketing | `marketing` | Newsletter, promotional media, newsletter analytics |
| Viewer / auditor | `read_only` | Read published content and safe summaries |

### Why it exists
Airtable was the pragmatic v1 store, but it is a spreadsheet, not a product: no roles, no
preview/publish, no immutable history, no per‑hotel isolation, no AI‑aware content model, no media
governance, no analytics. The Dashboard exists to give hotels a **safe, guided, auditable** way to
run a live AI concierge without touching production data or code — and to make each hotel's content a
first‑class, versioned, tenant‑isolated asset.

### How it replaces Airtable
The database layer already re‑modeled every Airtable table into a proper schema
(rooms/room_types, services, destination content, knowledge, guests/stays/consent, reception,
storage, newsletter, analytics). The Dashboard is the **editing surface** that makes that schema
usable. Replacement is per‑hotel and staged (see the separate cutover package): a hotel's staff move
their authoring into the Dashboard; once a hotel is fully served by Supabase + Dashboard and verified,
its `DATA_PROVIDER` flips from `airtable` to `supabase`. **Nothing in this Dashboard phase performs
that cutover** — it builds the tool that makes the cutover possible.

### How it communicates with the system
```
                         ┌──────────────────────────────────────────┐
                         │            AI OLLY Dashboard              │
                         │      (Next.js App Router, browser)        │
                         └───────────────┬──────────────────────────┘
        Supabase JS (user JWT, RLS)      │        HTTPS (user JWT)
     reads/writes/RPC/Storage/Realtime   │   privileged & secret ops
                         ┌───────────────┴───────────────┐
                         ▼                                ▼
             ┌───────────────────────┐        ┌────────────────────────────┐
             │   Supabase (aiolly)   │        │   Render backend (Node)     │
             │  Auth · Postgres+RLS  │        │  server/integrations/*      │
             │  PostgREST · Storage  │        │  Brevo adapter · AI preview │
             │  RPC · Realtime       │        │  signed-URL minting · webhooks│
             └───────────┬───────────┘        └───────┬───────────┬─────────┘
                         │                            │           │
                    content_versions             OpenAI       Brevo
                    audit_log, buckets          (AI answers)  (email send)
```

- **Supabase (direct, RLS‑enforced):** the Dashboard talks to Supabase for the overwhelming majority
  of reads and writes — every table the user's role may touch, every `resolved_*` read model, and the
  `publish_*` / `rollback_*` / `schedule_campaign` / `refresh_*` RPCs. Auth is Supabase Auth (staff
  accounts = `auth.users` + `profiles` + `hotel_memberships`). RLS is the security boundary; the
  Dashboard **never** holds the service‑role key.
- **Render backend:** used only for operations that need secrets or server authority the browser must
  never hold — **Brevo** sending/webhooks (via the future `server/integrations/brevo/` adapter),
  **OpenAI** AI‑preview answers (so the concierge prompt/logic stays in code), minting **signed URLs**
  for private buckets, and any privileged batch/refresh. The Dashboard calls these with the user's JWT;
  the backend re‑checks authorization.
- **OpenAI:** never called from the browser. AI Preview and Prompt Testing hit a Render endpoint that
  runs the same deterministic‑first pipeline used in production, reading resolved knowledge.
- **Brevo:** never called from the browser. Campaign send/schedule/test and webhook ingestion go
  through Render; the Dashboard only reads/writes newsletter tables and shows results.
- **Storage:** public media via Supabase Storage directly (path‑validated RLS); private
  documents/consent via short‑lived signed URLs minted by Render.

---

## Section 2 — Dashboard Philosophy

Ten principles, each enforced by something real in the schema.

1. **The Dashboard is the CMS, not a database editor.** People perform tasks; rows are an
   implementation detail. Every screen is verb‑first ("Publish", "Answer", "Invite"), never
   table‑first. *Enforced by:* task‑oriented IA (§3) over the normalized schema.
2. **No production content is edited directly.** Guests always read the *resolved, published* view.
   Authors edit drafts; guests never see them. *Enforced by:* `resolved_*` functions return
   published+valid rows only; live vs preview are separate reads.
3. **Every change has history.** Publishing writes an immutable `content_versions` snapshot; audit
   rows are append‑only. Nothing is silently overwritten. *Enforced by:* `content_versions`,
   `audit_log`, block‑update triggers.
4. **Preview before Publish.** Draft → Preview → Publish → Live is the universal content lifecycle.
   Preview renders exactly what the guest/AI will see. *Enforced by:* `content_status` +
   `publish_*(…)` RPCs; preview reads use `resolved_ai_knowledge(…, preview=true)`.
5. **Rollback is a forward action, never a destruction.** Restoring a prior version creates a new
   draft; the old version stays. *Enforced by:* `rollback_*` functions.
6. **Critical content is protected.** Check‑in/out, emergency, safety, payment facts require explicit
   acknowledgement to publish and can't be silently changed. *Enforced by:* `is_critical` +
   acknowledgement in `publish_*`.
7. **AI never invents hotel facts.** The concierge answers only from published, valid, AI‑enabled
   knowledge; otherwise it hands off. The Dashboard's job is to make coverage visible and gaps
   fixable. *Enforced by:* `available_to_ai`, `resolved_ai_knowledge`, `ai_response_logs`,
   `unanswered_questions`.
8. **One source of truth, one tenant boundary.** A hotel sees only its own data (plus shared
   platform/destination content). No cross‑hotel leakage, ever. *Enforced by:* RLS on every table +
   membership helpers.
9. **Logic lives in code; facts live in Supabase.** The Dashboard edits facts and approved content —
   never emergency routing, anti‑hallucination rules, token/QR security, or fallback mechanics.
   *Enforced by:* `ai_configs` stores facts/config only; guards stay server‑side.
10. **Least privilege, visibly.** The UI shows only what your role can do; hidden actions aren't
    "greyed out mysteriously", they simply aren't offered. Private guest PII, consent files, and push
    secrets are never surfaced to roles that can't see them. *Enforced by:* role→module map (§13) that
    mirrors RLS.

**Meta‑principle:** the UI must **never** be able to do something RLS would reject. The client is a
convenience layer; the database is the law. Every optimistic action is written to reconcile with the
server's answer.

---

## Section 3 — Information Architecture

Not an Airtable clone. A real SaaS shell: a **hotel switcher** (top‑left), a **left nav** of modules,
a **global command bar** (⌘K), and a **context‑aware right rail** for detail/history. Deep‑linkable
URLs (`/h/{hotel}/content/rooms/{id}`). Every module below lists its subsections.

```
AI OLLY Dashboard
├─ Home                      Operational landing (§4)
├─ Content                   The CMS (§5)
│  ├─ Rooms                  room_types + rooms, Room Guide (resolved_rooms)
│  ├─ Services               hotel_services + settings (resolved_hotel_services)
│  ├─ FAQ / Knowledge        knowledge_articles + categories + aliases + article_sources
│  ├─ News                   (hotel news items — modeled as knowledge/news content)
│  ├─ POI                    destination_pois + hotel_poi_settings (resolved_destination_pois)
│  ├─ Routes                 destination_routes + hotel_route_settings
│  ├─ Whispers               destination_whispers + hotel_whisper_settings
│  ├─ Events                 destination_events + hotel_event_settings
│  └─ Media                  (inline picker → Assets)
├─ AI                        (§6)
│  ├─ AI Preview             resolved_ai_knowledge + Render AI-preview endpoint
│  ├─ AI Quality             ai_quality_daily
│  ├─ Knowledge Coverage     content_health_daily + knowledge gaps
│  ├─ Unanswered Questions   unanswered_questions
│  ├─ Prompt Testing         Render AI-preview (sandbox)
│  └─ AI Config              ai_configs (persona/tone/handoff/flags)
├─ Reception                 (§7)
│  ├─ Today                  arrivals/departures (stays, resolved_active_stay)
│  ├─ Requests               guest_requests + request_events
│  ├─ Feedback               feedback
│  ├─ Consent                consent_templates + consents (sign/revoke)
│  ├─ Notifications          push_subscriptions (staff) + webhook status
│  └─ Tasks                  (request assignments / follow-ups)
├─ Guests                    (§7)
│  ├─ Directory              guests (PII-gated)
│  ├─ Stays                  stays (resolved_stays)
│  ├─ Duplicates             guest_duplicate_suggestions
│  └─ Privacy                pseudonymize / retention view
├─ Rooms                     (shortcut into Content▸Rooms for ops-heavy hotels)
├─ Services                  (shortcut into Content▸Services)
├─ Destination               (§5) platform/destination canonical + this hotel's presentation
│  ├─ POI / Routes / Whispers / Events (presentation overlay)
│  └─ Canonical (platform_admin only)
├─ Assets                    Digital Asset Manager (§8)
│  ├─ Library                assets (filter by type/scope/status)
│  ├─ Upload                 buckets + finalize_asset
│  ├─ Usage                  asset_usages ("where used")
│  └─ Trash / Archived       soft-deleted assets
├─ Newsletter                (§9)
│  ├─ Subscribers            newsletter_subscribers (consent-linked)
│  ├─ Segments               newsletter_segments (static + rule builder)
│  ├─ Templates              newsletter_templates (versioned)
│  ├─ Campaigns              newsletter_campaigns (schedule/snapshot)
│  └─ Analytics              newsletter_daily + events
├─ Analytics                 (§10) cross-module dashboards
│  ├─ Hotel Health
│  ├─ AI Quality
│  ├─ Knowledge
│  ├─ Guest Activity
│  ├─ Content & Assets
│  ├─ Newsletter
│  └─ Reception
├─ Settings                  Hotel profile, staff & roles, branding, integrations, billing (future), audit log
└─ Platform (platform_admin only)   Destinations, hotel onboarding, platform defaults, cross-tenant
```

**Global surfaces** present in every module: hotel switcher, ⌘K command bar (jump/create/publish),
notification center (requests, webhooks, publish results), account menu, and a persistent
**environment badge** (Dev / Prod) so nobody edits the wrong dataset.

---

## Section 4 — Dashboard Home

The Home screen answers one question: *"What needs my attention right now?"* It is a **role‑aware
operational cockpit**, not a vanity dashboard. Composed of cards; each card is a live query with a
one‑click action and a deep link.

**Cards (rendered by role):**
- **Today's arrivals / departures** (reception, hotel_admin) — from `stays` + `resolved_stays`;
  click → Reception▸Today. Counts + next few, no PII beyond first name in the summary.
- **Unread / open requests** (reception, hotel_admin) — `guest_requests` where status ∈ new/ack/in_progress;
  urgent ones pinned; click → Requests. Realtime badge.
- **AI Quality (last 24h / 7d)** (hotel_admin, editor) — `ai_quality_daily`: coverage estimate, safe
  handoffs, unanswered trend; click → AI▸Quality.
- **Knowledge completeness** (hotel_admin, editor) — `content_health_daily.completeness_score` +
  "critical pending" and "missing translations"; click → AI▸Coverage.
- **Drafts waiting** (editor, hotel_admin) — content in draft/preview across modules; "3 rooms, 1
  service, 2 articles"; click → filtered Content.
- **Broken / incomplete assets** (editor, marketing) — `content_health_daily`: unused assets, missing
  alt text, missing rights; click → Assets with filter.
- **Feedback pulse** (reception, hotel_admin) — recent ratings + follow‑ups requested.
- **Newsletter status** (marketing, hotel_admin) — scheduled/sent campaigns, open/click rate of the
  last one; click → Newsletter.
- **Quick actions** (role‑aware) — New request · New room · New article · Upload media · New campaign
  · Invite staff. Each opens a focused create flow, not a raw form.

**Design notes:** cards are reorderable and dismissible per user; empty states are encouraging, not
blank ("No open requests — nice."); every number is a link, never a dead stat. Platform_admin's Home
adds a **portfolio** row (hotels by health, onboarding status). *Design only — do not implement.*

---

## Section 5 — Content Module (the CMS)

The Content module is the heart of the product. It reframes the schema as an author's mental model:
**Rooms → Services → FAQ/Knowledge → News → POI → Routes → Whispers → Events → Media**. Every content
type shares the same **lifecycle chrome**: a status pill (Draft/Preview/Published/Archived), a
**Preview** toggle (guest view vs AI view), a **Publish** button with critical‑ack when relevant, and
a **History** drawer (versions + rollback). This consistency is the product's biggest UX win.

Common screen anatomy for a content type:
- **List** — a fast, filterable table (status, category, updated, "AI‑visible", "has media", validity)
  with inline status pills and bulk actions where safe.
- **Editor** — a two‑pane layout: structured fields/blocks on the left, **live Preview** on the right
  (toggle Guest PWA render vs AI answer). A right rail shows status, validity window, visibility
  toggles, media, and history.
- **Publish flow** — a confirm sheet summarizing the diff since last publish; critical content forces
  an acknowledgement checkbox; success writes a version and shows "Live in guest app".

Per content type:

- **Rooms.** Manage `room_types` (Pattern C defaults: Wi‑Fi/AC/TV/safe/features/AI‑welcome) and
  `rooms` (overrides; `NULL = inherit`, 3‑state booleans). The editor visually distinguishes
  *inherited* vs *overridden* fields; Preview shows the resolved Room Guide via `resolved_rooms`. QR
  tokens are shown **read‑only** and never editable (v1 QR compatibility is locked). Room list groups
  by type; "override" badges highlight where a room diverges from its type.
- **Services.** `hotel_services` with structured block bodies and independent visibility
  (`visible_in_pwa` / `visible_in_web` / `available_to_ai`); presentation via `hotel_service_settings`
  (hide/feature/reorder platform defaults without cloning). Editor emphasizes the block editor
  (paragraph/heading/list/price‑list/callout/link/contact‑action). Preview uses
  `resolved_hotel_services`. Validity windows for seasonal services; critical flag for check‑in etc.
- **FAQ / Knowledge.** The AI's brain. `knowledge_articles` scoped platform/destination/hotel with
  **override** support; `knowledge_categories`; `knowledge_aliases` (safe synonyms) and
  `knowledge_article_sources`. Editor shows the **resolution stack** for a key ("this hotel overrides
  the platform article"), the `approved_answer`, `available_to_ai`, priority, and validity. Preview =
  `resolved_ai_knowledge(hotel, locale, preview)`. This screen is where "AI never invents facts"
  becomes tangible: an article's presence/absence directly changes what the AI can say.
- **News.** Hotel news/announcements — modeled as knowledge/news content with published dates and a
  `news_image` asset. Simple list + block editor + schedule.
- **POI / Routes / Whispers / Events (Destination presentation).** Canonical content is
  **platform‑owned and read‑only** to hotels; the hotel edits only its **presentation overlay**
  (`hotel_*_settings`: visible/featured/order/walking‑time/recommendation/photo/short‑description).
  The editor makes this boundary obvious: canonical fields are locked with a "shared" lock icon; the
  hotel's own fields are editable beneath. Preview via `resolved_destination_*`. Platform_admin gets a
  separate **Canonical** editor for the source content (full publish lifecycle).
- **Media.** Not a separate screen here — every content editor has an inline **Media picker** that
  opens the Asset Manager (§8) in a modal, attaches an asset as a usage (`asset_usages`), and shows
  where else it's used.

---

## Section 6 — AI Module

The AI module turns the AI from a black box into something a non‑technical hotelier can understand and
improve. It reads exactly what production reads and writes nothing the AI pipeline depends on.

- **AI Preview.** A chat surface that asks the concierge questions *as a guest in a chosen room*,
  hitting a Render AI‑preview endpoint that runs the real deterministic‑first pipeline over
  `resolved_ai_knowledge`. Two modes: **Published** (what guests get now) and **Preview** (includes
  the hotel's drafts, author‑only via RLS). Each answer shows its **route** (deterministic handler /
  knowledge article / safe handoff) and the **source articles** used — so an editor can see *why* the
  AI answered a certain way and jump straight to the article. This is the "test before publish" loop.
- **AI Quality.** Trends from `ai_quality_daily`: total questions, deterministic vs model answers,
  safe‑handoff rate, unanswered count, avg latency, token usage, **coverage estimate** (formula
  versioned, `v1`). Framed as health, not raw metrics: "AI answered 92% confidently; 8% handed off to
  reception." Drill‑down to the days/questions behind a spike.
- **Knowledge Coverage.** The gap map: from `content_health_daily` + knowledge queries — published vs
  draft, **critical pending**, expired critical, missing translations, articles with no media, and
  the top **unanswered themes**. Each gap is a one‑click "create/assign article" action. This is the
  screen that drives content work.
- **Unanswered Questions.** `unanswered_questions` deduped and ranked by occurrence; assign to a
  teammate, mark resolved by linking a knowledge article (`resolution_article_id`), or dismiss. Guest
  PII stays out (redacted question form). Turns real guest confusion into a content backlog.
- **Prompt Testing.** A sandbox for platform_admin/hotel_admin to try questions across locales and
  rooms and compare Published vs Preview answers side‑by‑side — a safe place to validate before
  publishing, without touching the production prompt (which stays in code).
- **AI Config.** Edit `ai_configs` **facts only**: persona, tone, approved formatting, safe‑handoff
  text, retrieval limit, safe keyword aliases, feature flags. The screen explicitly labels what it
  does **not** control (emergency routing, anti‑hallucination, security) — those are code. Versioned
  via `publish_ai_config`.

---

## Section 7 — Reception Module (+ Guests)

The daily operational cockpit for front desk, designed for speed and clarity under pressure, with
strict PII discipline.

- **Today.** Arrivals and departures for the date, from `stays` (safe fields via `resolved_stays` —
  room number + guest first name, **no email/phone/token**). Check‑in/check‑out actions update stay
  status; `resolved_active_stay` powers "who's in room 101 right now". Realtime‑ready.
- **Requests.** A kanban/table hybrid over `guest_requests` with the real lifecycle
  (new → acknowledged → in_progress → resolved → closed → cancelled). Each request opens a detail with
  an **append‑only timeline** (`request_events`), a **guest‑visible reply** field and a separate
  **internal notes** field (never shown in the safe guest view). Assign, prioritize, acknowledge,
  resolve. This is where reception lives; it's built for keyboard + realtime.
- **Feedback.** `feedback` list with rating trends, follow‑up flags, and status; link feedback back to
  a stay/room for context.
- **Consent.** Capture guest consent from a **published** `consent_template` via `sign_consent` (exact
  text snapshot, immutable); view consent status per guest; **revoke** via `revoke_consent`
  (additive — never destroys the signed record). Signature/PDF are private assets accessed only via
  signed URLs. Legal wording is never authored here.
- **Notifications.** Staff push subscription management (`push_subscriptions`, secrets hidden) and a
  feed of webhook/system events. No push *sending* is built in this phase.
- **Tasks.** Lightweight follow‑ups derived from request assignments — "my open requests", due‑soon,
  reassignment.

**Guests sub‑module (PII‑gated to hotel_admin/reception):**
- **Directory.** `guests` with contact details; editor/marketing/read_only get **no** access.
- **Stays.** Full stay records; token references hidden.
- **Duplicates.** `guest_duplicate_suggestions` — review candidate matches; **confirm/reject only**,
  never auto‑merge.
- **Privacy.** Pseudonymize a guest (`pseudonymize_guest`), see retention posture; a GDPR‑minded
  surface, not a legal engine.

---

## Section 8 — Asset Manager (DAM)

A proper Digital Asset Manager over `assets` / `asset_usages` and the three buckets
(`public-media`, `private-documents`, `consent-files`). It treats media as governed, reusable,
audited objects — not loose files.

- **Library.** A responsive grid/list of assets filterable by **type** (hotel/room/POI/logo/icon/
  news/newsletter/video/document/consent…), **scope** (platform/destination/hotel), **status**
  (pending/ready/archived), and health (missing alt/rights, unused). Rich preview cards; private
  assets are visibly badged and gated by role.
- **Upload.** Drag‑and‑drop into the correct **tenant‑aware path** (`hotels/{hotel_id}/…`), enforcing
  per‑type size limits and allow‑listed MIME. Public media uploads go straight to Supabase Storage
  (path‑validated RLS); private uploads and their **signed URLs** are brokered by Render. On complete,
  `finalize_asset` flips the record to `ready` and captures size/dimensions/checksum.
- **Videos.** First‑class support for **external providers** (Vimeo for protected, YouTube for public)
  via `external_provider`/`external_url`/`external_id`, plus short clips in Storage. The DAM shows a
  unified card whether the video is hosted or embedded.
- **Documents / Audio / Logos / Icons.** Type‑aware handling and previews; logos/icons feed branding
  and the guest app.
- **Usage ("where is this used?").** For any asset, `asset_usage_report` lists every place it appears
  (room hero, POI card, newsletter header, consent PDF…). This is the killer DAM feature: you can't
  accidentally delete something in use.
- **Replace / Revision.** Replacing creates a **new asset/revision** and re‑points usages — history is
  never silently overwritten. A visible diff of before/after.
- **History & Trash.** Soft delete is **blocked while active usages exist** (detach first); archived
  assets live in Trash with restore. All metadata/usage changes are audited (never binary or signed
  URLs).
- **Preview.** Inline image transforms (thumbnail/card/hero/full via Supabase transforms — one
  original, no physical copies), video embeds, PDF preview via signed URL.

---

## Section 9 — Newsletter Module

A focused marketing surface over the newsletter schema — **Brevo‑ready but send‑safe** (all sending is
server‑side via the future Render Brevo adapter; the Dashboard never holds Brevo credentials).

- **Subscribers.** `newsletter_subscribers` with normalized email, **consent status** (linked to
  Package B `consents`), source, and lifecycle (pending/subscribed/unsubscribed/bounced/…). Import is
  consent‑aware; there is no "subscribe everyone who stayed" button — that's a principle, enforced.
- **Segments.** Two builders: **static** (pick subscribers) and **rule‑based** — a **guided, validated
  rule builder** (locale/country/source/status/tag with eq/in), never a raw query box. A live
  **audience preview** shows the resolved count via `resolve_newsletter_audience`, which *always*
  filters active consent + subscribed. Hotels can't write SQL.
- **Templates.** Versioned `newsletter_templates` authored in the same **block editor** as content
  (subject, preview text, structured blocks, header asset) with Draft → Preview → Publish
  (`publish_newsletter_template`). Preview renders the email; platform defaults can be cloned by
  hotels.
- **Campaigns.** Create → pick template + segment → **Preview** → **Schedule**. `schedule_campaign`
  **freezes an immutable snapshot** (subject/content/segment); later template edits never change a
  scheduled/sent campaign. Status flows draft/preview/scheduled/sending/sent/cancelled/failed. A
  **"Send test"** and **"Send now/Schedule"** call Render (no send in this phase's backend, but the UI
  is designed for it). Reception cannot send; marketing/hotel_admin can.
- **Analytics.** Per‑campaign and daily rollups from `newsletter_daily` + `newsletter_events`
  (delivered/open/click/bounce/unsub), append‑only events, idempotent webhook status. No cross‑hotel
  aggregation for hotel roles.
- **Scheduling.** Calendar view of upcoming/sent campaigns.
- **Brevo integration (surface).** A settings panel showing connection status and the operations the
  adapter will perform (sync subscriber, create/update campaign, send test/now, process webhook, sync
  stats) — documentation of the boundary, wired later.

---

## Section 10 — Analytics Module

Analytics is presentation over the tenant‑safe daily aggregates (`ai_quality_daily`,
`operations_daily`, `newsletter_daily`, `content_health_daily`) + a few live rollups. **No PII, no
cross‑hotel** for hotel roles; formulas are versioned (`calc_version`). Each dashboard is a small set
of clear cards + a trend chart, not a wall of numbers.

- **Hotel Health.** The executive one‑pager: AI coverage, knowledge completeness, open requests,
  feedback average, newsletter engagement — a single "how's my hotel doing" view for `hotel_admin`.
- **AI Quality.** Coverage, handoff rate, unanswered trend, latency/token usage; the formula and its
  version are shown so the number is trustworthy, not magical.
- **Knowledge.** Completeness score, critical pending, expired, missing translations, coverage by
  category — the content backlog, quantified.
- **Guest Activity.** Arrivals/stays volume, request volume by type, consent completion — operational
  rhythm, PII‑free.
- **Content & Assets.** Published/draft/archived counts, expired content, unused assets, assets
  missing alt/rights — content hygiene.
- **Newsletter.** Subscriber growth, active consent, send/open/click/bounce/unsub rates.
- **Reception.** Request volume, acknowledgement/resolution times, feedback trends.

Refresh is **on‑demand** via the `refresh_*` RPCs (a "Refresh" affordance + last‑refreshed timestamp);
scheduled refresh is a later ops decision (Render cron vs Supabase scheduled job). Platform_admin gets
a portfolio view across hotels.

---

## Section 11 — Publishing

Publishing is a **product surface**, not a button — the same experience everywhere, because it maps to
one schema mechanism (`content_status` + `content_versions` + `publish_*`/`rollback_*`).

- **Draft.** The working state. Autosaved. Guests/AI never see it.
- **Preview.** A shareable, faithful render of exactly what will go live — Guest PWA view and AI answer
  view. For knowledge, uses `resolved_ai_knowledge(preview=true)`; only authors (via RLS) can preview
  drafts.
- **Publish.** A confirm sheet showing a **diff since last published version**, a validity check, and —
  for `is_critical` content — a required **acknowledgement**. On confirm, the `publish_*` RPC writes an
  immutable snapshot and flips to Live. Direct status flips are blocked by the DB, so publishing is
  always versioned.
- **History.** A per‑item drawer listing versions (who, when, change summary) from `content_versions`,
  with a readable diff between any two.
- **Rollback.** Restores a chosen version as a **new draft** (never destroys history); the editor then
  reviews and re‑publishes. `rollback_*` RPCs.
- **AI Preview (pre‑publish).** For knowledge/services, "how will the AI answer after this change?" —
  runs the preview answer against the draft before you commit.
- **Approval (design‑forward, optional).** A lightweight review state where an `editor` submits and a
  `hotel_admin` approves before publish. The schema supports the audit trail; the approval *workflow*
  is a Dashboard‑level convention (assignee + status) layered on top — added when a hotel wants it, no
  schema change required.

---

## Section 12 — User Experience

**Aspiration:** it should feel like **Linear's speed**, **Notion's calm editing**, **Stripe's
clarity**, and **Apple's restraint** — a tool hotel staff *want* to open, not one they tolerate.

Principles:
- **Fast by default.** Instant navigation (client‑side routing + cached reads), optimistic writes that
  reconcile with RLS, keyboard‑first (⌘K to do anything), sub‑100ms interactions. Perceived speed is a
  feature.
- **Calm, minimal surfaces.** Generous whitespace, one primary action per screen, progressive
  disclosure (advanced fields behind "More"), no dense enterprise grids unless the task demands a
  table. Typography and spacing do the work; chrome recedes.
- **Content‑first, chrome‑second.** The thing you're editing is the hero; navigation and metadata sit
  quietly at the edges. Live preview is always one glance away.
- **Guided, not gated.** Empty states teach; destructive actions confirm; irreversible ones (there are
  almost none — history protects you) are clearly labeled. Errors are human ("Reception can't publish
  campaigns"), mapped from RLS/RPC errors, never raw Postgres codes.
- **Trustworthy.** Status is always visible (Draft/Live, Dev/Prod, last saved, who changed what).
  Because everything is versioned, the UI can be **confident** — users edit fearlessly.
- **Beautiful and brand‑aware.** A refined visual system echoing the AI OLLY brand (the existing navy
  `#1a3445` / cream `#e8d4a0`, Fraunces display / clean sans body) — premium, warm, editorial, not
  generic SaaS grey. Dark mode first‑class.
- **Accessible & responsive.** WCAG AA, full keyboard nav, reception usable on a tablet at the desk,
  managers on laptop; a focused mobile view for on‑the‑go request handling.

Signature interactions: the **command bar** (jump/create/publish anything), the **two‑pane editor with
live preview**, the **history drawer with diff**, the **audience preview** in segments, and the
**"where used" panel** in the DAM. These five carry the product's personality.

---

## Section 13 — Permissions (role → module map)

Mirrors RLS exactly — the UI never offers what the database would refuse. `platform_admin` has full
access everywhere (incl. Platform + Canonical). Below is per hotel scope:

| Module / Capability | hotel_admin | reception | editor | marketing | read_only |
|---|---|---|---|---|---|
| Home (role‑scoped cards) | ● full | ● ops | ● content | ● marketing | ● summaries |
| Content: Rooms/Services/FAQ/News | ● manage+publish | ○ read published | ● manage+publish | ○ read published | ○ read published |
| Content: Destination **presentation** | ● manage | ○ read | ● manage | ○ read | ○ read |
| Content: Destination **canonical** | ✕ (read shared) | ✕ | ✕ | ✕ | ✕ |
| AI: Preview / Quality / Coverage | ● | ✕ | ● | ✕ | ○ read |
| AI: Unanswered / Prompt Testing | ● | ✕ | ● | ✕ | ✕ |
| AI: Config | ● manage | ✕ | ○ read | ✕ | ✕ |
| Reception: Today/Requests/Feedback | ● | ● manage | ✕ | ✕ | ✕ |
| Reception: Consent | ● | ● capture/revoke | ✕ | ✕ | ✕ |
| Guests: Directory/Stays/Privacy (PII) | ● | ● | ✕ | ✕ | ✕ |
| Assets: public media | ● manage | ○ read | ● manage | ● manage (mktg) | ○ read |
| Assets: private (consent/docs) | ● | ● read | ✕ | ✕ | ✕ |
| Newsletter: Subscribers/Segments/Templates | ● manage | ○ consent status | ✕ (or read templates) | ● manage | ○ summaries |
| Newsletter: Campaigns (send/schedule) | ● | ✕ (no send) | ✕ | ● | ○ read |
| Analytics: AI/Knowledge/Content | ● | ✕ | ● | ✕ | ○ summaries |
| Analytics: Operations | ● | ● | ✕ | ✕ | ○ summaries |
| Analytics: Newsletter | ● | ✕ | ✕ | ● | ○ summaries |
| Settings: hotel profile/branding | ● | ✕ | ✕ | ✕ | ✕ |
| Settings: staff & roles | ● manage | ✕ | ✕ | ✕ | ✕ |

● full/manage · ○ read/limited · ✕ no access. (`editor` template access in R1 is read‑only — a
documented posture that can be widened without schema change.) The Dashboard renders nav and actions
from a single **capability map** derived from the user's memberships, so the menu itself is the
permission model made visible.

---

## Section 14 — Future (extensibility without redesign)

The Dashboard shell is designed so entire modules can be added as **plugins to the left nav** without
touching existing ones. The pattern: each module is a self‑contained route group with its own
data hooks, its own capability entries, and the shared lifecycle/preview/history chrome. New tables
get new modules; nothing existing is refactored.

Future modules (each a nav entry when its schema lands, no shell redesign):
- **Invoices / Billing** — hotel billing + guest folios.
- **Maintenance** — building/room maintenance tickets (reuses the request/timeline pattern).
- **Housekeeping** — room status board (reuses rooms + a status model).
- **PMS integrations** — the `external_source`/`external_id` and `pms_metadata` hooks already exist;
  a PMS module syncs stays/guests/pricing.
- **Channel Manager / Booking Engine** — inventory + rates (pricing schema is ready).
- **CRM** — guest lifecycle & campaigns on top of guests + newsletter.
- **Revenue Management** — analytics on pricing/occupancy.

Enablers baked in now: a **capability‑map‑driven nav**, a **module manifest** convention (title, icon,
routes, roles, home‑cards), **feature flags** via `ai_configs`/settings, and a **design‑system
component kit** so new modules inherit the look for free. Because publishing/versioning/audit are
generic (`content_versions`/`audit_log`), any future publishable content type gets history and rollback
with no new plumbing.

---

## Section 15 — Recommended Build Order

Ship value early, de‑risk the platform pieces first, defer the heaviest UI until the pattern is proven.

**Phase 0 — Shell & platform (foundation).** Auth (Supabase Auth staff login), hotel switcher,
capability‑map nav, ⌘K, layout/design system, the shared **lifecycle/preview/history chrome**, and the
**block editor** primitive. Nothing ships to a hotel yet, but everything after reuses it.

**Phase 1 — Reception (fastest real value).** Today, Requests (+ realtime timeline), Feedback,
Guests directory, Consent capture. This is the daily‑use hook that makes staff love the tool, and it
exercises RLS/PII discipline early.

**Phase 2 — Content core.** Rooms, Services, FAQ/Knowledge with full Draft→Preview→Publish→History →
this is the Airtable‑replacement heart. Reuses the Phase‑0 chrome.

**Phase 3 — AI module.** AI Preview, Quality, Coverage, Unanswered, Config — turns the content into a
measurably better concierge and proves the "AI never invents facts" story.

**Phase 4 — Assets (DAM).** Library, upload/finalize, usage, replace/history. Backfills media into the
content already built.

**Phase 5 — Destination presentation.** POI/Routes/Whispers/Events overlays (+ platform_admin
canonical editor).

**Phase 6 — Newsletter.** Subscribers, segments, templates, campaigns, analytics — pairs with the
Render Brevo adapter (built in parallel, server‑side).

**Phase 7 — Analytics dashboards.** Cross‑module Hotel Health + per‑domain dashboards over the daily
aggregates.

**Phase 8 — Settings & Platform.** Staff/roles, branding, integrations, audit log; platform_admin
onboarding & destinations.

**Then (separate package, not now):** per‑hotel Airtable→Supabase migration + compare mode + the
`DATA_PROVIDER` cutover. The Dashboard must be in daily use by a hotel before that hotel is cut over.

---

## Output — Summary & Recommendations

**Documents created:** `docs/AI_OLLY_DASHBOARD_MASTER_PLAN.md` (this file).

**Estimated dashboard size:** a **large but bounded** multi‑tenant SaaS — comparable in surface to a
focused Notion/Linear‑class product, not an ERP. Buildable in the phased order above by a small team;
Phases 0–3 deliver a genuinely useful product.

**Estimated pages / routes:** ~**60–80** route segments (≈12 modules × list + detail/editor + a few
sub‑views), plus auth/settings/platform. Roughly: Content ~18, Reception+Guests ~12, AI ~6, Assets ~5,
Newsletter ~6, Analytics ~7, Settings/Platform ~10, Home/auth/shell ~6.

**Estimated reusable components:** ~**120–160**. Core kit (~40): buttons, inputs, selects, dialogs,
sheets, tables, tabs, toasts, badges, cards, empty states, skeletons. Product patterns (~50):
StatusPill, PublishSheet, HistoryDrawer, DiffView, PreviewPane (Guest/AI), BlockEditor + block types,
MediaPicker, UsagePanel, SegmentRuleBuilder, AudiencePreview, RequestTimeline, ConsentCapture,
RoleGate, CapabilityNav, HotelSwitcher, CommandBar, KpiCard, TrendChart, DataTable wrapper. Module
compositions (~40): the per‑module list/editor screens.

**Recommended UI framework:** **Next.js (App Router) + React + TypeScript** — server components for
fast reads, route groups per module, deep‑linkable URLs, first‑class Vercel/Render deploy. Data layer:
**`@supabase/supabase-js`** (Auth + PostgREST + RPC + Storage + Realtime) with **TanStack Query** for
caching/optimistic updates, **react‑hook‑form + Zod** for forms (Zod schemas mirror the DB
constraints).

**Recommended design system:** **Tailwind CSS + shadcn/ui** (Radix primitives) with a **custom AI OLLY
token layer** (navy/cream brand, Fraunces/sans, dark‑mode‑first). shadcn gives ownership of the
components (copy‑in, not a locked dependency) — ideal for a bespoke premium feel.

**Recommended icon library:** **Lucide** (clean, consistent, pairs natively with shadcn).

**Recommended chart library:** **Recharts** for general trends, with **Tremor** for the analytics
dashboard blocks (premium dashboard components built on Recharts) — both lightweight and
themeable. (visx only if a bespoke viz is ever needed.)

**Recommended editor:** **TipTap** (ProseMirror) configured with a **constrained schema that emits the
exact validated block JSON** (`paragraph/heading/bullet_list/price_list/callout/link/contact_action/
divider`) accepted by `platform.is_valid_service_body`. One editor powers Services, Knowledge, News,
and Newsletter templates.

**Recommended upload library:** **`@supabase/storage-js` + react‑dropzone** for standard uploads
(direct, path‑validated), and **Uppy** (with the tus/resumable + Supabase target) for large video /
resumable needs. Private uploads and previews go through Render‑minted **signed URLs**.

**Recommended table library:** **TanStack Table** (headless) rendered with shadcn table primitives —
sorting/filtering/pagination/column‑visibility/row‑selection without a heavy grid.

**Known UX risks:**
- **Preview fidelity.** Dashboard preview must match the guest PWA exactly, or trust erodes; the PWA
  renderer and Dashboard preview should share a block‑render contract (design‑time coordination, no PWA
  change now).
- **Role confusion.** Six roles × twelve modules can bewilder; the capability‑map nav (only show what
  you can do) is the mitigation and must be rigorous.
- **Publishing overwhelm.** Draft/Preview/Publish/critical‑ack is powerful but can feel heavy; keep the
  happy path one click, push ceremony only where `is_critical` demands it.
- **PII discipline vs convenience.** Reception needs guest contact; editors must never see it. Clear
  visual gating + honest empty states ("You don't have access to guest contact details").
- **Destination canonical vs presentation boundary.** Hotels must instantly understand what they can
  and can't edit (shared vs own) — the lock‑icon pattern is essential.
- **Segment/rule builder safety.** Must feel powerful yet never expose raw querying; the guided builder
  + live audience count is the guardrail.

**Known technical risks:**
- **RLS ↔ UI parity.** The client must never assume it can do something RLS forbids; every action
  reconciles with the server, and RLS errors are mapped to human messages. Drift here = broken UX.
- **Realtime scale.** Reception realtime (requests/events) needs careful channel scoping per hotel to
  avoid noise/cost; enable narrowly.
- **Signed‑URL brokering.** Private media requires a reliable Render endpoint for short‑lived URLs;
  latency/expiry handling and never leaking paths matter.
- **Optimistic writes + versioning.** Publish/rollback are RPCs with side effects; optimistic UI must
  handle partial failures and refetch versions to stay truthful.
- **Multi‑hotel context bugs.** The hotel switcher + Dev/Prod badge must be bulletproof — editing the
  wrong hotel/environment is the scariest failure mode.
- **AI‑preview coupling.** AI Preview depends on a Render endpoint running the real pipeline; contract
  drift between production AI and preview would mislead editors.
- **Brevo boundary.** All sending stays server‑side; the Dashboard must be architected so it *cannot*
  send email directly even by mistake.

---

*End of master plan. No React/Next.js code, pages, or components have been created. Awaiting review
before any implementation begins.*
