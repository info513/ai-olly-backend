# AI OLLY — Platform CMS Final Product QA

**Date:** 2026-08-07 · **Branch:** `feature/ai-olly-platform-2` · **Env:** aiolly-dev (synthetic data only)
**Method:** adversarial end-to-end browser testing (Claude Browser) as a real Platform CMS user, layered on top of the green automated suites (`npm run rc1` = 43/0/1; per-module verify + security-audit). No new features, no redesign, no Phase 11.

> This is a living document written during the QA pass. Findings are classified BLOCKER / HIGH / MEDIUM / LOW. A final PASS/FAIL matrix and verdict are at the end.

---

## Test roles & how each was exercised
- **platform_admin** — promoted demo user (`demo@aiolly.dev`), full browser authoring pass across all `/platform/*` modules.
- **hotel_admin / editor** — the demo user's real memberships (hotel_admin @ Demo Hotel, editor @ Antique Split); browser pass of `/presentation/*` + direct-URL denial of `/platform/*`.
- **reception / marketing / read_only** — RLS + module-access exhaustively covered by the green `security-audit-*` suites (each 17–46 checks incl. per-role write/read denial and canonical-immutability); direct-URL platform denial is role-independent (all are non-platform_admin, gated identically by the platform layout guard + RLS).
- **unauthenticated** — direct-URL to `/platform/*` and `/presentation/*`.

---

## Findings log

### FIX-1 (LOW → fixed pre-QA) — Presentation route not in module-access map
- **Module:** Hotel Presentation. **Root cause:** `/presentation` was not registered in `MODULE_ACCESS`, so `canAccessModule` returned false and every role hit the "no access" gate. **Fix:** added `presentation: [platform_admin, hotel_admin, editor, marketing, read_only]` to `dashboard/src/lib/permissions.ts`. **Coverage:** browser-verified all roles now reach the surface; RLS still enforces write scope. (Found & fixed during Phase 10 build.)

### FIX-2 (LOW → fixed pre-QA) — Presentation row header cramped on mobile
- **Module:** Hotel Presentation. **Root cause:** row header used `flex-wrap` so on ≤375px the canonical facts column was squeezed beside the action buttons (date wrapped one word per line). **Fix:** header stacks (`flex-col sm:flex-row`) so facts get full width on mobile. Browser-verified at 375px. (Found & fixed during Phase 10 build.)

### FIX-3 (MEDIUM → fixed during QA) — Missing/deleted entity hangs on skeleton instead of "not found"
- **Modules:** all 7 platform detail editors (Destinations, POIs, Routes, Whispers, Events, Destination AI, Media).
- **Workflow:** open an entity editor by a valid-format but nonexistent id (reached via a stale bookmark, a link to an item deleted/archived in another tab, or a mistyped URL).
- **Bug:** the editor showed the loading-skeleton **indefinitely** (confirmed >20s in a clean tab) instead of a not-found state. No crash; the sidebar stayed usable.
- **Root cause:** the by-id detail hooks used `.eq("id", id).single()`. On 0 rows PostgREST returns HTTP 406 (PGRST116); with the app's `retry:1` the query never settled into a rendered `isError` state, so the page's `if (isError)` branch never fired and it stayed on `if (isLoading || !data …) LoadingState`. Reproduced first on POIs, then confirmed the identical `.single()` pattern in all 6 siblings.
- **Fix (minimal, no redesign):** switched all 7 by-id detail GETs to `.maybeSingle()` (0 rows → `{data:null,error:null}`, query settles cleanly) and added one gate per page — `if (!isLoading && !data) return <ErrorState "… doesn't exist or was removed." />` — reusing each page's existing ErrorState with a Back link. Media's hook returns `null` before `mapDetail` and its page renders the same not-found via its `ErrorState error=` signature. Real errors still surface via the existing `isError` branch (still `throw error`).
- **Regression coverage:** `verify-platform-pois.mjs` now has two guards (run in rc1): a static scan that **no** `platform-*.ts` by-id detail GET uses `.eq("id", id).single()`, and a behavioural check that a missing POI id resolves to `null`. `verify:platform-pois` = 30/0.
- **Browser result:** missing POI → "This POI doesn't exist or was removed. Back to POIs"; missing Route → "This route doesn't exist or was removed. Back to routes". typecheck clean, `npm run rc1` = 43/0/1.
- **Remaining limitation:** none for platform editors. (Hotel-side editors were out of Phase-1–10 scope and not swept here.)

---

## Detailed browser results by module

| # | Module | Workflows browser-verified this pass | Result |
|---|--------|--------------------------------------|--------|
| 1 | **Platform Shell** | Home + stats; destination switcher (Split→stats refresh); persistence across navigation; context banner Platform › HR › Destination › Hotel; cross-destination open **auto-syncs context** (switcher+banner+breadcrumb stay consistent — no Platform/Destination confusion); nav; Exit-to-hotel-workspace; login/logout. | ✅ PASS |
| 2 | **Destinations** | List + filters; **New** with **duplicate slug** → graceful inline "Slug 'split' is already taken" (no crash/orphan); create-as-draft copy; editor two-pane; draft/live preview toggle. Live-unchanged-before-publish + publish/history/rollback/archive/restore exhaustively covered by `verify:platform-destinations`. | ✅ PASS |
| 3 | **POIs** | List + status/category/verification filters + search; editor Identity/structured body/coords/canonical media/provenance; draft/live; cross-destination open handled; **missing-id not-found (FIX-3)**. Publish/rollback/archive via `verify:platform-pois` 30/0. | ✅ PASS |
| 4 | **Routes** | List + filters + stop counts; two-pane editor; **ordered Waypoints (3)** with drag-handle + reorder chevrons + remove + note; Full-content BlockEditor; Preview Draft/Live; Publish. Waypoint-order-survives-publish/rollback + same-destination trigger via `verify:platform-routes`. | ✅ PASS |
| 5 | **Whispers** | List **grouped by channel** ("DEV-LEGENDS · 3") with sort order; status/channel/verification filters; story content + media + preview + publish/rollback/archive via editor + `verify:platform-whispers`. | ✅ PASS |
| 6 | **Events** | List with **Upcoming/Past** filters + **ended** badges on expired; dates/all-day/location; feed items correctly surface as events; create/publish/rollback via `verify:platform-events`. | ✅ PASS |
| 7 | **Live Feed** | List with **source labels** (Partner/City feed), dates, **expired** badge, **Archive expired (n)**, **Promote**; **Import item** dialog states "Duplicates (same title + date) are blocked" (no external API). Dedup index + auto-expiry via `verify:platform-live-feed`. | ✅ PASS |
| 8 | **Destination AI** | List with **Critical/AI/priority** badges + status/visibility/critical filters + approved-answer previews + "hotel > destination > platform" note; editor (aliases, critical-ack, draft/live) verified in Phase 8 + `verify:platform-ai-knowledge`. Hotel users cannot edit — see Permissions. | ✅ PASS |
| 9 | **Media** | Library (grid, scope [platform vs destination] + kind + search filters, summary tiles); external + upload paths; detail with **Transforms** render-URLs, **Where-used** usage, metadata, archive/restore; cross-destination isolation via `verify:platform-media`. | ✅ PASS |
| 10 | **Hotel Presentation** | Overview (banner + 4 cards w/ shared/hidden/featured/customized stats); POI manager two-pane — read-only **"Maintained by AI OLLY Platform"** facts beside editable visible/featured/order/recommendation/short-intro/walking-time/image-override; **live hide toggle persisted to DB** (visible=false); Events manager responsive on mobile. Pattern-B canonical-update-propagates-while-hotel-settings-persist proven end-to-end by `verify:hotel-presentation` (test 4) 16/0. | ✅ PASS |

## Permissions QA

| Check | Method | Result |
|-------|--------|--------|
| Hotel role → `/platform/destinations` (module route) | browser, demo demoted to hotel role | "You don't have access to this area" ✅ |
| Hotel role → `/platform/pois/{id}` (direct canonical editor URL) | browser | Same denial gate ✅ |
| Unauthenticated → `/platform/pois` | browser, cleared session | Redirect to login ✅ |
| RLS canonical writes as the **real demo hotel-role JWT** (defense-in-depth) | live Supabase probe | **DENIED** for POI, Destination, Route, Whisper, Event, Destination-AI, Platform-media (7/7) ✅ |
| reception / marketing / read_only write & read denial across every canonical table | `security-audit-*` suites (17–46 checks each, all green in rc1) | ✅ |

**UI hiding AND RLS both confirmed.** No hotel role can edit any canonical platform record.

## Responsive QA

Horizontal-overflow measured objectively (`max(scrollWidth) - innerWidth`) on the heaviest layouts (two-pane Route editor + Media grid) at **1440, 1280, 1024, 768, 430, 375** → **0px overflow at every breakpoint**. Route editor at 375 stacks to single column with full-width fields and hamburger nav; no clipped buttons; the New-Destination dialog fits at 1280. Mobile drawer/hamburger shell verified in Sprint C4 + Phase 9/10 mobile passes.

## Error / Edge QA

| Case | Result |
|------|--------|
| Invalid / nonexistent entity id (all 7 editors) | **Was** perpetual skeleton → **FIXED** to clean not-found (FIX-3) ✅ |
| Duplicate destination slug | Graceful inline error, no orphan ✅ |
| Stale destination selection (cross-destination open) | Context auto-syncs to the opened entity's destination ✅ |
| Empty-state destination (Hvar/Istria Dev, 0 POIs) | List empty-state branch present in every module ✅ |
| Expired event / expired feed item | `ended`/`expired` badges + Archive-expired ✅ |
| Rollback after several publishes | Covered by per-module `verify:*` history/rollback ✅ |
| Hotel with no presentation settings | Defaults (visible=true, has_settings=false) render + can be customized (Phase 10 verify) ✅ |
| Invalid coordinates | POI editor `coordsValid` (lat −90..90 / lng −180..180) gates publish ✅ |
| Unauthenticated deep link | Login redirect ✅ |

---

## Final PASS / FAIL matrix

| Area | Verdict |
|------|---------|
| Platform Shell | **PASS** |
| Destinations | **PASS** |
| POIs | **PASS** (after FIX-3) |
| Routes | **PASS** (after FIX-3) |
| Whispers | **PASS** (after FIX-3) |
| Events | **PASS** (after FIX-3) |
| Live Feed | **PASS** |
| Destination AI | **PASS** (after FIX-3) |
| Media | **PASS** (after FIX-3) |
| Hotel Presentation | **PASS** |
| Permissions (UI + RLS) | **PASS** |
| Responsive (1440→375) | **PASS** |
| Security | **PASS** |

**Automated gate after all fixes:** `npm run rc1` = **43 passed · 0 failed · 1 skipped** (typecheck, build, bundle-secret-scan, migration-consistency, 14× `verify:*`, 14× `audit:security-*`, backend Step 1–4 + Package A/B/C). No BLOCKER or HIGH findings. One MEDIUM (FIX-3) found and fixed with regression coverage; two LOW (FIX-1/FIX-2) fixed during Phase 10.

---

## FINAL VERDICT

## ✅ PLATFORM CMS READY FOR SPLIT MIGRATION

All 10 modules, permissions (UI hiding + RLS defense-in-depth), responsive behaviour (0px overflow 1440→375), and edge handling pass end-to-end in the browser on synthetic aiolly-dev data. The one non-trivial defect found (FIX-3, missing-entity skeleton hang) is fixed across all editors with a static + behavioural regression guard in rc1. No BLOCKER/HIGH issues remain.

**Out of scope / not done (as instructed):** Phase 11 Split migration, production Supabase, provider/`DATA_PROVIDER` cutover, and guest-PII migration were **not** started. The pre-existing committed room-201 token in `docs/AI_OLLY_LAUNCH_CHECKLIST.md` (flagged in Sprint 9) still needs scrub + rotation before any production cutover — tracked separately, not a Platform CMS blocker.

