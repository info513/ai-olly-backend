# AI OLLY Platform 2.0 — Master Plan

> **Planning only.** No implementation, no SQL, no Supabase schema, no production changes, no PWA changes.
> Purpose: ensure implementation begins **only after every prerequisite is ready**. This is the single planning source that precedes architecture.
> Companion docs: `SUPABASE_DISCOVERY.md` (open questions), `AI_OLLY_PLATFORM_ROADMAP.md` (phase milestones), `AI_OLLY_V1_FINAL_REPORT.md` (frozen v1 contract), `AI_OLLY_V1_CLEANUP_REPORT.md`.
> Branch: `feature/ai-olly-platform-2`. Production (`main`, tag `v1.0.0-antique`) is frozen.
> Date: 2026-07-31.

> **Status update (2026-07-31): Supabase Phase 1 (infrastructure bootstrap) STARTED** on `feature/ai-olly-platform-2` — local CLI structure, one foundation migration, isolated server-only connection module + health check, and the Phase-1 docs. **Production PWA remains frozen. Airtable remains the live data provider. No production cutover has occurred. The full architecture is not finished.**
>
> **Status update (2026-08-01): DB migration Steps 1 & 2 APPLIED to `aiolly-dev`.** Step 1 cross-cutting (translations, content_versions, audit_log, retention_policies) fail-closed/append-only; Step 2 tenancy & identity (destinations, hotel_groups, hotels, profiles, hotel_memberships) with tenant-isolation RLS. Verified 35/35 + 50/50. Rooms/later domains not started; production/Airtable/PWA untouched.

## Confirmed directions (the ground we build on)
Supabase = primary DB + Auth + Storage + CMS backend + dashboard backend + AI knowledge backend + newsletter + analytics. **Airtable is fully retired.** **The dashboard is the only content-editing interface.** **Render stays** the backend API host. **The guest PWA and the v1 frozen contract are untouchable.** Vector search/embeddings is a **future** capability (design-for, build-later).

## Legend
- **WHO:** *Ivan* (account owner / decisions / billing) · *Dev* (Claude Code / engineering) · *Both*.
- **WHEN:** tied to roadmap phases — **P0** (now/before any dev), **P1** Supabase migration, **P2** Dashboard, etc.

---

# TASK 2 — Prerequisites Before Development

Everything below must exist (or be decided) before the matching phase can start. Nothing here is implementation — it's readiness.

## A. Infrastructure — Supabase
- **Supabase account & organization** — one org for the platform (billing entity). Decide org name.
- **Project naming convention** — e.g. `aiolly-dev`, `aiolly-staging`, `aiolly-prod`. Decide now so keys/URLs are predictable.
- **Environments** — separate Supabase **projects** for dev / staging / prod (recommended) vs a single project. This decision gates everything else.
- **Region** — EU (e.g. `eu-central-1` / Frankfurt) for GDPR + latency to Split. Confirm.
- **Pricing plan** — Free is fine for dev; Pro (or above) needed for prod (backups, no pausing, more storage/compute). Decide the prod tier.
- **Backup strategy** — enable Point-in-Time Recovery / daily backups on prod; define RPO/RTO expectations; where backups are retained.
- **Storage quotas & buckets** — expected media volume (heroes, POI/route photos, signatures, future video); public vs private buckets; egress/bandwidth ceiling; CDN decision.
- **Connection pooling** — enable the Supabase pooler (PgBouncer) for Render→Postgres, especially once Render runs multiple instances.
- **Extensions** — note (for later, not now): `pgvector` for Phase 9, `pg_cron` if used for scheduled jobs.

## B. Git & release
- **Repository strategy** — single repo (backend + PWA + dashboard) vs splitting the dashboard/Cathedra into their own repos. Decide before the dashboard exists.
- **Branch strategy** — `main` = production (protected), `feature/ai-olly-platform-2` = integration, short-lived feature branches off it. Confirm protection rules (no direct pushes to `main`, PR review).
- **Versioning** — semantic tags (`v1.0.0-antique` done); define the 2.0 tagging scheme (e.g. `v2.0.0-platform`).
- **Release flow** — feature → integration branch → PR → merge to `main` → Render auto-deploy → verify build/assets → tag. Define who approves merges to `main`.
- **CI** — decide if/when to add CI (run `npm test`, lint, evals on PR). Currently none.

## C. Render (backend host — stays)
- **Environments** — dev/staging/prod Render services matching the Supabase projects, or a single prod service initially. Decide.
- **Environment variables & secrets** — inventory current (`OPENAI_API_KEY`, `AIRTABLE_*`, `VAPID_*`, `WEBHOOK_SECRET`, `RECEPTION_PIN`, `BREVO_*`, `CATHEDRA_*`) and the **new** Supabase ones (`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, DB connection string/pooler URL).
- **Production vs Development separation** — never share prod secrets into dev; per-environment key sets.
- **Staging** — a staging Render + Supabase pair to rehearse the migration and the dashboard before prod.
- **Scaling readiness** — plan to move the in-memory rate-limiter/cache/push-map to shared storage before enabling horizontal scaling (flagged in the V1 report).
- **Background jobs** — decide where scheduled work runs (Render cron/worker vs Supabase scheduled functions) for newsletter sends, retention cleanup, event refresh.

## D. OpenAI
- **API keys & Project separation** — a dedicated OpenAI **project** per environment (dev/prod) so usage and limits are isolated.
- **Rate limits** — confirm the account's tier/limits vs expected multi-hotel load; the app's own 12/20s guest limiter stays but backend fan-out grows.
- **Usage monitoring & budgets** — set spend alerts/hard caps; decide model policy (GPT-4o now; embeddings provider/cost is a Phase 9 decision).
- **Key rotation** — plan for rotating keys without downtime.

## E. Brevo (email)
- **API keys** — per-environment keys; store in Render/Supabase secrets, never in code.
- **Templates** — inventory current transactional templates (guest request, checkout/feedback); plan campaign templates for the newsletter (Phase 7).
- **Webhooks** — decide Brevo→platform webhooks for delivery/open/click/bounce/unsubscribe stats (Phase 7/8).
- **Sender identity / deliverability** — verified sending domain + DKIM/SPF; per-hotel sender identity decision.
- **Missing today:** `BREVO_API_KEY` is not set in prod (flagged by tenant validation) — needed before email features count as live.

## F. Security
- **Secrets management** — single source of truth for secrets per environment (Render env + Supabase vault); documented inventory; no secrets in git.
- **Key rotation policy** — schedule and procedure for OpenAI, Supabase service-role, VAPID, Brevo, webhook secrets.
- **Service accounts** — the backend's Supabase **service-role** usage (bypasses RLS — must be server-only, never shipped to the browser) vs anon key for client contexts.
- **RLS posture** — decide (during design) row-level isolation as the default; this is a security prerequisite to nail before any table exists.
- **PII handling** — GUESTS/STAYS/PRIVOLE hold personal data; define retention, erasure, and access rules before migrating them.
- **Audit logging** — decide the audit-trail approach (who changed what/when) as a first-class requirement for the CMS/dashboard.

## G. Monitoring & observability
- **Error logging** — a central error tracker (e.g. Sentry) for the backend and dashboard; decide provider.
- **Metrics** — request rates, latency, OpenAI error/spend, unanswered/handoff rate, push delivery.
- **Health checks** — keep `/api/health` (build SHA); add DB connectivity + dependency checks; uptime monitoring/alerting on the Render service.
- **Analytics data** — decide what is logged for the Analytics phase (retention + privacy).

## H. Data & migration readiness
- **Full Airtable export/backup** of every base **before** any migration or deletion (archive).
- **Data-model decisions** — migrate-1:1 vs redesign (content + the 617-row AI intent layer); which tables migrate vs drop (`SERVICES (Out)`, `Table 15`, dev/QA tooling tables).
- **Stable-ID mapping** — a plan to preserve QR/token→room resolution and slugs across the migration (frozen contract).
- **Dual-run plan** — Airtable readable while Supabase becomes the writer, per hotel, until verified.

## I. Legal / compliance
- **GDPR** — EU data residency (Supabase region), consent records, erasure/export process, retention periods.
- **Cookie/consent** — decide if the dashboard (staff) and/or guest PWA need cookie consent (PWA is frozen — likely future).
- **Data processing** — DPA with Supabase/OpenAI/Brevo as sub-processors if selling to hotels.

---

# TASK 3 — "Things Ivan Must Do" (non-architect checklist)

Each item: **WHY / WHEN / WHO.** Dev (Claude Code) can assist, but these need Ivan's account access or decision.

### Accounts & infrastructure
- ☐ **Create/confirm a Supabase account & organization** — *WHY:* it's the new database/auth/storage home. *WHEN:* P0 (before any dev). *WHO:* Ivan.
- ☐ **Choose org + project naming** (`aiolly-dev/staging/prod`) — *WHY:* predictable keys/URLs and clean separation. *WHEN:* P0. *WHO:* Ivan (Dev advises).
- ☐ **Decide environments** (separate dev/staging/prod projects vs one) — *WHY:* protects production from experiments. *WHEN:* P0. *WHO:* Ivan.
- ☐ **Select region (EU/Frankfurt)** — *WHY:* GDPR + latency. *WHEN:* at project creation. *WHO:* Ivan.
- ☐ **Choose the prod pricing plan** — *WHY:* backups + no auto-pause + capacity. *WHEN:* before prod migration (P1). *WHO:* Ivan (budget).
- ☐ **Enable Storage** (create buckets when designed) — *WHY:* all hotel media lives here. *WHEN:* P1/P5. *WHO:* Ivan enables; Dev configures.
- ☐ **Enable Auth** (email/password + magic link; SSO later) — *WHY:* dashboard/staff login. *WHEN:* P2. *WHO:* Ivan enables; Dev configures.
- ☐ **Configure backups / PITR** on prod — *WHY:* recover from mistakes. *WHEN:* before prod data lands (P1). *WHO:* Ivan.
- ☐ **Configure SMTP / email for Auth** (or use Supabase default) — *WHY:* invite/reset emails for staff. *WHEN:* P2. *WHO:* Ivan (Dev advises).

### Keys & secrets
- ☐ **Generate Supabase keys** (anon + service-role + DB/pooler URL) per environment — *WHY:* the backend connects with these. *WHEN:* at project creation. *WHO:* Ivan generates; Dev stores.
- ☐ **Store all secrets in Render env** (never in git) — *WHY:* security. *WHEN:* per phase as new keys appear. *WHO:* Ivan (owner of Render) with Dev.
- ☐ **Create a dedicated OpenAI project + key per environment** — *WHY:* isolate usage/limits/billing. *WHEN:* P0/P1. *WHO:* Ivan.
- ☐ **Set OpenAI spend alerts / caps** — *WHY:* avoid runaway cost at multi-hotel scale. *WHEN:* P0. *WHO:* Ivan.
- ☐ **Set `BREVO_API_KEY` (+ verified sender domain/DKIM)** — *WHY:* emails don't send today; needed for requests + newsletter. *WHEN:* before email features (P6/P7). *WHO:* Ivan.
- ☐ **Decide a key-rotation cadence** — *WHY:* security hygiene. *WHEN:* P0 policy, ongoing. *WHO:* Ivan (Dev implements).

### Git / process
- ☐ **Protect `main`** (require PR, no direct push) — *WHY:* production safety. *WHEN:* P0. *WHO:* Ivan (repo owner).
- ☐ **Decide repo strategy** (mono vs split dashboard/Cathedra) — *WHY:* affects CI/deploy. *WHEN:* before P2. *WHO:* Ivan (Dev advises).
- ☐ **Approve the Cathedra decision** (in-platform / leave / spin out) — *WHY:* it shares the repo and an Airtable base. *WHEN:* P0. *WHO:* Ivan.

### Data & migration
- ☐ **Export/back up every Airtable base** before migration — *WHY:* irreversible-safety net. *WHEN:* before P1 cutover. *WHO:* Ivan (Dev can script the export).
- ☐ **Confirm which Airtable tables are legacy/removable** (`SERVICES (Out)`, `Table 15`, dev tables) — *WHY:* don't migrate junk. *WHEN:* P1 planning. *WHO:* Ivan.
- ☐ **Answer the open discovery questions** (`SUPABASE_DISCOVERY.md`) — *WHY:* architecture can't start without them. *WHEN:* before architecture. *WHO:* Ivan.

### Monitoring & ops
- ☐ **Choose an error-tracking service** (e.g. Sentry) — *WHY:* see failures in prod. *WHEN:* P1/P2. *WHO:* Ivan (Dev integrates).
- ☐ **Choose uptime/alerting** for Render + Supabase — *WHY:* know when prod is down (like the recent suspension). *WHEN:* P1. *WHO:* Ivan.
- ☐ **Confirm PMS/booking integration scope** (any system reception uses) — *WHY:* heavily shapes the reception/data model. *WHEN:* before P6 (ideally P0). *WHO:* Ivan.

---

# TASK 4 — Captured platform ideas (everything discussed + natural additions)

Recording all ideas raised across Phase-2 discussions so nothing is lost. **Capture only — not commitments.**

### Platform & data
- Airtable **fully retired**; Supabase as sole primary DB.
- **Multi-tenant** platform (hotel = tenant; possibly group→hotel hierarchy); slug kept as public id + internal UUID.
- **Isolation** via row-level security (default) in one shared Postgres.
- **Stable IDs** preserved so QR/tokens/rooms keep resolving.
- **Tenant seed/template** — new hotels start from defaults, then customize.

### CMS & editing
- **Dashboard as the single editing interface** (no direct DB/Airtable editing).
- **Draft → Preview → Publish** workflow; preview against the live PWA.
- **Version history** with rollback; audit fields (who/when, before→after).
- **AI Diff** — AI-assisted summary of what changed between versions.
- **Validation-on-save** — reuse the current `lint-content` rules (English-only guest text, room-type/number consistency, required fields).
- **Asset Manager** — media library per tenant; **asset usage tracking** (where each image is used).
- **Concurrent-edit** handling (locking / conflict warnings).
- **Bulk import / duplicate-from-template / copy-from-another-hotel.**
- Structured vs rich-text content types (Room Guide sections, Service price lists, FAQ, Whispers, News).

### AI layer
- **AI Knowledge redesign** — replace the 617-row intent-pattern model with a maintainable knowledge/FAQ + retrieval over the same CMS records.
- **Global Knowledge + Hotel Overrides** — shared platform knowledge (city/general) with per-hotel overrides.
- **Deterministic-first layer preserved** (room identity, smart glass, window, underfloor, AC-thermostat, extra bed, breakfast in-bed/bag, reception-help, etc.).
- **Safe-handoff** policy preserved (answer only from data, else Reception).
- **AI Preview** — test how the assistant answers before publishing content.
- **AI Quality dashboard** — eval results, unanswered/handoff rate, **knowledge completeness** per hotel.
- Persona / output-rules / disambiguation migrated to **per-tenant prompt config**.
- **Vector search / embeddings** (pgvector, tenant-scoped) — future; hybrid with Postgres full-text search.
- Cache-invalidation strategy so edits reflect quickly (today's 60s cache).

### Dynamic content
- **Realtime News** (NOVOSTI) — schedule/expire, push-on-publish.
- **Dynamic prices** — service price lists / extra-bed / (room rates?) editable; single source of truth shared by UI + AI (avoid the old price-guard trap); currency/VAT/seasonality; **PMS as possible source** (open).
- **Events** — hotel events vs shared city "Split Today" events (who maintains city events).

### Storage
- **Supabase Storage for all media**; per-tenant buckets; public guest media vs **private signatures**; image pipeline (transform vs pre-generate); video hosting decision; CDN.
- Migrate or archive historical Airtable attachments (signatures).

### Reception & ops
- **Reception dashboard** — live requests queue (status/assignee/notes/SLA), **active guests / check-in**, consent flow, notifications (**Supabase Realtime**).
- Replace Airtable-Automation webhooks with Supabase triggers / Edge Functions / jobs.
- Guest **web-push** retained; staff notifications (dashboard/email/possibly WhatsApp).
- Optional general **task/ticketing** beyond guest requests.

### Growth modules
- **Newsletter** — subscribers/segments/campaigns/stats; Brevo as relay; consent-linked opt-in.
- **Analytics** — guest question volume, unanswered rate, request response times, feedback, newsletter performance.
- **Self-serve hotel onboarding** — Platform Admin creates tenant → seed → invite staff → fill content → generate QR → go live.
- **Future integrations** — PMS/channel manager, payments/upsells, booking, **future mobile app**, additional verticals (e.g. Cathedra), white-label/reseller, optional guest accounts/loyalty.

---

# TASK 5 — Recommended Development Order (order only, not implementation)

1. **Infrastructure & prerequisites** (accounts, projects, regions, keys, secrets, environments, backups, monitoring).
2. **Supabase project(s)** provisioned (dev/staging/prod) with pooling + Auth/Storage enabled.
3. **Storage** buckets + access model (media is needed by CMS and can be set up early, low-risk).
4. **Authentication** (Supabase Auth + roles + RLS posture) — the security spine before any data is exposed.
5. **Database** design + provisioning (schema, relations, RLS) — *after* prerequisites + auth model are settled.
6. **Migration** of content + ops data from Airtable (dual-run, per hotel, with rollback).
7. **Dashboard** shell (auth, tenant context, role-aware navigation).
8. **Reception** module (highest-value operational surface; validates auth/RLS/realtime end-to-end).
9. **CMS** (content editing replaces Airtable; draft→preview→publish, versioning, asset manager).
10. **AI Layer** redesign (reads the new CMS; deterministic-first preserved; eval rebuilt).
11. **Newsletter** (needs consent + subscribers + Brevo).
12. **Analytics** (needs data from reception/AI/newsletter to be meaningful).
13. **Vector Search** (future; schema provisioned earlier, pipeline built last).

### Why this order
- **Prerequisites/infra first** — you cannot build safely on unconfigured accounts, missing keys, or a single shared environment; this also prevents the recent "production suspended" class of surprise.
- **Auth + RLS before data** — isolation is a security property that must exist *before* any tenant data is exposed; retrofitting RLS is dangerous.
- **Storage early** — low-risk, unblocks CMS media and lets us fix the empty-hero gap.
- **Migration before dashboard/CMS** — the dashboard edits data that must already live in Supabase; the API keeps serving the frozen PWA throughout (dual-run).
- **Reception before full CMS** — it's the highest-value staff surface and exercises auth/RLS/realtime end-to-end on a smaller scope, de-risking the CMS.
- **AI after CMS** — the redesigned AI must read the new CMS as its single source of truth, so CMS must exist first.
- **Newsletter/Analytics after core** — they depend on consent, subscribers, requests, and AI data being real.
- **Vector last** — explicitly a *future* capability; provisioning the schema early avoids a redesign, but the pipeline is not on the critical path.

---

# TASK 6 — Risks Before Development

| Risk | Why it matters | Mitigation (planning-level) |
|---|---|---|
| **Wrong tenant model** | Flat vs group→hotel decided late = painful reshape | Settle hierarchy + isolation before schema (discovery §4) |
| **Wrong Auth/permission model** | Cross-tenant data exposure; hard to retrofit | Design Auth + RLS *before* any data (order step 4) |
| **Bad Storage structure** | Public/private mistakes leak signatures; reorg is costly | Decide bucket/access model up front (P5 prereqs) |
| **Migration without rollback** | Data loss / broken guest resolution | Dual-run + full Airtable export + per-hotel verify |
| **Breaking production / frozen contract** | QR/token/room resolution or PWA behaviour changes | Preserve stable IDs; keep API contracts; `main` protected |
| **AI knowledge redesign regresses answers** | Guests get wrong/handoff answers; trust loss | Keep deterministic-first + safe-handoff; rebuild evals green before cutover |
| **Price ↔ AI inconsistency** | AI quotes a different price than the UI (old price-guard trap) | Single source of truth for each price; deterministic where confirmed |
| **Performance / connection limits** | Postgres connection exhaustion from Render | Use the pooler; load-test before multi-hotel |
| **Scaling (in-memory state)** | Rate-limiter/cache/push-map break with >1 Render instance | Move to shared storage before horizontal scaling |
| **Permissions creep** | Over-complex roles slow delivery and add bugs | Start role-based + simple; add granularity only if needed |
| **Media growth / cost** | Storage/egress balloons at 100+ hotels | Set quotas, image transforms, CDN, usage tracking |
| **Hidden Airtable automations/integrations** | Silent breakage when Airtable retires | Inventory every automation/webhook/interface first |
| **Cathedra coupling** | Second product entangled in repo/server/base | Decide in/out/spin-out before restructuring |
| **PII / GDPR** | Legal exposure on GUESTS/STAYS/PRIVOLE | EU region, retention/erasure design, DPA with sub-processors |
| **Doing too much at once** | 10-phase scope stalls | Ship phases independently and reversibly; verify each |

---

# TASK 7 — Questions Still Open (do not answer here)

These require Ivan's input before architecture. (Consolidated from `SUPABASE_DISCOVERY.md` §0–11; listed, not answered.)

1. **Cathedra:** in-platform, leave as-is, or spin out?
2. **Tenant:** hotel-only or generic property; flat vs group→hotel hierarchy?
3. **Isolation:** shared Postgres + RLS (default) vs schema/DB-per-tenant?
4. **Roles/permissions:** the exact role set and whether simple RBAC suffices.
5. **Auth:** email+password / magic link / SSO; reception real accounts vs shared PIN; 2FA for admins?
6. **Environments:** separate dev/staging/prod Supabase + Render, or single?
7. **Migration style:** dual-run gradual vs hard cutover; per-hotel or all-at-once (single pilot).
8. **Content model:** migrate 1:1 vs redesign; first-class **FAQ**?
9. **AI knowledge target model** and whether the deterministic layer stays in front.
10. **Prices:** which prices are dynamic; **is a PMS the source of truth?** currency/VAT/seasonality.
11. **Newsletter:** Brevo-as-relay vs Supabase-as-truth; segments; sender identity per hotel.
12. **Consent:** reception-only vs in-PWA; cookie consent scope; signature vs checkbox proof.
13. **Reception:** requests workflow/SLA; active-guests source (manual vs PMS); notification channels.
14. **Media:** bucket model; migrate historical attachments?; video hosting; CDN.
15. **Storage/DB region & pricing tier & backup expectations (RPO/RTO).**
16. **Realtime:** required now or later?
17. **Search:** Postgres FTS in Phase 2 even though vector is future?
18. **Vector scope:** schema-ready only vs working pipeline now; embedding provider/cost.
19. **Analytics:** which metrics drive decisions; retention/privacy.
20. **Legacy Airtable tables:** confirm `SERVICES (Out)` and `Table 15` are removable; fate of dev/QA tables.
21. **Success/definition-of-done** for Phase 2.
22. **Budget ceiling** across Supabase/OpenAI/Brevo/monitoring.
23. **Timeline / launch date** driving the migration.

---

> **This is the master planning document only.** No architecture, no schema, no SQL, no implementation has been produced. Awaiting Ivan's answers to the open questions before architecture begins.

---

> **Progress update (2026-08-02):** implementation on `feature/ai-olly-platform-2`, `aiolly-dev` only. **Steps 1–7 applied & verified**: cross-cutting (35), tenancy & identity (50), rooms/Room Guide — Pattern C (40), Hotel Services — Pattern A (76), **Package A: Destination Content + Presentation (Pattern B) + Pricing (Pattern A) (90)**. All integrated with Step 1 versioning/audit/retention. **Package B: AI Knowledge (Step 8) + Guests/Stays/Consent (Step 9) + Reception (Step 10) (136)**. All integrated with Step 1 versioning/audit/retention; sensitive data column-hidden and redacted from audit. **Package C: Storage & Asset Manager (Step 11) + Newsletter (Step 12) + Analytics Foundation (Step 13) (115)**. All integrated with Step 1 versioning/audit/retention; private media signed-URL-only; no real email sent. Production, Airtable, Render and the guest PWA remain untouched (`DATA_PROVIDER=airtable`). **The full Supabase data layer (Steps 1–13) is now complete.** Next and final: the **Dashboard + provider cutover** package (build the dashboard on this schema, then per-hotel Airtable→Supabase migration + `DATA_PROVIDER` switch) — not started, awaiting go-ahead. See `DATABASE_MIGRATION_STEP_1..4.md`, `_STEP_5_6_7.md`, `_PACKAGE_B.md`, `_PACKAGE_C.md`.
