# AI OLLY Platform 2.0 — RC1 Development Pipeline

The automated quality gate (RC1, Cluster 1). Every push and PR to
`feature/ai-olly-platform-2` runs the **same** verification developers run locally, so a
regression cannot land unproven. **Nothing is deployed** by this pipeline.

- **CI:** `.github/workflows/rc1.yml` → runs `npm run rc1`.
- **Local:** `npm run rc1` (identical stages; this is the single source of truth,
  `scripts/rc1.mjs`).

## Pipeline stages

Static stages **always** run (no secrets needed). Integration stages run only when Supabase/
Airtable secrets are configured; otherwise they **skip gracefully** and print why.

| # | Stage | Kind | Fails the gate when… |
|--:|---|---|---|
| 1 | `typecheck` | static | `tsc --noEmit` reports a type error |
| 2 | `lint` | static | ESLint rules fail — **skipped** while ESLint is unconfigured (`next.config.js: eslint.ignoreDuringBuilds`) |
| 3 | `build` | static | `next build` fails (uses placeholder public env if none) |
| 4 | `bundle-secret-scan` | static | a service-role JWT / API key / DB URI appears in `dashboard/.next/static` |
| 5 | `migration-consistency` | static | a migration filename is malformed, timestamps collide/reorder, or a file is empty |
| 6–12 | `verify:{content,ai,reception,assets,newsletter,analytics,migration}` | integration | any dashboard verify suite fails |
| 13–19 | `audit:{security,security-ai,security-reception,security-assets,security-newsletter,security-analytics,security-migration}` | integration | any dashboard security audit fails |
| 20–26 | `backend:{Step 1..4, Package A, B, C}` | integration | any backend Supabase suite fails |
| CI-only | lockfile integrity | static | `npm ci` changed `package-lock.json` / `dashboard/package-lock.json` |
| CI-only | no generated-code drift | static | the pipeline modified any tracked source file (`node_modules` excluded) |

The full stage plan is printable at any time: `npm run rc1:list`.

## Quality gates (the workflow fails if any of these are true)

- typecheck fails · build fails · any verify script fails · any security audit fails
- a secret appears in the client bundle · migrations are inconsistent
- the package lock changed unexpectedly · generated/tracked source code drifted
- formatting/lint rules fail *(once ESLint is configured; currently skipped)*

## Required GitHub Secrets

Configure under **Settings → Secrets and variables → Actions**. If absent, integration stages
skip and only the static gate runs (safe for forked PRs).

| Secret | Used by | Notes |
|---|---|---|
| `SUPABASE_URL` | verify/audit + backend suites | dev project URL |
| `SUPABASE_ANON_KEY` | suites + build | public anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | suites (server-side only) | **never** exposed to the browser |
| `SUPABASE_DB_URL` | suites (direct `pg`) | Postgres connection string |
| `SUPABASE_DB_PASSWORD` | optional | if separate from `SUPABASE_DB_URL` |
| `AIRTABLE_API_KEY` | `verify:migration`, `audit:security-migration` | **read-only** PAT |
| `AIRTABLE_BASE_ID` | migration suites | Antique Split base id |
| `OPENAI_API_KEY` | backend suites (if referenced) | server-side only |
| `BREVO_API_KEY` | newsletter (boundary is "not configured") | optional |
| `NEXT_PUBLIC_SUPABASE_URL` | build | defaults to `SUPABASE_URL` if unset |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | build | defaults to `SUPABASE_ANON_KEY` if unset |

**Point these at a non-production Supabase project (dedicated CI or dev — never production).**
The suites create + clean up synthetic data. The migration suites are additionally hard-pinned to
the `aiolly-dev` ref and refuse any other project.

Nothing is hardcoded: the service-role key, Airtable key, OpenAI key, Brevo key, and DB password
live only in GitHub Secrets (CI) or the local gitignored `.env` (dev).

## Required environment (how the scripts read secrets)

The verify/audit/backend scripts read a repo-root **`.env`**; the dashboard build reads
**`dashboard/.env.local`**. CI synthesizes both from the secrets above at run time (only when
`SUPABASE_DB_URL` + `SUPABASE_SERVICE_ROLE_KEY` are present). Locally, your existing `.env` /
`dashboard/.env.local` are used as-is.

Keys the scripts expect in `.env`: `SUPABASE_URL`, `SUPABASE_ANON_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_DB_URL`, `AIRTABLE_API_KEY`, `AIRTABLE_BASE_ID`,
`DATA_PROVIDER=airtable`. In `dashboard/.env.local`: `NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`.

## Local execution

```bash
npm run rc1          # full gate — identical to CI
npm run rc1:static   # static stages only (no secrets / DB needed)
npm run rc1:list     # print the stage plan + detected secrets, then exit
```

Prerequisites: `npm ci` at the repo root **and** in `dashboard/` (both are installed in CI).
For the full gate, a valid `.env` (+ `dashboard/.env.local`) pointing at a dev Supabase project,
and — for the two migration stages — the local export/normalize artifacts
(`migration/antique-split/…`, produced by `node scripts/migration/export-airtable-antique.mjs`
then `normalize-antique.mjs`). Without those, the migration stages skip with a clear reason.

## Expected execution time

| Context | Time |
|---|---|
| Static gate (`rc1:static`) | ~15–20 s (typecheck + build + 2 scans) |
| Full local gate (`rc1`, warm) | **~5–6 min** (measured 347 s: build ~12 s, 14 dashboard suites ~3 min, 7 backend suites ~2.5 min) |
| CI (cold) | ~7–10 min incl. `npm ci` for two packages (npm cache reduces this) |

## Pass / fail criteria

- **PASS:** every *run* stage passed. Skipped integration stages (no secrets / no migration
  artifacts) do **not** fail the gate; the reason is printed. Exit code `0`.
- **FAIL:** any run stage failed. The last ~25 lines of each failed stage are printed for
  triage. Exit code `1` — CI marks the check red and blocks the merge.

## Troubleshooting

- **Integration stages all SKIP.** No `.env` (or missing `SUPABASE_DB_URL`/`SERVICE_ROLE_KEY`).
  Locally: create `.env`. In CI: add the GitHub Secrets. This is expected on forked PRs.
- **`verify:migration` / `audit:security-migration` SKIP.** The local
  `migration/antique-split/manifests/export-manifest.json` (+ `normalized/tokens.local.json`)
  are absent — run the export + normalize scripts first. CI skips these unless the artifacts are
  provisioned (they are gitignored, so they are not present in a clean checkout by design).
- **`bundle-secret-scan` FAIL.** A secret reached `dashboard/.next/static`. Move the usage to a
  server-only route (`runtime = "nodejs"`); never read a service-role/Airtable/OpenAI key in a
  `"use client"` file or a `NEXT_PUBLIC_` var. Values are never printed by the scan.
- **`build` FAIL on missing public env.** The gate injects placeholder `NEXT_PUBLIC_*` when unset,
  so this should not happen; if it does, a page is reading a required env at build time — guard it.
- **CI "no generated-code drift" FAIL.** The pipeline modified a tracked source file — commit it or
  make the generator deterministic. `node_modules` is excluded (a stale tracked
  `node_modules/.package-lock.json` is a **pre-existing repo-hygiene issue**, not pipeline drift;
  untracking it is out of Cluster-1 scope).
- **Backend suite FAIL with a connection error.** `SUPABASE_DB_URL` is wrong or the dev project is
  paused/unreachable.

## What this pipeline does NOT do

No deployment, no publishing, no production secrets, no production Supabase/Render/PWA
interaction. Least-privilege `permissions: contents: read`. It only proves the platform still works.
