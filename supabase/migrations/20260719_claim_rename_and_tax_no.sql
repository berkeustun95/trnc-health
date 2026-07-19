-- ─── claim_requests — rename business flag + add tax registration number ────
-- Follow-up to 20260719_claim_evidence_and_guard.sql (already applied). Two small
-- schema changes reflecting decisions made after that ran. ADDITIVE + a RENAME —
-- no approve/reject logic, no RLS, no insert-guard changes; safe to ship ahead of
-- the app work.
--
--   1. RENAME kteb_confirmed → business_verified. KTEB (pharmacists' union) is no
--      longer the verification authority; the flag now means the general "an admin
--      confirmed this is a real business", not pharmacy-specific. A rename keeps
--      the type/default (boolean NOT NULL DEFAULT false) and all data — no change.
--      Verified nothing else references the old name: the column was introduced
--      in the prior migration and is not wired into any policy, function, trigger,
--      or view yet.
--   2. ADD tax_registration_no (Turkish "Vergi Sicil Numarası") — the universal
--      proof-of-business evidence collected for ALL facility claims (pharmacy,
--      clinic, hospital, dentist, vet), not pharmacy-specific.
--      NULLABLE at the DB level ON PURPOSE: existing facilities (~397 rows) and
--      existing claim_requests have no tax number, so a NOT NULL column would
--      break them. "Required" is enforced at claim time in the app (Step 2), not
--      by the database. English column name matches house schema naming; the
--      Turkish label lives in the app i18n layer.

BEGIN;

ALTER TABLE public.claim_requests
  RENAME COLUMN kteb_confirmed TO business_verified;

ALTER TABLE public.claim_requests
  ADD COLUMN IF NOT EXISTS tax_registration_no text;

COMMIT;

-- Rollback:
--   BEGIN;
--   ALTER TABLE public.claim_requests DROP COLUMN IF EXISTS tax_registration_no;
--   ALTER TABLE public.claim_requests
--     RENAME COLUMN business_verified TO kteb_confirmed;
--   COMMIT;
