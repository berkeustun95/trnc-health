-- ─── contact_events: permit action = 'maps' ─────────────────────────────────
--
-- Shiny Paw pet hotel partner, Explore slice. ONE CHECK CONSTRAINT. No new table, no new
-- column, no policy, no function. Shaped on 20261014, which added 'website' the same way.
--
-- ─── WHY ────────────────────────────────────────────────────────────────────
-- PetHotelPartnerScreen has four contact affordances: WhatsApp, Ara, website and
-- directions. The first three log. Directions did not, because the action CHECK permits
-- only call / whatsapp / call_secondary / website, and logging a directions tap as
-- 'website' would fold two intentions into one number in the partner report. The module
-- half needs nothing: contact_events_module_check already permits 'pets'.
--
-- ⚠ AN UNAPPLIED VERSION OF THIS FILE FAILS SILENTLY, WHICH IS WHY THE ORDER MATTERS.
--   logContactEvent is fire-and-forget and cannot throw. A row rejected by this CHECK is
--   swallowed: no error, no crash, no row, and directions taps read as ZERO.
--   So: APPLY THIS BEFORE FLIPPING PET_HOTEL_LIVE. The precondition is recorded on the
--   flag in constants/flags.js, the file somebody edits at go-live.
--
-- ─── WHY 20261046 AND NOT 20261045 ──────────────────────────────────────────
-- 20261045_places_source.sql exists on feat/visitncy-routes (unmerged, unapplied). Prefixes
-- are sequence numbers, so this takes the next one to avoid a collision when both merge.
--
-- ─── WHY NO `NOTIFY pgrst` ──────────────────────────────────────────────────
-- That is for ADD COLUMN. A CHECK is not in PostgREST's schema cache; Postgres accepts or
-- rejects the INSERT itself. Nothing to reload.
--
-- ─── TWO THINGS THIS FILE DOES DIFFERENTLY FROM 20261014 ────────────────────
--   • Literals are matched WITH their quotes: position('''call''' in def). 20261014's
--     position('call' in def) cannot fail on a dropped bare 'call', because 'call' is a
--     substring of 'call_secondary'. verify_schema.sql's tokens already quote; so does this.
--   • The output is the EXCEPTION, not RAISE NOTICE. NOTICEs are invisible in the Supabase
--     SQL editor (CLAUDE.md), so every assertion carries the definition it read in its
--     error. A clean run shows only "Success. No rows returned".
--
-- ─── HOW THIS IS REGISTERED ─────────────────────────────────────────────────
-- DROP-then-ADD of the SAME NAME, so the E-section token for contact_events_action_check
-- stays green whether or not this file ran. Two H-section tokens ('20261046_maps_action')
-- assert the DEFINITION instead. The 20261014 tokens are position checks, not counts, and
-- stay green after this: they are not retired.
--
-- EXECUTION: SQL editor, Role = postgres. Run the WHOLE FILE, copied from disk — one
-- transaction ending in COMMIT. Re-runnable: drop-then-add, house convention.

SET ROLE postgres;

BEGIN;

-- ─── 1. The change ──────────────────────────────────────────────────────────
ALTER TABLE public.contact_events DROP CONSTRAINT IF EXISTS contact_events_action_check;
ALTER TABLE public.contact_events ADD CONSTRAINT contact_events_action_check
  CHECK (action IN ('call','whatsapp','call_secondary','website','maps'));

-- ─── 2. Assert the DEFINITION, from pg_constraint, INSIDE the transaction ───
DO $$
DECLARE v_def text;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO v_def FROM pg_constraint
   WHERE conrelid = 'public.contact_events'::regclass
     AND conname  = 'contact_events_action_check';

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'contact_events_action_check does not exist after the ADD';
  END IF;

  IF position('''maps''' in v_def) = 0 THEN
    RAISE EXCEPTION 'the action CHECK does not permit maps. def=%', v_def;
  END IF;

  -- The four that were already there must survive. A file that REPLACES the vocabulary
  -- rather than extending it is not this file.
  IF position('''call''' in v_def) = 0
     OR position('''whatsapp''' in v_def) = 0
     OR position('''call_secondary''' in v_def) = 0
     OR position('''website''' in v_def) = 0
  THEN
    RAISE EXCEPTION 'the action CHECK lost one of call/whatsapp/call_secondary/website. def=%', v_def;
  END IF;
END $$;

-- ─── 3. BEHAVIOUR: a live round-trip, and a negative control ────────────────
-- The block above reads the definition. This proves an INSERT of the exact shape the app
-- sends (module 'pets', action 'maps') is accepted. entity_id is a throwaway uuid, NOT the
-- Shiny Paw id, so the probe never looks like a real tap. Everything it writes is deleted
-- before the block ends, inside the transaction.
DO $$
DECLARE v_probe uuid := '00000000-0000-4000-8000-0000000001ee';
BEGIN
  INSERT INTO public.contact_events (module, entity_id, action, region)
  VALUES ('pets', v_probe, 'maps', NULL);

  IF NOT EXISTS (SELECT 1 FROM public.contact_events
                  WHERE entity_id = v_probe AND action = 'maps' AND module = 'pets') THEN
    RAISE EXCEPTION 'a pets/maps INSERT did not land';
  END IF;
  DELETE FROM public.contact_events WHERE entity_id = v_probe;

  -- NEGATIVE CONTROL. Without it the positive proves only that SOMETHING inserts, not that
  -- the CHECK is doing any work: a constraint dropped rather than replaced passes above.
  BEGIN
    INSERT INTO public.contact_events (module, entity_id, action, region)
    VALUES ('pets', v_probe, 'not_a_real_action', NULL);
    DELETE FROM public.contact_events WHERE entity_id = v_probe;
    RAISE EXCEPTION 'CONTROL FAILED: a bogus action was accepted — the CHECK is not enforcing';
  EXCEPTION WHEN check_violation THEN
    NULL;  -- expected: the CHECK is live
  END;

  IF EXISTS (SELECT 1 FROM public.contact_events WHERE entity_id = v_probe) THEN
    RAISE EXCEPTION 'probe rows survived: % row(s) at entity_id %',
      (SELECT count(*) FROM public.contact_events WHERE entity_id = v_probe), v_probe;
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
VALUES ('20261046_contact_events_maps_action.sql', '093629116bc76d1bd415ad10e88e67992877533db59698e90ee0463de3938496')
ON CONFLICT (filename) DO UPDATE
  SET checksum = excluded.checksum, applied_at = now(), applied_by = current_user;
-- ─── ledger:stamp:end ────────────────────────────────────────────────
COMMIT;
RESET ROLE;

-- ─── Verification after applying (read-only, run alone) ─────────────────────
--   SELECT pg_get_constraintdef(oid) FROM pg_constraint
--    WHERE conrelid = 'public.contact_events'::regclass AND conname = 'contact_events_action_check';
--   -- expect: CHECK ((action = ANY (ARRAY['call'::text, 'whatsapp'::text,
--   --          'call_secondary'::text, 'website'::text, 'maps'::text])))
--   Then run supabase/verify_schema.sql: both 20261046_maps_action tokens must be OK.

-- ─── REVERT ────────────────────────────────────────────────────────────────
-- Narrow the vocabulary back. Safe ONLY if no 'maps' rows exist — the ADD fails against
-- them, which is the correct outcome rather than a reason to delete data.
--
--   SET ROLE postgres;
--   BEGIN;
--     ALTER TABLE public.contact_events DROP CONSTRAINT IF EXISTS contact_events_action_check;
--     ALTER TABLE public.contact_events ADD CONSTRAINT contact_events_action_check
--       CHECK (action IN ('call','whatsapp','call_secondary','website'));
--   COMMIT;
--   RESET ROLE;
--
-- Reverting while the pet hotel is live does NOT break the app: logContactEvent swallows
-- the rejection and the directions button keeps working. It silently stops counting.
