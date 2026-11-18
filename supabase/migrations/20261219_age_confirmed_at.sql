-- ─── 20261219 — "I am 13 or older" tick: profiles.age_confirmed_at, and the completion
-- ─── CHECK accepts it in place of a date of birth (Apple 5.1.1(v)) ─────────────────────
--
-- Apple rejected iOS 1.4.3 because sign-up demands a date of birth and a nationality that
-- the app does not need to function. Berke's decision (2026-11-18): the wizard asks for a
-- required "I am 13 or older" tick instead; date of birth and nationality become optional.
--
-- WHAT THIS FILE DOES
--   1. profiles.age_confirmed_at timestamptz, nullable. No default, NO BACKFILL: nobody's
--      consent is invented. Every already-completed row has a date of birth under the old
--      CHECK, so it validates against the new one untouched.
--   2. A small trigger function + BEFORE INSERT OR UPDATE OF age_confirmed_at trigger, same
--      rule as marketing_opt_in_at (20261016): THE CLIENT SAYS WHETHER, THE SERVER SAYS WHEN.
--        INSERT, non-NULL            -> now()
--        UPDATE NULL -> non-NULL     -> now() (whatever the client sent)
--        UPDATE non-NULL -> anything -> keeps OLD; a client cannot move or clear it
--        UPDATE non-NULL -> NULL     -> only is_admin() may clear it
--      check_profile_name_content() is NOT touched (profile:check parses it).
--   3. profiles_completion_requires_fields_check rewritten: date_of_birth is satisfied by
--      EITHER a date of birth OR age_confirmed_at, and nationality_code is no longer
--      required. Every other arm is carried over from the LIVE definition, read from
--      pg_get_constraintdef by the 2026-11-18 read-only probe (run 44291929792).
--
-- WHAT IS NOT TOUCHED: the UNDERAGE arm of check_profile_name_content stays NULL-guarded
-- (a row with no date of birth is not rejected as underage; the tick is the age statement
-- for those). No policy, grant or RLS change: the existing owner/admin policies on profiles
-- cover the new column exactly as they cover marketing_opt_in_at.
--
-- ⚠ ACCEPTED: age_confirmed_at is a self-declaration. Nothing in the database can verify it,
-- and a row may carry both a date of birth and a tick. The server stamps WHEN, never WHETHER.

BEGIN;

-- ─── 0. Is the world the shape this file expects? ───────────────────────────
DO $$
DECLARE
  v_def  text;
  v_want text := 'CHECK (((profile_completed_at IS NULL) OR ((first_name IS NOT NULL) AND (last_name IS NOT NULL) AND (display_name IS NOT NULL) AND (date_of_birth IS NOT NULL) AND (region IS NOT NULL) AND (resident_status IS NOT NULL) AND (nationality_code IS NOT NULL) AND ((resident_status <> ''student''::text) OR (student_level IS NOT NULL)))))';
BEGIN
  SELECT pg_get_constraintdef(c.oid) INTO v_def
    FROM pg_constraint c
   WHERE c.conrelid = 'public.profiles'::regclass
     AND c.conname = 'profiles_completion_requires_fields_check';

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'REFUSING: profiles_completion_requires_fields_check does not exist. Nothing applied.';
  END IF;
  IF v_def IS DISTINCT FROM v_want THEN
    RAISE EXCEPTION 'REFUSING: the live completion check is not the definition this file was written against. Live: %', v_def;
  END IF;
  IF to_regprocedure('public.is_admin()') IS NULL THEN
    RAISE EXCEPTION 'REFUSING: public.is_admin() does not exist. Nothing applied.';
  END IF;
END $$;

-- ─── 1. The column ──────────────────────────────────────────────────────────
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS age_confirmed_at timestamptz;

COMMENT ON COLUMN public.profiles.age_confirmed_at IS
  'When the person ticked "I am 13 or older" (MIN_SIGNUP_AGE). SERVER-stamped by '
  'stamp_age_confirmed_at(): the client says whether, the server says when. Once set a client '
  'cannot move or clear it; only is_admin() can clear it. Satisfies the profile completion '
  'check in place of date_of_birth. Self-declared, not verified. 20261219.';

-- ─── 2. The server stamp ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.stamp_age_confirmed_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.age_confirmed_at IS NOT NULL THEN
      NEW.age_confirmed_at := now();
    END IF;
  ELSIF NEW.age_confirmed_at IS NOT DISTINCT FROM OLD.age_confirmed_at THEN
    NULL;
  ELSIF OLD.age_confirmed_at IS NULL THEN
    NEW.age_confirmed_at := now();
  ELSIF NEW.age_confirmed_at IS NULL AND public.is_admin() IS NOT DISTINCT FROM true THEN
    NULL;
  ELSE
    NEW.age_confirmed_at := OLD.age_confirmed_at;
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.stamp_age_confirmed_at() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.stamp_age_confirmed_at() FROM anon, authenticated;

DROP TRIGGER IF EXISTS profiles_age_confirmed_stamp ON public.profiles;
CREATE TRIGGER profiles_age_confirmed_stamp
  BEFORE INSERT OR UPDATE OF age_confirmed_at ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.stamp_age_confirmed_at();

-- ─── 3. The completion check ────────────────────────────────────────────────
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_completion_requires_fields_check;
ALTER TABLE public.profiles ADD  CONSTRAINT profiles_completion_requires_fields_check
  CHECK (profile_completed_at IS NULL OR (
        first_name       IS NOT NULL
    AND last_name        IS NOT NULL
    AND display_name     IS NOT NULL
    AND (date_of_birth IS NOT NULL OR age_confirmed_at IS NOT NULL)
    AND region           IS NOT NULL
    AND resident_status  IS NOT NULL
    AND (resident_status <> 'student' OR student_level IS NOT NULL)
  ));

-- ─── 4. Assertions, read from the catalogue ─────────────────────────────────
DO $$
DECLARE
  v_def text;
  v_col text;
  v_trg text;
BEGIN
  SELECT pg_get_constraintdef(c.oid) INTO v_def
    FROM pg_constraint c
   WHERE c.conrelid = 'public.profiles'::regclass
     AND c.conname = 'profiles_completion_requires_fields_check';
  IF v_def IS NULL THEN
    RAISE EXCEPTION 'the completion check is missing after the rewrite. Nothing applied.';
  END IF;
  IF position('age_confirmed_at' IN v_def) = 0 THEN
    RAISE EXCEPTION 'the completion check does not mention age_confirmed_at. Live: %', v_def;
  END IF;
  IF position('nationality' IN v_def) > 0 THEN
    RAISE EXCEPTION 'the completion check still requires nationality. Live: %', v_def;
  END IF;
  FOREACH v_col IN ARRAY ARRAY['first_name','last_name','display_name','date_of_birth','region',
                               'resident_status','student_level','profile_completed_at'] LOOP
    IF position(v_col IN v_def) = 0 THEN
      RAISE EXCEPTION 'the completion check no longer mentions % - the wrong arm was removed. Live: %', v_col, v_def;
    END IF;
  END LOOP;

  SELECT pg_get_triggerdef(t.oid) INTO v_trg
    FROM pg_trigger t
   WHERE t.tgrelid = 'public.profiles'::regclass AND t.tgname = 'profiles_age_confirmed_stamp'
     AND NOT t.tgisinternal AND t.tgenabled <> 'D';
  IF v_trg IS NULL THEN
    RAISE EXCEPTION 'profiles_age_confirmed_stamp is missing or disabled.';
  END IF;
  IF v_trg NOT LIKE '%BEFORE INSERT OR UPDATE OF age_confirmed_at%' THEN
    RAISE EXCEPTION 'profiles_age_confirmed_stamp has the wrong timing. Live: %', v_trg;
  END IF;
  IF has_function_privilege('anon', 'public.stamp_age_confirmed_at()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.stamp_age_confirmed_at()', 'EXECUTE') THEN
    RAISE EXCEPTION 'stamp_age_confirmed_at() is EXECUTE-able by anon or authenticated.';
  END IF;
  RAISE NOTICE '20261219 definitions verified.';
END $$;

-- ─── 5. Behaviour of the REAL trigger function, on session-local tables only ─
-- No profiles row is read or written. A positive control (a deliberately broken stamp) must
-- be caught by the same assertions, or the checks are not measuring anything.
CREATE TEMP TABLE tmp_age_probe  (id int PRIMARY KEY, age_confirmed_at timestamptz);
CREATE TEMP TABLE tmp_age_broken (id int PRIMARY KEY, age_confirmed_at timestamptz);

CREATE TRIGGER tmp_age_probe_t
  BEFORE INSERT OR UPDATE OF age_confirmed_at ON tmp_age_probe
  FOR EACH ROW EXECUTE FUNCTION public.stamp_age_confirmed_at();

-- A stamp that honours whatever the client sends. now() is constant inside one transaction, so a
-- control that "always stamps now()" would be indistinguishable from the real function here.
CREATE FUNCTION pg_temp.age_stamp_broken() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  RETURN NEW;
END;
$fn$;
CREATE TRIGGER tmp_age_broken_t
  BEFORE INSERT OR UPDATE OF age_confirmed_at ON tmp_age_broken
  FOR EACH ROW EXECUTE FUNCTION pg_temp.age_stamp_broken();

DO $$
DECLARE
  v_bogus  timestamptz := timestamptz '2001-01-01 00:00+00';
  v_bogus2 timestamptz := timestamptz '2002-02-02 00:00+00';
  v_got    timestamptz;
BEGIN
  IF public.is_admin() IS NOT DISTINCT FROM true THEN
    RAISE EXCEPTION 'precondition failed: the migration session reads as an admin, so the clear-refusal cannot be tested here.';
  END IF;

  INSERT INTO tmp_age_probe (id, age_confirmed_at) VALUES (1, v_bogus), (2, NULL);
  SELECT age_confirmed_at INTO v_got FROM tmp_age_probe WHERE id = 1;
  IF v_got IS DISTINCT FROM now() THEN RAISE EXCEPTION 'INSERT with a client value was not stamped now().'; END IF;
  SELECT age_confirmed_at INTO v_got FROM tmp_age_probe WHERE id = 2;
  IF v_got IS NOT NULL THEN RAISE EXCEPTION 'INSERT with NULL was stamped.'; END IF;

  UPDATE tmp_age_probe SET age_confirmed_at = v_bogus WHERE id = 2;
  SELECT age_confirmed_at INTO v_got FROM tmp_age_probe WHERE id = 2;
  IF v_got IS DISTINCT FROM now() THEN RAISE EXCEPTION 'NULL to non-NULL did not store now() (client value honoured).'; END IF;

  UPDATE tmp_age_probe SET age_confirmed_at = v_bogus2 WHERE id = 2;
  SELECT age_confirmed_at INTO v_got FROM tmp_age_probe WHERE id = 2;
  IF v_got IS DISTINCT FROM now() THEN RAISE EXCEPTION 'a client moved an already-set age_confirmed_at.'; END IF;

  UPDATE tmp_age_probe SET age_confirmed_at = NULL WHERE id = 2;
  SELECT age_confirmed_at INTO v_got FROM tmp_age_probe WHERE id = 2;
  IF v_got IS DISTINCT FROM now() THEN RAISE EXCEPTION 'a non-admin cleared age_confirmed_at.'; END IF;

  INSERT INTO tmp_age_broken (id, age_confirmed_at) VALUES (1, NULL);
  UPDATE tmp_age_broken SET age_confirmed_at = v_bogus WHERE id = 1;
  UPDATE tmp_age_broken SET age_confirmed_at = v_bogus2 WHERE id = 1;
  SELECT age_confirmed_at INTO v_got FROM tmp_age_broken WHERE id = 1;
  IF v_got IS NOT DISTINCT FROM now() THEN
    RAISE EXCEPTION 'RED-FIRST FAILED: the control did not notice a stamp that lets the client move the value. THE CONTROL IS BROKEN, NOT THE TRIGGER.';
  END IF;
  RAISE NOTICE '20261219 behaviour verified, positive control seen red.';
END $$;

DROP TABLE tmp_age_probe;
DROP TABLE tmp_age_broken;

RESET ROLE;

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
VALUES ('20261219_age_confirmed_at.sql', '2269938910a70b4b884b9aece9cc786b0ba1924b71eeb6d63053340d256c107e')
ON CONFLICT (filename) DO UPDATE
  SET checksum = excluded.checksum, applied_at = now(), applied_by = current_user;
-- ─── ledger:stamp:end ────────────────────────────────────────────────
COMMIT;

NOTIFY pgrst, 'reload schema';
