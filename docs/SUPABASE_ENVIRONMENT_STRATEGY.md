# Supabase Environment Strategy

> Phase 1 foundation. Defines environments, branch↔environment mapping, migration promotion, secrets, and rollback. **No production cutover.** Airtable remains the live data provider.
> Date: 2026-07-31.

## Environments

| Environment | Supabase project | Render service | Data provider | Purpose |
|---|---|---|---|---|
| **Local** | Supabase CLI local stack (Docker) | local `npm start` | `airtable` (default) | Develop migrations + code on a throwaway local DB |
| **Shared development** | `aiolly-dev` (to be created) | (later) a dev Render service, or local | `airtable`, then `supabase` per-endpoint | Team-shared dev DB; first place Supabase reads/writes are exercised |
| **Staging** | `aiolly-staging` (later) | staging Render | dual-run / compare | Rehearse migration + dashboard against prod-like data before prod |
| **Production** | `aiolly-prod` (later) | **existing** Render (frozen v1) | `airtable` **until cutover** | Live Antique Split v1 — untouched in Phase 1 |

> Phase-1 recommendation: create **one development project (`aiolly-dev`)** now. Add staging + prod projects later, before their respective phases. Do **not** create prod yet.

## Branch → environment mapping

| Branch | Maps to | Rule |
|---|---|---|
| `main` | **Production** (Antique Split v1) | Frozen. Render auto-deploys `main`. No Supabase link in Phase 1. |
| `feature/ai-olly-platform-2` | **Local / dev** only | All Phase-2 work. **Never** connected to production Supabase. |

The feature branch must never point at a production Supabase project. Local/dev credentials only.

## Migration promotion flow

```
write migration  ─▶  apply locally (supabase db reset)  ─▶  push to dev (supabase db push)
                                                            └─▶ later: staging  ─▶  production
```

- Migrations are the **only** way schema changes move between environments (no manual dashboard edits to schema).
- Each migration is forward-only in shared envs; local uses `db reset` for a clean rebuild.
- Promotion is gated: local verified → dev verified → staging verified → prod (with backup + rollback plan).
- Requires: Supabase CLI + Docker locally (not installed in the current sandbox — install per `SUPABASE_SETUP_GUIDE.md`).

## Secret handling

- Secrets live in **`.env` (local, gitignored)** and the **Render dashboard (server)** — never in git, never in `config.toml`, never in the guest PWA bundle.
- Per-environment key sets; never reuse prod secrets in dev.
- Public vs server-only split is defined in `.env.example` and `SUPABASE_SECURITY_BASELINE.md`.

## Rollback expectations

- **Local:** `supabase db reset` rebuilds from migrations + seed — zero risk.
- **Dev/Staging:** a bad migration is fixed with a new corrective migration; projects can be reset if disposable.
- **Production (later):** full backup + PITR before any migration; **dual-run** so Airtable remains the source of truth until Supabase is verified; the provider switch (`DATA_PROVIDER`) is the instant rollback lever (flip back to `airtable`).

## Phase-1 status
- Supabase foundation **started** on the feature branch (local structure + one foundation migration + isolated connection module).
- **No** production link, **no** data migration, **no** endpoint switched. Airtable is still the live provider everywhere.
