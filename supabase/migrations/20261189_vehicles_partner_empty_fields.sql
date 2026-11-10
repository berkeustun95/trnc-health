-- ═══════════════════════════════════════════════════════════════════════════
-- 20261189 — Araçlar: a partner may leave a field empty (price, km, …); private sellers may not
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Berke, 2026-11-10, a standing rule for ALL partners and dealers: an empty field in a partner's stock list is on
-- purpose (buyers are meant to call and ask). The car is imported with the field EMPTY: never skipped, never given
-- an invented value. The app shows "Fiyat için ara" / "Km için sor" instead of a blank, and a filter on that field
-- leaves the car out (no guess).
--
-- So for dealer and import rows these may be NULL: km, year, fuel, gearbox, body_type, colour, steering, currency,
-- region, and the price (price for a sale, price_per_day for a rental). make, model and intent stay required for
-- every row: without them there is no listing.
--
-- PRIVATE sellers keep every one of them required, exactly as before:
--   • vehicles_private_required_check: a private row has all nine columns.
--   • vehicles_price_check: a sale never carries a daily price and a rental never a sale price (all rows); a private
--     sale has a price and a private rental a daily price.
-- The İlan ver form already requires them (constants/cars.js carFormError); this is the table saying the same.
--
-- The enum / range CHECKs (fuel IN …, km BETWEEN …, currency IN …) are untouched: NULL passes a CHECK, a wrong value
-- still does not. No grant, policy or function changes; vehicles_guard compares rows with IS DISTINCT FROM.
--
-- ORDER: no app dependency. Builds that predate the "ask" labels show nothing where a value is missing (their
-- labels already skip NULL), and only ADA Preview can see an inactive dealer's cars.
--
-- Apply: supabase-migrate, one file. Column nullability changes ⇒ ends with NOTIFY pgrst.
-- ═══════════════════════════════════════════════════════════════════════════

SET ROLE postgres;

BEGIN;

SET LOCAL lock_timeout = '5s';

LOCK TABLE public.vehicles IN ACCESS EXCLUSIVE MODE;

DO $$
DECLARE v_def text; v_cols text;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO v_def FROM pg_constraint
   WHERE conrelid = 'public.vehicles'::regclass AND conname = 'vehicles_price_check';
  IF v_def IS NULL OR v_def LIKE '%private%' THEN
    RAISE EXCEPTION 'REFUSING: vehicles_price_check is missing or already source-aware (was this already run?). Nothing applied.';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.vehicles'::regclass AND conname = 'vehicles_private_required_check') THEN
    RAISE EXCEPTION 'REFUSING: vehicles_private_required_check already exists. Nothing applied.';
  END IF;
  SELECT string_agg(attname, ',' ORDER BY attname) INTO v_cols FROM pg_attribute
   WHERE attrelid = 'public.vehicles'::regclass AND attnum > 0 AND NOT attisdropped AND attnotnull
     AND attname IN ('km', 'year', 'fuel', 'gearbox', 'body_type', 'colour', 'steering', 'currency', 'region');
  IF v_cols IS DISTINCT FROM 'body_type,colour,currency,fuel,gearbox,km,region,steering,year' THEN
    RAISE EXCEPTION 'REFUSING: the nine columns are not all NOT NULL today (%): the table is not what 20261165 left. Nothing applied.', v_cols;
  END IF;
END $$;

ALTER TABLE public.vehicles
  ALTER COLUMN km        DROP NOT NULL,
  ALTER COLUMN year      DROP NOT NULL,
  ALTER COLUMN fuel      DROP NOT NULL,
  ALTER COLUMN gearbox   DROP NOT NULL,
  ALTER COLUMN body_type DROP NOT NULL,
  ALTER COLUMN colour    DROP NOT NULL,
  ALTER COLUMN steering  DROP NOT NULL,
  ALTER COLUMN currency  DROP NOT NULL,
  ALTER COLUMN region    DROP NOT NULL;

-- A private seller's listing is complete, as it always was.
ALTER TABLE public.vehicles ADD CONSTRAINT vehicles_private_required_check CHECK (
  source <> 'private'
  OR (km IS NOT NULL AND year IS NOT NULL AND fuel IS NOT NULL AND gearbox IS NOT NULL AND body_type IS NOT NULL
      AND colour IS NOT NULL AND steering IS NOT NULL AND currency IS NOT NULL AND region IS NOT NULL));

-- A sale never has a daily price, a rental never a sale price; a PRIVATE listing always has its own price.
ALTER TABLE public.vehicles DROP CONSTRAINT vehicles_price_check;
ALTER TABLE public.vehicles ADD CONSTRAINT vehicles_price_check CHECK (
     (intent = 'sale' AND price_per_day IS NULL AND (price IS NOT NULL OR source <> 'private'))
  OR (intent = 'rent' AND price IS NULL AND (price_per_day IS NOT NULL OR source <> 'private')));

COMMENT ON COLUMN public.vehicles.km IS 'NULL only on dealer / import rows: the partner left it empty on purpose (buyers ask). Private rows always have it (vehicles_private_required_check). 20261189.';
COMMENT ON COLUMN public.vehicles.price IS 'Sale price in the listing''s own currency. NULL on a rental; on a dealer / import sale NULL means "call for the price" (20261189). A private sale always has it.';

DO $$
DECLARE v_cols text; v_def text;
BEGIN
  SELECT string_agg(attname, ',' ORDER BY attname) INTO v_cols FROM pg_attribute
   WHERE attrelid = 'public.vehicles'::regclass AND attnum > 0 AND NOT attisdropped AND attnotnull;
  -- What stays required for every row, partner or private.
  IF v_cols IS DISTINCT FROM 'created_at,id,intent,make,model,source,status,updated_at' THEN
    RAISE EXCEPTION 'vehicles NOT NULL columns are not the expected eight: %', v_cols;
  END IF;
  SELECT pg_get_constraintdef(oid) INTO v_def FROM pg_constraint
   WHERE conrelid = 'public.vehicles'::regclass AND conname = 'vehicles_private_required_check';
  IF v_def IS NULL OR (SELECT bool_or(v_def NOT LIKE '%' || c || ' IS NOT NULL%')
                         FROM unnest(ARRAY['km', 'year', 'fuel', 'gearbox', 'body_type', 'colour', 'steering', 'currency', 'region']) c) THEN
    RAISE EXCEPTION 'vehicles_private_required_check does not require all nine columns: %', v_def;
  END IF;
  SELECT pg_get_constraintdef(oid) INTO v_def FROM pg_constraint
   WHERE conrelid = 'public.vehicles'::regclass AND conname = 'vehicles_price_check';
  -- Both branches (sale, rent) must name private sellers: 'private' appears twice.
  IF v_def NOT LIKE '%price_per_day IS NULL%' OR v_def NOT LIKE '%price IS NULL%'
     OR (length(v_def) - length(replace(v_def, 'private', ''))) / 7 <> 2 THEN
    RAISE EXCEPTION 'vehicles_price_check is not the source-aware form: %', v_def;
  END IF;
  -- Nothing that exists today became invalid, and no private row lost a value.
  IF EXISTS (SELECT 1 FROM public.vehicles WHERE source = 'private'
              AND (km IS NULL OR year IS NULL OR currency IS NULL OR region IS NULL OR (price IS NULL AND price_per_day IS NULL))) THEN
    RAISE EXCEPTION 'a private listing is missing a required value';
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
VALUES ('20261189_vehicles_partner_empty_fields.sql', 'db66b738ab40179189ba55ec86489cb75f634ac9e148a5a8c4827a16cb9b363f')
ON CONFLICT (filename) DO UPDATE
  SET checksum = excluded.checksum, applied_at = now(), applied_by = current_user;
-- ─── ledger:stamp:end ────────────────────────────────────────────────
COMMIT;

RESET ROLE;

NOTIFY pgrst, 'reload schema';

-- ─── Verification after applying (read-only, run alone) ─────────────────────
--   verify_schema QUERY 1: the 20261189 row reads OK.
--
-- ─── Rollback ───────────────────────────────────────────────────────────────
--   Only while no row has a NULL in the nine columns or a missing price:
--   ALTER COLUMN … SET NOT NULL for the nine; DROP CONSTRAINT vehicles_private_required_check; re-add the 20261165
--   vehicles_price_check; revert the verify_schema row; delete the schema_migrations_applied row.
