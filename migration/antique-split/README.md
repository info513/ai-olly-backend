# Antique Split — Airtable → Supabase migration workspace

**DEV ONLY.** This directory holds the local, repeatable migration pipeline for the
Antique Split pilot hotel. It never touches production Render, the guest PWA, or
production Supabase, and it treats the production Airtable base as **read-only**.

## Layout

| Dir | Purpose | Committed? |
|---|---|---|
| `raw/` | Verbatim read-only Airtable export (JSON per table). **Contains room access tokens + production content.** | **No** — gitignored |
| `normalized/` | Deterministic, Supabase-shaped records derived from `raw/`. Full production content. | **No** — gitignored |
| `manifests/` | Export manifest, legacy ID map, media manifest, checksums. | **No** — gitignored |
| `reports/` | Machine-readable compare/verify output. | **No** — gitignored |

The **human-readable, redacted** reports are committed under [`docs/`](../../docs)
(`ANTIQUE_SPLIT_*`). Room access tokens are **never** written to `normalized/`,
`manifests/`, `reports/`, `docs/`, logs, or the Dashboard — only carried in-memory
from `raw/` into the DEV import so that room→token mapping is preserved exactly.

## Decision: exports are local-only

Per Sprint 9 Part 2: `raw/` carries production room access tokens, and every stage
carries full production content (POI descriptions, service bodies, AI facts). To keep
secrets and bulk production content out of git, **all four data dirs are gitignored**.
Only the scripts (`scripts/migration/*.mjs`) and redacted `docs/ANTIQUE_SPLIT_*` are
committed. Regenerate the local artifacts at any time with the export → normalize →
import pipeline.

## Pipeline

```bash
# from repo root; reads AIRTABLE_API_KEY (read-only) + SUPABASE_* from .env
node scripts/migration/export-airtable-antique.mjs        # Airtable → raw/
node scripts/migration/normalize-antique.mjs              # raw/ → normalized/ + legacy id map
node scripts/migration/import-antique-to-supabase.mjs --dry-run   # preview
node scripts/migration/import-antique-to-supabase.mjs --apply     # → aiolly-dev only
node scripts/migration/compare-antique-providers.mjs      # source vs Supabase resolved
node scripts/migration/rollback-antique-dev-import.mjs --apply    # reset the DEV import
```

Every script refuses to run against any Supabase project ref other than the approved
DEV ref, and the Airtable client is GET-only.
