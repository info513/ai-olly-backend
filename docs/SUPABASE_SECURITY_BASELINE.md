# Supabase Security Baseline

> Phase 1 foundation. The security rules every later phase must uphold. No RLS policies are created yet (none needed for the empty foundation); this defines the posture before any business table exists.
> Date: 2026-07-31.

## Keys

| Key | Visibility | Rule |
|---|---|---|
| **anon key** | Public (may appear in a browser dashboard bundle) | Public by design, but **all access is restricted by RLS**. It grants nothing on its own once RLS is on. |
| **service-role key** | **SECRET — server-only** | Bypasses RLS. Lives only in Render env / local `.env`. **Never** in any browser bundle, the guest PWA, or git. |
| **DB URL / password** | **SECRET — server/tooling only** | Used by the CLI/migrations. Never in code or the browser. |

- No secrets in git. `.env` is gitignored; `config.toml` holds no secrets.
- The guest PWA receives **none** of these variables in Phase 1 (and never the service-role key, ever).
- The browser (future dashboard) may receive **only** `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY` — never the service-role key.

## Row-Level Security (RLS)

- **RLS enabled by default on every exposed table.** A table without RLS + a policy is a data leak; treat "RLS off" as a bug.
- Tenant isolation is enforced at the row level: every business row carries a tenant id, and policies restrict access to the caller's tenant.
- The server (service-role) enforces tenant scoping in application code even though it bypasses RLS — belt and braces.
- The guest PWA never queries Supabase directly for protected hotel data (contract: PWA → Render API → Supabase).

## Storage

- **Private buckets** for sensitive files (consent signatures, generated consent PDFs, any document). Access via **signed URLs** only, time-limited.
- **Public buckets** only for guest-facing media (hotel/POI/route/news images, logos) — still per-tenant organised.
- Storage access is governed by Storage RLS policies (added in the Storage phase), same tenant-isolation principle.

## Secrets & rotation

- Per-environment key sets (dev/staging/prod never shared).
- **Rotation policy:** rotate service-role key, DB password, OpenAI, Brevo, VAPID, and webhook secrets on a schedule and immediately on any suspected exposure. Rotations must be doable without downtime (update Render env → redeploy).
- Service accounts: the backend acts as one service identity (service-role) for server work; user actions in the dashboard use per-user JWTs (RLS-enforced).

## Audit logging

- Every content edit and privileged action must be attributable (who / when / before→after). Audit tables/columns are a first-class requirement of the CMS/dashboard phases.
- Auth events (logins, invites, role changes) are retained.

## Tenant isolation (recap)

- One shared Postgres, isolation via RLS + tenant-scoped rows (per confirmed decision #13).
- No query — REST, RPC, full-text, or future vector — may cross tenants. Same fail-closed principle as the current Airtable `slug`/`AI_SOURCE`/`Active` filtering.

## GDPR / PII

- EU region (data residency). GUESTS/STAYS/PRIVOLE + signatures are personal data.
- Define retention + erasure (right to be forgotten) + export before migrating any PII.
- DPAs with Supabase/OpenAI/Brevo as sub-processors when selling to hotels.

## Backup & recovery

- Enable backups / Point-in-Time Recovery on prod (and staging).
- Full Airtable export retained as an archive before any migration/deletion.
- The `DATA_PROVIDER` switch is the fast rollback lever during migration.

## Phase-1 note
No RLS policies, no business tables, no PII exist yet. This baseline is the contract that Database/Auth/Storage/CMS phases must implement.
