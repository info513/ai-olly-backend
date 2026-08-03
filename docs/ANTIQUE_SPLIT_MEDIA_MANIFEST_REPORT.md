# Antique Split — Media Manifest Report

**Sprint 9 · Part 10.** No production media is copied into Supabase Storage. This report is the
prerequisite manifest; a Storage copy requires **separate approval** after review.

## Finding: no Airtable binaries to migrate

The read-only export inspected every content table for attachment fields:

| Table | Records with attachments | Files |
|---|--:|--:|
| POI | 0 | 0 |
| ROUTES (Galerija) | 0 | 0 |
| ROOM GUIDE | 0 | 0 |
| SERVICES | 0 | 0 |
| PARTNERS | 0 | 0 |

**Total Airtable content attachments: 0.** The only attachment fields with data in the base are
`PRIVOLE.Potpis` (guest consent signatures — **PII, never migrated**) and `Table 15` (an unused
Airtable template). Imagery for the guest experience is **external or pending**: hero-image slots
are empty (`--hero-img: none`), app icons are placeholder `.gitkeep`, and POI/route photography
is not yet in Airtable. This matches the v1 documentation's known-open items.

## Manifest schema (for a future Storage copy)

Each future attachment would be catalogued with: source URL · filename · MIME · size · source
record · intended `asset_type` · owner scope (public/private) · intended usage · alt-text status ·
rights/source status · duplicate hash · priority · **action** (migrate / retain external /
replace / archive / manual review). With zero current attachments, the manifest `items` array is
empty.

## Storage testing

Automated Storage tests use **synthetic files only** (per the Sprint 6 asset seed). No production
binary is uploaded. Producing the imagery (hero photos, icons, POI photography) is a content task,
not a data migration — tracked separately.

## Verdict

**READY (nothing to copy).** Media migration is a no-op for data; imagery completeness is a
separate content gap flagged in cutover readiness.
