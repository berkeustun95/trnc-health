-- ─── 20261036 — a guest is not a caller ────────────────────────────────────
--
-- One clause added to two guards. No schema change, no grants.
--
-- ─── WHAT 20261035 CLOSED, AND WHAT IT DID NOT ──────────────────────────────
--
-- 20261035 stopped may_initiate_by_age and is_listed_student answering a caller with no
-- session, because the first reads profiles.date_of_birth for two arbitrary uuids and
-- its boolean is a clean over-18 bit on the second one. That closed the `anon` role.
--
-- It did not close the app's own front door. WelcomeScreen.js:20 calls
-- signInAnonymously() — one tap from a cold start, no email, no password — and the
-- session that comes back has a REAL auth.uid(). So `auth.uid() IS NULL` is false for a
-- guest, the guard passes, and the oracle answers exactly as before:
--
--     POST /rpc/may_initiate_by_age  {<known adult>, X}   ->  is X under 18?
--
-- The gap between "anyone with the public key" and "anyone who taps Continue as guest"
-- is one tap. It is not a narrowing worth having, and calling 20261035 sufficient would
-- have meant recording a fix that mostly was not one.
--
-- ─── HOW IT WAS MISSED, WHICH IS THE PART WORTH KEEPING ─────────────────────
--
-- Every other RPC in this slice already guards on is_anonymous_session():
-- get_student_list, get_student_profile and can_see_student_lists all carry it, and
-- start_conversation and send_message both open with
-- `IF v_me IS NULL OR is_anonymous_session() THEN RAISE`.
--
-- may_initiate_by_age is the ONE that does not — and it is the one reading dates of
-- birth. The slice had a convention, this function sat outside it, and the convention
-- being near-universal is exactly what made the exception invisible: eight call sites
-- looked right, so the ninth was never read as a question.
--
-- ⚠ auth.uid() IS NOT A PROXY FOR "A REAL PERSON" IN THIS APP. It is a proxy for "some
--   session exists", and an anonymous session is one. Any guard written as a uid-null
--   test is asking a weaker question than it looks like it is asking. That is now twice
--   in two files: 20261034's guard treated `uid IS NULL` as "postgres in the SQL editor"
--   when it also meant `anon`, and 20261035's treated `uid IS NOT NULL` as "a real user"
--   when it also meant a guest. Same word, two opposite mistakes.
--
-- ─── WHY THIS IS SAFE AT EVERY CALL SITE ────────────────────────────────────
--
-- Checked, not assumed — all five references in 20261029:
--
--   :379  can_see_student_lists -> is_listed_student(auth.uid())
--         Already reads `NOT is_anonymous_session() AND is_listed_student(auth.uid())`,
--         so the new clause is redundant there and cannot change the answer.
--   :798  start_conversation -> is_listed_student(p_recipient_id)
--   :807  start_conversation -> may_initiate_by_age(v_me, p_recipient_id)
--   :919  send_message       -> is_listed_student(v_them)
--         All three sit below `IF v_me IS NULL OR is_anonymous_session() THEN RAISE`, so
--         no anonymous session ever reaches them.
--   :514  enforce_message_age_rule (TRIGGER) -> may_initiate_by_age(initiator, recipient)
--         Its arguments come from the conversations row rather than the caller, so it
--         needed the same check 20261035 got: `INSERT INTO messages` appears in exactly
--         two places in this schema (20261029:828 and :924), both inside
--         start_conversation and send_message, and both refuse an anonymous session
--         before inserting. The trigger has no guest path.
--
-- postgres in the SQL editor is unaffected: auth.jwt() is null there, so
-- is_anonymous_session() coalesces to false and the new clause is a no-op.

BEGIN;

-- ─── 0. Guards ──────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF to_regprocedure('public.may_initiate_by_age(uuid,uuid)') IS NULL
     OR to_regprocedure('public.is_listed_student(uuid)') IS NULL THEN
    RAISE EXCEPTION 'REFUSING: 20261029 is not applied. Nothing applied.';
  END IF;
  IF to_regprocedure('public.is_anonymous_session()') IS NULL THEN
    RAISE EXCEPTION 'REFUSING: is_anonymous_session() is missing — the new guard would be created broken.';
  END IF;
  -- 20261035 must be in place first. Applying this on top of the ORIGINAL body would
  -- silently drop its auth.uid() guard and reopen the anon half while appearing to
  -- tighten things — the worst possible outcome of a migration named like this one.
  IF pg_get_functiondef(to_regprocedure('public.may_initiate_by_age(uuid,uuid)'))
       NOT LIKE '%auth.uid() IS NULL%' THEN
    RAISE EXCEPTION
      'REFUSING: may_initiate_by_age does not carry 20261035''s uid guard, so 20261035 '
      'has not been applied. Apply it first — this file REPLACES the body and would '
      'otherwise leave you with neither guard. Nothing applied.';
  END IF;
END $$;

-- ─── 1. may_initiate_by_age ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.may_initiate_by_age(p_sender uuid, p_recipient uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_sender    date;
  v_recipient date;
  v_cutoff    date := (current_date - interval '18 years')::date;  -- ADULT_AGE
BEGIN
  -- ⚠ TWO CLAUSES, AND THE SECOND ONE IS 20261036. Without it a guest — one tap from a
  --   cold start, no credentials — gets a minor/adult bit on any uuid they name. The
  --   first clause alone reads like "a real user is asking"; in this app it only means
  --   "a session exists", and signInAnonymously() makes one.
  IF auth.uid() IS NULL OR is_anonymous_session() THEN
    RETURN false;
  END IF;

  SELECT date_of_birth INTO v_sender    FROM profiles WHERE id = p_sender;
  SELECT date_of_birth INTO v_recipient FROM profiles WHERE id = p_recipient;

  -- Born AFTER the cutoff = younger than 18 = a minor.
  IF v_sender IS NOT NULL AND v_sender > v_cutoff THEN
    RETURN true;   -- the sender is a known minor
  END IF;
  IF v_recipient IS NOT NULL AND v_recipient <= v_cutoff THEN
    RETURN true;   -- the recipient is a known adult
  END IF;

  RETURN false;
END;
$function$;

-- ─── 2. is_listed_student ───────────────────────────────────────────────────
--
-- Stays LANGUAGE sql. Both guards are conjuncts rather than branches, so the function
-- keeps its STABLE inlineable shape and short-circuits before the lookup.
CREATE OR REPLACE FUNCTION public.is_listed_student(p_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT auth.uid() IS NOT NULL
     AND NOT is_anonymous_session()
     AND EXISTS (
    SELECT 1
      FROM student_education e
      JOIN profiles p ON p.id = e.user_id
     WHERE e.user_id = p_user_id
       AND e.listing_opt_in
       AND p.display_name IS NOT NULL
       AND (p.ugc_banned_until IS NULL OR p.ugc_banned_until <= now())
  );
$function$;

-- ─── 3. Verification ────────────────────────────────────────────────────────
--
-- EXERCISED as a guest, not inspected. A body that reads is_anonymous_session() and
-- ignores the answer passes any text check; only asking it a question catches that.
DO $$
DECLARE
  v_probe uuid;
  v_ans   boolean;
BEGIN
  -- A guest session: a real sub, is_anonymous true. This is what signInAnonymously()
  -- produces, and it is the state 20261035 let straight through.
  PERFORM set_config('request.jwt.claims',
    '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated","is_anonymous":true}', true);

  IF NOT is_anonymous_session() THEN
    RAISE EXCEPTION
      'ABORTING: the probe claims did not read as an anonymous session, so the two '
      'assertions below would prove nothing. Check is_anonymous_session(). Nothing applied.';
  END IF;

  v_ans := public.may_initiate_by_age(
             '00000000-0000-4000-8000-0000000000a2'::uuid,
             '00000000-0000-4000-8000-0000000000a3'::uuid);
  IF v_ans IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'ABORTING: may_initiate_by_age answered % to a GUEST. Nothing applied.', v_ans;
  END IF;

  IF public.is_listed_student('00000000-0000-4000-8000-0000000000a2'::uuid) IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'ABORTING: is_listed_student answered a GUEST. Nothing applied.';
  END IF;

  -- ⚠ THE CONTROL. "Return false always" closes the oracle AND kills messaging for
  --   everyone, and it would satisfy both assertions above. A REAL session must still
  --   get a real answer. (p, p) is true whichever side of 18 p is on — a minor sender
  --   takes the first permissive branch, an adult recipient the second — so it is the
  --   one question whose answer does not depend on which rows exist.
  --   Read-only: profiles.id is FK'd to auth.users, so a seeded probe row cannot exist.
  SELECT id INTO v_probe FROM profiles WHERE date_of_birth IS NOT NULL LIMIT 1;
  IF v_probe IS NULL THEN
    RAISE NOTICE '  CONTROL SKIPPED: no profile carries a date_of_birth, so nothing can '
                 'demonstrate a TRUE. Re-run this assertion once one does.';
  ELSE
    PERFORM set_config('request.jwt.claims',
                       format('{"sub":"%s","role":"authenticated"}', v_probe), true);
    v_ans := public.may_initiate_by_age(v_probe, v_probe);
    IF v_ans IS DISTINCT FROM true THEN
      RAISE EXCEPTION
        'ABORTING: with a REAL session, may_initiate_by_age(p,p) answered % instead of '
        'true. The guard is refusing everyone and messaging would be dead. Nothing applied.', v_ans;
    END IF;
  END IF;

  PERFORM set_config('request.jwt.claims', '', true);
  RAISE NOTICE '20261036 verified: both refuse a guest, and may_initiate_by_age still answers a real session.';
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
VALUES ('20261036_age_oracle_needs_a_real_caller.sql', 'bef4196f9a2ac4660c6acf53369ff58bd037c4a871906d5c979f89b0ae9868dd')
ON CONFLICT (filename) DO UPDATE
  SET checksum = excluded.checksum, applied_at = now(), applied_by = current_user;
-- ─── ledger:stamp:end ────────────────────────────────────────────────
COMMIT;

NOTIFY pgrst, 'reload schema';
