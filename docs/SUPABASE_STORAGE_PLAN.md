# Supabase Storage Plan

> **Planning only.** No buckets created, no media uploaded or migrated in Phase 1. Proposes asset classes + policies for the Storage phase.
> Date: 2026-07-31.

## Principles
- **Per-tenant organisation** — every asset path is namespaced by tenant (`<tenant>/…`), enforced by Storage RLS in the Storage phase.
- **Public vs private** — guest-facing media is public/CDN-cacheable; anything with PII or legal weight is **private, signed-URL only**.
- **Metadata is required** — alt text (accessibility/SEO), rights/source (who owns the photo), and usage tracking (where it's referenced).
- **Video is likely external** — large video should generally use Vimeo/YouTube/CDN, not Storage, unless there's a strong reason.

## Proposed asset classes

| Class | Public/Private | Likely bucket | Max size (proposed) | Accepted types | Notes |
|---|---|---|---|---|---|
| Hotel images | Public | `media-public` | 10 MB | jpg, png, webp | hero + gallery per hotel |
| Room images | Public | `media-public` | 10 MB | jpg, png, webp | per room type |
| POI images | Public | `media-public` | 10 MB | jpg, png, webp | fixes the empty POI heroes |
| Route images | Public | `media-public` | 10 MB | jpg, png, webp | per route/category |
| News images | Public | `media-public` | 8 MB | jpg, png, webp | NOVOSTI |
| Logos | Public | `media-public` | 2 MB | png, svg, webp | brand marks |
| Icons / app icons | Public | `media-public` | 1 MB | png, svg | incl. the missing PWA icons |
| Whispers images | Public | `media-public` | 10 MB | jpg, png, webp | cultural series |
| Whispers video/audio | **External preferred** | (Vimeo/CDN) or `media-video` | n/a / 200 MB | mp4, mp3 | prefer external hosting for bandwidth/cost |
| Documents (guest-facing) | Public or Private | `documents` | 20 MB | pdf | depends on sensitivity |
| **Consent signatures** | **Private** | `consent-private` | 2 MB | png | PII — signed URLs only |
| **Generated consent PDFs** | **Private** | `consent-private` | 10 MB | pdf | legal/PII — signed URLs only |
| Newsletter assets | Public | `media-public` | 8 MB | jpg, png, webp | campaign images |

*(Sizes/types are proposals to confirm in the Storage phase.)*

## Required metadata per asset
- **alt text** (accessibility + SEO)
- **rights/source** (owner, licence, credit)
- **uploaded by / at** (audit)
- **usage references** (which content records use it — enables "asset usage tracking" and safe deletion)
- **lifecycle/retention** (esp. consent artefacts — retention + erasure rules)

## Access model (to implement in Storage phase)
- Public buckets: read-open, write via authenticated dashboard only; served via CDN.
- Private buckets: no public read; access via time-limited **signed URLs** issued by the server; Storage RLS scoped to tenant + role.
- Image pipeline: decide Supabase on-the-fly **image transformations** vs pre-generated sizes (hero/card/thumbnail); prefer webp/avif.

## Lifecycle / retention
- Guest-facing media: retained while referenced; orphan cleanup via usage tracking.
- **Consent signatures/PDFs:** retained per legal requirement, then erasable on data-subject request (GDPR).

## Migration
- Historical Airtable attachments (existing PRIVOLE signatures) — decide migrate vs archive in the Storage phase. **Not done in Phase 1.**

## Out of scope for Phase 1
No buckets, no uploads, no migration, no transforms.
