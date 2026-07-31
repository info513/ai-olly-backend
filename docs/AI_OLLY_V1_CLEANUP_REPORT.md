# AI OLLY — Repository Cleanup Report (pre-Platform 2.0)

> **Report only. Nothing has been deleted or changed.** These are candidates to review before Platform 2.0. Each item lists what it is, why it's flagged, and a recommendation — but no action is taken here.
> v1 (`v1.0.0-antique`) is frozen; this report is informational for the `feature/ai-olly-platform-2` cleanup discussion.
> Date: 2026-07-31.

## How to read this
- **Recommendation** is a suggestion, not an instruction. **Do not act without explicit approval.**
- Anything touching the guest PWA, QR/tokens, or production behaviour is marked **DO NOT TOUCH (frozen)**.

---

## 1. Empty stub files (imply an unbuilt layer)
| File | Size | Note | Recommendation |
|---|---|---|---|
| `scripts/create_vector_store.js` | 0 B | Empty — implies a RAG/vector setup that was never built | Remove, or keep as a placeholder for Phase 9 (vector) |
| `sync/airtable_fetch.js` | 0 B | Empty | Remove — Phase 1 replaces the sync concept entirely |
| `sync/sync_runner.js` | 0 B | Empty | Remove |
| `sync/vector_upload.js` | 0 B | Empty | Remove (Phase 9 will design retrieval fresh) |

*Impact of removal: none (no code imports them). They currently mislead readers into thinking a sync/vector pipeline exists.*

## 2. Dead PWA scaffolding (not referenced by `index.html`)
| Path | Size | Note | Recommendation |
|---|---|---|---|
| `pwa/home-v2.html` / `.css` / `.js` | ~56 KB | Prototype of the current Home; superseded once Home V2 shipped in the live shell | Archive/remove — verified not referenced |
| `pwa/home-menu-demo.html` / `.css` | ~20 KB | Standalone menu demo | Archive/remove |
| `pwa/mock/` (9 JSON fixtures) | — | Mock guest/hotel/POI/weather/split-today data | Archive/remove — live app uses the API, not these |
| `pwa/story/` | empty | Empty directory | Remove |

**DO NOT TOUCH:** `pwa/index.html`, `app.js`, `style.css`, `whispers-data.js`, `config.js`, `sw.js`, `manifest.json`, `icons/` — these are the frozen live PWA.

## 3. Second product in the repo (Cathedra)
| Path | Note | Recommendation |
|---|---|---|
| `cathedra/` (index.html, app.js, style.css) | A separate driving-school / exam product served at `/cathedra` + `/api/cathedra/*`, on its own Airtable base | **Decision needed** (see discovery §0): keep in-platform, leave as-is, or spin out to its own repo before 2.0 |
| `test-cathedra.mjs` (root, ~11 KB) | Cathedra test harness | Move under a `cathedra/` or `tests/` folder, or spin out with Cathedra |
| `usporedba_predmeta_AT.csv` (~37 KB, untracked) | Cathedra subject-comparison CSV; currently **untracked** in the working tree | Decide: gitignore, move into Cathedra, or remove — do not commit by accident |

## 4. Loose root files
| File | Note | Recommendation |
|---|---|---|
| `payload.json` (225 B) | Looks like a leftover request payload for manual testing | Review; likely remove or move to a `scratch/` (gitignored) area |
| `README.md` | Empty | Write a real README (repo purpose, run, deploy, link to `docs/`) |

## 5. Tests — orphaned from `npm test`
`npm test` runs only **3 of 12** test files (`fix-01-02`, `fix-03-filters`, `fix-04-routing`). Orphaned (present but not run): `fix-07`, `08`, `09`, `10`, `11`, `12`, `13`, `14`, `15`.
- **Recommendation:** wire all into a `test:all` script (or the default `test`) so the classifier/handler coverage actually runs in CI. No files to delete — just un-orphan them. New Round-1 handlers (extra bed, breakfast in-bed/bag, reception-help, arrival guard) have **no unit tests yet** — add them.

## 6. Duplicate / parallel logic
| Area | Duplication | Recommendation |
|---|---|---|
| Eval systems | `qa_eval/` (Python, local, 40 cases → `QA_EVAL`) **and** `scripts/run-evals.js` (JS, prod, → `AI_EVAL_TESTS`) | Consolidate to one (the JS prod runner is the active gate). Decide the Python set's fate. |
| Field-name fallbacks | `getHotelRecord` / room/POI/route mappers accept many alternate Airtable field names | Expected while on Airtable; **collapses naturally in Phase 1** when Postgres has fixed columns. |
| Contact card renderers | `renderHotelCoreAnswer` (full) vs `renderFocusedHotelCoreAnswer` (focused) | Keep both (different purposes); revisit if the full card is no longer used after reception-help handler. |

## 7. Airtable-coupled code (migration surface, not "dead")
Not dead — but the entire data-access layer in `server/server.js` (getHotelRecord, getRoomGuideRecord, getServicesForHotelPwa, POI/route mappers, the `TABLE_*` env constants, caching keyed by Airtable, the Airtable Content API signature upload, the 3 Airtable-Automation webhooks) is **the Phase 1 migration surface**. It should be **abstracted behind a data layer** (not deleted) so Supabase can swap in. Flagging here so it's planned, not surprised by.

## 8. Airtable base (informational — not a repo file, but relevant to cleanup)
Two tables in `appon9UYjX6KU9cr1` are **suspected legacy** (from earlier discovery): **`SERVICES (Out)`** (apparent duplicate/export of SERVICES) and **`Table 15`** (generic scratch table). **Do not delete** — confirm with the hotel/owner, then drop during the Phase 1 migration. Dev/QA tooling tables (`QA_EVAL`, `AI_EVAL_TESTS`, `AI_CONTENT_LINT`, `AI_TENANT_ONBOARDING`) also need a keep/migrate/drop decision.

## 9. Untracked working-tree items
| Item | Note | Recommendation |
|---|---|---|
| `.claude/` | Local tooling/agent config | Add to `.gitignore` (already partially ignored) if not meant to be committed |
| `usporedba_predmeta_AT.csv` | See §3 | Decide before it's accidentally committed |

---

## Summary of recommendations (all pending approval — nothing done)
1. **Safe to remove (no references):** 4 empty stubs (§1), dead PWA scaffolding (§2), `pwa/story/`.
2. **Decide scope:** Cathedra + its test/CSV (§3) — in/out/spin-out.
3. **Improve, don't delete:** un-orphan tests + add tests for new handlers (§5); write a README (§4); consolidate eval systems (§6).
4. **Plan, don't delete:** abstract the Airtable data layer for Phase 1 (§7); confirm-then-drop `SERVICES (Out)` / `Table 15` during migration (§8).
5. **Hygiene:** gitignore `.claude/` and resolve the untracked CSV (§9).

> **No files were deleted or modified by this report.** Await explicit approval before any cleanup, and keep all guest-PWA / QR / token / production behaviour frozen.
