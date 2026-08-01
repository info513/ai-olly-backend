# Database Migration — Step 3 (Rooms & Room Guide)

**Branch:** `feature/ai-olly-platform-2` · **Target:** `aiolly-dev` (mcgrccvvybgcozeqlisj) only
**Status:** applied to dev, verified 40/40. No production writes. DATA_PROVIDER stays `airtable`.

Implements **Pattern C** (room_type → room field-level inheritance) for the Room Guide, the
first business-domain slice of Platform 2.0. Rooms inherit their room type's defaults; each
room may override any field. The guest PWA and `server/server.js` are untouched.

## Objects created

### Tables
- **`public.room_types`** — the inheritance defaults (Pattern C parent). One row per
  room category per hotel. `hotel_id` FK, `slug` unique-per-hotel, `active`,
  `default_capacity`, and the full Room-Guide default surface as explicit columns:
  `wifi_instructions`, `ac_instructions`, `tv_instructions`, `safe_instructions`,
  `smart_glass` (bool) + `smart_glass_instructions`, `window_instructions`,
  `underfloor_heating` (bool), `room_features text[]`, `room_notes text[]`,
  `ai_welcome`, `minibar_available`, `kettle_available`, `blackout_system`,
  `toiletries`, `extra_facts jsonb`.
- **`public.rooms`** — physical rooms (Pattern C child). `hotel_id` FK, `room_type_id`
  FK (same-hotel enforced), `room_number` unique-per-hotel, `access_token` unique
  (the QR token — never exposed to `authenticated`). Every guide field has a nullable
  `*_override` column: **NULL means inherit** from the room type. Booleans are
  **3-state** (`true` / `false` / `null=inherit`).

### View
- **`public.resolved_rooms`** (`security_invoker = true`) — the read surface the future
  dashboard/API consumes. Resolves every field via `COALESCE(room.override, room_type.default)`.
  **Excludes `access_token`.** Because it is security-invoker, the caller's RLS on
  `rooms`/`room_types` still applies.

### Functions & triggers (schema `platform`)
- `platform.check_room_type_same_hotel()` — rejects a room pointing at a room_type from
  another hotel (tenant-integrity guard).
- `platform.normalize_room_overrides()` — empties (`''`) collapse to `NULL` so blank ≠ override.
- `platform.protect_room_columns()` / `platform.protect_room_type_columns()` — column-level
  write guards (SECURITY INVOKER):
  - `editor` → content/guide fields only;
  - `hotel_admin` → operational fields too;
  - `hotel_id` / `access_token` / legacy identity → only `postgres`/`service_role`.
- `platform.get_room_access_token(uuid)` — the **only** path to a room token; returns it
  for `platform_admin` **only**. (`service_role` on the server reads the base table directly.)

## Inheritance model (Pattern C)

```
room_types (defaults) ──1:N──> rooms (overrides, NULL = inherit)
                                   │
                                   └── resolved_rooms  (COALESCE view, no token)
```

Resolution is deterministic: `effective = COALESCE(room.field_override, room_type.field_default)`.
No override precedence ambiguity, no magic sentinels — `NULL` is the single "inherit" signal.

## Role & privilege model

| Role | room_types | rooms | access_token | resolved_rooms |
|------|-----------|-------|--------------|----------------|
| `anon` | — | — | — | — |
| `authenticated` (via membership) | SELECT + guarded UPDATE | SELECT (token-excluded) + guarded UPDATE | **hidden** | SELECT |
| `service_role` (server) | full | full | read (base table) | — |
| `postgres` (migrations) | full | full | full | full |

- SELECT on `rooms` is a **column-level grant that EXCLUDES `access_token`**, so even a
  membership-holding staff user cannot read QR tokens through the API.
- All writes are gated twice: **RLS** (tenant + membership) *and* the **column guard**
  trigger (role → allowed field set).

## RLS policy matrix

| Table | SELECT | INSERT/UPDATE/DELETE |
|-------|--------|----------------------|
| `room_types` | platform_admin OR hotel membership | platform_admin OR `has_hotel_role(hotel_admin, editor)` |
| `rooms` | platform_admin OR hotel membership | platform_admin OR `has_hotel_role(hotel_admin, editor)` |

Column-level guards then narrow *which* columns each role may change (above).

## Corrective migrations (found & fixed during Step 3 verification)

1. **`20260801140445_step3_fix_last_admin_cascade.sql`** — `protect_last_hotel_admin`
   fired on the cascade delete of a hotel's memberships and made hotels undeletable
   (blocking dev cleanup). Fix: exempt `postgres`/`supabase_admin` only; `service_role`
   stays subject to the guard (Step 2 assertion preserved), dashboard `hotel_admin`s still
   cannot remove the last active admin.
2. **`20260801140701_step3_grant_platform_usage.sql`** — SECURITY INVOKER trigger bodies
   call `platform.is_platform_admin()`/`has_hotel_role()` in the invoker's context, which
   needs **USAGE on schema `platform`**; without it, authenticated updates failed with
   *"permission denied for schema platform."* (RLS policy expressions did not surface this;
   trigger bodies do.) Fix: `grant usage on schema platform to authenticated, service_role`.
   This grant references only — no `platform` **table** grants exist, so no data is exposed.
   The same grant unblocks Step 2's `protect_hotel_privileged_columns` (latent, untested there).

## Synthetic seed

`supabase/seed.sql` (dev only, `supabase db reset`): Demo Deluxe / Demo Standard room
types on Demo Hotel; rooms 101 (inherits all), 102 (overrides Smart Glass → false), 201
(Standard, overrides view). Tokens are obvious placeholders (`DEMO-TOKEN-*`). No production
hotel/guest/room data.

## Known limitations (R1)
- No content-versioning wired to room edits yet (Step 1 `content_versions` exists but is
  not populated from room writes — deferred to the write-path/API step).
- `resolved_rooms` returns room-type defaults inline; multi-locale text still lives in the
  base columns (translation join to `public.translations` deferred to the i18n step).
- Room media/photos deferred to the Storage step.

## Rollback / rebuild
Forward-only. To rebuild dev from scratch: `supabase db reset` (re-applies all migrations +
seed). No manual dashboard edits were made.

## Test evidence
- `npm run verify:supabase:step3` → **40 passed, 0 failed** (real Auth users `*@verify.local`,
  RLS + inheritance + token-hiding + column-guard checks; synthetic data & users cleaned up;
  no tokens logged).
- Regressions: Step 1 **35/0**, Step 2 **50/0**.
- Server boots (HTTP 200 on `/api/health`); `server/server.js` and `pwa/` unchanged from
  `v1.0.0-antique`; `main` frozen at `b158278`.
