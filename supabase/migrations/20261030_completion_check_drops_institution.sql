-- ─── 20261030 — profiles_completion_requires_fields_check loses its last ────
-- ─── reference to institution_id                                          ────
--
-- ONE constraint, ONE arm removed. No columns, no data, no functions, no policies.
--
-- ─── WHY THIS IS NOT A NEW DECISION ─────────────────────────────────────────
--
-- 20261026 already accepted losing this enforcement when the affiliation moved to
-- student_education, and recorded the reasoning in its own header (lines 30-33):
--
--     "What IS given up: the database can no longer enforce 'a university-level student
--      has an institution' — a cross-table invariant a CHECK cannot express. That is a
--      COMPLETENESS rule, not a corruption rule. A profile with student_level='university'
--      and no education row is incomplete, not broken, and ProfileScreen.js:456 already
--      refuses to save it."
--
-- Four of the five CHECKs naming those columns go with the columns in 20261027. This arm
-- of profiles_completion_requires_fields_check is the LAST SURVIVING PIECE of the rule,
-- and it survives only because the constraint also guards nine other columns that are
-- staying. It is the same decision, finishing.
--
-- And it changes either way: Postgres will not drop a column that a multi-column CHECK
-- still references, so 20261027 cannot drop institution_id without rewriting this
-- constraint. Doing it here, before the OTA, means the rewrite is a deliberate step with
-- its own reasoning rather than a line buried in a DROP COLUMN migration.
--
-- ─── WHY IT HAS TO BE NOW, AND NOT WITH 20261027 ────────────────────────────
--
-- ProfileScreen's education editor moves to student_education in the OTA that follows
-- this file. With the arm still in place that editor cannot work, and not narrowly:
--
--     AND (student_level IS NULL
--          OR student_level NOT IN ('university','postgraduate')
--          OR institution_id IS NOT NULL)
--
-- A completed profile claiming university-level student status REQUIRES
-- profiles.institution_id. The new editor writes the institution to student_education and
-- never to profiles, so ANY path into university-level student status — a new student, or
-- someone returning to study after the status change that clears the stale columns —
-- ends in a 23514 the user cannot clear from any screen. The editor would ship broken.
--
-- ─── ⚠ WHAT IS BEING ACCEPTED, WRITTEN DOWN RATHER THAN DISCOVERED ─────────
--
--   AFTER THIS FILE, NOTHING IN THE DATABASE STOPS A COMPLETED PROFILE FROM CLAIMING
--   UNIVERSITY-LEVEL STUDENT STATUS WITH NO ENROLMENT AT ALL.
--
-- Not a weakened guard — an absent one. profile_completed_at can be set on a row whose
-- student_level is 'university' and which has no student_education row, and no constraint
-- anywhere will object. The ONLY thing standing between a user and that state is
-- ProfileScreen's own missingRequired check, which is client-side, which means it is
-- advisory: a direct PostgREST call with a valid JWT can produce that row today.
--
-- That is tolerable for the same reason 20261026 gave — an incomplete profile is not a
-- corrupt one, and nothing reads student_level expecting an enrolment to exist. The
-- student list, the profile page and every messaging RPC read student_education directly
-- and see such a user as having no enrolments, which is exactly what they are.
--
-- What it is NOT safe to do later is assume the reverse. If anything ever derives "is a
-- university student" from profiles.student_level and expects an institution to be
-- reachable from it, it will be wrong for these rows, and there will be no error to
-- notice. Read student_education.
--
-- ─── ⚠ WRITTEN AGAINST THE LIVE CONSTRAINT, NOT AGAINST 20261001 ───────────
--
-- The first draft of this file carried `phone IS NOT NULL` forward because 20261001:160
-- has it. PROD DOES NOT. pg_get_constraintdef on 2026-09-18 shows no phone clause:
--
--   CHECK (((profile_completed_at IS NULL) OR ((first_name IS NOT NULL) AND (last_name
--   IS NOT NULL) AND (display_name IS NOT NULL) AND (date_of_birth IS NOT NULL) AND
--   (region IS NOT NULL) AND (resident_status IS NOT NULL) AND (nationality_code IS NOT
--   NULL) AND ((resident_status <> 'student'::text) OR (student_level IS NOT NULL)) AND
--   ((student_level IS NULL) OR (student_level <> ALL (ARRAY['university'::text,
--   'postgraduate'::text])) OR (institution_id IS NOT NULL)))))
--
-- The clause was removed BY HAND on or before 2026-09-12 as the database half of commit
-- 721c0d3 ("Phone becomes optional"), which says so in its own message: "No migration:
-- the DB half of the phone change was applied by hand before this commit (see the
-- follow-up recording it)." That follow-up was never written. 2026-09-12_phone-optional.md
-- names the exact remedy — "A recording migration + a verify_schema.sql H-token are the
-- follow-up" — and neither existed until this file.
--
-- Carrying phone forward would not have been a harmless copy. It would have ADDED a
-- requirement, and a plain ADD CONSTRAINT validates existing rows: 3 completed profiles
-- have no phone (227 of 257 rows have none at all), so the statement would have raised
-- 23514 and aborted. Nothing would have applied — the BEGIN/COMMIT wrapper is why a wrong
-- file costs nothing here — but the fix would still have been a second, silent policy
-- change smuggled into a file about institution_id.
--
-- ► SO THIS FILE ALSO DISCHARGES THE 2026-09-12 DEBT, and that is not scope creep:
--   recording an already-applied hand change is the opposite of a new decision. The end
--   state below is identical on a prod-shaped database (where phone is already gone) and
--   on one built from migration files (where it is not), so the two converge. The H token
--   in verify_schema.sql now asserts phone's ABSENCE, which is the half that makes a
--   future hand-edit visible.
--
-- ─── NO BEHAVIOURAL PROBE IN THIS FILE, DELIBERATELY ────────────────────────
--
-- The natural verification is to take a real completed university student, null their
-- institution_id inside the transaction to prove the constraint no longer blocks it, and
-- restore the captured value. That probe is REFUSED, because it is not reversible:
-- 20261026's mirror_profile_affiliation() fires on institution_id going NULL and sets
-- listing_opt_in = false on every mirror_owned row for that user. Restoring institution_id
-- afterwards does not re-list them. A verification that quietly drops a real person off
-- the student list to prove a CHECK is a worse bug than the one it is checking for.
--
-- So section 2 asserts the DEFINITION, which for a CHECK is the behaviour, and reads it
-- from pg_get_constraintdef rather than from this file.

BEGIN;

-- ─── 0. Is the world the shape this file expects? ───────────────────────────
DO $$
DECLARE
  v_def text;
BEGIN
  SELECT pg_get_constraintdef(c.oid) INTO v_def
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
   WHERE n.nspname = 'public' AND t.relname = 'profiles'
     AND c.conname = 'profiles_completion_requires_fields_check';

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'REFUSING: profiles_completion_requires_fields_check does not exist. 20261001 has not been applied. Nothing applied.';
  END IF;

  -- Re-runnable: if the arm has already gone, this file has already run. Say so and stop
  -- rather than dropping and rebuilding a constraint that is already correct.
  IF position('institution_id' in v_def) = 0 THEN
    RAISE NOTICE '20261030: already applied — the constraint no longer references institution_id. Nothing to do.';
  END IF;

  -- PRINT the live definition before touching it. This file exists in the shape it does
  -- because its first draft was written from 20261001 instead of from here, and the
  -- difference (a phone clause that prod has not had since 2026-09-12) would have aborted
  -- the apply. Printing what is actually there costs one line and is the only thing that
  -- would have caught it without a human noticing.
  RAISE NOTICE '20261030: live definition BEFORE = %', v_def;
END $$;

-- ─── 1. The rewrite ─────────────────────────────────────────────────────────
--
-- Every arm below is carried over from the LIVE definition quoted in the header. The only
-- thing removed is the student_level/institution_id arm. There is no phone clause to carry
-- because prod has not had one since 2026-09-12; ADDING one would raise 23514 on the 3
-- completed profiles that have no phone.
--
-- This never ADDS a requirement, so it cannot fail validation on either shape of database.
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_completion_requires_fields_check;
ALTER TABLE public.profiles ADD  CONSTRAINT profiles_completion_requires_fields_check
  CHECK (profile_completed_at IS NULL OR (
        first_name       IS NOT NULL
    AND last_name        IS NOT NULL
    AND display_name     IS NOT NULL
    AND date_of_birth    IS NOT NULL
    AND region           IS NOT NULL
    AND resident_status  IS NOT NULL
    AND nationality_code IS NOT NULL
    AND (resident_status <> 'student' OR student_level IS NOT NULL)
  ));

-- ─── 2. Verification, read from the catalogue and not from this file ────────
DO $$
DECLARE
  v_def  text;
  v_col  text;
  v_kept text[] := ARRAY['first_name','last_name','display_name','date_of_birth','region',
                         'resident_status','nationality_code','student_level',
                         'profile_completed_at'];
BEGIN
  SELECT pg_get_constraintdef(c.oid) INTO v_def
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
   WHERE n.nspname = 'public' AND t.relname = 'profiles'
     AND c.conname = 'profiles_completion_requires_fields_check';

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'profiles_completion_requires_fields_check is missing after the rewrite. Nothing applied.';
  END IF;

  -- The one thing this file exists to remove. Asserted on the LIVE definition, so it is
  -- true of the database rather than of the text above it.
  IF position('institution_id' in v_def) > 0 THEN
    RAISE EXCEPTION 'institution_id is STILL referenced by the completion check. Live definition: %', v_def;
  END IF;

  -- …and every column that must have survived. A rewrite that dropped the wrong arm would
  -- pass the assertion above and fail here, which is the point of checking both directions
  -- rather than only the one that was intended.
  FOREACH v_col IN ARRAY v_kept LOOP
    IF position(v_col in v_def) = 0 THEN
      RAISE EXCEPTION 'the completion check no longer mentions % — the wrong arm was removed. Live definition: %', v_col, v_def;
    END IF;
  END LOOP;

  -- phone must be ABSENT. Not decoration: it is what makes a database built from migration
  -- files converge with prod, and what turns a future hand-edit that re-adds it into a red
  -- row instead of a silent divergence.
  IF position('phone' in v_def) > 0 THEN
    RAISE EXCEPTION 'the completion check requires phone again — prod has not since 2026-09-12. Live definition: %', v_def;
  END IF;

  -- The four columns 20261027 will drop must appear NOWHERE in this constraint now, or
  -- that DROP COLUMN will fail on a dependency this file was supposed to clear.
  FOREACH v_col IN ARRAY ARRAY['study_start_year','study_end_year','subject_id','student_listing_opt_in'] LOOP
    IF position(v_col in v_def) > 0 THEN
      RAISE EXCEPTION 'the completion check references %, which 20261027 drops. Live definition: %', v_col, v_def;
    END IF;
  END LOOP;

  RAISE NOTICE '20261030 verified. Live definition: %', v_def;
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
VALUES ('20261030_completion_check_drops_institution.sql', '38ea7211d68eeb7b0a14214b3c971dd60a2c83af97be842bfc9a7ca2145a5164')
ON CONFLICT (filename) DO UPDATE
  SET checksum = excluded.checksum, applied_at = now(), applied_by = current_user;
-- ─── ledger:stamp:end ────────────────────────────────────────────────
COMMIT;

NOTIFY pgrst, 'reload schema';
