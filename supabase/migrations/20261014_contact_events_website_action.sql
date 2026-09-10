-- ─── contact_events: permit action = 'website' ──────────────────────────────
--
-- Slice 2 of the Yurtlar / dorm partner showcase. ONE CHECK CONSTRAINT. No new table, no
-- new column, no policy, no function.
--
-- ─── WHY ────────────────────────────────────────────────────────────────────
-- The dorm showcase has three contact affordances — WhatsApp, Ara, and the partner's
-- website — and the partner report needs all three. `contact_events` already accepts
-- module = 'accommodation' (its module CHECK is the MODULE_FLAGS vocabulary, and
-- accommodation has been in it since 20260910), so the module half needs nothing. The
-- ACTION half is the gap: the constraint permits only 'call', 'whatsapp' and
-- 'call_secondary'.
--
-- ⚠ AN UNAPPLIED VERSION OF THIS FILE FAILS SILENTLY, WHICH IS WHY THE ORDER MATTERS.
--   logContactEvent is deliberately fire-and-forget and cannot throw — it runs on the line
--   BEFORE Linking.openURL so a hanging analytics write can never cost somebody their tap.
--   The cost of that guarantee is that a row rejected by this CHECK is swallowed: no error,
--   no crash, no row. Website taps would read as ZERO, and a zero from a working counter
--   and a zero from a rejected INSERT are the same number on the screen.
--
--   So: APPLY THIS BEFORE FLIPPING DORMS_LIVE. The precondition is recorded on the flag
--   itself in constants/flags.js, because that is the file somebody edits at go-live, and
--   a note in a migration nobody is reading that day protects nothing.
--
-- ─── WHY NO `NOTIFY pgrst` ──────────────────────────────────────────────────
-- That is for ADD COLUMN, where a stale PostgREST schema cache reports 42703 for a column
-- that exists. A CHECK constraint is not in the schema cache; PostgREST sends the INSERT
-- and Postgres accepts or rejects it. Nothing to reload.
--
-- ─── HOW THIS IS REGISTERED, AND WHY THE EXISTING TOKEN IS NOT ENOUGH ───────
-- `verify_schema.sql` already carries an E-section token for
-- ('0910_contact_events','contact_events_action_check') — but that asserts a constraint of
-- that NAME exists, and this is a drop-then-add of the SAME NAME. The E token therefore
-- stays green whether or not this file was ever applied: exactly the shape of the
-- `facilities.area` failure the drift check exists to catch.
--
-- So an H-section token goes in alongside it, asserting the DEFINITION rather than the
-- name, read from pg_constraint. Keep both: existence is still the E token's job.
--
-- EXECUTION: SQL editor, Role = postgres. Run the WHOLE FILE — one transaction ending in
-- COMMIT. Re-runnable: drop-then-add per constraint, house convention.

SET ROLE postgres;

BEGIN;

-- ─── 1. What the constraint permits BEFORE the change ───────────────────────
-- Printed, so the run itself records what was replaced. Read from pg_constraint, never
-- from the migration file that claims to have created it.
DO $$
DECLARE v_def text;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO v_def FROM pg_constraint
   WHERE conrelid = 'public.contact_events'::regclass
     AND conname  = 'contact_events_action_check';
  RAISE NOTICE '── before ───────────────────────────────────────────────';
  RAISE NOTICE '  %', coalesce(v_def, '<no such constraint>');
  RAISE NOTICE '─────────────────────────────────────────────────────────';
END $$;

-- ─── 2. The change ──────────────────────────────────────────────────────────
ALTER TABLE public.contact_events DROP CONSTRAINT IF EXISTS contact_events_action_check;
ALTER TABLE public.contact_events ADD CONSTRAINT contact_events_action_check
  CHECK (action IN ('call','whatsapp','call_secondary','website'));

-- ─── 3. Assert it, from pg_constraint, INSIDE the transaction ───────────────
-- A false alarm here rolls the whole thing back and costs nothing — the argument for
-- wrapping even a one-line change in an explicit transaction with its assertions inside.
--
-- The failure message PRINTS THE DEFINITION IT READ. An assertion that fails without
-- showing what it saw sends the next reader to suspect the system before the check.
DO $$
DECLARE v_def text;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO v_def FROM pg_constraint
   WHERE conrelid = 'public.contact_events'::regclass
     AND conname  = 'contact_events_action_check';

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'contact_events_action_check does not exist after the ADD';
  END IF;

  -- IS DISTINCT FROM / position(), not <>: a NULL comparison is NULL and `IF NULL THEN`
  -- does not fire, so a plain <> would PASS on precisely the failure it exists to catch.
  IF position('website' in v_def) = 0 THEN
    RAISE EXCEPTION 'the action CHECK does not permit website. def=%', v_def;
  END IF;

  -- And the three that were already there must survive. A file that REPLACES the
  -- vocabulary rather than extending it is not this file.
  IF position('call' in v_def) = 0
     OR position('whatsapp' in v_def) = 0
     OR position('call_secondary' in v_def) = 0
  THEN
    RAISE EXCEPTION 'the action CHECK lost one of the original three. def=%', v_def;
  END IF;

  RAISE NOTICE '── after ────────────────────────────────────────────────';
  RAISE NOTICE '  %', v_def;
  RAISE NOTICE '  website is now permitted; the original three survive.';
  RAISE NOTICE '─────────────────────────────────────────────────────────';
END $$;

-- ─── 4. A live round-trip, rolled back ──────────────────────────────────────
-- The assertions above read the DEFINITION. This proves the BEHAVIOUR, which is not the
-- same claim: a constraint can read correctly and still reject, if something else on the
-- table disagrees. Written and removed inside the same transaction.
--
-- entity_id is a throwaway uuid, NOT the Alasia id — a probe must not leave a row that
-- looks like a real tap even for the instant before it is rolled back.
DO $$
DECLARE v_probe uuid := '00000000-0000-4000-8000-0000000000ff';
BEGIN
  INSERT INTO public.contact_events (module, entity_id, action, region)
  VALUES ('accommodation', v_probe, 'website', NULL);

  IF NOT EXISTS (SELECT 1 FROM public.contact_events
                  WHERE entity_id = v_probe AND action = 'website') THEN
    RAISE EXCEPTION 'the website INSERT did not land';
  END IF;

  DELETE FROM public.contact_events WHERE entity_id = v_probe;
  RAISE NOTICE '  round-trip: a website row INSERTs and was removed again.';

  -- NEGATIVE CONTROL. Without this the positive above proves only that SOMETHING can be
  -- inserted, not that the CHECK is doing any work at all — a constraint accidentally
  -- dropped rather than replaced would sail through the test above.
  BEGIN
    INSERT INTO public.contact_events (module, entity_id, action, region)
    VALUES ('accommodation', v_probe, 'not_a_real_action', NULL);
    DELETE FROM public.contact_events WHERE entity_id = v_probe;
    RAISE EXCEPTION 'CONTROL FAILED: a bogus action was accepted — the CHECK is not enforcing';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE '  control: a bogus action is still rejected. The CHECK is live.';
  END;
END $$;

COMMIT;
RESET ROLE;

-- ─── REVERT ────────────────────────────────────────────────────────────────
-- Narrow the vocabulary back. Safe ONLY if no 'website' rows exist — the ADD would fail
-- against them, which is the correct outcome rather than a reason to delete data.
--
--   SET ROLE postgres;
--   BEGIN;
--     ALTER TABLE public.contact_events DROP CONSTRAINT IF EXISTS contact_events_action_check;
--     ALTER TABLE public.contact_events ADD CONSTRAINT contact_events_action_check
--       CHECK (action IN ('call','whatsapp','call_secondary'));
--   COMMIT;
--   RESET ROLE;
--
-- Reverting this while the dorm showcase is live does NOT break the app: logContactEvent
-- swallows the rejection and the website button keeps working. It silently stops counting,
-- which is the failure this file's header is about.
