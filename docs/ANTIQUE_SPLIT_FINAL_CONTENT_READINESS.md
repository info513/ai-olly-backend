# Antique Split — Final Content Readiness

**Closes the remaining content gaps before production provisioning.** DEV-only (aiolly-dev);
Airtable + the v1 PWA were read-only sources; no production, PII, tokens, or DATA_PROVIDER touched;
no cutover. Companion: `ANTIQUE_SPLIT_CONTENT_COMPLETION.md`, `ANTIQUE_SPLIT_MEDIA_COMPLETION_PLAN.md`,
`ANTIQUE_SPLIT_FINAL_RC1_VERIFICATION.md`.

## What this task added (idempotent, source-backed)

| Item | Result | Source (read-only) |
|---|--:|---|
| **Whispers chapters** | **12** → `destination_whispers` + 12 `hotel_whisper_settings` | v1 PWA `pwa/whispers-data.js` (verbatim: titles, order, chapter text, "Did you know") |
| **Extra-bed price** | **€40/night** structured `price_item`, linked to the 2 eligible room types | ROOM GUIDE `Room features` + `docs/ANTIQUE_SPLIT_QA_ROUND_1.md` (CONFIRMED) |
| **VAT honesty** | all 36 price items flagged `vat_status:"unconfirmed"` | `vat_rate` is NOT NULL (schema default 0.00) — no rate invented; none > 0 |
| **Media** | **0 imported** (no source binaries exist anywhere) | Airtable 0 attachments + PWA 0 image files |

## Media imported / still required

- **Imported: none.** There are **zero image binaries** in Airtable or the PWA repo — nothing safe to
  upload; fabricating placeholders would be invention. `assets`/`asset_usages` for Antique Split are
  empty by design.
- **Still required (from the hotel / production):** logo, PWA icons (192/512), one hero, five
  room-type images, ~6 POI category fallbacks — the *minimum pilot set*. Everything else uses
  gradients/category fallbacks. Full plan + classification: `ANTIQUE_SPLIT_MEDIA_COMPLETION_PLAN.md`.

## Room imagery status

Strategy = **per-room-type** (5 images), not per-room (avoids duplicating equivalent rooms).
Resolution: `room override → room-type → hotel hero`. **Status: pending hotel/production files** — no
room photography exists in any source. Room *facts* are fully structured (Part below).

## POI / route / event imagery status

- POIs (22): category-fallback for pilot; per-POI photography = enhancement. **Pending.**
- Routes (6): route hero / first-POI fallback. **Pending.**
- Hotel events (11) + **Split Today (49)**: **category fallback**, explicitly *no unique image per
  time-sensitive event*. **Pending, non-blocking** (fallbacks defined).

## Whispers migration status

✅ **Complete.** All **12 chapters** migrated from the v1 PWA into `destination_whispers` with titles,
ordering (ch01→ch12), full chapter text, and "Did you know" preserved verbatim; 12
`hotel_whisper_settings` (visible, ch01 featured). Compare = **whispers 12 = 12 MATCH**. Imagery
(`story/*.jpg`) does not exist in the source → gradient fallback (as in v1); flagged for production.
Whispers are English-only in the source → no translations to migrate.

## Manual-review record decisions

| Record | Decision |
|---|---|
| **SERVICES (Out) — 1 active city service** | → **needs owner confirmation** whether it is destination content or knowledge; not force-fit (44 inactive correctly excluded) |
| **PARTNERS — 3 dining partners** | → **needs owner confirmation**; candidate mapping = hotel_services (Dining) or destination POIs; no "partner" entity exists, so deliberately not force-fit |

## Headline-price status

| Price | Classification | Basis |
|---|---|---|
| **Extra bed** | ✅ **CONFIRMED SOURCE** — €40/night, migrated | ROOM GUIDE features + QA Round-1 + v1 server extractor |
| **Private transfer** | **HOTEL CONFIRMATION REQUIRED** | UX-Bible mentions raising it *to €45* (illustrative, not the current confirmed rate); no amount in Airtable |
| **Breakfast** | **NO CHARGE** (included) | Services state breakfast is included by rate; no price |
| **Breakfast bag** | **PRICE ON REQUEST / HOTEL CONFIRMATION** | mentioned without an amount |
| **Room service** | **PRICE ON REQUEST** | contact reception; minibar items at minibar prices (migrated) |
| **VAT rate (all items)** | **HOTEL CONFIRMATION REQUIRED** | not in Airtable; never invented (schema default 0.00, flagged unconfirmed) |

No VAT, validity dates, or amounts were invented.

## Remaining hotel confirmations

1. Private-transfer price (and any other guest-facing amounts).
2. Breakfast-bag / room-service pricing (or confirm "on request").
3. **VAT rate** for the price items.
4. Mapping decision for the **1 SERVICES-Out** + **3 PARTNERS** records.
5. The **minimum media set** (logo, icons, hero, 5 room-type images, POI fallbacks).

## Verification results

- **Compare engine — 10/10 domains MATCH** (room_types, rooms, services, services_active, pois,
  routes, events, split_today, **whispers**, price_items) + **TOKEN MATCH** + services 22/2-transformed/0-missing.
- **`verify-antique-migration` — 51 passed / 0 failed** (incl. whispers count/order, extra-bed
  €40/night, VAT-not-invented, structured room facts, walking times, route graphs, knowledge).
- **`npm run rc1` — 25 passed / 0 failed** (idempotency, no secrets in bundle, no production writes).
- Media/asset checks: 0 assets → 0 orphans, 0 broken usages, no private-path/token leakage, no
  cross-hotel access (RLS + security audits green).

## Final completion

| Layer | Completion |
|---|--:|
| Structured content (rooms/services/POI/routes/events/Split-Today/knowledge/AI-config/prices/**Whispers**) | **~99%** |
| Confirmed prices | extra-bed done; transfer/breakfast-bag/room-service **need hotel input** |
| Manual-review records | **4 need owner mapping** |
| **Media / imagery** | **0% (pending hotel files / production)** |
| Operational data (guests/stays/consents/requests/subscribers) | **not migrated (PII — by design)** |

---

## Final verdict

### **READY WITH HOTEL INPUT REQUIRED**

Honestly: **the structured content migration is effectively complete** — with Whispers (12/12) and the
confirmed extra-bed price now in, all ten content domains MATCH, and the gate is green. What stands
between here and a launchable pilot is **hotel-supplied input, not engineering**:
1. **Media** — the minimum image set (logo, icons, hero, 5 room-type images, POI fallbacks) must be
   supplied/produced; **0 binaries exist in any source**, so nothing could be migrated (no invention).
2. **Price + mapping confirmations** — transfer/breakfast-bag/room-service prices, the VAT rate, and
   the 1 SERVICES-Out + 3 PARTNERS records need owner decisions.

This is **not** "READY FOR PRODUCTION PROVISIONING" — that additionally requires the production
Supabase project, the B1 token rotation, and the operational-data (PII) decision from the RC1 release
plan, none of which are content tasks. And it is well past "NOT READY" — the content itself is done.

**Do not treat this as cutover-ready.** Development content is complete; production provisioning and
the hotel inputs above remain. Once the hotel supplies the media + confirmations and production is
provisioned + hardened, re-run this verification on the production project before any cutover.

---

*DEV-only content/media completion — read-only sources; production, PII, tokens, DATA_PROVIDER
untouched; no cutover performed.*
