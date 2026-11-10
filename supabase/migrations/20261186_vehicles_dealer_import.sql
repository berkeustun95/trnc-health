-- ═══════════════════════════════════════════════════════════════════════════
-- 20261186 — Araçlar: dealer stock imports (consent on the dealer row, one car per dealer reference, 'minibus')
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Berke, 2026-11-10: the first real dealer (Mustafa Üstüner Otomotiv) comes in from a hand-collected CSV, one row per
-- car, matched by the dealer's own listing number. Three small things the importer (scripts/import-dealer-cars.mjs)
-- needs, in one run:
--
--   1. dealers.consent_date / consent_note: when and how the owner agreed to be shown in ADA. Private: the table-level
--      SELECT on dealers becomes a column grant on the thirteen existing columns, so no client (anon, signed in, admin)
--      reads the consent columns; service_role writes and reads them. Every client read of dealers names its columns
--      (constants/cars.js DEALER_COLS, AdminScreen dealers(name)).
--   2. vehicles_dealer_external_key: UNIQUE (dealer_id, external_id) for dealer rows that carry a reference. A dealer's
--      listing number can be imported once only; the importer matches a new CSV against it. The existing
--      vehicles_external_key (source_site, external_id) cannot do this: a dealer row has source_site NULL.
--   3. vehicles_body_type_check gains 'minibus' (a 1998 Mercedes minibus is neither a van nor a minivan).
--      constants/cars.js BODY_LABEL_KEY and the nine languages ship in the same PR.
--
-- Nothing here shows a car to anyone: a dealer row is created inactive by the importer, later.
--
-- Apply: supabase-migrate, one file. dealers gains columns ⇒ ends with NOTIFY pgrst.
-- ═══════════════════════════════════════════════════════════════════════════

SET ROLE postgres;

BEGIN;

SET LOCAL lock_timeout = '5s';

DO $$
DECLARE v_def text;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO v_def FROM pg_constraint
   WHERE conrelid = 'public.vehicles'::regclass AND conname = 'vehicles_body_type_check';
  IF v_def IS NULL OR v_def NOT LIKE '%minivan%' OR v_def LIKE '%minibus%' THEN
    RAISE EXCEPTION 'REFUSING: vehicles_body_type_check is missing or already has minibus (is 20261165 applied, or was this already run?). Nothing applied.';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'dealers' AND column_name LIKE 'consent%') THEN
    RAISE EXCEPTION 'REFUSING: dealers already has a consent column. Nothing applied.';
  END IF;
  IF (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'dealers') <> 13 THEN
    RAISE EXCEPTION 'REFUSING: dealers does not have the 13 columns of 20261165; the column grant below would hide a column nobody reviewed. Nothing applied.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.vehicles WHERE source = 'dealer' AND external_id IS NOT NULL
              GROUP BY dealer_id, external_id HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'REFUSING: a dealer already has two cars with the same reference. Nothing applied.';
  END IF;
END $$;

-- ─── 1. consent, readable by no client ──────────────────────────────────────
ALTER TABLE public.dealers
  ADD COLUMN consent_date date,
  ADD COLUMN consent_note text,
  ADD CONSTRAINT dealers_consent_note_check CHECK (consent_note IS NULL OR char_length(consent_note) BETWEEN 1 AND 300);

COMMENT ON COLUMN public.dealers.consent_date IS 'The day the owner agreed to be shown in ADA. service_role only (no client column grant). 20261186.';
COMMENT ON COLUMN public.dealers.consent_note IS 'Who agreed and how. service_role only (no client column grant). 20261186.';

REVOKE SELECT ON public.dealers FROM anon, authenticated;
GRANT SELECT (id, slug, name, logo_path, phone, whatsapp, region, area, website, is_rental_company, is_active, created_at, updated_at)
  ON public.dealers TO anon, authenticated;

-- ─── 2. one car per dealer reference ────────────────────────────────────────
CREATE UNIQUE INDEX vehicles_dealer_external_key ON public.vehicles (dealer_id, external_id)
  WHERE source = 'dealer' AND external_id IS NOT NULL;

-- ─── 3. 'minibus' ───────────────────────────────────────────────────────────
ALTER TABLE public.vehicles DROP CONSTRAINT vehicles_body_type_check;
ALTER TABLE public.vehicles ADD CONSTRAINT vehicles_body_type_check
  CHECK (body_type IN ('sedan', 'hatchback', 'suv', 'estate', 'coupe', 'convertible', 'pickup', 'van', 'minivan', 'minibus'));

DO $$
DECLARE v_cols text;
BEGIN
  SELECT string_agg(a.attname, ',' ORDER BY a.attname) INTO v_cols FROM pg_attribute a
   WHERE a.attrelid = 'public.dealers'::regclass AND a.attnum > 0 AND NOT a.attisdropped
     AND NOT has_column_privilege('anon', a.attrelid, a.attnum, 'SELECT');
  IF v_cols IS DISTINCT FROM 'consent_date,consent_note' THEN
    RAISE EXCEPTION 'anon should be unable to read exactly the consent columns of dealers, got: %', v_cols;
  END IF;
  SELECT string_agg(a.attname, ',' ORDER BY a.attname) INTO v_cols FROM pg_attribute a
   WHERE a.attrelid = 'public.dealers'::regclass AND a.attnum > 0 AND NOT a.attisdropped
     AND NOT has_column_privilege('authenticated', a.attrelid, a.attnum, 'SELECT');
  IF v_cols IS DISTINCT FROM 'consent_date,consent_note' THEN
    RAISE EXCEPTION 'authenticated should be unable to read exactly the consent columns of dealers, got: %', v_cols;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.dealers'::regclass AND a.attnum > 0 AND NOT a.attisdropped
              AND (has_column_privilege('anon', a.attrelid, a.attnum, 'INSERT,UPDATE') OR has_column_privilege('authenticated', a.attrelid, a.attnum, 'INSERT,UPDATE'))) THEN
    RAISE EXCEPTION 'a client can write a dealers column';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'vehicles_dealer_external_key'
                  AND indexdef LIKE 'CREATE UNIQUE INDEX%(dealer_id, external_id)%') THEN
    RAISE EXCEPTION 'vehicles_dealer_external_key is missing or not unique on (dealer_id, external_id)';
  END IF;
  IF (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid = 'public.vehicles'::regclass AND conname = 'vehicles_body_type_check')
     NOT LIKE '%minibus%' THEN
    RAISE EXCEPTION 'vehicles_body_type_check has no minibus';
  END IF;
END $$;

-- ─── ledger:stamp:begin ──────────────────────────────────────────────
-- Machine-generated by scripts/migration-ledger.mjs --stamp. Do not hand-edit.
-- The checksum is of THIS FILE WITH THIS BLOCK STRIPPED, which is what lets the file
-- carry its own stamp. Everything between the markers is excluded from the checksum
-- but still runs — so it may contain NOTHING but this INSERT. See the note in the
-- generator: anything else here would execute on paste while leaving no trace in the
-- hash, and the ledger would be attesting a file it never actually verified.
--
-- This is also the LAST statement inside BEGIN/COMMIT: if a paste is truncated before
-- it, COMMIT is never reached and nothing applies.
INSERT INTO public.schema_migrations_applied (filename, checksum)
VALUES ('20261186_vehicles_dealer_import.sql', 'fcbf2f45f694c22e117cf4053083b760862070c1478f1098dfa0303223dc4ba9')
ON CONFLICT (filename) DO UPDATE
  SET checksum = excluded.checksum, applied_at = now(), applied_by = current_user;
-- ─── ledger:stamp:end ────────────────────────────────────────────────
COMMIT;

RESET ROLE;

NOTIFY pgrst, 'reload schema';

-- ─── Verification after applying (read-only, run alone) ─────────────────────
--   verify_schema QUERY 1: the 20261186 rows and the 20261165 grants row read OK.
--
-- ─── Rollback ───────────────────────────────────────────────────────────────
--   Only while no car has body_type 'minibus' and no dealer row carries consent:
--   re-add vehicles_body_type_check without 'minibus'; DROP INDEX vehicles_dealer_external_key;
--   GRANT SELECT ON public.dealers TO anon, authenticated; ALTER TABLE dealers DROP COLUMN consent_date, DROP COLUMN
--   consent_note; revert the verify_schema rows; delete the schema_migrations_applied row.
