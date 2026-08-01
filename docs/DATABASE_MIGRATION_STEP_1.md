# Database Migration — Step 1 (cross-cutting schema)

> Applied to **aiolly-dev only**. Production, Render, Airtable and the guest PWA untouched; `DATA_PROVIDER=airtable`.
> Migrations: `supabase/migrations/20260801104904_step1_cross_cutting.sql` + `20260801110151_step1_grants_hardening.sql`.
> Date: 2026-08-01. Branch `feature/ai-olly-platform-2`.

## Objects created

### Enums (schema `public`)
| Enum | Values | Why |
|---|---|---|
| `content_status` | draft, preview, published, archived | content lifecycle for versioning/publishing |
| `audit_action` | create, update, publish, unpublish, archive, restore, delete, login, export | typed audit verbs |
| `retention_action` | delete, anonymize, archive | action a retention policy applies |
| `actor_type` | service, user, system | who performed an audited action (backend service / dashboard user / automated job) |

*No speculative domain enums (rooms/services/newsletter) were created.*

### Helper trigger functions
- `platform.set_updated_at()` — reused from the foundation migration (maintains `updated_at`).
- `platform.normalize_locale()` — lowercases/trims `translations.locale` so the unique key is stable.
- `platform.block_row_update()` — raises on UPDATE; makes `content_versions` and `audit_log` update-immutable for **all** roles.
- `platform.set_content_version_checksum()` — sets a sha256 `checksum` of the snapshot on insert (integrity).

### Tables (schema `public`)

**`translations`** — generic localization (no `title_en`/`title_hr` anywhere).
Columns: `id` uuid pk, `entity_type` text, `entity_id` uuid, `field_key` text, `locale` text, `value` **text**, `created_at`, `updated_at`, `created_by`, `updated_by`.
- **`value` is `text`** (justification): translated fields are strings; text is simplest, indexable, sufficient for R1. A `value_json` column is intentionally omitted until a genuine structured-translation need appears (per Q2/Task 2 preference).
- Constraints: `unique(entity_type, entity_id, field_key, locale)`; `locale ~ '^[a-z]{2}(-[a-z]{2})?$'`.
- Index: `(entity_type, entity_id)`. Triggers: normalize_locale (BEFORE INS/UPD), set_updated_at (BEFORE UPD).

**`content_versions`** — immutable version snapshots.
Columns: `id`, `entity_type`, `entity_id`, `version_number` int, `status` content_status, `snapshot` jsonb, `translations_snapshot` jsonb, `change_summary`, `checksum`, `hotel_id` (nullable, Step 2), `restored_from_version_id` (self-FK), `published_at`, `created_at`, `created_by`.
- Constraints: `unique(entity_type, entity_id, version_number)`; `version_number > 0`.
- Indexes: `(entity_type, entity_id)`, `(status)`. Triggers: set_content_version_checksum (BEFORE INS), block_row_update (BEFORE UPD → immutable).
- **Rollback = insert a new version** (`restored_from_version_id` points to the source); historical rows are never overwritten.

**`audit_log`** — append-only audit trail.
Columns: `id`, `occurred_at`, `actor_user_id`, `actor_type`, `hotel_id` (nullable, Step 2), `entity_type`, `entity_id`, `action` audit_action, `before_state` jsonb, `after_state` jsonb, `metadata` jsonb, `correlation_id`, `ip_address` inet, `user_agent`.
- Indexes: `(entity_type, entity_id)`, `(hotel_id)`, `(occurred_at)`, `(actor_user_id)`. Trigger: block_row_update (immutable UPDATE).
- **Redaction expectation:** the application layer MUST redact secrets/tokens/PII from `before_state`/`after_state`/`metadata` before writing. `ip_address`/`user_agent` are optional and privacy-sensitive.

**`retention_policies`** — configurable retention (no assumed legal periods).
Columns: `id`, `data_type`, `hotel_id` (nullable = platform default), `jurisdiction`, `effective_from`, `effective_to`, `retention_days` (nullable = indefinite), `action` retention_action, `configuration` jsonb, `active`, `legal_basis`, `notes`, audit fields.
- Constraints: `retention_days >= 0` (or null); `effective_to >= effective_from`.
- **No rows seeded** — legal periods remain pending confirmation. Index: `(data_type)`, `(hotel_id)`, `(active)`. Trigger: set_updated_at.

## RLS posture (Phase-1: fail-closed)
- **RLS ENABLED** on all four tables; **zero policies** ⇒ anon and authenticated are fully denied.
- **No tenant/membership policies yet** (hotels/memberships don't exist until Step 2).
- Guest path is unchanged: PWA → Render (service-role) → Supabase; the guest PWA never queries Supabase.

## Privilege model (least privilege)
Supabase default privileges over-grant, so the hardening migration does **REVOKE ALL then GRANT the minimum**:
| Table | anon/authenticated | service_role (backend) |
|---|---|---|
| translations | none | SELECT, INSERT, UPDATE, DELETE |
| content_versions | none | SELECT, INSERT *(append-only: no UPDATE/DELETE)* |
| audit_log | none | SELECT, INSERT *(append-only: no UPDATE/DELETE)* |
| retention_policies | none | SELECT, INSERT, UPDATE *(deactivate via `active`, no DELETE)* |

`service_role` has `bypassrls`; combined with these grants it can perform intended admin ops but **cannot** mutate append-only rows. `content_versions`/`audit_log` UPDATE is additionally blocked by a trigger for every role.

## Known limitations (by design, Phase-1)
- No tenant-aware access yet (added in Step 2). Until then only the backend (service-role) can read/write.
- `hotel_id` on `content_versions`/`audit_log` is nullable until tenancy exists.
- No automatic audit triggers on domain tables (none exist yet); audit is written explicitly by the backend.
- Retention **deletion/anonymization jobs are not implemented** — only the policy store exists.
- Legal retention values are not seeded (pending legal).

## How Step 2 extends this (no table recreation)
- Add `hotels`, `hotel_memberships`, `profiles.is_platform_admin`.
- Add **RLS policies** (CREATE POLICY) to these tables: platform_admin full access; hotel members scoped by `hotel_id`; then **GRANT** the needed privileges to `authenticated`. Tables/columns already exist — policies + grants are purely additive.
- Backfill `hotel_id` where applicable and tighten constraints.

## Rollback / rebuild
- **Fresh project:** `supabase db reset` (local, needs Docker) or apply both migrations to a clean project via `supabase db push` → deterministic final state (migration 2's revoke/grant corrects the default-privilege over-grant).
- **Undo on dev:** create a forward-only `drop`-migration (drop tables, functions, types) — never edit an applied migration (breaks the CLI migration hash).

## Test evidence (`npm run verify:supabase:step1`, 2026-08-01)
**33 passed, 0 failed.** Highlights:
- All four tables exist; `platform_health()` still works; no business-domain tables present.
- RLS enabled + 0 policies on all four; 0 grants to anon/authenticated.
- service_role grants exactly the least-privilege set per table.
- Functional (service-role): insert works; translations uniqueness enforced; locale normalized to `en`; content_versions version-number uniqueness enforced; **content_versions UPDATE denied**; audit_log append works; **audit_log UPDATE and DELETE denied**; retention_days `>= 0` validation enforced.
- anon/authenticated functional denial: **structurally proven** (RLS on + 0 policies + 0 grants); live functional probe pending `SUPABASE_ANON_KEY` in `.env`.
- Synthetic data (`entity_type='verify.step1'`) cleaned up; no production writes.
