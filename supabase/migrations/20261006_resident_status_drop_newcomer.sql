-- ═══════════════════════════════════════════════════════════════════════════
-- resident_status: FIVE options become FOUR — 'newcomer' is retired.
--
--   student  · working · resident · visiting
--
-- The wizard offers, in this order: Student / Öğrenciyim, Working here / Burada
-- çalışıyorum, Resident / Burada yaşıyorum, Tourist / Ziyaretçiyim. 'visiting' KEEPS
-- its value while its label reads "Tourist" — renaming the stored string would mean a
-- second constraint migration for something no user ever sees, and constants/
-- profileGate.js and this CHECK must agree character-for-character (npm run
-- profile:check compares them and goes red on any disagreement).
--
-- ─── THIS FILE NARROWS A CHECK, WHICH IS THE DANGEROUS DIRECTION ────────────
--
-- Adding a value to a CHECK cannot fail. REMOVING one fails at ADD CONSTRAINT time if
-- any row holds it — a hard error naming the constraint and nothing else, in the middle
-- of a manual paste. So section 0 asks the question FIRST and prints the answer, and the
-- whole file is inside BEGIN … COMMIT: an abort here half-applies nothing and is
-- re-runnable the moment the data is dealt with.
--
-- WHY THE COUNT IS DERIVED HERE AND NOT ASSUMED. The expectation is zero — the wizard
-- is the only writer of profiles.resident_status and it has never reached a user (the
-- OTA carrying PROFILE_GATE_LIVE = true has not been published as this is written). But
-- that is an argument from the CLIENT about the DATABASE, which is exactly the reasoning
-- this repo has been burned by. `profiles` denies SELECT to anon, so the repo-side
-- checker holding only the anon key structurally cannot answer it — a zero from it would
-- be RLS, not truth. The only place that can ask is a statement running as postgres,
-- which is this file. It counts, it prints, and it refuses to continue if the answer is
-- not zero.
--
-- IF IT IS NOT ZERO: decide where those users belong before re-running. 'newcomer' maps
-- most naturally onto 'resident' (someone who has moved here) — but that is a product
-- call about real people's answers, not a default this migration is entitled to make,
-- which is why there is no silent UPDATE in it.
--
-- ─── PRE-FLIGHT (run this by hand first, Role → postgres) ───────────────────
--   SELECT resident_status, count(*) FROM public.profiles
--    WHERE resident_status IS NOT NULL GROUP BY 1 ORDER BY 1;
-- ═══════════════════════════════════════════════════════════════════════════

SET ROLE postgres;
BEGIN;

-- ─── 0. BEFORE — the count, printed, and the refusal ────────────────────────
DO $$
DECLARE
  n_newcomer int;
  n_any      int;
  r          record;
BEGIN
  SELECT count(*) INTO n_newcomer FROM public.profiles WHERE resident_status = 'newcomer';
  SELECT count(*) INTO n_any      FROM public.profiles WHERE resident_status IS NOT NULL;

  RAISE NOTICE '── BEFORE ────────────────────────────────────────────────';
  RAISE NOTICE '  profiles with a resident_status set: %', n_any;
  FOR r IN SELECT resident_status AS v, count(*) AS c FROM public.profiles
            WHERE resident_status IS NOT NULL GROUP BY 1 ORDER BY 1 LOOP
    RAISE NOTICE '    % : %', rpad(r.v, 10), r.c;
  END LOOP;
  IF n_any = 0 THEN
    RAISE NOTICE '    (none — the wizard has not written a row yet)';
  END IF;

  -- IS DISTINCT FROM, not <>. count(*) cannot be NULL so <> would be correct here, but
  -- the house rule is that assertions do not depend on the reader checking whether NULL
  -- is reachable before trusting them.
  IF n_newcomer IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION
      'ABORT: % profile(s) still carry resident_status = ''newcomer''. Decide where they '
      'belong and UPDATE them first — this file deliberately does not choose for you. '
      'Nothing has been applied; the transaction rolls back clean.', n_newcomer;
  END IF;
END $$;

-- ─── 1. The constraint ──────────────────────────────────────────────────────
-- Same DROP-then-ADD shape as 20261001, which is what makes the newest definition of a
-- constraint findable by filename order: scripts/check-profile-gate.mjs resolves each
-- CHECK to the LAST migration that ADDs it, so this file — not 20261001 — is now the
-- authority it compares RESIDENT_STATUSES against.
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_resident_status_check;
ALTER TABLE public.profiles ADD  CONSTRAINT profiles_resident_status_check
  CHECK (resident_status IS NULL OR resident_status IN
        ('student','working','resident','visiting'));

-- ─── 2. AFTER — assert against pg_get_constraintdef, not against this file ──
DO $$
DECLARE
  v_def text;
  v     text;
BEGIN
  SELECT pg_get_constraintdef(c.oid) INTO v_def
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace ns ON ns.oid = t.relnamespace
   WHERE ns.nspname = 'public' AND t.relname = 'profiles'
     AND c.conname = 'profiles_resident_status_check';

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'FAIL: profiles_resident_status_check does not exist after the ADD';
  END IF;

  -- THE ABSENCE, which is the entire point of the file. A constraint definition carries
  -- no comments — unlike pg_get_functiondef, whose prose has twice defeated a negative
  -- token in this repo — so a plain NOT LIKE is safe here and means what it says.
  IF v_def LIKE '%newcomer%' THEN
    RAISE EXCEPTION 'FAIL: ''newcomer'' is still permitted. def = %', v_def;
  END IF;

  -- ...paired with a POSITIVE for each survivor. Without these, the absence check above
  -- would pass just as happily on a constraint that permits nothing at all.
  FOREACH v IN ARRAY ARRAY['student','working','resident','visiting'] LOOP
    IF v_def NOT LIKE '%''' || v || '''%' THEN
      RAISE EXCEPTION 'FAIL: ''%'' is no longer permitted. def = %', v, v_def;
    END IF;
  END LOOP;

  -- The NULL arm survives. profiles.resident_status is NULL for every row until its
  -- owner finishes the wizard; a constraint that lost `IS NULL OR` would reject the
  -- next INSERT into profiles — that is, every new signup — and the failure would
  -- surface as "sign-up is broken" pointing nowhere near this file.
  IF v_def NOT LIKE '%IS NULL%' THEN
    RAISE EXCEPTION 'FAIL: the NULL arm is gone — new signups would be rejected. def = %', v_def;
  END IF;

  -- CONTROL. A definition this probe cannot read at all would satisfy every NOT LIKE
  -- above; assert it is really the string it looks like before believing any of them.
  IF v_def NOT LIKE '%resident_status%' THEN
    RAISE EXCEPTION 'CONTROL FAILED: the constraint def does not mention the column it '
                    'constrains, so nothing above was actually checked. def = %', v_def;
  END IF;

  RAISE NOTICE '── AFTER ─────────────────────────────────────────────────';
  RAISE NOTICE '  %', v_def;
  RAISE NOTICE '  4 values permitted · newcomer retired · NULL arm intact';
  RAISE NOTICE '──────────────────────────────────────────────────────────';
END $$;

COMMIT;
RESET ROLE;

NOTIFY pgrst, 'reload schema';

-- ─── APPLYING, AND THE FREE RED-FIRST ──────────────────────────────────────
--   0. Run supabase/verify_schema.sql BEFORE pasting this file. The
--      '1006_resident_status' row must come back RED — the live constraint still
--      permits 'newcomer' at that point. That is the only chance to watch this token
--      fail, and it costs one query: the repo half holds the anon key alone, so
--      pg_constraint is unreachable from `npm run profile:check` and the token would
--      otherwise ship having never been observed doing anything. A token that goes
--      green on its first ever run has not been tested, it has been assumed.
--      supabase/schema_drift_audit.sql reports a K-row drift on the same constraint at
--      this point, for the same reason and with the same expiry.
--
-- ─── AFTER APPLYING ────────────────────────────────────────────────────────
--   1. Run supabase/verify_schema.sql — QUERY 1's first row must say ALL n PASS. The
--      H-section token '1006_resident_status' is the only check that can see this
--      change: the constraint NAME is unchanged, so sections B and E stay green over
--      a stale value set by construction.
--   2. Run `npm run profile:check` — it resolves profiles_resident_status_check to the
--      newest migration that ADDs it and compares that value set to RESIDENT_STATUSES.
--   3. supabase/schema_drift_audit.sql carries the same four values as a repo baseline
--      literal signature; it was updated in the same commit as this file.
--
-- ─── REVERT ────────────────────────────────────────────────────────────────
-- Widening is the safe direction and cannot fail on data:
--   ALTER TABLE public.profiles DROP CONSTRAINT profiles_resident_status_check;
--   ALTER TABLE public.profiles ADD  CONSTRAINT profiles_resident_status_check
--     CHECK (resident_status IS NULL OR resident_status IN
--           ('student','working','newcomer','resident','visiting'));
-- Revert the client half in the same breath, or profile:check goes red — which is the
-- guard working, not an obstacle.
