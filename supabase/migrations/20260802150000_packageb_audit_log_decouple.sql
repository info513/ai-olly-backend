-- ============================================================================
-- Fix: decouple audit_log.hotel_id from hotels (forensic append-only log).
-- ----------------------------------------------------------------------------
-- FINDING (surfaced in Package B): AFTER DELETE audit triggers on operational
-- tables (guests/stays/requests/…) INSERT an audit_log row tagged with hotel_id
-- during a hotel's cascade delete. The Step 2 FK audit_log_hotel_fk (SET NULL)
-- is checked immediately on those inserts, but the hotel row is being removed in
-- the same statement → "violates foreign key constraint audit_log_hotel_fk",
-- making hotels undeletable.
--
-- Correct model: an audit log is a forensic record that must OUTLIVE the entities
-- it references. hotel_id is a denormalized tag, not a live relationship — Step 1
-- created it as a plain column with no FK. Drop the Step 2 FK so audit history
-- survives entity deletion and cascade deletes no longer fail. The index remains.
-- content_versions/retention_policies FKs are unaffected (not inserted mid-delete).
-- ============================================================================

alter table public.audit_log drop constraint if exists audit_log_hotel_fk;
