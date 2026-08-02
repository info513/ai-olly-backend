# Database Migration — Package C (Steps 11, 12, 13)

**Storage & Asset Manager · Newsletter · Analytics Foundation**

**Branch:** `feature/ai-olly-platform-2` · **Target:** `aiolly-dev` (mcgrccvvybgcozeqlisj) only
**Status:** applied to dev, verified **115/115**. No production writes. **No real emails sent.** `DATA_PROVIDER=airtable`.

The remaining shared infrastructure before dashboard/migration work: a secure asset/media
system (Storage), the newsletter data + campaign operations model (Brevo-ready, no send), and a
tenant-safe analytics/quality reporting foundation. All wired into the Step 1 spine
(`content_versions`, `audit_log`, `retention_policies`) with no duplicated version systems. Guest
PWA, `server/server.js`, production Render/Airtable/Supabase/`main` untouched.

## Migrations
- `20260802160000_step11_storage_assets.sql`
- `20260802160100_step12_newsletter.sql`
- `20260802160200_step13_analytics.sql`

---

## STEP 11 — Storage & Asset Manager

### Buckets (single set — NOT one per hotel)
| Bucket | Public | Size limit | Allowed MIME |
|---|---|---|---|
| `public-media` | **yes** (public read) | 100 MB | image jpeg/png/webp/gif/svg, video/mp4, audio mpeg/mp4 |
| `private-documents` | no | 25 MB | pdf, png, jpeg |
| `consent-files` | no | 5 MB | pdf, png, jpeg, svg |

**Path convention (tenant-aware):** `platform/…`, `destinations/{destination_id}/…`,
`hotels/{hotel_id}/…`, `hotels/{hotel_id}/rooms/{room_id}/…`, `hotels/{hotel_id}/consents/{consent_id}/…`.

### Tables
- **`assets`** — metadata over a Storage object **or** an external video (`external_provider`
  vimeo/youtube + `external_url`/`external_id`). `owner_scope` (platform/destination/hotel, derived),
  `bucket_name`, `storage_path`, `asset_type` (enum: hotel/room/poi/route/whisper image, whisper
  audio, short video, logo, icon, news/newsletter image, document, consent_signature, consent_pdf,
  other), mime/size/dimensions/duration/checksum, `alt_text`/`caption`/`source_credit`/`rights_*`/
  `license_type`, `status` (pending/ready/archived), `public_access`, soft `deleted_at`, `metadata`.
  **Per-type size limits** enforced by CHECK via `platform.asset_max_bytes()` (images/logos 15 MB,
  audio 50 MB, docs/consent-pdf 25 MB, signatures 5 MB, short video 100 MB). Private types
  (`consent_signature`/`consent_pdf`/`document`) can never land in `public-media` (CHECK).
- **`asset_usages`** — reuse-aware (`asset_id`, `entity_type`, `entity_id`, `usage_role`,
  `sort_order`) with unique `(asset_id, entity_type, entity_id, usage_role)`. One asset → many
  usages. `public.asset_usage_report(asset)` answers **“where is this used?”**.

### Rules & functions
- `platform.normalize_asset()` derives `owner_scope`, forces `public_access=false` for private
  types / non-public buckets.
- `platform.check_asset_usage_scope()` — a **hotel** asset may only be used within its hotel;
  platform/destination assets may be reused by any authorized hotel (**cross-hotel hotel-asset
  usage rejected**).
- `platform.protect_asset_delete()` — **soft-delete blocked while active usages exist** (detach
  first); locks tenancy/link/path columns for non-privileged callers.
- `public.finalize_asset()` (SECURITY DEFINER) — metadata → `ready`, re-checks size.
- **Replacement = new asset/revision**, never a silent overwrite of history.

### Public vs private security
- `public-media`: **anyone reads**; writes require `platform.can_manage_media(name)` — a SECURITY
  DEFINER path validator that extracts `hotels/{hotel_id}` and checks
  `hotel_admin`/`editor`/`marketing` (platform_admin for platform/destination paths). Client paths
  are never trusted alone.
- `private-documents` / `consent-files`: **no anon/authenticated storage policies at all** →
  only the backend (`service_role`, bypasses RLS) reads/writes and mints **signed URLs** (expiry).
  `assets` RLS additionally restricts private consent/document rows to
  `platform_admin`/`hotel_admin`/`reception` (editor/marketing/read_only denied).

### Image transformations (R1 strategy — documented, PWA unchanged)
One original + Supabase on-the-fly transforms. Target variants: **thumbnail** ~160px,
**card** ~480px, **hero** ~1280px, **full** original. Quality ~75–80 webp; cover-crop with focal
center; fallback to original on transform miss; long-cache transformed URLs. **Do not** pre-generate
four physical copies.

### Video strategy
Vimeo (protected/premium), YouTube (public), Supabase Storage only for short clips ≤100 MB. Asset
records carry `external_provider`/`external_url`/`external_id`. **No real video uploaded/migrated.**

### Audit
Redacted asset/usage audit (create/update/finalize/archive/soft-delete/usage attach-detach) —
records status/type/bucket-name only, **never** binary data, storage paths as secrets, or signed URLs.

---

## STEP 12 — Newsletter (Brevo-ready, no send)

### Tables
- **`newsletter_subscribers`** — `email` + generated `email_normalized` (lower/trim), unique
  `(hotel_id, email_normalized)`; `status` (pending/subscribed/unsubscribed/bounced/complained/
  suppressed); `consent_id` → Package B `consents`; `brevo_contact_id`; guest link optional.
- **`newsletter_segments`** (+ `newsletter_segment_members`) — `type` static | rule. Rule
  structure is a **validated JSONB** (`platform.is_valid_segment_rules`): `{match, conditions:[{field
  ∈ locale/country_code/source/status/tag, op ∈ eq/in, value}]}` — **no arbitrary SQL / no query
  builder**.
- **`newsletter_templates`** — platform default (hotel_id NULL) or hotel; structured `content`
  (validated blocks, no raw HTML as canonical); versioned via `content_versions`; `Draft → Preview →
  Publish` (`public.publish_newsletter_template`; direct publish blocked).
- **`newsletter_campaigns`** — `template_id`/`segment_id` + **snapshots**
  (`subject_snapshot`/`preview_text_snapshot`/`content_snapshot`/`segment_snapshot`); `status`
  (draft/preview/scheduled/sending/sent/cancelled/failed); `brevo_campaign_id`; delivery totals.
  **`public.schedule_campaign()`** freezes the snapshot and sets `scheduled`; a guard trigger makes
  the snapshot **immutable once scheduled/sending/sent** — later template edits never change it.
- **`newsletter_campaign_recipients`** — per-recipient delivery state, `brevo_message_id`,
  timestamps, redacted `error_*`.
- **`newsletter_events`** — **append-only** delivery events (block-update trigger).
- **`newsletter_webhook_events`** — **idempotent** ingestion via unique `(provider, provider_event_id)`;
  redacted payload; **backend-only** (no authenticated grant).

### Consent integration & audience
Marketing consent links to the Package B `consents` model (type/version/exact text snapshot/source/
timestamp/status). `public.resolve_newsletter_audience(segment)` (SECURITY DEFINER) **always**
filters `status='subscribed'` **AND** an active granted consent — so no subscriber without valid
consent is ever targeted; unsubscribed/suppressed are excluded; rule segments additionally filter by
locale/country. **No auto-subscription from a stay**; transactional comms stay separate from
marketing consent. No GDPR legal wording is authored here.

### Brevo integration boundary
DB fields + an isolated **future** adapter contract only — **no credentials, no send calls, no
`server/server.js` change**. Documented future adapter at `server/integrations/brevo/` (sync
subscriber, create/update campaign, send test, schedule, send now, process webhook, sync stats).

---

## STEP 13 — Analytics Foundation

Tenant-safe **daily aggregates** (counts only — no PII), refreshed idempotently and timezone-aware.

### Tables
- **`ai_quality_daily`** — total questions, deterministic vs model answers, safe handoffs,
  unanswered, avg latency, token usage, knowledge articles used, **coverage_estimate**.
- **`operations_daily`** — request volume/resolved/open, avg ack/resolution seconds, feedback count
  & avg rating, stays arriving, consents granted.
- **`newsletter_daily`** — active subscribers, active consent, sent/delivered/opened/clicked/
  bounced/unsubscribed.
- **`content_health_daily`** — published/draft/archived, expired, critical pending, unresolved
  unanswered, unused assets, assets missing alt/rights, **completeness_score**.

Every row stamps `calc_version` (from `platform.analytics_calc_version()` = **`v1`**).

### Metric formulas (v1 — versioned)
- **AI coverage_estimate** = `(total_questions − safe_handoffs) / total_questions` ∈ [0,1]. Not a
  scientific quality score — a coverage proxy; bump `calc_version` on any change.
- **content completeness_score** = `published / (published + draft + expired + critical_pending)`
  ∈ [0,1] over hotel-owned knowledge.
- Reception timings from request `created_at → acknowledged_at / resolved_at`.

### Refresh & scheduling
`public.refresh_{ai_quality,operations,newsletter,content_health}_daily(hotel, day)` and
`public.refresh_analytics(hotel, day)` (SECURITY DEFINER) — internal authorization via
`platform.assert_analytics_access()` (never trust a caller-supplied hotel alone), **idempotent
upsert**, day-bucketed in the **hotel's timezone**. **No cron/jobs implemented.** Future scheduling
options (choice deliberately left open): **Render cron/background worker** *or* **Supabase scheduled
job** — to be decided when the operational trigger is built.

### Analytics RLS (role-scoped, no cross-hotel)
`platform_admin` platform-wide; `hotel_admin` all four for its hotels; `editor` AI-quality +
content-health; `reception` operations; `marketing` newsletter; `read_only` safe summaries of all
four; anon/no-membership/suspended denied. Writes only via the DEFINER refresh functions +
`service_role`.

---

## RLS / privilege matrix (Package C summary)
| Data | platform_admin | hotel_admin | editor | marketing | reception | read_only | anon | service_role |
|---|---|---|---|---|---|---|---|---|
| Public assets | full | manage | manage | manage | read | read | read (public bucket) | manage |
| Private (consent/doc) assets | full | read | — | — | read | — | — | full |
| Subscribers | full | manage | — | manage | read (consent status) | — | — | manage |
| Segments/templates/campaigns | full | manage | read (templates) | manage | read (no send) | read summaries | — | manage |
| Webhook events | full | — | — | — | — | — | — | append-only |
| AI-quality / content-health analytics | all | own | own | — | — | summaries | — | write via fn |
| Operations analytics | all | own | — | — | own | summaries | — | write via fn |
| Newsletter analytics | all | own | — | own | — | summaries | — | write via fn |

RLS from row one; **REVOKE ALL → precise GRANT**; append-only tables deny DELETE even to
service_role; `service_role` grants are the minimum for the future Brevo adapter/webhooks; no reliance
on Supabase default privileges.

## Sensitive-data safeguards
- **Storage**: private buckets have no anon/authenticated policies (signed-URL-only via backend);
  public writes path-validated; asset audit never carries paths-as-secrets or signed URLs.
- **Newsletter**: subscriber emails/PII, provider IDs, webhook payloads and recipient details are
  RLS-restricted and **redacted from audit** (subscriber audit records status only, never the email).
- **Analytics**: aggregate tables contain **no PII columns** (verified) — counts and rates only.

## Audit & retention integration
Redacted audit for asset/usage, template/campaign changes, campaign scheduling/cancellation,
subscriber status changes (no email), and (implicitly) analytics via calc_version. `content_versions`
covers newsletter templates (and existing publishable content). `retention_policies` gains valid
`data_type` targets: `consent-files`/private assets, deleted/unused assets, campaign recipients &
events, newsletter webhook payloads, and analytics aggregates. **No deletion jobs executed.**

## Synthetic seed
`supabase/seed.sql` (dev only): Demo Hotel logo + room hero + shared destination POI image + a
**private synthetic** consent signature (+ usages); newsletter subscribers (subscribed + unsubscribed,
`@verify.local`), a static + a rule segment, a draft + published template, a draft + scheduled
campaign, a recipient + event; and one synthetic daily row per analytics table. No real send, no
real recipients, no Antique Split media/tokens.

## Architectural discoveries
1. **`postgres` can manage Storage in migrations** — it holds INSERT on `storage.buckets` and may
   `create policy` on `storage.objects` (owned by `supabase_storage_admin`), so buckets + object
   policies live in normal forward migrations (no dashboard step).
2. **Private buckets need *no* RLS policies** — omitting authenticated/anon policies is the safest
   "backend-signed-URL-only" posture; `service_role` bypasses RLS for legitimate backend access.
3. **Path validation belongs in a SECURITY DEFINER helper** — `can_manage_media()` parses the
   object path with exception-guarded casts and checks role, so a storage policy never trusts the
   client path and never errors on a malformed path.
4. **Pass `date` params as text** — pg-node round-trips a `date` through a JS `Date` and can shift a
   day across timezones; analytics refresh takes `p_day` and callers should pass `'YYYY-MM-DD'` text.

## Known limitations (R1)
- Image transforms are on-the-fly (documented dimensions/quality); no physical variant rows.
- Segment rule engine supports a bounded field/op set (locale/country/source/status/tag; eq/in) — no
  stay-period/booking-source rules yet.
- No Brevo adapter, no send, no webhook processor code (schema + boundary only).
- Analytics are refresh-on-demand; no scheduler; formulas are `v1` coverage/completeness proxies.
- Retention/deletion jobs remain future work.

## Rollback / rebuild
Forward-only. Rebuild dev with `supabase db reset` (re-applies all migrations + seed + buckets). No
manual dashboard edits were made.

## Test evidence
- `npm run verify:supabase:packagec` → **115 passed, 0 failed** (real Auth users + synthetic Storage
  objects): buckets/policies/RLS/anon-deny/no-over-grant; asset ownership/size/private-bucket rules,
  finalize, private-asset role restriction, tenant isolation, usage tracking, cross-hotel-usage
  rejection, soft-delete-blocked-while-used; Storage functional (anon-denied private upload,
  service_role signed URL, hotel path validation, cross-hotel path denied); subscriber
  normalization/uniqueness, consent-filtered audience, segment-rule validation (no arbitrary SQL),
  template publish/version + direct-publish block, campaign snapshot immutability after scheduling +
  template-change independence, reception-cannot-schedule, append-only events, idempotent webhook,
  no-Brevo-id, cross-tenant + PII protection; analytics tz-bucketed idempotent refresh, role-scoped
  access, tenant isolation, no-PII columns, versioned formulas; and an audit sweep proving **no**
  emails/paths/signed-URLs/consent-text leaked. Synthetic data/users/objects cleaned up; no real
  emails; no secrets logged.
- Regressions: Step 1 **35/0**, Step 2 **50/0**, Step 3 **40/0**, Step 4 **76/0**, Package A **90/0**,
  Package B **136/0**.
- Server boots (HTTP 200) with `DATA_PROVIDER=airtable`; `server/server.js` and `pwa/` unchanged from
  `v1.0.0-antique`; `main` frozen at `b158278`.
