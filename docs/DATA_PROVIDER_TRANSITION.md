# Data Provider Transition

> Phase 1 foundation — **design of the provider boundary, not a full implementation.** Airtable stays the default and the live source of truth. Supabase is introduced endpoint-by-endpoint later. No production switch in this phase.
> Date: 2026-07-31.

## The switch

A single environment variable selects the data backend used by the **data layer** (never by the guest PWA directly):

| Variable | Values | Default | Meaning |
|---|---|---|---|
| `DATA_PROVIDER` | `airtable` \| `supabase` | **`airtable`** | Which backend the data layer reads/writes. |
| `DATA_PROVIDER_COMPARE` | `true` \| `false` | **`false`** | Optional: read from both, serve Airtable, log only *shape/consistency* differences (never PII). |

## Principles (locked)

1. **Airtable remains default.** With `DATA_PROVIDER=airtable` (or unset) the app behaves exactly as v1. Boot must not depend on any Supabase variable.
2. **API contracts are unchanged.** Every `/api/*` response keeps its current shape regardless of provider — the guest PWA cannot tell the difference.
3. **Endpoint-by-endpoint.** Supabase implementations are added one endpoint at a time, behind the switch, verified against Airtable output before that endpoint is allowed to use `supabase` in any shared environment.
4. **Compare mode is safe.** When enabled, it may log field presence / counts / mismatched keys — **never** guest PII (no names, emails, phone numbers, signatures, message bodies). Compare runs in dev/staging only.
5. **No production switch in Phase 1.** Production stays on Airtable until a full, verified, reversible cutover.

## The boundary (skeleton only — no behaviour change)

The intended shape is a thin **provider interface** the endpoints call instead of Airtable directly:

```
API endpoint  ──▶  data layer (provider-agnostic)  ──▶  { airtable | supabase } implementation
```

- Today, `server/server.js` calls Airtable helpers directly (getHotelRecord, getRoomGuideRecord, getServicesForHotelPwa, POI/route mappers, …). These become the **airtable** implementation of the interface.
- A **supabase** implementation is filled in per method in later phases.
- A tiny selector reads `DATA_PROVIDER` and returns the active implementation.

> Phase 1 adds only the isolated Supabase client (`server/data/supabase/client.js`) — **not** the interface refactor. The full data-layer abstraction is a Database/Migration-phase task. `server/server.js` is **not** refactored in Phase 1, so v1 behaviour is untouched.

## Rollback

`DATA_PROVIDER=airtable` is the instant rollback lever: flip it back and the app serves from Airtable again, no code change. This is why Airtable code is **not removed** during migration.

## Out of scope for Phase 1
- No interface refactor of `server.js`.
- No Supabase read/write of business data.
- No compare-mode implementation.
- No endpoint switched to `supabase`.
