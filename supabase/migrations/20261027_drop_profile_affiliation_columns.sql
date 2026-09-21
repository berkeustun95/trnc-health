-- ─── 20261027 — the affiliation leaves `profiles` for good ─────────────────
--
-- Five columns, two triggers, one function, eight constraints, two indexes. The end of
-- the transition 20261026 opened.
--
-- ─── WHAT THIS FINISHES ─────────────────────────────────────────────────────
--
-- 20261026 moved a person's education from one row on `profiles` to N rows on
-- `student_education`, backfilled it, and left a mirror trigger behind so that clients
-- still writing the old shape kept working. That window closes here.
--
-- The window was not arbitrary. It stayed open until:
--   · the OTA carrying the new client landed and soaked (0b6d1e76, 2026-09-20),
--   · the stale-affiliation recovery path was exercised on a real account — it fires on a
--     23514 from profiles_institution_coupling_check, which THIS FILE drops, so after
--     today nobody can ever test it again,
--   · and the message deep link was tested warm and cold.
-- All three are done. Nothing else is waiting on these columns.
--
-- ─── ⚠ student_education.mirror_owned IS NOT DROPPED, AND THAT IS DELIBERATE ─
--
-- It was in the original scope and it comes out. The column is inert after this file —
-- mirror_profile_affiliation was its only reader in the database and it is dropped below
-- — but INERT IS NOT THE SAME AS UNREFERENCED, and the difference is a client that is
-- live right now:
--
--     utils/education.js:34   EDUCATION_SELECT names mirror_owned  -> every enrolment READ
--     utils/education.js:114  enrolmentRow writes it               -> every insert/update
--     ProfileScreen.js:399    toggleListing writes it              -> the opt-in switch
--     ProfileScreen.js:455    closing a current enrolment
--
-- Dropping it would 42703 the read that renders the education section, the write behind
-- the consent switch, and every enrolment edit — for every user, on the build published
-- forty minutes before this file was written. That is the `facilities.area` failure class
-- exactly: a column named in a select that no longer exists.
--
-- The five `profiles` columns are safe for the opposite reason, and it was checked rather
-- than assumed: App.js PROFILE_COLUMNS names NONE of them (verified by parsing the
-- constant, not by reading the comment beside it), and ProfileScreen's own select
-- excludes them with a note saying why. That is what 20261026 promised and it held.
--
-- So mirror_owned needs its own release, in the same two-sided shape 20261033 used:
-- a client that stops naming it, an OTA, a soak, then a one-line drop. Cheap to keep —
-- one inert boolean — and an outage to remove early.
--
-- ─── ⚠ THE FUNCTION check_profile_study_years() SURVIVES. ONLY ITS TRIGGER GOES ─
--
-- 20261026 rebound the same function to the new table:
--
--     CREATE TRIGGER check_student_education_years
--       BEFORE INSERT OR UPDATE ON public.student_education
--       FOR EACH ROW EXECUTE FUNCTION public.check_profile_study_years();
--
-- One function, two triggers. Dropping the function here — the obvious move when its
-- name says `profile` and profiles is losing the columns — would take the future-end-year
-- rule off student_education with it, silently, and nothing else in this repo checks that
-- rule at write time. The trigger on `profiles` is dropped; the function is not, and
-- section 4 asserts the surviving binding rather than trusting this paragraph.
--
-- ─── ⚠ ABSORB, DO NOT ASSERT-NULL ───────────────────────────────────────────
--
-- The tempting first line is `IF EXISTS (SELECT 1 FROM profiles WHERE institution_id IS
-- NOT NULL) THEN RAISE`. It is wrong in the direction that loses data: a straggler is a
-- row whose owner has not opened the app since 20261026, and refusing to apply does not
-- rescue it — it just postpones the same choice. Worse, the obvious "fix" for the refusal
-- is to null the column by hand, which throws the row away silently.
--
-- So section 1 RE-RUNS 20261026's backfill verbatim. Anything the mirror missed is
-- absorbed into student_education first, and only then does section 3 assert that no
-- profile carrying an institution lacks a row. Nothing is dropped until its contents have
-- somewhere to live.
--
-- ⚠ ONE WAY A STRAGGLER CANNOT BE ABSORBED, and it aborts rather than skipping.
--   student_education_one_open_per_user is a partial unique index over (user_id) WHERE
--   study_end_year IS NULL. A straggler with no end year, for somebody who ALREADY has an
--   open enrolment at a different institution, cannot be inserted. 20261026 never met this
--   because it ran against an empty table; this file cannot assume that. The insert is
--   wrapped so the raw 23505 becomes a sentence that says which index and what to do,
--   instead of an error that reads like the migration being broken.
--
-- ─── NO CASCADE, ANYWHERE ───────────────────────────────────────────────────
--
-- DROP COLUMN ... CASCADE would remove the constraints and indexes below without naming
-- them, and would remove anything else that had come to depend on these columns without
-- naming that either. Every dependent is dropped explicitly first, so a dependency nobody
-- knew about stops the migration instead of disappearing inside it.

BEGIN;

-- ─── 0. Guards ──────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF to_regclass('public.student_education') IS NULL THEN
    RAISE EXCEPTION 'REFUSING: student_education is missing — 20261026 is not applied. Nothing applied.';
  END IF;
  -- 20261030 removed institution_id from the completion CHECK. Postgres will not drop a
  -- column a multi-column CHECK still references, so without it section 4 fails halfway.
  -- Caught here, before anything is dropped, with a message that names the fix.
  IF EXISTS (SELECT 1 FROM pg_constraint
              WHERE conname = 'profiles_completion_requires_fields_check'
                AND pg_get_constraintdef(oid) ILIKE '%institution_id%') THEN
    RAISE EXCEPTION
      'REFUSING: profiles_completion_requires_fields_check still references institution_id, '
      'so DROP COLUMN would fail. Apply 20261030 first. Nothing applied.';
  END IF;
  -- The function this file must NOT drop has to already be doing its other job, or
  -- dropping the profiles trigger removes the only enforcement there is.
  IF NOT EXISTS (SELECT 1 FROM pg_trigger
                  WHERE tgrelid = to_regclass('public.student_education')
                    AND tgname = 'check_student_education_years' AND NOT tgisinternal) THEN
    RAISE EXCEPTION
      'REFUSING: check_student_education_years is not bound to student_education, so the '
      'future-end-year rule would be left with no trigger at all once the profiles one '
      'goes. Nothing applied.';
  END IF;
END $$;

-- ─── 1. Absorb every straggler, then prove none is left ────────────────────
DO $$
DECLARE
  v_source   int;
  v_before   int;
  v_inserted int;
  v_orphans  int;
BEGIN
  SELECT count(*) INTO v_source FROM public.profiles WHERE institution_id IS NOT NULL;
  SELECT count(*) INTO v_before FROM public.student_education;
  RAISE NOTICE 'absorb: % profile(s) still carry an institution; student_education holds % row(s)', v_source, v_before;

  BEGIN
    -- 20261026's backfill, verbatim, including the 'university' fallback for a graduate
    -- whose student_level no longer says university. mirror_owned = true is kept for the
    -- same reason it was chosen there — these rows ARE profiles.institution_id in the new
    -- shape — and it is inert from the moment section 2 drops the trigger that read it.
    INSERT INTO public.student_education
      (user_id, institution_id, level, subject_id, study_start_year, study_end_year,
       listing_opt_in, mirror_owned)
    SELECT p.id, p.institution_id,
           CASE WHEN p.student_level IN ('university', 'postgraduate') THEN p.student_level
                ELSE 'university' END,
           p.subject_id, p.study_start_year, p.study_end_year, p.student_listing_opt_in, true
      FROM public.profiles p
     WHERE p.institution_id IS NOT NULL
    ON CONFLICT (user_id, institution_id, level) DO NOTHING;
    GET DIAGNOSTICS v_inserted = ROW_COUNT;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION
      'ABORTING: a straggler could not be absorbed — it would be a SECOND open enrolment '
      'for somebody who already has one (student_education_one_open_per_user, a partial '
      'unique index over user_id WHERE study_end_year IS NULL). Give the profiles row a '
      'study_end_year, or close the existing enrolment, then re-run. Nothing applied.';
  END;

  SELECT count(*) INTO v_orphans
    FROM public.profiles p
   WHERE p.institution_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.student_education e
                      WHERE e.user_id = p.id AND e.institution_id = p.institution_id);
  IF v_orphans > 0 THEN
    RAISE EXCEPTION
      'ABORTING: % profile(s) carry an institution with no student_education row. Dropping '
      'the columns now would destroy their education history. Nothing applied.', v_orphans;
  END IF;

  RAISE NOTICE 'absorb: % straggler(s) inserted, 0 orphan(s) remain — safe to drop', v_inserted;
END $$;

-- ─── 2. Unbind the triggers, in the same transaction as the drop ───────────
--
-- mirror_profile_affiliation reads all five columns. It has to stop existing before they
-- do, and in ONE transaction: between a committed trigger drop and a committed column
-- drop there is a window in which an old client's write reaches profiles with no mirror
-- behind it, and that write is silently lost.
DROP TRIGGER IF EXISTS mirror_profile_affiliation ON public.profiles;
DROP FUNCTION IF EXISTS public.mirror_profile_affiliation();

-- The trigger only. See the header: the FUNCTION is shared with student_education.
DROP TRIGGER IF EXISTS check_profile_study_years ON public.profiles;

-- ─── 3. Every dependent, named ─────────────────────────────────────────────
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_institution_coupling_check;
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_listing_opt_in_requires_institution_check;
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_study_fields_require_institution_check;
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_study_years_order_check;
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_study_start_year_range_check;
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_study_end_year_range_check;
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_institution_id_fkey;
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_subject_id_fkey;

DROP INDEX IF EXISTS public.idx_profiles_institution_id;
DROP INDEX IF EXISTS public.idx_profiles_subject_id;

-- ─── 4. The columns ────────────────────────────────────────────────────────
ALTER TABLE public.profiles DROP COLUMN IF EXISTS institution_id;
ALTER TABLE public.profiles DROP COLUMN IF EXISTS study_start_year;
ALTER TABLE public.profiles DROP COLUMN IF EXISTS study_end_year;
ALTER TABLE public.profiles DROP COLUMN IF EXISTS subject_id;
ALTER TABLE public.profiles DROP COLUMN IF EXISTS student_listing_opt_in;

-- ─── 5. Verification ───────────────────────────────────────────────────────
DO $$
DECLARE
  v_left text;
BEGIN
  -- The five are gone. DERIVED, so a sixth affiliation column somebody added since would
  -- also show up rather than being missed by a list of five names.
  SELECT string_agg(column_name, ', ' ORDER BY column_name) INTO v_left
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'profiles'
     AND column_name IN ('institution_id','study_start_year','study_end_year',
                         'subject_id','student_listing_opt_in');
  IF v_left IS NOT NULL THEN
    RAISE EXCEPTION 'ABORTING: these columns survived the drop: %. Nothing applied.', v_left;
  END IF;

  -- The mirror is gone, both halves.
  IF to_regprocedure('public.mirror_profile_affiliation()') IS NOT NULL THEN
    RAISE EXCEPTION 'ABORTING: mirror_profile_affiliation() still exists.';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = to_regclass('public.profiles')
              AND tgname = 'mirror_profile_affiliation' AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'ABORTING: the mirror trigger still exists on profiles.';
  END IF;

  -- ⚠ AND THE ONE THAT MUST STILL BE THERE. This is the assertion the header's
  --   shared-function warning is worth: if a future edit "tidies up" by dropping
  --   check_profile_study_years() along with its profiles trigger, student_education
  --   loses the future-end-year rule and nothing else would say so.
  IF to_regprocedure('public.check_profile_study_years()') IS NULL THEN
    RAISE EXCEPTION
      'ABORTING: check_profile_study_years() was dropped. It is SHARED — student_education '
      'trigger check_student_education_years executes it, and that rule is now unenforced.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger
                  WHERE tgrelid = to_regclass('public.student_education')
                    AND tgname = 'check_student_education_years' AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'ABORTING: check_student_education_years is no longer bound to student_education.';
  END IF;

  -- mirror_owned stays. Asserted POSITIVELY so that removing it becomes a deliberate act
  -- with this line to delete, rather than something that happens in passing — the live
  -- client reads and writes it (see the header) and a drop is a 42703 for every user.
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema='public' AND table_name='student_education'
                    AND column_name='mirror_owned') THEN
    RAISE EXCEPTION
      'ABORTING: student_education.mirror_owned is gone. The shipped client SELECTs and '
      'WRITES it — utils/education.js:34 and :114, ProfileScreen.js:399 and :455 — so its '
      'absence 42703s every enrolment read and the opt-in switch.';
  END IF;

  RAISE NOTICE '20261027 verified: five columns gone, mirror gone, year rule still bound to student_education, mirror_owned kept.';
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
VALUES ('20261027_drop_profile_affiliation_columns.sql', 'a0d651a599c73e8a2fec8ec13fa9c034f0625d3f11b25b59e195bba7766f294f')
ON CONFLICT (filename) DO UPDATE
  SET checksum = excluded.checksum, applied_at = now(), applied_by = current_user;
-- ─── ledger:stamp:end ────────────────────────────────────────────────
COMMIT;

-- profiles lost five columns, so PostgREST's cached schema would keep offering them and
-- answer 42703 on a column it just advertised.
NOTIFY pgrst, 'reload schema';
