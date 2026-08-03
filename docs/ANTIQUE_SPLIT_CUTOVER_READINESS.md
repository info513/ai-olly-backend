# Antique Split — Cutover Readiness

**Sprint 9 · Part 20.** Per-domain readiness for a *future* production migration. This sprint
proved **DEV parity only**. It does **not** authorize production cutover, does not create
production Supabase, and does not switch `DATA_PROVIDER`.

## Verdict by domain

| Domain | Verdict | Basis / blockers |
|---|---|---|
| Tenancy (destination + hotel) | ✅ READY | Canonical address/phone/mobile/check-in-out; single hotel; idempotent; no duplicates. |
| Rooms + access tokens | ✅ READY | 8/8 rooms, 5 types, Pattern C; Smart Glass 101/201/301; **TOKEN MATCH**; reset+reimport preserves tokens. |
| Services | ⚠️ READY WITH WARNINGS | 94 migrated (83 published). Wall-of-text → conservative structured blocks; a subset benefits from editorial pass; embedded prices partially structured. |
| Destination content (POI/events) | ⚠️ READY WITH WARNINGS | 22 POIs + 11 events clean; **route→POI graph deferred** (stored as waypoint text). |
| Pricing | ⚠️ READY WITH WARNINGS | 35 items parsed; **VAT & validity unknown from source** (flagged `needs_review`); extra-bed/transfer prices need confirmation from authoritative content. |
| AI | ⚠️ READY WITH WARNINGS | Config (persona/tone/output/safe-handoff) migrated; 598 aliases classified but not bulk-imported; knowledge articles minimal by design (services carry facts). |
| Media / imagery | ⚠️ READY WITH WARNINGS | Zero binaries to migrate; **imagery (hero/icons/POI photos) is pending content**, not a data gap. |
| Guest PII (guests/stays/consent/requests/logs) | ⛔ NOT READY | Intentionally never migrated. A production cutover needs a separate PII+consent migration design with legal review. |

## Overall

**NOT READY for production cutover.** DEV parity is **PROVEN** (all domain counts MATCH, room
matrix all-PASS, TOKEN MATCH, idempotent + reversible). The blockers below must be resolved
before any production decision.

## Exact blockers before production migration

1. **Guest PII + consent migration** — design a separate, consented, legally-reviewed path for
   GUESTS/STAYS/PRIVOLE/REQUESTS (and decide retention for AI_RESPONSE_LOGS). Not attempted here.
2. **Production Supabase project** — does not exist; must be provisioned and hardened (out of scope, requires approval).
3. **Provider cutover mechanics** — `DATA_PROVIDER` switch, compare-mode in the live guest path,
   and rollback plan are not built (deferred to the cutover package).
4. **Pricing review** — confirm VAT treatment + validity dates + extra-bed/transfer prices from an authoritative source.
5. **Route→POI graph** — migrate the ordered POI relationships from waypoint text to linked records.
6. **City/dynamic feeds** — SERVICES (Out), Split Today (49) need a scheduled feed, not static import.
7. **Imagery** — hero photos, app icons, POI photography must be produced and (optionally) copied to Storage after manifest approval.
8. **Pre-existing token exposure** — a room-201 access token is committed in `docs/AI_OLLY_LAUNCH_CHECKLIST.md`; scrub + rotate before launch (flagged separately; rotation was out of scope here).

## Recommended next step

Keep iterating in DEV: author the small knowledge-article set + curated aliases, complete the
pricing/VAT review, and build the route→POI graph. Only after those, open a dedicated **cutover
package** (production Supabase provisioning + PII/consent plan + provider switch + live compare-mode).
Do not begin production cutover from this sprint.
