# AI OLLY Platform 2.0 — Locked Decisions

> The confirmed decisions that govern Platform 2.0. These are **locked** — architecture and schema must conform to them. Open items that still block the first schema are listed at the end.
> Branch: `feature/ai-olly-platform-2` (pushed to origin). Production `main` frozen at `b158278`, tag `v1.0.0-antique`.
> Date: 2026-08-01. No tables, SQL, or migration produced by this document.

## Legend
Each decision lists: **Decision · Rationale · Consequence · Deferred details** (what is intentionally left for later).

---

### 1. Cathedra out of scope
- **Decision:** Cathedra is completely out of scope for Platform 2.0.
- **Rationale:** it is a separate product/vertical; including it would distort the hotel-focused tenant model.
- **Consequence:** the schema is hotel-specific; Cathedra keeps its own repo/Airtable/service untouched.
- **Deferred:** if/how Cathedra is ever spun out of this repo (cleanup report tracks it).

### 2. AI OLLY is a hotel platform
- **Decision:** AI OLLY is a hotel platform, not a generic education/shared-product platform.
- **Rationale:** focus enables a clean, hotel-shaped domain model.
- **Consequence:** entities are hotels/rooms/guests/stays/services — not generic "properties".
- **Deferred:** any future non-hotel verticals (would be a separate platform decision).

### 3. Render stays the backend host
- **Decision:** Render remains the backend/API/AI host.
- **Rationale:** proven, stable; no reason to move compute.
- **Consequence:** Express keeps serving the API; Supabase sits behind it. PWA → Render → Supabase.
- **Deferred:** horizontal scaling / moving in-memory state to shared storage (later phase).

### 4. Guest PWA unchanged
- **Decision:** the guest PWA remains unchanged.
- **Rationale:** v1 is frozen production; no guest-facing regressions allowed.
- **Consequence:** all 2.0 work is backend/dashboard; PWA files are not touched.
- **Deferred:** any future PWA evolution is a separate, explicit project.

### 5. PWA talks to Render, not Supabase
- **Decision:** the guest PWA communicates with Render, never directly with Supabase for protected hotel data.
- **Rationale:** keeps the frozen API contract; avoids exposing DB/keys to the browser.
- **Consequence:** no Supabase client or keys in the guest PWA bundle.
- **Deferred:** (none — firm boundary).

### 6. Supabase is the sole DB/Auth/Storage/Realtime
- **Decision:** Supabase becomes the sole database, Auth, Storage and Realtime platform.
- **Rationale:** one integrated backend reduces moving parts.
- **Consequence:** Auth, Storage, Realtime all designed on Supabase; no third-party auth/storage.
- **Deferred:** which Realtime features ship in release 1 vs later.

### 7. Airtable retired after migration + read-only fallback
- **Decision:** Airtable is fully retired after migration and a temporary read-only fallback period.
- **Rationale:** safe cutover; keep a rollback path during transition.
- **Consequence:** dual-run design; `DATA_PROVIDER` switch; Airtable code not deleted until after fallback.
- **Deferred:** exact fallback duration and per-hotel cutover criteria.

### 8. Dashboard is the only editing interface
- **Decision:** the dashboard is the only content-editing interface.
- **Rationale:** single, auditable, role-controlled surface; no direct DB/Airtable edits.
- **Consequence:** all content flows through the dashboard; direct SQL edits are out-of-process.
- **Deferred:** dashboard hosting/stack (see Open Blocker J).

### 9. Shared Postgres, hotel_id + RLS isolation
- **Decision:** one shared Postgres with `hotel_id` tenant isolation enforced by RLS.
- **Rationale:** simplest scalable multi-tenant model; strong isolation without per-tenant DBs.
- **Consequence:** every business row carries `hotel_id`; RLS on by default; queries fail closed.
- **Deferred:** exact policy shapes (built during schema/auth phase).

### 10. Multi-tenant from the start
- **Decision:** multi-tenant from day one.
- **Rationale:** avoids a costly retrofit; the platform is built to hold many hotels.
- **Consequence:** no single-hotel shortcuts in the schema.
- **Deferred:** tenant hierarchy specifics (see Open Blocker A).

### 11. Backward-compatible QR/tokens/slugs/API
- **Decision:** existing QR links, room tokens, slugs and API response contracts stay backward-compatible.
- **Rationale:** printed QR codes and the frozen PWA must keep working.
- **Consequence:** stable-ID mapping during migration; API shapes preserved.
- **Deferred:** internal ID scheme (UUIDs) alongside the preserved public slugs/tokens.

### 12. Content changes without deployment
- **Decision:** content changes must not require an application deployment.
- **Rationale:** hotels self-serve content; edits are data, not code.
- **Consequence:** content lives in Supabase, served dynamically; no rebuild to change text/prices.
- **Deferred:** cache-invalidation strategy so edits reflect quickly.

### 13. Content workflow Draft → Preview → Publish → Live
- **Decision:** the content workflow is Draft → Preview → Publish → Live.
- **Rationale:** safe editing with preview before guests see changes.
- **Consequence:** content records carry state; only "published" is served to guests/AI.
- **Deferred:** who may publish / mandatory review (see Open Blocker D).

### 14. Version history + rollback
- **Decision:** important content supports version history and rollback.
- **Rationale:** auditability and safe recovery from bad edits.
- **Consequence:** versioned content tables + restore capability; audit fields.
- **Deferred:** retention depth of versions (see Open Blocker I).

### 15. Supabase Storage for media + private documents
- **Decision:** Supabase Storage holds hotel media and private documents.
- **Rationale:** integrated storage with RLS + signed URLs.
- **Consequence:** per-tenant buckets; public media vs private (signatures/PDFs).
- **Deferred:** video hosting + size limits (see Open Blocker H).

### 16. Dynamic operational content
- **Decision:** dynamic content includes news, events, minibar, transfers, prices, parking and other operational info.
- **Rationale:** hotels change these often; must be editable without deploys.
- **Consequence:** these become first-class, editable content types.
- **Deferred:** pricing model specifics (see Open Blocker E).

### 17. AI Knowledge redesigned (not 1:1 intent patterns)
- **Decision:** AI Knowledge is redesigned; the 617 Airtable intent patterns are not migrated 1:1.
- **Rationale:** the intent-pattern model is unmaintainable and was unreliable in testing.
- **Consequence:** a new knowledge/FAQ model with retrieval, sourced from the CMS.
- **Deferred:** exact knowledge model + retrieval design (AI phase).

### 18. Deterministic handlers remain the safety layer
- **Decision:** deterministic handlers remain the safety layer for critical facts.
- **Rationale:** they are the guaranteed-accurate, eval-locked answers (room facts, contact, etc.).
- **Consequence:** deterministic-first pipeline preserved in front of any AI/knowledge retrieval.
- **Deferred:** which handlers migrate/expand.

### 19. Platform Knowledge overridable by hotel
- **Decision:** Platform Knowledge can be overridden by hotel-specific knowledge.
- **Rationale:** shared defaults (city/general) with per-hotel customization.
- **Consequence:** knowledge has a platform layer + hotel-override layer.
- **Deferred:** inheritance mechanics (see Open Blocker C).

### 20. Vector search future-ready, not required in release 1
- **Decision:** RAG/vector search is future-ready but not required in the first release.
- **Rationale:** avoid premature complexity/cost; deterministic + structured knowledge suffices first.
- **Consequence:** schema is designed to accept embeddings later (pgvector); no pipeline in R1.
- **Deferred:** embedding provider/cost/pipeline (Phase 9).

### 21. Newsletter in dashboard, Brevo delivers
- **Decision:** newsletter is managed from the AI OLLY dashboard; Brevo remains the email delivery provider.
- **Rationale:** control in-platform, proven delivery via Brevo.
- **Consequence:** subscribers/segments/campaigns modeled in Supabase; Brevo sends.
- **Deferred:** Brevo-as-relay vs source-of-truth details; sender identity per hotel.

### 22. Reception/guests/stays/requests/consents are dashboard modules
- **Decision:** these are dashboard modules.
- **Rationale:** operations move off Airtable into the dashboard.
- **Consequence:** ops entities modeled in Supabase with a reception UI.
- **Deferred:** guest/stay source (manual vs PMS) (see Open Blocker G).

### 23. Required platform capabilities
- **Decision:** Asset Manager, AI Preview, AI Diff, AI Quality and knowledge-completeness reporting are required.
- **Rationale:** these make the CMS/AI maintainable and measurable.
- **Consequence:** the dashboard and data model must support them.
- **Deferred:** their detailed UX/scope per phase.

### 24. Production v1 must not be endangered
- **Decision:** production v1 must not be endangered.
- **Rationale:** live guests depend on it.
- **Consequence:** frozen `main`; dual-run; reversible changes; no cutover without verification.
- **Deferred:** (none — overriding constraint).

### 25. `aiolly-dev` is the current dev project
- **Decision:** `aiolly-dev` is the current development Supabase project.
- **Rationale:** isolated dev environment established and connection-verified.
- **Consequence:** all Phase-1+ dev work targets `aiolly-dev`.
- **Deferred:** staging project creation timing.

### 26. `aiolly-prod` created later
- **Decision:** `aiolly-prod` will be created later.
- **Rationale:** production project is stood up only when migration is ready.
- **Consequence:** no prod Supabase until cutover phase.
- **Deferred:** exact timing + paid tier selection.

### 27. Free plan for dev, paid for prod
- **Decision:** Free plan is acceptable for development; production will use a paid plan.
- **Rationale:** cost control in dev; backups/capacity needed in prod.
- **Consequence:** prod tier (Pro+) chosen before prod data lands.
- **Deferred:** exact prod tier.

### 28. Frankfurt / Central EU region
- **Decision:** Frankfurt / Central EU is the selected region.
- **Rationale:** GDPR residency + latency to Split.
- **Consequence:** all projects in EU; migrations use the region's pooler.
- **Deferred:** (none).

### 29. Custom SMTP deferred
- **Decision:** custom SMTP is deferred; Brevo may later serve Supabase Auth SMTP.
- **Rationale:** Auth email not needed until the dashboard/Auth phase.
- **Consequence:** default Supabase email for now; Brevo SMTP integration later.
- **Deferred:** when/whether to wire Brevo as Auth SMTP.

### 30. `DATA_PROVIDER=airtable` until controlled cutover
- **Decision:** `DATA_PROVIDER` stays `airtable` until a controlled cutover.
- **Rationale:** Airtable remains the live source of truth during build/migration.
- **Consequence:** Supabase implementations are added behind the switch, endpoint by endpoint.
- **Deferred:** cutover sequencing and per-endpoint verification criteria.

---

## LOCKED DATABASE-DESIGN DECISIONS (A–J) — confirmed 2026-08-01

The former open blockers are now **locked** (confirmed by Ivan). These govern the first business schema.

**A. Tenant hierarchy** — Support **hotel groups AND individual hotels**. A hotel **may optionally** belong to a group. One staff user **may belong to multiple hotels**. Use **hotel memberships** (join table), not a single `hotel_id` on the user.

**B. First-release staff roles** — `platform_admin`, `hotel_admin`, `reception`, `editor`, `marketing`, `read_only`. **Role-based** permissions for R1, structured to allow **more granular permissions later**.

**C. Content inheritance** — **Hybrid**: live platform defaults + hotel-specific overrides; **hotel override wins** when present; **do not copy** every platform record into every hotel.

**D. Publishing** — May publish: `platform_admin`, `hotel_admin`, `editor`. Review **optional** in R1. **Emergency direct publish:** `platform_admin` + `hotel_admin` only. **Critical facts** (emergency info, checkout times, prices, legal texts) must show an **explicit warning before publication**.

**E. Pricing** — One **generic `price_items`** model, linked to services or other content contexts. Columns: `amount`, `currency`, `vat_included`, `tax_rate` (where applicable), `billing_unit`, `valid_from`, `valid_to`, `status`, hotel override, `note`, `external_source`, `external_id`, `last_synced_at`. **PMS integration is future scope; schema must be PMS-ready.**

**F. Localization** — **English only required for R1**, but schema supports localization from day one via **translation tables + locale fields**. **No `title_en`/`title_hr`-style columns.**

**G. Guests & stays** — Stays created **manually or via QR/token** initially; **PMS later**. **Guests do not create accounts.** Preserve **room token / stay token** guest access (frozen contract).

**H. Media** — Supabase Storage for images, PDFs, short audio, signatures, consent PDFs, logos, newsletter assets. **Long-form video:** Vimeo preferred, YouTube for public, Supabase Storage only for shorter videos. **Upload limits:** images 15 MB · PDFs 25 MB · audio 50 MB · short video 100 MB · signatures 5 MB. **Plan automatic image optimization** for PWA delivery.

**I. Audit & retention** — Retain **≥50 content versions**. Published **legal/consent text versions retained permanently or per confirmed legal policy**. Guest-data retention **configurable and legally confirmed**. Support **deletion + pseudonymization** workflows. **AI full-text logs: 90 days**; anonymized aggregate analytics may be retained longer. **Do not hardcode legal retention periods without approval.**

**J. Dashboard** — Host the **Next.js dashboard on Vercel**; keep **Render** for Express API + AI. **Separate dashboard app inside the same repository (monorepo).** Guest PWA is not modified in this phase.

> Architecture proposal built on these locks: `docs/AI_OLLY_DATABASE_ARCHITECTURE.md`. **No SQL is created or applied until that proposal is reviewed.**

---

## LOCKED DATABASE ARCHITECTURE DECISIONS (1–10) — confirmed 2026-08-01

Refine the architecture proposal. Introduce a **destination** concept and three distinct override patterns.

**1. Room Guide** — **Room-type inheritance with room-specific overrides.** `room_types` hold shared/default room-guide content; individual rooms override specific facts (view, Smart Glass, window operation, heating, extra-bed availability, notes). The **resolved room context must always be deterministic**; shared text is **not** duplicated across every room.

**2. Whispers** — Whispers belong primarily to a **destination**, not a single hotel. Destination-level chapters; hotels may **select, order or hide** destination chapters and may add **private hotel-specific stories**.

**3. Split Today / Events** — City events are **destination-shared**: one canonical destination event record; hotels control **visibility, highlighting and ordering**. Hotel-specific news/events remain **hotel-owned** content.

**4. POIs** — **Destination-shared** with hotel presentation overrides. Canonical shared data: identity, location, coordinates, destination, general description. Hotel override data: hotel-specific short description, recommendation, photo, priority, walking time, visibility, sort order.

**5. Localization** — Generic translations model for R1: `(entity_type, entity_id, field_key, locale, value)`. English required for R1; schema fully localization-ready.

**6. Content versioning** — **Full immutable JSON snapshots** per version. Rollback restores a complete snapshot; the UI may compute field-level before/after diffs. **Legal, consent, pricing and critical AI content must preserve exactly what was published.**

**7. Content inheritance** — Hotel overrides replace the **complete logical content record** (platform ↔ hotel axis). **No automatic field-by-field merging** of text/content. Configuration fields (visibility, ordering) may be separate, but text/content overrides must be **explicit and predictable**.

**8. Guest deduplication** — **One guest, multiple stays**, but **no automatic merge** solely by matching email/phone. Possible duplicates are **suggested for staff review**. Reliable linking via manual confirmation, PMS external identifier, or another trusted external source. **Guests do not receive user accounts.**

**9. Retention** — Configurable, **not hardcoded as legal truth**. A **retention-policy** concept by data type and, where needed, hotel/jurisdiction. Planning defaults: full AI conversation content **90 days**; anonymized analytics may be retained longer; content versions **≥50**; legal/consent published snapshots per **confirmed legal policy**; guest operational data configurable with **deletion/pseudonymization** support.

**10. Backward compatibility** — Preserve: hotel **slug**, **room number**, existing **room/access tokens**, **QR URL structure**, existing **API response contracts**. Use new **UUID** primary keys internally. Hotel slug **globally unique**; room number + access token **unique within the hotel scope**, with **token security preserved**.

> Applied to the architecture in `docs/AI_OLLY_DATABASE_ARCHITECTURE.md` → **Addendum A**. Still no SQL/tables/migration.

---

## LOCKED DATABASE ARCHITECTURE DECISIONS (Q1–Q8) — confirmed 2026-08-01

Resolve the last database-design blockers.

**Q1. Pricing model** — One **controlled polymorphic `price_items`** table (no per-domain price tables). Fields: id, hotel_id, context_type, context_id, name, amount, currency, billing_unit, vat_included, tax_rate (where applicable), valid_from, valid_to, active, note, external_source, external_id, last_synced_at. Allowed `context_type`: `minibar_item`, `transfer`, `hotel_service`, `room`, `parking`, `breakfast`, `wellness`, `laundry`, `extra_bed`.

**Q2. Platform admin** — Global flag `profiles.is_platform_admin`. Hotel-specific roles remain in `hotel_memberships`. A platform admin **does not require a hotel membership** to access platform-level administration.

**Q3. Retention** — Exact legal periods remain **PENDING LEGAL CONFIRMATION**; do not hardcode assumed periods. Schema supports configurable retention policies by: **data type, hotel, jurisdiction, effective date, retention duration, action (delete / anonymize / archive)**.

**Q4. Image optimization** — Use **Supabase image transformations** for R1. Store **one original** asset; serve transformed variants: `thumbnail`, `card`, `hero`, `full`. Do not pre-generate/store multiple copies unless later justified by performance/cost.

**Q5. Deterministic handlers** — **Logic stays in code:** emergency routing, safety guards, room identity, QR/token logic, safe handoff, identity questions, anti-hallucination rules, critical routing, fallback. **Facts stay in data (Supabase):** check-in/out, contact info, breakfast times, parking, transfers, extra bed, Smart Glass, room-specific facts, approved answers, safe keyword aliases where appropriate. **Principle: logic in code, facts in data.**

**Q6. Destination content editing** — R1: **only `platform_admin`** may edit canonical destination content (canonical POIs, Whispers chapters, destination events, coordinates, identity). Hotel staff manage **only hotel presentation settings** (visibility, priority, sort order, walking time, hotel short description, recommendation, hotel media). **No `destination_editor` role in R1.**

**Q7. Hotel ↔ destination** — R1: **one hotel belongs to exactly one destination** via `hotels.destination_id`. **No many-to-many** unless a confirmed future use case requires it.

**Q8. Destination versioning** — Canonical destination content is **fully versioned (immutable snapshots)**. Hotel presentation settings are **audited but not full-version-snapshotted** in R1. Any hotel-side change affecting guest presentation still produces an **audit-log entry**.

> All database-design blockers are now resolved. Applied to `AI_OLLY_DATABASE_ARCHITECTURE.md` → **Addendum B** (final inventory + migration order). Still no SQL/tables/migration.
