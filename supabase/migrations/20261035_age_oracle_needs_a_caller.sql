-- ─── 20261035 — the age rule stops answering strangers ─────────────────────
--
-- Two guards, two functions, no grants and no schema change.
--
-- ─── THE DEFECT, IN PLAIN WORDS ─────────────────────────────────────────────
--
-- may_initiate_by_age(sender, recipient) exists to STOP ADULTS INITIATING CONTACT WITH
-- UNDER-18s. It is the child-safety control on Student Hub messaging: start_conversation
-- calls it before opening a thread, and a trigger re-checks it on every message insert.
--
-- It is SECURITY DEFINER, so it reads profiles.date_of_birth for whichever two uuids it
-- is handed, regardless of who is asking. And it was callable by `anon` — no JWT, no
-- account, nothing but the public key that ships inside the app.
--
-- So the function written to protect minors would tell any anonymous caller WHICH USERS
-- ARE MINORS. Hand it a uuid you know belongs to an adult as the sender and the uuid you
-- are interested in as the recipient, and the boolean comes back as a clean over-18 bit
-- on that person:
--
--     may_initiate_by_age(<known adult>, X) = false   ⇒  X is under 18
--     may_initiate_by_age(<known adult>, X) = true    ⇒  X is 18 or over
--
-- ADA is a DECLARED MIXED-AUDIENCE APP with a 13-15 band, a 16-17 band, and 18-and-over.
-- date_of_birth is the field the whole advertising branch turns on, and `profiles` is the
-- table that already shipped a six-week over-share once. An unauthenticated minor-status
-- oracle on it is not a hardening item.
--
-- is_listed_student(uuid) is the same shape, smaller radius: DEFINER, anon-callable, and
-- it answers "is this person on the student list" about anybody you name.
--
-- ─── ⚠ WHY THE FIX IS A GUARD AND NOT A REVOKE ──────────────────────────────
--
-- The reflex is `REVOKE EXECUTE ... FROM anon`, which is what 20261034 does for the
-- waitlist blast. It is the WRONG instrument here and the difference is worth stating,
-- because the next person will reach for the revoke first too.
--
-- Both functions are called from inside RLS policy evaluation (can_see_student_lists()
-- wraps is_listed_student and is used in policies). A function reached that way runs with
-- the INVOKING role's privileges — so removing EXECUTE does not make the policy return
-- false, it makes the whole query raise `permission denied for function`. A read that
-- politely returns no rows today would start erroring instead, on whatever path reaches
-- it. The revoke would trade a privacy leak for an outage.
--
-- Returning false to a caller with no uid changes no privileges, cannot raise, and is
-- also the HONEST answer: "may this session initiate contact" has no meaning for a
-- session that is not signed in, and false is what the rule already implies.
--
-- ─── THE FOUR CALL SITES, CHECKED RATHER THAN ASSUMED ───────────────────────
--
-- The guard is only safe if no legitimate caller reaches these functions with a NULL
-- auth.uid(). All four references in 20261029 were read before this was written:
--
--   :379  can_see_student_lists() -> is_listed_student(auth.uid())
--         The argument IS auth.uid(). With a NULL uid the lookup is `WHERE user_id = NULL`,
--         which matches nothing and already returns false. The guard is a NO-OP here —
--         it returns the same answer by a shorter route.
--   :798  start_conversation -> is_listed_student(p_recipient_id)
--   :807  start_conversation -> may_initiate_by_age(v_me, p_recipient_id)
--   :919  send_message       -> is_listed_student(v_them)
--         All three sit below `IF v_me IS NULL OR is_anonymous_session() THEN RAISE`, so
--         auth.uid() is non-null by the time any of them runs.
--   :514  enforce_message_age_rule (TRIGGER) -> may_initiate_by_age(v_initiator, v_recipient)
--         THE ONE THAT NEEDED CHECKING, because its arguments come from the conversations
--         row rather than from the caller, so the guard could in principle block a write
--         the trigger should have allowed. It cannot: `INSERT INTO messages` appears in
--         exactly two places in this schema (20261029:828 and :924), both inside
--         start_conversation and send_message, and both refuse a null uid before they
--         insert. Nothing else writes that table, so the trigger has no null-uid path.
--
-- The one behaviour that DOES change: a hand-written `INSERT INTO messages` in the SQL
-- editor as postgres (auth.uid() null) now raises AGE_RULE instead of succeeding. That is
-- an operator action rather than a code path, and it fails CLOSED on a child-safety rule,
-- which is the direction to fail in. Set request.jwt.claims first if you ever need it.
--
-- ─── WHAT THIS DOES NOT CLOSE ───────────────────────────────────────────────
--
-- A signed-in user can still ask both questions about anybody. That is by design:
-- start_conversation has to answer them to work at all, and any listed student can
-- already see the list. What ends here is the ANONYMOUS oracle — the version with no
-- account, no rate limit, and nothing tying the asker to a person.

BEGIN;

-- ─── 0. Guards ──────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF to_regprocedure('public.may_initiate_by_age(uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION 'REFUSING: may_initiate_by_age(uuid,uuid) is missing. Is 20261029 applied?';
  END IF;
  IF to_regprocedure('public.is_listed_student(uuid)') IS NULL THEN
    RAISE EXCEPTION 'REFUSING: is_listed_student(uuid) is missing. Is 20261029 applied?';
  END IF;
END $$;

-- ─── 1. may_initiate_by_age — a rule about a session, answered only for one ─
--
-- Body unchanged below the guard. TRUE means "this pairing may proceed"; the two RETURN
-- true branches are the permissive ones (a minor sending, or an adult receiving) and
-- false is the block. Returning false for a caller with no session therefore denies, and
-- denial is the safe direction for the rule this function enforces.
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
  -- ⚠ ADDED 20261035. Without this the function reads two arbitrary dates of birth for
  --   anyone who can reach PostgREST, and its answer is a minor/adult bit on the uuid in
  --   the second argument. See the header: the control against adults contacting minors
  --   was itself the way to find the minors.
  IF auth.uid() IS NULL THEN
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

-- ─── 2. is_listed_student — same guard, and at :379 it is a no-op ───────────
--
-- Stays LANGUAGE sql: the guard is one more conjunct rather than a control-flow branch,
-- so the function keeps its STABLE inlineable shape and the planner sees the same thing
-- it saw before. `auth.uid() IS NOT NULL AND EXISTS(...)` short-circuits, so a JWT-less
-- caller never reaches the lookup.
CREATE OR REPLACE FUNCTION public.is_listed_student(p_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT auth.uid() IS NOT NULL
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
-- The oracle is EXERCISED, not inspected. Asserting that the text contains "auth.uid()"
-- would pass on a function that reads it and ignores it; the only evidence that the
-- oracle is shut is asking it a question as a caller with no session and getting the
-- constant answer back.
DO $$
DECLARE
  v_probe  uuid;
  v_listed uuid;
  v_ans    boolean;
BEGIN
  -- ── (1) NO SESSION: both must answer false, for any uuids at all ──────────
  --    '' rather than NULL because that is the shape auth.uid() nullifs away, and it is
  --    what an unset request.jwt.claims actually looks like to it.
  PERFORM set_config('request.jwt.claims', '', true);

  v_ans := public.may_initiate_by_age(
             '00000000-0000-4000-8000-0000000000a1'::uuid,
             '00000000-0000-4000-8000-0000000000a2'::uuid);
  IF v_ans IS DISTINCT FROM false THEN
    RAISE EXCEPTION
      'ABORTING: may_initiate_by_age answered % to a caller with no session. The age '
      'oracle is still open. Nothing applied.', v_ans;
  END IF;

  v_ans := public.is_listed_student('00000000-0000-4000-8000-0000000000a1'::uuid);
  IF v_ans IS DISTINCT FROM false THEN
    RAISE EXCEPTION
      'ABORTING: is_listed_student answered % to a caller with no session. Nothing applied.', v_ans;
  END IF;

  -- ── (2) THE CONTROLS, WITHOUT WHICH (1) PROVES NOTHING ────────────────────
  --    A function that returned false unconditionally passes every assertion above and
  --    would have silently killed Student Hub messaging — start_conversation refuses
  --    every pairing with AGE_RULE, and the student list renders empty for everybody.
  --    So each function must also be shown ANSWERING TRUE when it should.
  --
  --    ⚠ READ-ONLY, AND IT HAS TO BE. profiles.id is FK'd to auth.users, so a seeded
  --      probe row cannot exist — an INSERT of a fabricated uuid aborts on the foreign
  --      key and takes the migration with it. These read rows that are already there and
  --      write nothing.
  SELECT id INTO v_probe FROM profiles WHERE date_of_birth IS NOT NULL LIMIT 1;
  IF v_probe IS NULL THEN
    RAISE NOTICE '  CONTROL SKIPPED: no profile carries a date_of_birth, so nothing can '
                 'demonstrate a TRUE. Re-run this assertion once one does.';
  ELSE
    PERFORM set_config('request.jwt.claims',
                       format('{"sub":"%s","role":"authenticated"}', v_probe), true);
    -- (p, p) is true whichever side of 18 p is on: a minor sender takes the first
    -- permissive branch, an adult recipient takes the second. It is the one question
    -- whose answer does not depend on which rows happen to exist.
    v_ans := public.may_initiate_by_age(v_probe, v_probe);
    IF v_ans IS DISTINCT FROM true THEN
      RAISE EXCEPTION
        'ABORTING: with a session, may_initiate_by_age(p,p) answered % instead of true. '
        'The guard is refusing everyone, not just anonymous callers — messaging would be '
        'dead on arrival. Nothing applied.', v_ans;
    END IF;
  END IF;

  SELECT e.user_id INTO v_listed
    FROM student_education e JOIN profiles p ON p.id = e.user_id
   WHERE e.listing_opt_in AND p.display_name IS NOT NULL
     AND (p.ugc_banned_until IS NULL OR p.ugc_banned_until <= now())
   LIMIT 1;
  IF v_listed IS NULL THEN
    RAISE NOTICE '  CONTROL SKIPPED: nobody is on the student list yet, so nothing can '
                 'demonstrate a TRUE from is_listed_student. Expected while the hub is dark.';
  ELSE
    PERFORM set_config('request.jwt.claims',
                       format('{"sub":"%s","role":"authenticated"}', v_listed), true);
    IF public.is_listed_student(v_listed) IS DISTINCT FROM true THEN
      RAISE EXCEPTION
        'ABORTING: with a session, a genuinely listed student read as NOT listed. The '
        'guard is refusing everyone and the student list would render empty. Nothing applied.';
    END IF;
  END IF;

  PERFORM set_config('request.jwt.claims', '', true);
  RAISE NOTICE '20261035 verified: both functions answer false with no session, and still answer true with one.';
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
VALUES ('20261035_age_oracle_needs_a_caller.sql', '99b504ab7980aa82ac4466c24b6fa5125cedab17c96b1284f9b3804b8a1b0d24')
ON CONFLICT (filename) DO UPDATE
  SET checksum = excluded.checksum, applied_at = now(), applied_by = current_user;
-- ─── ledger:stamp:end ────────────────────────────────────────────────
COMMIT;

-- Both were replaced; PostgREST caches signatures.
NOTIFY pgrst, 'reload schema';
