-- ─── Events category re-taxonomy — STEP 1 of 2: WIDEN ───────────────────────
--
--   ORDER OF OPERATIONS — DO NOT SKIP OR REORDER
--
--   1. ►► THIS FILE ◄◄  ....... apply BEFORE publishing the OTA update
--   2. eas update --channel production
--   3. 20260724_events_category_narrow.sql ... apply AFTER the OTA has reached
--      users (give it a day; check EAS Update insights if unsure)
--
-- WHY THIS ORDER: the database is shared and changes instantly, but an OTA
-- bundle only reaches a user on their next app launch. So for a while there are
-- two client versions live at once — the old one writing 'concert'/'festival',
-- the new one writing 'music'/'sports'/'arts'/'family'. This migration widens
-- the CHECK constraint to a SUPERSET that accepts BOTH vocabularies, so neither
-- client can hit a constraint violation.
--
-- IF YOU RUN STEP 3 FIRST (or skip this file): an organizer still on the old
-- bundle who edits an event submits category='concert', trips the constraint,
-- and gets a raw Postgres error in an Alert dialog. That is the failure this
-- two-step exists to prevent.
--
-- No rows are changed here. This file only relaxes a constraint.
-- Safe to re-run: drop-then-create (Postgres has no ADD CONSTRAINT IF NOT EXISTS).

BEGIN;

ALTER TABLE public.events DROP CONSTRAINT IF EXISTS events_category_check;

ALTER TABLE public.events ADD CONSTRAINT events_category_check
  CHECK (category = ANY (ARRAY[
    -- legacy vocabulary (retired in step 2)
    'concert', 'festival',
    -- final vocabulary
    'music', 'nightlife', 'sports', 'arts', 'family', 'other'
  ]));

COMMIT;
