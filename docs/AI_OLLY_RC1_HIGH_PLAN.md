# AI OLLY Platform 2.0 — RC1 HIGH Findings Execution Plan

**Analysis only. Nothing was fixed.** This plan sequences the six HIGH findings from
[AI_OLLY_RC1_AUDIT.md](AI_OLLY_RC1_AUDIT.md) as a dependency graph, groups them into
implementation clusters, and defines the order that minimizes duplicated work, regressions,
repeated testing, and repeated refactoring. The single BLOCKER (B1, leaked token) is already
scrubbed and is out of this plan's scope except as a driver for the CI secret-scan (Cluster 1).

The six HIGH findings:

| ID | Title | Subsystem owner |
|---|---|---|
| H1 | App shell not mobile-responsive (no drawer) | Dashboard · Shared shell / UX |
| H2 | ~550 LOC dead mock scaffolding still shipped | Dashboard · Developer Experience |
| H3 | 35 foreign-key columns unindexed | Supabase · Performance |
| H4 | No code-splitting (BlockEditor eager in 3 heaviest routes) | Dashboard · Performance (bundle) |
| H5 | Unbounded whole-table fetches (no `.limit()`) | Dashboard · Performance (data layer) |
| H6 | No CI pipeline / automated quality gate | Developer Experience |

---

## 1. Executive summary

The six HIGH findings are **not independent** — they resolve into **four clusters** with a clear
precedence. The optimal path front-loads the two lowest-risk, highest-leverage enablers (a **CI
safety net** and **dead-code removal**), then does the **Performance** work as one indexed→bounded→
split sequence, and finishes with the **Responsive shell** so its wide-blast-radius UI regression
runs exactly once against the final, stable dashboard.

Key couplings that drive the order:
- **H6 (CI) is a force-multiplier for verification.** Building it first makes every subsequent
  cluster's "regression run" automatic — the single biggest reducer of *repeated testing*.
- **H3 must precede H5.** Bounding/paginating the list queries (H5) only performs well if the
  supporting indexes (H3) already exist; doing H5 first would mean re-testing the same queries
  after H3 lands. Combine them (indexes → bounded queries) to avoid a second pass.
- **H2 should precede H1 and H4.** Removing dead scaffolding first keeps the shell (H1) and bundle
  (H4) analysis clean, so nobody refactors or measures dead code.
- **H1 is best last.** It changes shell chrome on *every* route (MEDIUM blast radius) but touches no
  data/business logic; doing it after the content is stable means one responsive regression instead
  of re-checking responsiveness after every later change.

Net effect: **1 BLOCKER (done) + 6 HIGH closed, ~6 MEDIUM and ~3 LOW absorbed as hidden impact**,
moving RC1 from *desktop-only / unbounded / ungated* to *responsive / bounded+indexed / CI-gated*.

---

## 2. Dependency graph

```
                 ┌──────────────────────────────────────────────┐
                 │  H6  CI / safety net  (Cluster 1)             │  enables cheap,
                 │  depends on: none                            │  repeatable
                 └───────┬───────────────┬───────────┬──────────┘  verification for
                soft ↓   │        soft ↓  │   soft ↓   │  soft ↓     ALL clusters
        ┌────────────────▼───┐   ┌────────▼───┐  ┌─────▼──────┐  ┌──▼───────────┐
        │ H2 dead-code       │   │ H3 indexes │  │ H4 split   │  │ H1 shell     │
        │ (Cluster 2)        │   │            │  │            │  │ (Cluster 4)  │
        │ depends: none      │   │ depends:   │  │ depends:   │  │ depends:none │
        └───────┬─────┬──────┘   │ none       │  │ none       │  └──────────────┘
         soft ↓ │     │ soft ↓   └─────┬──────┘  └────────────┘         ▲
       (clean   │     │ (clean         │ HARD ↓ (queries need indexes)  │ best done
        bundle) │     │  shell)        │                                │ LAST (widest
                ▼     ▼                ▼                                 │ UI blast
             H4 ◄─────┘             H5 bounded fetches                   │ radius; one
        (Cluster 3 ── Performance: H3 → H4 → H5) ────────────────────────┘ final pass)
```

Legend: **HARD** = must precede (correctness/performance). **soft** = should precede (avoids
duplicated work / rework), not a correctness blocker.

### Per-finding dependency matrix

| Finding | Root cause | Depends ON | Depended-on BY | Hidden impact if fixed | Effort | Regression risk | Independent? |
|---|---|---|---|---|---|---|---|
| **H6** CI | No CI ever set up; suites run manually | — | H2,H3,H4,H5,H1 (soft: cheap verify) | Absorbs **M15** (tests) + a **pre-commit secret scan** that would have caught **B1**; catches future regressions | M | LOW | YES (foundational) |
| **H2** dead code | Pre-real-Home scaffolding never deleted | — (H6 soft) | H4, H1 (soft: clean baseline) | Removes ~548 LOC; slightly lowers H4 bundle baseline; absorbs **L12** (v1 stubs), **L13** (untracked) | XS–S | LOW | YES |
| **H3** FK indexes | RLS-first schema shipped without covering FK indexes | — | **H5 (HARD)** | Absorbs **M1** (composite indexes), **M2** (legacy-id indexes) if done in one migration; speeds cutover | S–M | LOW | YES |
| **H4** code-split | No `next/dynamic` anywhere; BlockEditor eager | — (H2 soft) | — | Frees ~40–45 kB on 3 editor routes; adjacent to signature-pad + framer-motion splits | S | LOW–MED | YES |
| **H5** unbounded fetch | List hooks fetch whole tables, filter in JS | **H3 (HARD)** | — | Editing `guests.ts` fixes **M6** (O(n²) join) in place; pagination reduces need for **M7** (virtualization); touching `assets.ts` enables **M8** (image transforms) | M–L | MEDIUM | **NO** → parent = Performance cluster |
| **H1** mobile shell | Sidebar always rendered, fixed width, no drawer | — (H2 soft) | — | Adjacent to LOW nav/top-bar polish; unlocks tablet/phone use | M | MEDIUM | YES (own UX cluster) |

---

## 3. Cluster analysis

### Cluster 1 — Developer Experience & Safety Net
- **Purpose:** Establish an automated quality gate so every later cluster is verified cheaply and no regression lands silently. This is the precondition that makes "verify after each cluster" free.
- **HIGH included:** H6. **Absorbs:** M15 (unit/E2E + CI-isolated DB for the integration suites), pre-commit secret scan (prevents B1-class leaks), L13 (untracked artifacts).
- **Dependencies:** None. Must be green on current `feature/ai-olly-platform-2` before proceeding.
- **Recommended internal order:** (1) CI workflow running `typecheck` + `build` + the source-inspection security audits (no DB) — immediate value; (2) provision an isolated/ephemeral CI Supabase project and point the `verify-*`/`security-audit-*`/backend `step*` suites at it (removes the "suites mutate shared dev" risk); (3) add a secret-scan pre-commit hook + CI step.
- **Regression risk:** LOW — additive tooling; cannot change app runtime.
- **Estimated effort:** M (S for the no-DB gate; the isolated CI DB is the M part).
- **Expected improvement:** Repeatable one-command/auto verification; secret leaks blocked at commit; regression insurance for Clusters 2–4.
- **Verification strategy:** CI passes on an untouched checkout of the current branch; deliberately introduce a trivial type error locally to confirm the gate fails.
- **Rollback complexity:** Trivial — delete the workflow/hook files; no runtime impact.

### Cluster 2 — Codebase Hygiene
- **Purpose:** Remove dead/misleading surface *before* the performance and shell work, so no effort is spent measuring or refactoring code that ships to nobody.
- **HIGH included:** H2. **Absorbs:** L12 (0-byte v1 `sync/*` + `create_vector_store.js`), L13.
- **Dependencies:** Cluster 1 (soft — its removal is validated automatically by the new gate).
- **Recommended internal order:** Delete `src/mock/`, `src/hooks/use-dashboard.ts`, `src/components/home/*`; delete v1 dead stubs; `tsc --noEmit` + build.
- **Regression risk:** LOW — verified zero live importers in the audit.
- **Estimated effort:** S.
- **Expected improvement:** −~548 LOC; a reviewer/agent can no longer mistake `mock/provider` for a live path; marginally smaller H4 baseline.
- **Verification strategy:** CI green (typecheck + build) + a grep confirming no dangling `@/mock` / `@/components/home` / `@/hooks/use-dashboard` imports remain.
- **Rollback complexity:** Trivial — single `git revert` of one deletion commit.

### Cluster 3 — Performance (indexes → bundle → bounded data)
- **Purpose:** Make data access fast and bounded end-to-end, and shed first-load JS on the heaviest routes — solved together so the whole dashboard gets **one** performance regression pass instead of three.
- **HIGH included:** H3, H4, H5. **Absorbs:** M1, M2 (composite/legacy-id indexes), M6 (O(n²) `useGuests`), M7 (virtualization → largely obviated by pagination), M8 (image transforms), L5 (drift-fix opportunity), L6 (chart memo).
- **Dependencies:** Internal **H3 → H5 (hard)**; H4 independent; Cluster 2 (soft — clean bundle baseline).
- **Recommended internal order:**
  1. **H3 (+ M1/M2)** — one additive migration: `CREATE INDEX CONCURRENTLY` on the 35 FK columns + the missing composite/partial indexes + the 14 legacy-id indexes. Zero-risk, and it unblocks H5.
  2. **H4** — dynamic-import BlockEditor (one change covers all three editor routes); optionally signature pad + framer-motion. Quick, isolated win; re-measure bundle.
  3. **H5** — add `.limit()`/pagination and push date/status filters server-side across the ~6 offending hooks; fold M6 into the `guests.ts` edit and M8 into `assets.ts`. Riskiest step, done last so it lands on already-indexed queries and gets the final regression.
- **Regression risk:** LOW (H3, H4) → **MEDIUM (H5** — changes query semantics/row counts and list UX).
- **Estimated effort:** L (H3 S–M + H4 S + H5 M–L + absorbed MEDIUMs).
- **Expected improvement:** Query latency on list/detail + AI-serving paths; ~40–45 kB off editor routes; removal of the production scaling cliff (unbounded downloads); faster GDPR/parent deletes.
- **Verification strategy:** `EXPLAIN (ANALYZE)` on the hot queries pre/post to confirm index use; bundle-size diff from `next build`; **per-list data-count re-verification** (paginated results must match previous totals) via the existing `verify-*` suites; full dashboard regression (all `verify-*` + `security-audit-*` + backend `step*`).
- **Rollback complexity:** LOW–MEDIUM — indexes drop cleanly (`DROP INDEX CONCURRENTLY`); H4 and per-hook H5 changes revert file-by-file; keep H5 behind a small pagination flag if extra caution is wanted.

### Cluster 4 — Responsive Shell / UX
- **Purpose:** Make the dashboard usable on tablet/phone. Isolated to the shell chrome; done last so its cross-route responsive regression runs once against the final DOM.
- **HIGH included:** H1. **Absorbs:** LOW nav/top-bar polish.
- **Dependencies:** Cluster 2 (soft — dead `components/home` gone); best sequenced after Cluster 3 so content is stable.
- **Recommended internal order:** `hidden md:flex` the `<aside>`; render it as a Radix Dialog/Sheet drawer toggled by a hamburger added to `TopBar`; keep the existing collapse behavior for `md+`.
- **Regression risk:** MEDIUM — shell-wide; every route's layout is affected (but no data/logic).
- **Estimated effort:** M.
- **Expected improvement:** Unlocks reception/tablet/phone usage — the dashboard stops being desktop-only.
- **Verification strategy:** Browser regression at 375 / 768 / 1280 px (and dark mode) across every top-level route; console clean; keyboard focus trap on the drawer.
- **Rollback complexity:** LOW — changes confined to `layout.tsx`, `app-sidebar.tsx`, `top-bar.tsx`; single revert.

---

## 4. Prioritization (business impact ↓ technical risk ↓ effort ↓ regression risk)

| Rank | Cluster | Business impact | Technical risk | Effort | Regression risk | Why here |
|---|---|---|---|---|---|---|
| 1 | **DX / Safety Net** (H6) | Indirect but highest leverage | Low | M | LOW | Without the gate, every later cluster pays *repeated manual testing* — the exact cost we're minimizing. Cheapest insurance; also lands the secret-scan that closes the B1 recurrence risk. |
| 2 | **Hygiene** (H2) | Low direct, high clarity | Low | S | LOW | Trivial and low-risk; shrinks the surface the two big clusters operate on so no effort is wasted on dead code. Natural quick win once CI exists. |
| 3 | **Performance** (H3,H4,H5) | **Highest** — removes the production scaling cliff + biggest UX-latency/bundle wins | Medium (concentrated in H5) | L | LOW→MED | Greatest technical + scaling business value, but H5 carries the real risk — so it runs *after* the safety net + hygiene, with internal order front-loading the zero-risk wins (indexes, split) before the risky bounded-fetch refactor. |
| 4 | **Responsive Shell** (H1) | High (mobile/tablet enablement) | Medium (wide UI blast radius) | M | MED | Orthogonal to data/logic and widest-reaching UI change → verified once at the end against the stable, optimized dashboard, avoiding responsive re-tests after every earlier change. |

**Why not lead with the user-visible mobile fix (H1)?** Because H1's value is preserved regardless
of order, but its *cost* (a full-route responsive regression) multiplies if done early — every
later change would reopen it. Leading with the invisible-but-foundational CI gate minimizes total
testing across the whole program.

---

## 5. Execution order

```
Cluster 1  DX / Safety Net (H6 + secret-scan + CI-isolated DB)
   ↓  VERIFY — CI green on untouched branch; forced-failure smoke test
Cluster 2  Codebase Hygiene (H2 + dead stubs)
   ↓  VERIFY — CI: typecheck + build + full verify/audit suites; no dangling imports
Cluster 3  Performance  →  H3 (indexes)  →  H4 (code-split)  →  H5 (bounded data)
   ↓  VERIFY — EXPLAIN(ANALYZE) on hot queries; bundle diff; per-list count re-verify;
              full regression (all verify-* + security-audit-* + backend step*)
Cluster 4  Responsive Shell (H1)
   ↓  VERIFY — multi-viewport browser regression (375/768/1280 + dark), all routes, console clean
   ↓
RC1 sign-off
```

Every cluster ends with its **own** regression run; from Cluster 2 onward those runs are the
automated CI gate established in Cluster 1.

---

## 6. Regression strategy

- **Baseline:** capture the green state before Cluster 1 (all suites currently pass: ~205 dashboard
  checks, 542 backend, typecheck + build; migration audit 33/0/0 after B1 scrub).
- **Gate (every cluster):** `typecheck` → `build` → `verify-{content,ai,reception,assets,newsletter,
  analytics,migration}` → `security-audit-{…}` → backend `verify:supabase:*`. Automated by Cluster 1.
- **Cluster-specific add-ons:**
  - Cluster 3: `EXPLAIN (ANALYZE)` before/after on the hot queries (index use); `next build`
    route-size diff; **data-count parity** — paginated list totals must equal pre-change counts.
  - Cluster 4: scripted browser pass at 3 breakpoints + dark mode across all top-level routes;
    keyboard focus-trap check on the drawer; console-error assertion.
- **Isolation:** run DB-backed suites against the **CI/ephemeral** Supabase project (Cluster 1
  output), never shared `aiolly-dev`, so a suite run can't collide with manual dev use.
- **No merge to `main`** until the final RC1 sign-off; all work on `feature/ai-olly-platform-2`.

## 7. Rollback strategy

- **Granularity:** one cluster = one small stack of focused commits/PRs; revertable independently.
- **Cluster 1:** delete workflow/hook files — zero runtime impact.
- **Cluster 2:** single `git revert` restores the deleted files.
- **Cluster 3:** indexes drop with `DROP INDEX CONCURRENTLY` (additive, reversible); H4 dynamic
  imports revert per route; **H5 is the only semantic-risk change** — stage it per-hook and/or behind
  a pagination flag so a single hook can be rolled back without reverting the cluster.
- **Cluster 4:** revert the 3 shell files.
- **Ordering safety:** because H3 precedes H5, rolling back H5 leaves the (harmless, additive) indexes
  in place — no coupled rollback needed.

## 8. Estimated total effort

| Cluster | HIGH | Cluster effort (XS–XL) |
|---|---|---|
| 1 DX / Safety Net | H6 | **M** |
| 2 Hygiene | H2 | **S** |
| 3 Performance | H3+H4+H5 (+~5 MEDIUM) | **L** |
| 4 Responsive Shell | H1 | **M** |
| **Program total** | 6 HIGH (+ ~6 MEDIUM, ~3 LOW absorbed) | **≈ L–XL** (order-of-magnitude ~6–10 engineer-days incl. absorbed MEDIUMs and verification) |

## 9. Expected RC1 quality improvement

- **Security/process:** BLOCKER already closed; CI + pre-commit secret scan prevent recurrence.
- **Reliability:** automated regression gate replaces manual discipline; DB suites isolated from dev.
- **Performance:** hot queries indexed (list/detail + AI-serving), FK-delete/GDPR paths no longer
  seq-scan; ~40–45 kB shed on the 3 editor routes; list downloads bounded → production scaling cliff
  removed. Absorbs M1/M2/M6/M7/M8.
- **Reach:** dashboard becomes usable on tablet/phone (was effectively desktop-only).
- **Maintainability:** ~548 LOC of dead scaffolding + v1 stubs removed; cleaner module boundaries.
- **Coverage delta:** **6/6 HIGH closed, ~6 MEDIUM + ~3 LOW absorbed for free**, with the residual
  MEDIUM/LOW backlog reduced to genuinely independent polish items.

## 10. Recommended stopping point before RC1 release

- **Minimum technical bar (internal RC candidate):** through **Cluster 3 verify** — B1 (done) + the
  DX gate + hygiene + all Performance HIGHs. At this point the platform is *correct, bounded, indexed,
  and gated*. Acceptable to tag an **internal** RC only if the target launch is desktop-first.
- **True RC1 release bar:** complete **Cluster 4** and its multi-viewport verify. **Do not ship RC1
  with H1 open** if reception/staff will use tablets or phones — mobile-unusable is a release-blocking
  UX gap for a concierge product.
- **Hard gate:** RC1 sign-off only after the Cluster 4 regression run is green **and** B1's remaining
  owner actions (rotate room-201 token in Airtable, purge from git history) are confirmed done — the
  repo scrub alone does not invalidate the exposed credential.

---

*Analysis only — no code, schema, migration, dashboard, or existing documentation was modified.*
