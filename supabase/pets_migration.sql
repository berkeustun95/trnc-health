-- ─── Pets Module Migration ──────────────────────────────────────────────────
-- Run in Supabase SQL editor.
-- Adds 'vet' as a valid facility type so veterinary clinics can be listed
-- using the existing facilities infrastructure (RLS, bookings, reviews, Q&A).

-- 1. Drop existing type check constraint if one exists, then recreate with 'vet'
--    (If no constraint exists, the ALTER TABLE ADD CONSTRAINT below is sufficient.)
ALTER TABLE facilities
  DROP CONSTRAINT IF EXISTS facilities_type_check;

ALTER TABLE facilities
  ADD CONSTRAINT facilities_type_check
  CHECK (type IN ('pharmacy', 'clinic', 'hospital', 'dentist', 'vet'));

-- 2. (Optional) Seed a placeholder vet clinic for testing.
--    Remove or replace with real data before production.
-- INSERT INTO facilities (name, type, address, phone, verified)
-- VALUES ('Test Veterinary Clinic', 'vet', 'Kyrenia, TRNC', '+90 392 000 0000', false);
