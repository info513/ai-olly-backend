# Database Migration — Step 2 (Tenancy & Identity)

> Applied to **aiolly-dev only**. Production, Render, Airtable and the guest PWA untouched; `DATA_PROVIDER=airtable`; `main` = `b158278`.
> Migration: `supabase/migrations/20260801112225_step2_tenancy_identity.sql`. Dev seed: `supabase/seed.sql`.
> Date: 2026-08-01. Branch `feature/ai-olly-platform-2`.

## Objects created

### Enums
`hotel_member_role` (hotel_admin, reception, editor, marketing, read_only) · `membership_status` (invited, active, suspended, removed) · `hotel_status` (setup, active, suspended, archived) · `hotel_group_status` (active, archived) · `destination_status` (active, archived).

### Tables
- **`destinations`** — canonical city (platform-level): name, slug (unique), country_code (ISO-2), timezone (req), default_locale, status, audit.
- **`hotel_groups`** — optional brand/group: name, slug (unique), status, audit.
- **`hotels`** — tenant: `destination_id` (req FK), `hotel_group_id` (nullable FK), name, slug (**globally unique**), status, timezone, default_locale, currency (ISO-3), country_code, address_line/city/postal_code, reception_phone/mobile/email, check_in_time/check_out_time (time), `legacy_airtable_id` (nullable), `settings` jsonb (flexible/future config only — stable facts are explicit columns), audit.
- **`profiles`** — 1:1 with `auth.users`: user_id (pk/fk), display_name, email (snapshot), `is_platform_admin` (default false), active, last_login_at, timestamps. No passwords.
- **`hotel_memberships`** — staff↔hotel: hotel_id (fk), user_id (fk auth.users), role, status, invited_by/at, accepted_at, timestamps; `unique(hotel_id, user_id)`.

### Helper functions (SECURITY DEFINER, read-only)
`platform.is_platform_admin()`, `platform.has_hotel_membership(uuid)`, `platform.has_hotel_role(uuid, hotel_member_role[])`, `platform.has_destination_access(uuid)`, `platform.has_group_access(uuid)`.
- **Why safe:** they only READ status for the **current `auth.uid()`**; the `hotel_uuid` argument is the row being evaluated (never a trusted client value on its own); membership must be `active`; STABLE; `search_path=''` + schema-qualified; no writes; no escalation. SECURITY DEFINER is used deliberately so RLS policies calling them do **not** re-trigger RLS on `hotel_memberships`/`profiles` (avoids recursion). EXECUTE granted only to `authenticated` + `service_role`.

### Guard triggers (not SECURITY DEFINER)
- `protect_profile_privileged_columns` — non-service callers cannot change `is_platform_admin`/`active` (reset to OLD).
- `protect_hotel_privileged_columns` — non-platform-admin callers cannot change `slug`/`destination_id`/`hotel_group_id`/`status`.
- `protect_last_hotel_admin` — blocks removing/demoting/suspending the **last active hotel_admin** of a hotel.

## ER overview
```
hotel_groups 1─0..* hotels *..1 destinations
auth.users 1─1 profiles
auth.users 1─* hotel_memberships *..1 hotels
content_versions/audit_log/retention_policies *..0..1 hotels  (hotel_id FK, nullable)
```

## Role model
- **platform_admin** — global (`profiles.is_platform_admin`), cross-tenant; NOT a membership role.
- **Hotel roles** (per hotel, in `hotel_memberships`): hotel_admin, reception, editor, marketing, read_only.
- Access requires an **active** membership; suspended/removed/invited grant nothing.

## RLS policy matrix
| Table | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|
| destinations | platform_admin OR member of a hotel in this destination | platform_admin | platform_admin | platform_admin |
| hotel_groups | platform_admin OR member of a hotel in this group | platform_admin | platform_admin | platform_admin |
| hotels | platform_admin OR active member | platform_admin | platform_admin OR active **hotel_admin** (privileged columns trigger-protected) | platform_admin |
| profiles | own OR platform_admin | (backend only) | own OR platform_admin (is_platform_admin/active trigger-protected) | (auth cascade) |
| hotel_memberships | own OR platform_admin OR hotel_admin of the hotel | platform_admin OR hotel_admin of the hotel | platform_admin OR hotel_admin of the hotel | platform_admin OR hotel_admin of the hotel |
| anon | — none on any table — | | | |

## Privilege matrix (roles get grants; RLS is the real gate)
| Table | anon | authenticated | service_role |
|---|---|---|---|
| destinations | — | S,I,U,D | S,I,U |
| hotel_groups | — | S,I,U,D | S,I,U |
| hotels | — | S,I,U,D | S,I,U |
| profiles | — | S,U | S,I,U |
| hotel_memberships | — | S,I,U,D | S,I,U,D |
*(archive-via-status: service_role has no DELETE on destinations/hotels/groups/profiles.)*

## Synthetic seed strategy
- `supabase/seed.sql` (dev-only, runs on `db reset`): `Split Test` destination, `Demo Hotel Group`, `Demo Hotel` — fixed UUIDs, `on conflict do nothing`. No production data, no real tokens/emails.
- The verification script creates **real Supabase Auth test users** (`*@verify.local`) + hotels/memberships to exercise RLS, then **deletes them** (auth cascade cleans profiles/memberships; tenant rows removed by the owner connection).

## Cross-cutting changes (Step 1 tables)
- Added `hotel_id` **FK → hotels(id)** (ON DELETE SET NULL) to `content_versions`, `audit_log`, `retention_policies`; added `content_versions(hotel_id)` index. `hotel_id` stays **nullable** (platform-level rows). Append-only/immutability and closed RLS on Step-1 tables **unchanged**.
- **Default-privilege hardening:** `alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated, service_role` — future public tables no longer auto-over-grant (the Step-1 finding, now structurally prevented).

## Known limitations (R1)
- Column-level edit limits for hotel_admin are enforced by a trigger (not native column RLS).
- Membership invitations assume the auth user exists first (no pre-signup invite flow yet).
- `translations`/`content_versions` remain **service-role-only** (tenant-aware policies deferred to a later phase).
- No automatic audit triggers on domain tables — audit is written explicitly by the backend (see below).

## Deferred questions
- Auto profile creation on signup (`handle_new_user`) — deferred to the Auth/dashboard phase; for now profiles are created by the backend (service-role) when staff are provisioned.
- Pre-signup email invitations; billing/commercial metadata on hotel_groups; tenant-aware policies for cross-cutting content.

## Audit contract (Task 11)
Step 2 does not add automatic audit triggers (too broad/risky now). The **application-level contract**: the backend writes an `audit_log` row for hotel create/update/status-change, membership create/role/status-change, platform-admin status change, destination updates, and hotel-group updates — with secrets/tokens/passwords/full-auth-metadata/unnecessary PII **redacted** from `before_state`/`after_state`/`metadata`.

## Rollback / rebuild
- Fresh project: `supabase db reset` (local) or apply all migrations to a clean project → deterministic state.
- Undo on dev: forward-only drop-migration (drop policies, triggers, tables, functions, types, and the FKs on Step-1 tables). Never edit an applied migration.

## Test evidence
- **`npm run verify:supabase:step2` → 50 passed, 0 failed** (2026-08-01): objects/enums/functions exist; RLS enabled; anon has no grants; service_role privilege matrix matches; slug/destination/membership uniqueness; anon deny (read+write); no-membership deny; member sees only assigned hotel; multi-hotel sees two; suspended grants nothing; platform_admin cross-tenant; reception/editor cannot manage memberships; hotel_admin manages only its hotel; self-promotion to platform_admin blocked; platform_admin can create destinations, hotel_admin cannot; last-active-hotel_admin removal prevented. Auth test users + synthetic data cleaned up.
- **`npm run verify:supabase:step1` → 35 passed, 0 failed** (regression, incl. live anon deny).
- App boots with `DATA_PROVIDER=airtable` (HTTP 200); `server/server.js` and `pwa/` unchanged; `main` = `b158278`.
