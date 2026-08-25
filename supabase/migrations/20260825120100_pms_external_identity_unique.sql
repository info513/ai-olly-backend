-- Additive (Phase R2): DB-level idempotency for PMS-sourced entities. A given external
-- reservation/guest maps to exactly one stay/guest per hotel, so re-processing a webhook
-- or re-running initial sync updates the same row (ON CONFLICT) instead of duplicating.
-- Partial (external_id not null) so manual stays/guests (external_id NULL) are unaffected.
create unique index if not exists stays_external_ident
  on public.stays (hotel_id, external_source, external_id) where external_id is not null;
create unique index if not exists guests_external_ident
  on public.guests (hotel_id, external_source, external_id) where external_id is not null;
