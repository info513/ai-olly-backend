# AI OLLY Platform 2.0 — Release Candidate 1 Audit

**Status:** Feature-complete. This is a **quality audit only** — no code, schema, UX, or
Design-System changes were made. Scope: the Platform 2.0 implementation being released —
`dashboard/` (Next.js 14 App Router), the Supabase schema/RLS/RPC (`supabase/migrations/*`),
and the migration tooling (`scripts/migration`, `dashboard/scripts`). The frozen v1 backend
(`server/`, `pwa/`) is noted only where it leaks into the platform (F-DX4, B1).

Method: four independent read-only specialist reviews (DB/RLS/indexes, frontend/a11y,
performance/bundle/caching, security/permissions) plus a DX/Product pass. Every finding is
evidence-backed with file/table references. Severities below are the **final, normalized** QA
call (individual reviewers' guesses were reconciled for consistency).

## Totals

| Severity | Count |
|---|--:|
| **BLOCKER** | 1 |
| **HIGH** | 6 |
| **MEDIUM** | 16 |
| **LOW** | 14 |
| **Total** | **37** |

Plus a **Cleared / positive-assurance** section (items investigated and found sound — not counted).

> **Progress:** BLOCKER B1 scrubbed (token redacted; rotation + history purge remain owner actions).
> **H2 RESOLVED** in RC1 Cluster 2; **H3, H4, H5 RESOLVED** in RC1 Cluster 3 — **all 6 HIGH
> findings are now resolved** (see the Cluster 2 / Cluster 3 result sections below). Severities
> are otherwise unchanged.

---

## BLOCKER

### B1 — Live production room access token committed in plaintext
- **Severity:** BLOCKER
- **Problem:** `docs/AI_OLLY_LAUNCH_CHECKLIST.md:47` contains a working room credential — room 201 token `‹redacted›`. The guest PWA authenticates purely by `?slug=antique-split&room=201&token=…` (`:46`), so this is a live key. The repo's own `.gitignore:8-17` deliberately excludes token artifacts, yet one leaked into a tracked doc; git history retains it after any edit. (Detected by `dashboard/scripts/security-audit-migration.mjs`; already surfaced as a task chip in Sprint 9.)
- **Impact:** Anyone with repo or history read access can open room 201's guest experience.
- **Recommended fix:** Rotate room 201's Access Token in Airtable (invalidates the value + its QR), scrub the token from the doc, purge from git history (git-filter-repo/BFG), and add a pre-commit secret scan.
- **Estimated effort:** M
- **Risk of fixing:** Low — rotation invalidates one printed QR (the doc's own line 50 documents the rotation path). Note: token rotation is a production action, out of scope for an audit; owner action required.

---

## HIGH

### H1 — App shell is not mobile-responsive (no drawer)
- **Severity:** HIGH
- **Problem:** `app/(app)/layout.tsx:51-59` always renders `<AppSidebar>`; `components/shell/app-sidebar.tsx:39-44` fixes width to `w-[248px]`/`w-[68px]` with no `md:`/`hidden` breakpoint, no off-canvas Sheet/drawer, and no hamburger. Collapse is a manual localStorage toggle, not viewport-driven; `top-bar.tsx:14` only hides the page title on mobile.
- **Impact:** On a 375px phone the sidebar consumes ~66% of width (or 68px permanently) and cannot be dismissed — the dashboard is effectively desktop-only. Reception/tablet use suffers.
- **Recommended fix:** Below `md`, `hidden md:flex` the `<aside>` and render it as a Radix Dialog/Sheet drawer toggled by a hamburger in `TopBar`.
- **Estimated effort:** M
- **Risk of fixing:** Med — shell-wide layout change; regression-test all routes.

### H2 — ~550 LOC of dead mock scaffolding still shipped ✅ RESOLVED (RC1 Cluster 2)
- **Severity:** HIGH — **RESOLVED**
- **Problem:** A closed cluster imported by nothing live: `src/mock/{data,provider,types}.ts`, `src/hooks/use-dashboard.ts` (zero importers), and `src/components/home/*` (`greeting/kpi-card/quick-actions/today-card/requests-card/recent-activity`). The real `app/(app)/home/page.tsx` uses live `@/data/*` hooks and imports none of them. This is the pre-real-Home scaffolding superseded in Sprint 8.
- **Impact:** ~548 misleading LOC in the RC; a reviewer/agent could mistake `mock/provider` for a live data path.
- **Recommended fix:** Delete `src/mock/`, `src/hooks/use-dashboard.ts`, `src/components/home/`; `tsc --noEmit` to confirm zero breakage.
- **Estimated effort:** S
- **Risk of fixing:** Low (verified zero live importers).

### H3 — 35 foreign-key columns have no covering index ✅ RESOLVED (RC1 Cluster 3)
- **Severity:** HIGH — **RESOLVED**
- **Problem:** 35 FK columns in `public` lack a leading index (FKs vs `pg_indexes`). Hot examples: `guest_requests.guest_id/room_id`, `consents.stay_id/template_id`, `newsletter_events.subscriber_id/hotel_id/recipient_id`, `newsletter_campaign_recipients.subscriber_id/hotel_id`, `newsletter_subscribers.guest_id/consent_id`, `asset_usages.hotel_id`, `request_events.hotel_id`, `feedback.stay_id/room_id`, `knowledge_articles.category_id/override_of_article_id`, all `hotel_*_settings.*_id`, `guest_duplicate_suggestions.*`.
- **Impact:** Slow joins on list/detail views; every parent DELETE (guest/stay/subscriber/hotel — incl. GDPR delete) triggers a seq-scan per unindexed child FK, degrading as data grows.
- **Recommended fix:** One migration of `CREATE INDEX CONCURRENTLY` on each FK column.
- **Estimated effort:** M
- **Risk of fixing:** Low (additive, concurrent).

### H4 — No code-splitting: BlockEditor eagerly bundled into the 3 heaviest routes ✅ RESOLVED (RC1 Cluster 3)
- **Severity:** HIGH — **RESOLVED**
- **Problem:** Zero `next/dynamic`/`React.lazy` in `src/`. `BlockEditor` is statically imported into `ai/knowledge/[articleId]` (**230 kB**), `content/services/[serviceId]` (**228 kB**), `newsletter/templates/[templateId]` (**228 kB**) — the top 3 First-Load-JS routes. `framer-motion` (used only by login + module-placeholder) also sits in the shared graph.
- **Impact:** ~40–45 kB extra JS parsed on first load of every editor route atop the 87.5 kB baseline; slower TTI on authoring paths.
- **Recommended fix:** `dynamic(() => import('@/components/content/block-editor'), { ssr:false, loading:… })` (one change covers all three); consider dynamic import for the signature pad and framer-motion.
- **Estimated effort:** S
- **Risk of fixing:** Low.

### H5 — Unbounded whole-table fetches (no `.limit()`), filtered in JS ✅ RESOLVED (RC1 Cluster 3)
- **Severity:** HIGH — **RESOLVED**
- **Problem:** List hooks pull entire hotel tables and filter client-side: `data/guests.ts:25-30` (all stays+requests+consents), `data/reception.ts:177-200` (all stays/requests/consents, "today" filtered in JS), `data/subscribers.ts:37-39`, `data/assets.ts:47-58`, `data/unanswered.ts:18-22`, `data/consents.ts:174,186`. (Search/activity/notifications correctly cap with `.limit()` — this is the exception.)
- **Impact:** Download grows linearly with property history; a hotel with thousands of stays/requests downloads all of them per view. Invisible on dev data, a scaling cliff in production.
- **Recommended fix:** Add `.limit()` + pagination; push date/status filters into the query; consider a view/RPC for the reception/guests aggregates.
- **Estimated effort:** M
- **Risk of fixing:** Med (changes query semantics; re-verify counts).

### H6 — No CI pipeline / automated quality gate
- **Severity:** HIGH
- **Problem:** No `.github/workflows` (or any CI config). The substantial verify/security suites (≈205 dashboard + 542 backend checks) and typecheck/build exist but run **only** when invoked manually. Nothing gates a push/PR.
- **Impact:** For an RC, quality relies on discipline; a regression can land on the branch unblocked. No reproducible pre-merge gate.
- **Recommended fix:** Add a CI workflow running typecheck + build + the verify/audit suites (against an ephemeral or dedicated CI Supabase project, not shared dev) on PR.
- **Estimated effort:** M
- **Risk of fixing:** Low.

---

## MEDIUM

### M1 — Composite indexes don't match hot query paths
- **Severity:** MEDIUM · **Problem:** `guest_requests` has `(hotel_id,status)` but queries order by `created_at` (no `(hotel_id,status,created_at)`); `knowledge_articles` lacks `(hotel_id,status,available_to_ai)` (the AI-serving filter); `stays` lacks `(hotel_id,status,arrival_at)`; `consents` lacks `(hotel_id,stay_id)`; `assets` would benefit from partial `(hotel_id) WHERE deleted_at IS NULL`. · **Impact:** Extra sort/filter on the busiest and AI-serving queries. · **Fix:** Add the 4–5 composite/partial indexes. · **Effort:** S · **Risk:** Low.

### M2 — 14 `legacy_airtable_record_id` columns unindexed
- **Severity:** MEDIUM (HIGH for the pending cutover) · **Problem:** All legacy-id columns (rooms, room_types, hotel_services, service_categories, knowledge_*, price_*, destination_*, assets, hotels.legacy_airtable_id) have no index. · **Impact:** The idempotent-upsert lookups the Airtable→Supabase cutover relies on become full scans → O(rows²) re-import. · **Fix:** `CREATE INDEX CONCURRENTLY` (partial `WHERE … IS NOT NULL`) on each. · **Effort:** S · **Risk:** Low.

### M3 — EXECUTE-grant hardening drift (anon/PUBLIC retain grants)
- **Severity:** MEDIUM (defense-in-depth; not a live exploit) · **Problem:** `anon` still holds EXECUTE on `public.publish_destination_content`, `public.publish_price_item`, `public.resolved_price_items`, and `platform.get_room_access_token` has PUBLIC EXECUTE — the step5/step7/step3 RPCs were never re-hardened like the later `reharden_content_rpc_grants`/`ai_execute_hardening` migrations. **Every one self-guards internally** (raises `42501`), so anon cannot actually publish or read tokens today. · **Impact:** Standard-compliance/hygiene gap. · **Fix:** `revoke all … from public, anon, authenticated` then re-grant `authenticated, service_role` on the 3 publish/token RPCs. · **Effort:** S · **Risk:** Low.

### M4 — Newsletter offered to roles the RLS denies (dead ends)
- **Severity:** MEDIUM · **Problem:** `lib/permissions.ts:36` grants newsletter to `editor/reception/read_only`, but RLS restricts subscribers to hotel_admin/marketing/reception and segments/events/recipients + all writes to hotel_admin/marketing (`20260802160100_step12_newsletter.sql:378-431`). The command palette surfaces New campaign/segment/template/Find subscriber to those roles (`command-palette.tsx:34-69`). · **Impact:** editor/read_only/reception see a Newsletter section + Create actions that render empty or 403 — looks broken at RC. · **Fix:** Tighten `MODULE_ACCESS.newsletter` to `[platform_admin,hotel_admin,marketing]` (+reception only for a read view), or gate palette actions by write-capability. · **Effort:** S · **Risk:** Low.

### M5 — `webhook-events` route broadens delivery-event visibility beyond RLS
- **Severity:** MEDIUM · **Problem:** `api/newsletter/webhook-events/route.ts:33-37` authorizes by campaign visibility (`newsletter_campaigns` SELECT = any hotel member) then reads `newsletter_webhook_events` with the **service-role key**, while `newsletter_events` RLS restricts to hotel_admin/marketing. · **Impact:** read_only/editor/reception members can pull (redacted) webhook summaries they'd normally be denied — role-scope broadening (content is redacted, so not a PII leak). · **Fix:** Add the same role check `webhook-dev` uses (platform_admin OR hotel_admin/marketing) before the service-role read. · **Effort:** S · **Risk:** Low.

### M6 — O(n²) client-side join in `useGuests`
- **Severity:** MEDIUM · **Problem:** `data/guests.ts:39-45` — `latestStay(gid)` runs `stays.filter().sort()` inside `.map()` over every guest (O(guests×stays)) on the main thread each refetch. · **Impact:** Tens of thousands of iterations at a few hundred rows each. · **Fix:** Pre-bucket stays into a `Map<guestId, Stay[]>` in one pass → O(N+M). · **Effort:** S · **Risk:** Low.

### M7 — No list virtualization
- **Severity:** MEDIUM · **Problem:** No virtualization anywhere; guests, subscribers, assets library, unanswered, requests render every row. Combined with H5 the DOM node count is unbounded. · **Impact:** Large DOM + slow re-render on filter/sort at scale. · **Fix:** Paginate (pairs with H5) or add `@tanstack/react-virtual` for the largest tables. · **Effort:** M · **Risk:** Low.

### M8 — Raw `<img>` with full-resolution thumbnails (no image optimization)
- **Severity:** MEDIUM · **Problem:** No `next/image`; raw `<img>` at `components/assets/asset-preview.tsx:27,59,97` and `consent/[consentId]/page.tsx:117`. Grid thumbnails load the **full-res** signed URL (`:27`), not a Supabase transform. · **Impact:** Asset grids download MB-scale originals for thumbnails; no responsive sizing/format. · **Fix:** Use Supabase render/transform URLs (`?width=…&quality=…`) for thumbnails; full-res only on detail. · **Effort:** M · **Risk:** Med (signed-URL+transform interaction needs testing).

### M9 — Dev webhook-events hook swallows HTTP failures as "empty"
- **Severity:** MEDIUM · **Problem:** `data/newsletter-events.ts:64-66` returns `[]` on missing token / `!res.ok`; a 401/500 is indistinguishable from "no events" (`retry:false`). · **Impact:** Silent blind spot on campaign analytics; a broken feed looks empty. · **Fix:** `throw` on `!res.ok`/missing token so the panel's `ErrorState` surfaces it. · **Effort:** S · **Risk:** Low.

### M10 — Icon-only edit/delete buttons without `aria-label`
- **Severity:** MEDIUM · **Problem:** Unlabeled icon buttons: `stays/[stayId]/page.tsx:78,90` (Pencil) and `components/ai/aliases-panel.tsx:131` (Trash2 delete). Screen readers announce "button". · **Impact:** WCAG 4.1.2 violation on edit + destructive controls. · **Fix:** Add `aria-label` (the shell already labels its icon buttons). · **Effort:** S · **Risk:** Low.

### M11 — Signature pad has no accessible name / no non-pointer path
- **Severity:** MEDIUM · **Problem:** `components/reception/signature-pad.tsx` — the `<canvas>` has no `role`/`aria-label`; capture is pointer-only with no keyboard or typed-name fallback, gating a legally-meaningful consent signature. · **Impact:** Keyboard/assistive-tech users cannot complete consent capture; invisible to screen readers. · **Fix:** `role="img"`+`aria-label`, plus a typed-name fallback (also improves legal robustness). · **Effort:** M · **Risk:** Med (compliance flow — validate with product).

### M12 — Zero optimistic updates on hot reception actions
- **Severity:** MEDIUM · **Problem:** No `onMutate`/`setQueryData`/`cancelQueries` anywhere; every mutation invalidates + refetches. Request status/priority/assign toggles (`reception/requests/[requestId]/page.tsx:86,101-103,112`) pay a full round-trip + spinner before the UI reflects the change. · **Impact:** Perceived latency on the concierge hot path. · **Fix:** Add optimistic patches with rollback for the small set of instantaneous toggles; leave create/delete on invalidate. · **Effort:** M · **Risk:** Med (needs correct rollback).

### M13 — App-wide shared primitives live under the `content/` feature folder
- **Severity:** MEDIUM · **Problem:** `EmptyState/ErrorState/SectionLoader/PermissionDenied` (`components/content/states.tsx`) are imported by 54 files (46 outside content); `PageHeader` (`components/content/page-header.tsx`) by 43 non-content files. · **Impact:** Misleading module boundaries; every page reaches "into content" for generic UI. · **Fix:** Move to `components/ui/` (or `components/common/`) + update imports (codemod-able). · **Effort:** M · **Risk:** Low (import churn only).

### M14 — Mutation error-handling wrapper duplicated across 12 pages
- **Severity:** MEDIUM · **Problem:** `const [err,setErr]=…; const run=async(p)=>{setErr(null);try{await p}catch(e){setErr(humanizeError(e))}}` + an inline `bg-danger-soft/40` banner re-implemented in 12 files (reception/guests/stays/assets/consent/newsletter detail pages + `usage-panel.tsx`). · **Impact:** No single place to standardize mutation-error UX (or move to toasts). · **Fix:** Extract `useRunAction()` + `<InlineError>`. · **Effort:** M · **Risk:** Low.

### M15 — No unit/component/E2E tests; integration suites run against the live dev DB
- **Severity:** MEDIUM · **Problem:** No test framework in the dashboard (no vitest/jest/playwright/@testing-library). Quality rests entirely on the `verify-*`/`security-audit-*` `.mjs` integration scripts, which mutate and read the **shared aiolly-dev** project (create+cleanup real users/rows). No component/interaction/E2E coverage; no isolation from dev data. · **Impact:** UI regressions (rendering, a11y, interaction) are uncaught; suites can collide with live dev usage. · **Fix:** Add component tests (vitest+@testing-library) for the shared primitives + a couple of Playwright smoke flows; point integration suites at an ephemeral CI project. · **Effort:** L · **Risk:** Low.

### M16 — Analytics aggregates have no production refresh scheduler
- **Severity:** MEDIUM · **Problem:** The four `*_daily` tables are refreshed only by the dev-only "Refresh analytics" button / `refresh_analytics` RPC. No scheduled job exists (documented as future in Sprint 8). · **Impact:** In production, Home/Analytics/Hotel-Health would show stale or empty aggregates until someone manually refreshes. · **Fix:** Add a Render cron or Supabase scheduled job calling `refresh_analytics(hotel, day)` per hotel daily (tz-aware); document the cadence. · **Estimated effort:** M · **Risk of fixing:** Low.

---

## LOW

### L1 — `rls_auto_enable` event trigger exists in the live DB but not in migrations
- **Severity:** LOW · **Problem:** Live `public.rls_auto_enable()` + `ensure_rls` event trigger (auto-enables RLS on new public tables) was created out-of-band; absent from `supabase/migrations`. Benign/protective, but a clean rebuild wouldn't reproduce it (and it explains the M3 grant drift). · **Impact:** Schema drift / reproducibility. · **Fix:** Codify the function + `create event trigger` in a migration. · **Effort:** S · **Risk:** Low.

### L2 — Backend-only tables (RLS-on, zero policies) — document the access model
- **Severity:** LOW (informational) · **Problem:** `audit_log, content_versions, translations, retention_policies, newsletter_webhook_events` have RLS enabled + zero policies + no anon/authenticated grants → fully service-role-only (correct fail-closed design). Caveat: any dashboard path hitting `content_versions`/`translations` with a user JWT via PostgREST silently returns nothing. · **Impact:** None today; a latent foot-gun. · **Fix:** Add a one-line confirmation/comment that all access goes via service-role/RPC. · **Effort:** S · **Risk:** Low.

### L3 — Content/Assets module gating is the inverse of RLS in spots
- **Severity:** LOW · **Problem:** `rooms/room_types/services` SELECT = any member, yet `permissions.ts:29` hides Content from reception/marketing (deliberate product choice); `MODULE_ACCESS.assets` includes `read_only` but `assets_ins` denies it, so palette "Upload asset" is a dead end for read_only/reception. · **Impact:** Cosmetic; no security exposure (RLS authoritative). · **Fix:** Document the per-role matrix; add a `canWrite(module)` helper distinct from `can(module)`. · **Effort:** S · **Risk:** Low.

### L4 — Migration routes echo raw error messages
- **Severity:** LOW · **Problem:** `api/migration/status/route.ts:47` and `run/route.ts:52` return `{ error: e.message }` (unlike other routes' generic strings); `run` redacts script output but not the catch-all message. Gated to platform_admin + dev ref, so exposure is limited. · **Impact:** An unexpected error could surface an internal path/detail to a platform admin. · **Fix:** Return generic message + log detail server-side, or pass through `redactLog`. · **Effort:** S · **Risk:** Low.

### L5 — Minor query waterfalls (fetch-then-enrich)
- **Severity:** LOW · **Problem:** `data/assets.ts:56-65` (assets → `usageCounts(ids)`) and `data/subscribers.ts:51-53` (`useSubscriber` awaits row then scans hotel-wide `consentStates`) do a second serial round-trip; the subscriber path over-fetches hotel-wide state for one row. · **Impact:** One extra round-trip per view + over-fetch on single-subscriber. · **Fix:** Resolve consent state for the single id; fold asset usage into a view/embedded aggregate. · **Effort:** S · **Risk:** Low.

### L6 — Charts recompute geometry every render
- **Severity:** LOW · **Problem:** `components/analytics/charts.tsx` `TrendChart`/`Sparkline` compute `Math.max`, point strings, ticks inline without `useMemo`. (Dependency-free inline SVG — no chart lib in bundle, so cost is small.) · **Impact:** Minor CPU on re-render. · **Fix:** `useMemo` the derived arrays keyed on `points`. · **Effort:** S · **Risk:** Low.

### L7 — `const sb = () => getSupabaseBrowserClient()` duplicated in 26 data modules
- **Severity:** LOW · **Problem:** Identical accessor declared at the top of 26 `src/data/*` files. · **Impact:** Noise + a change point if the accessor ever needs auth-token plumbing (relevant to the cutover). · **Fix:** Export one shared `sb` from `data/_client.ts`. · **Effort:** S · **Risk:** Low.

### L8 — Percentage formatter re-declared per page
- **Severity:** LOW · **Problem:** `analytics.ts:86-88` exports `pct/pctStr/deltaPct`, yet identical local `pct`/`rate` are re-declared in `newsletter/page.tsx:14`, `analytics/newsletter/page.tsx:13`, `newsletter/campaigns/page.tsx:18`, `campaigns/[campaignId]/page.tsx:25`. · **Impact:** Rounding/empty-symbol drift risk. · **Fix:** Import `pctStr` (or move to `lib/utils`). · **Effort:** S · **Risk:** Low.

### L9 — `CriticalBadge` defined twice
- **Severity:** LOW · **Problem:** Identical `CriticalBadge` in `components/content/pills.tsx:29` and `components/ai/ai-pills.tsx:14`. · **Impact:** Two sources of truth for one token. · **Fix:** One shared badge. · **Effort:** S · **Risk:** Low. (Note: the per-domain `*-pills.tsx` files otherwise correctly delegate to one `<Badge>` primitive — not duplication.)

### L10 — Campaign "send synthetic event" silently no-ops when unauthenticated
- **Severity:** LOW · **Problem:** `newsletter/campaigns/[campaignId]/page.tsx:61` — `if (!token) return;` inside the dev action; the click does nothing with no feedback. · **Impact:** Confusing dead-click if the session lapsed (dev-only tool). · **Fix:** `setErr("Please sign in again.")`. · **Effort:** S · **Risk:** Low.

### L11 — Naming inconsistency: `services` (UI) vs `hotel_services` (DB); mixed `ai-*` prefixes
- **Severity:** LOW · **Problem:** UI/route use `services` while the table is `hotel_services` (11 `.from("hotel_services")`); AI module mixes `ai-config/ai-quality/ai-types/ai-preview` with un-prefixed `knowledge.ts`/`unanswered.ts`. · **Impact:** Extra cognitive mapping; grep/onboarding friction. · **Fix:** Document the `services ⇄ hotel_services` mapping; standardize AI filenames. · **Effort:** S · **Risk:** Low.

### L12 — v1 dead stub files still in the tree
- **Severity:** LOW · **Problem:** 0-byte `sync/airtable_fetch.js`, `sync/vector_upload.js`, `sync/sync_runner.js`, `scripts/create_vector_store.js` (planned v1 vector/RAG pipeline never built). · **Impact:** Implies a pipeline that doesn't exist; repo hygiene. · **Fix:** Delete the empty stubs. · **Effort:** S · **Risk:** Low.

### L13 — Untracked artifacts in the working tree
- **Severity:** LOW · **Problem:** `.claude/`, `dashboard/.claude/`, and a stray `usporedba_predmeta_AT.csv` sit untracked at repo root across sessions. · **Impact:** Working-tree noise; risk of accidental commit. · **Fix:** Add to `.gitignore` or remove. · **Effort:** S · **Risk:** Low.

### L14 — Future `<table>` overflow discipline (watch-item)
- **Severity:** LOW (pass with note) · **Problem:** The only native `<table>` (`content/rooms/page.tsx:64`) is correctly wrapped in `overflow-x-auto`; no fixed-width body-scroll offenders found. · **Impact:** None currently. · **Fix:** Keep wrapping any future `<table>` in an overflow container. · **Effort:** S · **Risk:** Low.

---

## Cluster 2 — Codebase Hygiene: result

**H2 RESOLVED** + repo hygiene (L12, L13). Dead code removed with **no observable behavior change**;
`npm run rc1` green (25 passed · 0 failed) before and after.

**Files removed (14 + 642 untracked):**
- Dead Dashboard scaffolding (10 files, closed dead island — proven zero live importers):
  `dashboard/src/mock/{data,provider,types}.ts`, `dashboard/src/hooks/use-dashboard.ts`,
  `dashboard/src/components/home/{greeting,kpi-card,quick-actions,today-card,requests-card,recent-activity}.tsx`
  (the empty `src/mock/`, `src/hooks/`, `src/components/home/` directories were removed).
- v1 empty stub scripts (L12, 0-byte, referenced nowhere):
  `sync/airtable_fetch.js`, `sync/vector_upload.js`, `sync/sync_runner.js`, `scripts/create_vector_store.js`
  (the empty `sync/` directory was removed).
- Repo hygiene (L13): **642 tracked `node_modules/` artifacts untracked** via `git rm -r --cached`
  (they remain on disk and were already covered by `.gitignore node_modules/` — only stale tracking removed).

**LOC removed:** **548** lines of dead application code (across the 10 Dashboard files) + 4 empty stub
files. Untracking `node_modules` dropped 642 stale artifacts (incl. the 1,105-line `.package-lock.json`)
from version control.

**Dependencies removed:** **none.** Every external import in the dead cluster (`lucide-react`,
`next/link`, `next/navigation`, `react`) is used by 34–90 other files, so no `package.json`
dependency became unused.

**Behavior verification:** full `npm run rc1` = 25 passed / 0 failed / 1 skipped (lint), incl. all
7 dashboard verify suites, 7 security audits, and 7 backend suites; typecheck + build clean; bundle
secret scan clean; no dangling imports (`@/mock`, `@/hooks/use-dashboard`, `@/components/home`, the
v1 stubs — all zero references post-deletion). No route, page, provider, or visible feature changed.
`server/server.js` and `pwa/` untouched; `main` remains `b158278`.

**Intentionally retained (not dead):**
- `dashboard/src/components/shell/module-placeholder.tsx` — still used by the `[...slug]` catch-all
  for not-yet-built routes.
- All dev-setup (`setup-dev-*.mjs`), `verify-*`, `security-audit-*` scripts and the gitignored
  `migration/antique-split/` fixtures — required by the RC1 gate.
- The frozen v1 `pwa/` (including its demo files and `pwa/icons/.gitkeep`) and `server/` — the RC1
  behavior freeze requires them unchanged; PWA demo cleanup is out of scope here.
- Empty root `README.md` — content file, not scaffolding.
- Duplicate helpers (`sb()` ×26, `pct`/`rate`, `CriticalBadge` — L7/L8/L9, M14) — **deferred** to a
  later cluster; consolidating them touches live component/data files and is kept out of this
  hygiene pass to preserve the behavior freeze.

## Cluster 3 — Performance: result

**H3, H4, H5 RESOLVED** (order: indexes → code-splitting → bounded queries). No responsive/UX,
schema, or RLS change. `npm run rc1` green (25 passed · 0 failed) after the work.

**H3 — Database indexes (migration `20260804090000_rc1_performance_indexes.sql`, forward-only, additive):**
- **54 indexes added** (177 → 231): **35** covering indexes for every unindexed foreign-key column
  (avoids seq-scan on parent DELETE + speeds joins), **5** composite/partial hot-path indexes
  (`guest_requests (hotel_id,status,created_at desc)`, `knowledge_articles (hotel_id,status,available_to_ai)`,
  `stays (hotel_id,status,arrival_at)`, `consents (hotel_id,stay_id)`, `assets (hotel_id) WHERE deleted_at IS NULL`),
  and **14** partial `legacy_airtable_record_id` indexes backing idempotent migration upserts (absorbs M1, M2).
- **Verified used:** all 54 are valid; under `enable_seqscan=off` every one is a live index-scan access
  path (0 fell back to seq-scan), 51 chosen by their own name for a single-column probe (the other 3 are
  covered by a pre-existing index on the same leading column and serve their multi-column queries).
- Plain `CREATE INDEX IF NOT EXISTS` (transaction-safe + idempotent); the migration notes that a large
  production table should use `CREATE INDEX CONCURRENTLY`.

**H4 — Code-splitting (BlockEditor lazy-loaded):**
- Added `components/content/block-editor-lazy.tsx` (`next/dynamic`, `ssr:false`, skeleton) and repointed the
  three editor routes. **First Load JS dropped ~19–20 kB each:** `/ai/knowledge/[articleId]` 230→**210 kB**,
  `/content/services/[serviceId]` 228→**209 kB**, `/newsletter/templates/[templateId]` 228→**209 kB**.
  One shared wrapper — no over-fragmentation. Browser-verified: the editor still mounts + renders content.

**H5 — Bounded queries (+ M6):**
- Added `.limit()`/server-side filters to every flagged unbounded fetch: `guests` (list `.limit(1000)` +
  satellites `.limit(2000)`), `reception` (`useRequests` `.limit(500)`; `useReceptionToday` stays filtered
  to `status in (reserved, checked_in)` + `.limit(2000)`, requests to open + `.limit(1000)`, consents
  `.limit(2000)`), `subscribers` `.limit(1000)`, `assets` `.limit(1000)`, `unanswered` `.limit(500)`,
  per-entity consent history `.limit(100)`. The reception/guest status filters are behavior-preserving
  (those hooks only ever consumed those statuses).
- **M6 fixed:** `useGuests` latest-stay lookup rebucketed into a `Map<guestId, Stay[]>` (O(N·M) → O(N+M)).
- **Cache review:** no change needed — every list key is hotel-scoped (`gk.guests`/`rk.today`/`rk.requests`/
  `subk.list`/`ak.assets`/`uqk.list`/`ck.consents`) so hotel switching refetches; per-entity keys use a
  unique id; `staleTime` 30 s + `refetchOnWindowFocus:false` + `invalidateQueries` already correct.
- Browser-verified: Guests, Reception Today, and the Services editor render identically; console clean.

**Also fixed (required to keep the gate green):** a pre-existing time-window flake in `verify-analytics.mjs`
— it computed "today" in UTC while the tz-aware refresh buckets by hotel timezone, so it failed between
22:00–24:00 UTC. Now computes the date in the hotel timezone (matches the refresh + production). Not a
performance change; a verification bug fix.

**Deferred (out of Cluster 3 / plan backlog):** list virtualization + cursor-pagination UI (M7), image
transforms (M8), chart memoization (L6) — these are follow-ups; the bounds above remove the unbounded-fetch
risk without a UX change.

## Cleared / positive assurance (investigated, no action — not counted)

- **RLS is fail-closed on every `public` table**; multi-tenant isolation is real; zero-policy tables are intentionally service-role-only (see L2).
- **56/56 SECURITY DEFINER functions set an explicit `search_path`** — the usual Supabase footgun is fully handled.
- **Natural-key uniqueness is enforced** via partial unique indexes (`service_categories/hotel_services/price_*/knowledge_categories` on `(hotel_id,key) WHERE hotel_id IS NOT NULL` + platform singletons; `ai_configs` one-per-hotel). The earlier "missing unique constraint" suspicion is **refuted** — these are valid `ON CONFLICT` targets.
- **React Query is correctly tuned** (`query-provider.tsx:12-14`: `staleTime 30s`, `refetchOnWindowFocus:false`, `retry:1`); every fetching hook has an `enabled` guard; multi-source hooks use `Promise.all`; search/activity/notifications cap rows.
- **Error/empty/loading states are near-universal** via shared `ErrorState/EmptyState/SectionLoader`; list pages distinguish "no data" vs "no filter match" with contextual CTAs. No empty `catch{}` anywhere.
- **Server-route auth is solid**: all 7 routes require a bearer JWT + `auth.getUser()`; private-upload/signed-url derive paths server-side and re-check via the caller's RLS client; MIME allowlist + magic-byte sniffing on uploads; fixed action→script allowlist on `migration/run` (no argv injection); `assertDevRef()` hard-pins migration to aiolly-dev.
- **Secrets**: the service-role key appears only in the 4 `nodejs` route handlers — never `NEXT_PUBLIC`, never in a `"use client"` file. No `dangerouslySetInnerHTML` (no XSS surface). State-changing routes are POST + bearer (not cookies) → classic CSRF N/A.
- **Charts and command palette are accessible** (`role="img"`/`aria-label`/`<title>`; cmdk + Radix Dialog + VisuallyHidden); native table wrapped in an overflow container.

---

## Recommended RC gate (do NOT action from this audit — planning only)

1. **B1** — rotate + scrub the leaked room token (must-fix before any launch).
2. **HIGH** — H1 mobile shell, H2 delete dead mock, H3 FK indexes, H4 code-split BlockEditor, H5 bound the list fetches, H6 add CI.
3. **MEDIUM** — index/grant/permission-consistency cluster (M1–M5), perf (M6–M8), a11y (M10–M11), then M9/M12–M16.
4. **LOW** — batch as cleanup PRs.

**Nothing in this document has been fixed.** This is an audit deliverable only.
