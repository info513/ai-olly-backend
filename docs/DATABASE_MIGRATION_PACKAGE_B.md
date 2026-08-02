# Database Migration — Package B (Steps 8, 9, 10)

**AI Knowledge · Guests / Stays / Consent · Reception Operations**

**Branch:** `feature/ai-olly-platform-2` · **Target:** `aiolly-dev` (mcgrccvvybgcozeqlisj) only
**Status:** applied to dev, verified **136/136**. No production writes. `DATA_PROVIDER=airtable`.

The secure operational + AI data foundation: a structured AI Knowledge CMS (deterministic,
tenant-safe retrieval), guests/stays without guest accounts, immutable consent capture,
and reception request/feedback/push workflows. Every table is multi-tenant, RLS-protected and
auditable from creation, wired into the Step 1 spine (`content_versions`, `audit_log`,
`retention_policies`) with **no duplicated version systems**. Guest PWA, `server/server.js`,
production Render/Airtable/`main` untouched. **Logic stays in code; facts/approved content live
in Supabase.**

## Migrations
- `20260802140000_step8_ai_knowledge.sql`
- `20260802140100_step9_guests_stays_consent.sql`
- `20260802140200_step10_reception.sql`
- `20260802150000_packageb_audit_log_decouple.sql` (forward-fix — see Architectural discoveries)
- `20260802151000_packageb_fix_request_event_cast.sql` (forward-fix — enum cast in history trigger)

---

## STEP 8 — AI Knowledge

### Objects
- **`knowledge_categories`** — platform default (hotel_id NULL) vs hotel scope; per-scope unique key.
- **`knowledge_articles`** — the CMS. `hotel_id`/`destination_id` (mutually exclusive) place an
  article at **platform / destination / hotel** scope; `override_of_article_id` makes a hotel
  article a complete **override** of a platform/destination article (same key+locale, enforced).
  Structured `body_content jsonb` (validated by `platform.is_valid_service_body` — no raw HTML),
  `approved_answer`, `locale`, `status`, `active`, `available_to_ai`, `priority`, `is_critical`,
  `valid_from`/`valid_to`, `source_entity_type`/`source_entity_id`, critical-ack metadata.
  Per-scope+locale unique keys via three partial unique indexes.
- **`knowledge_article_sources`** — provenance (many per article).
- **`knowledge_aliases`** — safe synonyms/retrieval terms pointing to an article **or** a stable
  `intent_key`; `normalized_alias` (generated `lower(btrim())`), unique per (hotel, locale,
  normalized), min length 2 (avoids broad unsafe matching). **Not** a rebuild of the 617 patterns.
- **`ai_configs`** — editable hotel **facts/config only** (persona, tone, response formatting,
  safe-handoff text, feature flags, retrieval limit, safe keyword aliases). One per hotel + one
  platform default. Emergency routing, anti-hallucination, token/QR security, room identity,
  fallback mechanics, authorization stay **in code**.
- **`ai_response_logs`** — operational log (question/answer/route/knowledge IDs/model meta/latency/
  tokens/handoff/quality, `expires_at`). Guest context → sensitive; **never public**.
- **`unanswered_questions`** — deduped per (hotel, normalized_question); occurrence counter;
  tenant-isolated.
- **`knowledge_embeddings`** — schema-readiness placeholder (article/locale/model/hash/status);
  **no vectors generated**, no pgvector dependency introduced.

### Publishing / versioning
`public.publish_knowledge_article(article, change_summary, acknowledge_critical)` (SECURITY
DEFINER): platform/destination → `platform_admin`; hotel → `hotel_admin`/`editor`; **critical
articles require explicit acknowledgement** (editors cannot bypass); writes an immutable
`content_versions` snapshot. Direct `status='published'` UPDATE is blocked (column guard).
`public.rollback_knowledge_article()` restores a prior snapshot as a new draft (history intact).
`public.publish_ai_config()` versions AI config changes.

### Resolution (deterministic, tenant-safe)
`public.resolved_ai_knowledge(hotel, locale, preview)` (SECURITY INVOKER): resolution order
**hotel override → hotel → destination → platform**, deduped by key (`distinct on (key)` ordered
by precedence) — **no duplicate resolved articles**. Live mode returns published + active + valid +
`available_to_ai`; **preview mode** relaxes the status filter but RLS still gates rows, so only the
authorized author (hotel author / `platform_admin`) actually sees drafts. Expired/inactive critical
content is simply absent (never silently substituted with invented facts — the AI layer handles the
safe handoff). `public.resolved_ai_config(hotel)` returns the hotel config if published, else the
platform default. Render service_role can retrieve live resolved knowledge; dashboard members are
scoped to their hotel context. **The current production AI pipeline is unchanged.**

---

## STEP 9 — Guests, Stays & Consent

### Guests (no accounts)
`guests` holds minimal PII (`first_name`/`last_name`/`email`/`phone` + locale/country/external
ref/`pseudonymized_at`/`deleted_at`). **No automatic merge** by email/phone —
`guest_duplicate_suggestions` records candidate matches (reason/score/status) for staff review only;
reliable merge needs staff confirmation or a trusted PMS id. `public.pseudonymize_guest()` (SECURITY
DEFINER, `hotel_admin`/`platform_admin`) strips PII and stamps `pseudonymized_at`; staff cannot set
`pseudonymized_at` directly (column-protected).

### Stays (manual now, PMS later)
`stays` (guest nullable for group/anonymous, `room_id`, `status` enum, arrival/departure,
`checked_in_at`/`checked_out_at`, external ref). Cross-hotel integrity trigger rejects a room or
guest from another hotel. **Deterministic active stay:** partial unique index `(room_id) where
status='checked_in'`; `public.resolved_active_stay(room)` returns the single active stay.
`access_token_hash` is a **synthetic hashed reference** for future QR/token compatibility —
column-hidden from `authenticated` and never audited; **v1 tokens are not touched or migrated**.
`public.resolved_stays(hotel)` (SECURITY DEFINER, membership-checked) exposes a safe operational
list (room number + guest **first name only** — no email/phone/token).

### Consent
`consent_templates` are versioned (`Draft → Preview → Publish` via `public.publish_consent_template`);
**only a published template may be signed**. `public.sign_consent(template, guest, stay, name,
device)` (SECURITY DEFINER, `hotel_admin`/`reception`) copies the exact published `body_text` into an
**immutable** `consents.consent_text_snapshot`. A trigger makes signed consents immutable (only the
revocation transition is allowed); `public.revoke_consent()` is **additive** — it sets
`status='revoked'`/`revoked_at` without overwriting the original signed record. Later template edits
do **not** change existing signed snapshots. `signature_asset_id`/`generated_document_asset_id` are
nullable placeholders for future Storage (**no buckets created**); consents are readable only by
`hotel_admin`/`reception`.

---

## STEP 10 — Reception Operations

- **`guest_requests`** — practical lifecycle (`new → acknowledged → in_progress → resolved →
  closed → cancelled`), priority, assignment, `guest_visible_response` separated from staff-only
  `internal_notes`.
- **`request_events`** — **append-only** history (block-update trigger; no DELETE grant). A SECURITY
  DEFINER trigger auto-logs `created`/`acknowledged`/`resolved`/`status_change`; staff add
  `internal_note`/`guest_reply`/`assigned` events (`is_internal` flag).
- **`feedback`** — rating (1–5)/category/message/follow-up/status, hotel-isolated.
- **`push_subscriptions`** — `endpoint`/`p256dh`/`auth_key` are **secret**: column-hidden from
  `authenticated` (service_role only), **never** included in audit. Revocation via `active`/
  `revoked_at`; `endpoint` unique.
- **`public.guest_request_public`** — a safe guest-facing view that **omits `internal_notes`** and
  internal fields.

### Realtime readiness
`guest_requests`, `request_events` and (optionally) `feedback` are the tables that will likely use
Supabase Realtime later. Realtime publication is **not** broadly enabled in this package.

---

## RLS / privilege matrix (summary)
| Data | platform_admin | hotel_admin | reception | editor | marketing | read_only | anon / no-membership / suspended | service_role |
|---|---|---|---|---|---|---|---|---|
| Platform/destination knowledge | full | read published | read published | read published | read published | read published | — | read |
| Hotel knowledge | full | manage | read published | **manage** | read published | read published | — | read |
| AI config | full (platform) | manage (hotel) | read | read | read | read | — | read |
| AI response logs | read all | read own hotel | — | — | — | — | — | **insert** (append-only) |
| Unanswered questions | full | manage | read | manage | read | read | — | insert/update |
| Guests (PII) | full | read/write | read/write | **—** | **—** | **—** | — | read/write |
| Stays | full | manage | manage | read (ops) | — | — | — | manage |
| Consent templates | full (platform) | manage (hotel) | read | read | read | read | — | manage |
| Consents | full | read/write | read/write | — | — | — | — | read/write |
| Guest requests / events | full | manage | manage | **—** write | **—** write | **—** write | — | manage/append |
| Feedback | full | manage | manage | — | — | — | — | manage |
| Push subscriptions | full | manage hotel | own | own | own | own | — | full (incl. secrets) |

RLS enabled from row one; **REVOKE ALL then precise GRANT**; append-only tables deny DELETE even to
service_role; cross-tenant isolation everywhere (hotel membership / destination access); platform
defaults protected; suspended/anon/no-membership denied.

## Sensitive-data safeguards
- **Column hiding** (column-level SELECT grants exclude the field): `stays.access_token_hash`;
  `push_subscriptions.endpoint`/`p256dh`/`auth_key`. Verified not selectable by anon/authenticated.
- **Guest PII** (`email`/`phone`) readable only by `platform_admin`/`hotel_admin`/`reception`;
  editor/marketing/read_only get **no** guest rows.
- **Immutable consent** snapshot + additive revocation; **immutable** `request_events`;
  append-only `ai_response_logs`.
- **Redacted audit**: guest/stay/consent/push audit rows carry only non-secret flags/status — never
  email/phone, consent text, stay tokens, or push endpoint/keys. Verified: an audit sweep of a
  hotel's rows contained **none** of the seeded PII/token/secret/consent-text strings.
- **SECURITY DEFINER** functions validate authorization internally, run `set search_path=''`,
  schema-qualify all references, and derive `hotel_id` from the target row (never trust a
  caller-supplied hotel_id alone).

## Audit & versioning integration
Redacted triggers append to Step 1 `audit_log` for knowledge (create/update/publish/archive/
rollback), AI config, guest (create/update/pseudonymize), stay, consent (sign/revoke), guest request
(create/assign/status/resolution), feedback, and push (revocation). Publishing writes Step 1
`content_versions` for knowledge articles, AI configs and consent templates. No parallel version
system was introduced.

## Retention integration
`retention_policies` (Step 1) is the single retention surface. Valid `data_type` targets now include
`ai_response_logs`, `unanswered_questions`, `guests`, `stays`, `consents`, `feedback`,
`guest_requests`, `push_subscriptions`. `ai_response_logs.expires_at` supports a **configurable**
(not hardcoded) ~90-day operational retention. Deletion/anonymization **jobs are future work** —
only schema and policy references exist now.

## Synthetic seed
`supabase/seed.sql` (dev only): Demo Hotel gets a platform knowledge article + hotel override,
a destination article, a critical article, a draft + published article, a hotel AI config; a
synthetic guest, an active stay, a published consent template + a signed consent snapshot; a guest
request (with auto history), feedback, and a push subscription with **clearly fake** endpoint/keys.
No Antique Split data, production tokens, real emails or real guests.

## Future Airtable mapping (documentation only; nothing migrated)
- The 617 intent patterns are **not** ported 1:1 — they become a smaller set of structured
  `knowledge_articles` (+ a few safe `knowledge_aliases`), with deterministic handlers staying in
  code. `AI_SOURCE`-style flags → `available_to_ai`; hotel-specific answers → hotel articles/overrides.
- Guests/stays arrive from manual entry now, PMS later (`external_source`/`external_id`, hashed
  `access_token_hash` preserve future QR/token compatibility). Legacy ids via
  `legacy_airtable_record_id`. Render response contracts are unchanged in this package.

## Known limitations (R1)
- Multi-locale is modeled per-row (`locale`) — a translations join is deferred to the i18n step.
- `knowledge_embeddings` is a placeholder; no vector column/pgvector, no embedding pipeline.
- Duplicate detection stores suggestions only; the scoring/merge workflow is future dashboard work.
- Retention/pseudonymization **jobs** are not implemented (schema + policy references only).
- Storage buckets, signature/document binaries, and PMS/Realtime wiring are explicitly out of scope.

## Architectural discoveries
1. **Audit log must be FK-decoupled from entities.** AFTER-DELETE audit triggers insert audit rows
   tagged with `hotel_id` during a hotel's cascade delete; the Step 2 `audit_log_hotel_fk` (SET NULL)
   was checked immediately on those inserts and blocked hotel deletion. Correct model: a forensic
   audit log **outlives** the entities it references — dropped the FK (`hotel_id` stays a
   denormalized tag). Forward-fix `20260802150000`.
2. **Enum casts in shared triggers.** A `CASE` producing `text` fails to insert into an enum column;
   the history trigger needed an explicit `::request_event_type` cast (forward-fix `20260802151000`).
3. **Preview via RLS, not a flag.** `resolved_ai_knowledge(preview=true)` relaxes the status filter
   but relies on RLS to expose drafts only to authors — no separate authorization path needed.
4. **`to_jsonb(NEW)` + `->>` redaction** lets one audit function serve several tables while emitting
   only whitelisted, non-secret fields — the safe default for PII/secret-bearing tables.

## Rollback / rebuild
Forward-only. Rebuild dev with `supabase db reset` (re-applies all migrations + seed). No manual
dashboard edits were made.

## Test evidence
- `npm run verify:supabase:packageb` → **136 passed, 0 failed** (real Auth users `*@verify.local`):
  catalog/RLS/anon-deny/no-over-grant, knowledge resolution order + dedup + drafts-excluded +
  override-wins + validity + preview-author-only, publish/versioning, critical ack, rollback, alias
  normalization/scoping, AI-log protection, unanswered tenant isolation; guests/stays isolation +
  PII restriction + cross-hotel rejection + manual stay + duplicate-suggestion + pseudonymization +
  token hiding; consent published-required + immutable snapshot + template independence + additive
  revocation + cross-tenant; reception lifecycle + append-only history + internal-note hiding +
  operational-write denial + feedback isolation + push-secret hiding + revocation; and a global
  audit sweep proving **no** PII/tokens/secrets/consent-text leaked into audit. Synthetic data +
  users cleaned up; no secrets logged.
- Regressions: Step 1 **35/0**, Step 2 **50/0**, Step 3 **40/0**, Step 4 **76/0**, Package A **90/0**.
- Server boots (HTTP 200 on `/api/health`) with `DATA_PROVIDER=airtable`; `server/server.js` and
  `pwa/` unchanged from `v1.0.0-antique`; `main` frozen at `b158278`.
