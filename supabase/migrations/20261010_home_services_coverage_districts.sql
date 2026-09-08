-- ─── Ev Hizmetleri — multi-district coverage ────────────────────────────────
--
-- Adds `home_services.coverage_districts text[]`: where a provider actually WORKS, as
-- opposed to `district`, which is where they are registered. Driven by the TadilArt
-- Cyprus partnership (Lefkoşa AND Girne); nothing in the schema could hold a provider
-- who serves two districts.
--
-- ─── WHY ADD A COLUMN RATHER THAN WIDEN `district` TO text[] ────────────────
--
-- `search_content()` reads `hs.district` as the subtitle of every home-services result
-- (20260912_search_tokenised_and_public_health_slice2.sql). Renaming or retyping that
-- column forces a CREATE OR REPLACE of the search function to ride along in the same
-- paste, plus edits in the onboarding form, the provider dashboard, AdminScreen and
-- schema_drift_audit.sql — a wide blast radius for a cosmetically tidier shape. Adding
-- alongside touches the search function not at all.
--
-- The shape is lifted from `towing_companies` (20260905): base_region + coverage_regions
-- + a base-inside-coverage CHECK. Same problem, same answer, and one precedent in this
-- repo is worth more than a second design.
--
-- ─── NOT NULL WITH NO DEFAULT — DELIBERATE ──────────────────────────────────
--
-- The tempting alternatives both fail quietly:
--   • DEFAULT '{}' contradicts the cardinality >= 1 CHECK, so every INSERT that omits the
--     column dies on a constraint rather than on the missing value — a confusing error
--     for the right reason.
--   • A BEFORE INSERT trigger filling ARRAY[NEW.district] would work, but it also makes
--     the base-in-coverage CHECK unreachable: the trigger repairs the exact state the
--     CHECK exists to reject, so the CHECK becomes a decoration that can never go red.
-- So: NOT NULL, no default, and the two client write paths send it explicitly
-- (HomeServiceOnboardingScreen, HomeServiceDashboardScreen). Any path that forgets fails
-- LOUDLY at the boundary, which is the behaviour worth having.
--
-- ─── NO GIN INDEX, ON PURPOSE ───────────────────────────────────────────────
-- towing_companies has one; this table does not get one. `home_services` holds single
-- digits of rows and the planner will sequential-scan a 4-row table whatever indexes
-- exist. Same reasoning 20260904 recorded for properties.amenities. Add one when the
-- table passes a few hundred rows and the containment filter shows up in a plan — and
-- register it in verify_schema.sql's F section when you do.
--
-- ⚠ APPLY THIS BEFORE THE NEXT `npm run ota`, WHATEVER THAT OTA IS FOR ─────────
--
-- The client half shipped in the same commit as this file, and `eas update` bundles the
-- WORKING TREE for the whole app — so the next OTA published for ANY reason carries a
-- HomeServiceDashboardScreen whose Save sends `coverage_districts`. Against a database
-- without this column that is a 42703 and the provider simply cannot save their listing.
--
-- MODULE_FLAGS.homeServices does NOT contain this. App.js is role-first: an account with
-- role='home_service_provider' renders the dashboard directly (App.js ~1373), gated on
-- the role and nothing else. The module being dark hides the customer directory, not the
-- provider's own screen.
--
-- No repo-side guard can catch this — only the anon key is in the repo and pg_attribute
-- is unreachable through PostgREST as anon, which is the same gap check-terms-commitment
-- documents. It is a sequencing fact somebody has to hold, and this is where it is held.
--
-- EXECUTION: SQL editor, Role = postgres. Run the WHOLE FILE — one transaction ending in
-- COMMIT. A block-at-a-time paste stops before COMMIT and applies nothing.

SET ROLE postgres;

BEGIN;

-- ─── 1. Column ──────────────────────────────────────────────────────────────
ALTER TABLE public.home_services
  ADD COLUMN IF NOT EXISTS coverage_districts text[];

-- ─── 2. Backfill BEFORE NOT NULL ────────────────────────────────────────────
--
-- ⚠ THE TRIGGER HAS TO COME OFF FOR THIS ONE STATEMENT, AND THAT IS NOT OPTIONAL.
--   hs_guard_owner_update() opens with
--       IF auth.uid() IS NULL THEN RAISE EXCEPTION 'home_services: no system-context
--       updates allowed';
--   In the SQL editor as postgres there is no JWT, so auth.uid() IS NULL and EVERY row
--   this backfill touches raises. On a table with rows the migration aborts on its
--   second statement; on an EMPTY table it applies cleanly and the trap is invisible
--   until production, which is the worse outcome. Verify the guard's body with
--     SELECT pg_get_functiondef(oid) FROM pg_proc WHERE proname='hs_guard_owner_update';
--   rather than trusting this comment or the migration that wrote it.
--
--   DISABLE TRIGGER is scoped to the one guard (not session_replication_role, which
--   would silence hs_guard_insert and every other trigger in the transaction), and it
--   is transactional — if anything below fails, the ROLLBACK re-enables it. Step 4
--   asserts it came back ON from pg_trigger, because "I re-enabled it" is a claim about
--   a file and pg_trigger is the authority.
--
-- Every existing provider is single-district by construction: it is the only thing the
-- form could express. So coverage IS the district for all of them.
ALTER TABLE public.home_services DISABLE TRIGGER hs_guard_owner_update;

UPDATE public.home_services
   SET coverage_districts = ARRAY[district]
 WHERE coverage_districts IS NULL;

ALTER TABLE public.home_services ENABLE TRIGGER hs_guard_owner_update;

ALTER TABLE public.home_services
  ALTER COLUMN coverage_districts SET NOT NULL;

COMMENT ON COLUMN public.home_services.coverage_districts IS
  'Districts the provider WORKS in. Always contains `district` (the registered base). '
  'Single-district providers carry ARRAY[district]. Filter the directory on this, never '
  'on `district` — search_content still reads `district` as a subtitle.';

-- ─── 3. Constraints ─────────────────────────────────────────────────────────
-- Same six-district vocabulary as home_services_district_check. NB accommodation uses
-- five (no lefke) and towing seven (adds karpaz) — three lists, deliberately different.
ALTER TABLE public.home_services
  DROP CONSTRAINT IF EXISTS home_services_coverage_districts_check;
ALTER TABLE public.home_services
  ADD CONSTRAINT home_services_coverage_districts_check
  CHECK (
    coverage_districts <@ ARRAY['nicosia'::text,'kyrenia'::text,'famagusta'::text,
                                'morphou'::text,'iskele'::text,'lefke'::text]
    -- cardinality(), NOT array_length(). array_length() returns NULL on an empty array
    -- and a CHECK ACCEPTS a NULL result, so the array_length form is a guard against
    -- empty arrays that lets empty arrays through. Copied from towing, which records
    -- the same note for the same reason.
    AND cardinality(coverage_districts) >= 1
  );

-- The base must be inside coverage. Without it a row can claim to be registered in
-- Lefkoşa and serve only Girne, and the directory would list it under neither in a way
-- anyone would predict.
ALTER TABLE public.home_services
  DROP CONSTRAINT IF EXISTS home_services_base_in_coverage_check;
ALTER TABLE public.home_services
  ADD CONSTRAINT home_services_base_in_coverage_check
  CHECK (district = ANY (coverage_districts));

-- ─── 4. Verification — derived, printed, and with a positive control ────────
DO $$
DECLARE
  v_nullable  text;
  v_type      text;
  v_rows      int;
  v_bad       int;
  v_checks    int;
  v_names     text;
  v_probe     uuid;
  v_rejected  int := 0;
  v_tgenabled "char";
BEGIN
  -- Shape, read from information_schema and not from the ALTER above it.
  SELECT is_nullable, data_type INTO v_nullable, v_type
    FROM information_schema.columns
   WHERE table_schema='public' AND table_name='home_services'
     AND column_name='coverage_districts';

  IF v_nullable IS DISTINCT FROM 'NO' THEN
    RAISE EXCEPTION 'coverage_districts is_nullable=% (expected NO)', coalesce(v_nullable,'<column absent>');
  END IF;
  IF v_type IS DISTINCT FROM 'ARRAY' THEN
    RAISE EXCEPTION 'coverage_districts data_type=% (expected ARRAY)', coalesce(v_type,'<null>');
  END IF;

  -- Backfill actually landed on every row, not on the rows we happened to think of.
  SELECT count(*) INTO v_rows FROM public.home_services;
  SELECT count(*) INTO v_bad  FROM public.home_services
   WHERE coverage_districts IS NULL
      OR cardinality(coverage_districts) = 0
      OR NOT (district = ANY (coverage_districts));
  IF v_bad IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'backfill incomplete: % of % rows have empty or base-excluding coverage', v_bad, v_rows;
  END IF;

  -- The constraint count is DERIVED and PRINTED. A hardcoded name list goes green on
  -- the one thing it names and stays silent about everything it forgot.
  SELECT count(*), string_agg(conname, ', ' ORDER BY conname)
    INTO v_checks, v_names
    FROM pg_constraint
   WHERE conrelid = 'public.home_services'::regclass AND contype = 'c';

  -- ── POSITIVE CONTROL ──────────────────────────────────────────────────────
  -- A constraint that has never been seen to reject anything is not evidence. Push
  -- three bad rows through and require each to fail; then push a GOOD row and require
  -- it to succeed, because a table that rejects everything would pass the first half.
  BEGIN
    INSERT INTO public.home_services (name, phone, district, coverage_districts, service_types)
    VALUES ('ZZ probe', '+90 000 000 0000', 'nicosia', ARRAY['kyrenia'], ARRAY['handyman']);
    RAISE EXCEPTION 'CONTROL FAILED: base outside coverage was ACCEPTED';
  EXCEPTION WHEN check_violation THEN v_rejected := v_rejected + 1;
  END;

  BEGIN
    INSERT INTO public.home_services (name, phone, district, coverage_districts, service_types)
    VALUES ('ZZ probe', '+90 000 000 0000', 'nicosia', ARRAY[]::text[], ARRAY['handyman']);
    RAISE EXCEPTION 'CONTROL FAILED: an EMPTY coverage array was ACCEPTED';
  EXCEPTION WHEN check_violation THEN v_rejected := v_rejected + 1;
  END;

  BEGIN
    INSERT INTO public.home_services (name, phone, district, coverage_districts, service_types)
    VALUES ('ZZ probe', '+90 000 000 0000', 'nicosia', ARRAY['nicosia','karpaz'], ARRAY['handyman']);
    RAISE EXCEPTION 'CONTROL FAILED: an off-vocabulary district (karpaz) was ACCEPTED';
  EXCEPTION WHEN check_violation THEN v_rejected := v_rejected + 1;
  END;

  IF v_rejected IS DISTINCT FROM 3 THEN
    RAISE EXCEPTION 'CONTROL FAILED: expected 3 rejections, counted %', v_rejected;
  END IF;

  -- The other half of the control: a well-formed two-district row must be ACCEPTED.
  INSERT INTO public.home_services (name, phone, district, coverage_districts, service_types)
  VALUES ('ZZ probe', '+90 000 000 0000', 'nicosia', ARRAY['nicosia','kyrenia'], ARRAY['handyman'])
  RETURNING id INTO v_probe;
  IF v_probe IS NULL THEN
    RAISE EXCEPTION 'CONTROL FAILED: a valid two-district row did not return an id';
  END IF;
  DELETE FROM public.home_services WHERE id = v_probe;

  -- The probe is INSERT-only and deletes itself. It never touches an existing row, so
  -- re-applying this file cannot damage a real provider's listing.
  IF (SELECT count(*) FROM public.home_services WHERE name = 'ZZ probe') IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'probe rows were not cleaned up: % remain',
      (SELECT count(*) FROM public.home_services WHERE name = 'ZZ probe');
  END IF;

  -- The guard is back ON. tgenabled is a single char ('O' = enabled/origin, 'D' =
  -- disabled) — a plain column, no encoding to decode, unlike tgargs.
  SELECT tgenabled INTO v_tgenabled
    FROM pg_trigger
   WHERE tgrelid = 'public.home_services'::regclass
     AND tgname  = 'hs_guard_owner_update';
  IF v_tgenabled IS DISTINCT FROM 'O' THEN
    RAISE EXCEPTION 'hs_guard_owner_update did NOT come back on: tgenabled=%',
      coalesce(v_tgenabled::text, '<trigger absent>');
  END IF;

  RAISE NOTICE '── home_services.coverage_districts ──────────────────────';
  RAISE NOTICE '  column: NOT NULL, %', v_type;
  RAISE NOTICE '  rows backfilled: % · rows with bad coverage: %', v_rows, v_bad;
  RAISE NOTICE '  CHECK constraints on home_services: % → %', v_checks, v_names;
  RAISE NOTICE '  controls: 3 malformed rows REJECTED, 1 valid two-district row ACCEPTED';
  RAISE NOTICE '  hs_guard_owner_update tgenabled: % (O = on)', v_tgenabled;
  RAISE NOTICE '──────────────────────────────────────────────────────────';
END $$;

COMMIT;
RESET ROLE;

-- Without this, PostgREST answers 42703 "column coverage_districts does not exist"
-- through the REST API even though Postgres has it — and the directory's district
-- filter would return nothing at all while the SQL editor shows a healthy table.
NOTIFY pgrst, 'reload schema';

-- ─── REVERT ────────────────────────────────────────────────────────────────
--   BEGIN;
--     SET ROLE postgres;
--     ALTER TABLE public.home_services
--       DROP CONSTRAINT IF EXISTS home_services_base_in_coverage_check,
--       DROP CONSTRAINT IF EXISTS home_services_coverage_districts_check,
--       DROP COLUMN IF EXISTS coverage_districts;
--   COMMIT;
--   RESET ROLE;
--   NOTIFY pgrst, 'reload schema';
-- The client MUST be reverted with it: HomeServicesScreen filters on
-- .contains('coverage_districts', [d]) and both write paths send the column, so a
-- dropped column breaks the district filter and every provider save.
