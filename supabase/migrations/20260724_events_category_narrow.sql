-- ─── Events category re-taxonomy — STEP 2 of 2: MIGRATE + NARROW ────────────
--
--   ORDER OF OPERATIONS — DO NOT SKIP OR REORDER
--
--   1. 20260724_events_category_widen.sql ... must ALREADY be applied
--   2. eas update --channel production ....... must ALREADY be published AND
--      have reached users (give it a day)
--   3. ►► THIS FILE ◄◄
--
-- STOP: if you have not done 1 and 2, close this file. Running it early breaks
-- event editing for every user still on the old bundle — see the header of
-- 20260724_events_category_widen.sql for why.
--
-- WHAT THIS DOES
--   • Normalises any NULL category to 'other'. A CHECK constraint evaluates to
--     UNKNOWN for NULL and therefore PASSES it, so nulls survive both steps
--     unless explicitly handled. They would render under the "All" chip only.
--   • Folds the retired keys into the final set: concert → music,
--     festival → music. Per the owner's call, arts-leaning festivals get
--     hand-corrected afterwards in the admin UI (few rows).
--   • Narrows the CHECK to the final six categories.
--
-- Safe to re-run: the UPDATEs are idempotent (no rows match on a second pass)
-- and the constraint is drop-then-create.

BEGIN;

UPDATE events SET category = 'other' WHERE category IS NULL;

UPDATE events SET category = 'music' WHERE category IN ('concert', 'festival');

ALTER TABLE public.events DROP CONSTRAINT IF EXISTS events_category_check;

ALTER TABLE public.events ADD CONSTRAINT events_category_check
  CHECK (category = ANY (ARRAY[
    'music', 'nightlife', 'sports', 'arts', 'family', 'other'
  ]));

COMMIT;

-- After this runs, the legacy alias in EventsScreen.js (music also matching
-- 'concert'/'festival') is dead code. Harmless to leave; safe to delete.
