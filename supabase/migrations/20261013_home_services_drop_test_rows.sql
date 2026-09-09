-- ─── Remove the four home_services test rows ────────────────────────────────
--
-- Phase D of the partner-only change. DATA ONLY — no DDL, no policies, no functions.
-- Requires 20261012 (is_partner + the tightened read policy).
--
-- ─── WHAT THESE FOUR ARE ────────────────────────────────────────────────────
--   ecc59457  Mehmet Usta Plumbing      owner_id NULL      seeded 2026-06-25
--   3a3f7e1a  Nicosia Electric          owner_id NULL      seeded 2026-06-25
--   6084b642  Ali Carpenter & Painter   owner_id NULL      seeded 2026-06-25
--   7736d6ce  Kaju Usta elektirikci     owner_id 235da7e5  created 2026-07-01
--
-- The first three are the placeholder seed from supabase/home_services_migration.sql,
-- with the invented phone numbers it shipped (+90 548 000 0001 and friends). The fourth
-- came through the self-registration form from okay@deneme.com, a test account belonging
-- to the project owner and confirmed as such before this file was written.
--
-- NO profiles.role CHANGE IS NEEDED, and that was checked rather than assumed: no
-- account anywhere holds role='home_service_provider'. The Kaju account is 'organizer',
-- so deleting its listing strands nothing — App.js never routes it to the home-service
-- dashboard, and the crash that dashboard would hit on a missing listing
-- (`.eq('id', listing.id)` with listing null) is therefore unreachable.
--
-- ⚠ ONE ODDITY, RECORDED RATHER THAN CHASED. That row is status='active', which normally
--   means it went through AdminScreen's Approve — and that path also grants
--   role='home_service_provider' at AdminScreen.js:2692. Nobody holds the role. So either
--   the row was inserted directly, or the grant failed silently. It does not block this
--   delete, and the path is gated as of 20261012 + HS_SELF_REGISTRATION, but a silent
--   failure there matters if that policy is ever reversed.
--
-- ─── WHY AN EXPLICIT ID LIST ────────────────────────────────────────────────
-- `WHERE is_partner = false` would do the same thing today and would keep doing it to
-- whatever lands in the table next. `WHERE name LIKE ...` keys on a mutable column. Four
-- literal ids can only ever match these four rows, and section 2 asserts that they match
-- exactly four and that none of them is the partner.
--
-- ─── WHY NO DISABLE TRIGGER THIS TIME ───────────────────────────────────────
-- home_services carries hs_guard_insert (BEFORE INSERT) and hs_guard_owner_update
-- (BEFORE UPDATE). There is no DELETE trigger, so the auth.uid()-is-NULL problem that
-- forced the wrap in 20261010 and 20261012 does not arise here. Confirmed from
-- pg_trigger by section 2, not assumed from that sentence.
--
-- ─── NOTHING CASCADES ───────────────────────────────────────────────────────
-- No foreign key anywhere references home_services.id. contact_events.entity_id is
-- polymorphic and deliberately has NO FK (see its own H-token), so any tap rows for
-- these ids would be orphaned rather than deleted — section 2 COUNTS and PRINTS them
-- instead of assuming there are none. Expected to be zero: logContactEvent is wired only
-- to the partner card, which has never rendered for any of these rows.
--
-- EXECUTION: SQL editor, Role = postgres. Run the WHOLE FILE — one transaction ending in
-- COMMIT. No NOTIFY: nothing here changes the schema.

SET ROLE postgres;

BEGIN;

-- ─── 1. Look at exactly what is about to be destroyed ───────────────────────
-- Printed BEFORE the delete, so the run itself is the record of what it removed. If any
-- line here is a surprise, ROLLBACK instead of COMMIT and nothing has happened.
DO $$
DECLARE r record; n int := 0;
BEGIN
  RAISE NOTICE '── rows this file will DELETE ────────────────────────────';
  FOR r IN
    SELECT id, name, status, is_partner, owner_id, phone, service_types, created_at
      FROM public.home_services
     WHERE id IN ('ecc59457-0e36-4aeb-9cd1-dea30a4f09a8',
                  '3a3f7e1a-9d17-4cf8-b8a4-fb43729ab2dc',
                  '6084b642-212c-407e-9cd3-cde37fe61490',
                  '7736d6ce-2d0c-4ce6-ac80-1de082f0fe32')
     ORDER BY created_at, name
  LOOP
    n := n + 1;
    RAISE NOTICE '  % | % | status=% | is_partner=% | owner=% | % | %',
      r.id, r.name, r.status, r.is_partner,
      coalesce(r.owner_id::text, 'NULL'), r.phone, r.service_types::text;
  END LOOP;
  RAISE NOTICE '  (% row(s))', n;
  RAISE NOTICE '──────────────────────────────────────────────────────────';
END $$;

-- ─── 2. Pre-flight assertions ───────────────────────────────────────────────
DO $$
DECLARE
  v_match     int;
  v_partners  int;
  v_total     int;
  v_orphans   int;
  v_deltrig   int;
BEGIN
  SELECT count(*) INTO v_match FROM public.home_services
   WHERE id IN ('ecc59457-0e36-4aeb-9cd1-dea30a4f09a8',
                '3a3f7e1a-9d17-4cf8-b8a4-fb43729ab2dc',
                '6084b642-212c-407e-9cd3-cde37fe61490',
                '7736d6ce-2d0c-4ce6-ac80-1de082f0fe32');
  IF v_match IS DISTINCT FROM 4 THEN
    RAISE EXCEPTION 'expected 4 rows to match those ids, found % — somebody has already changed this table', v_match;
  END IF;

  -- THE ONE THAT MATTERS. If a partner id ever appears in that list, stop.
  SELECT count(*) INTO v_partners FROM public.home_services
   WHERE is_partner
     AND id IN ('ecc59457-0e36-4aeb-9cd1-dea30a4f09a8',
                '3a3f7e1a-9d17-4cf8-b8a4-fb43729ab2dc',
                '6084b642-212c-407e-9cd3-cde37fe61490',
                '7736d6ce-2d0c-4ce6-ac80-1de082f0fe32');
  IF v_partners IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'REFUSING: % of the four ids is a PARTNER row', v_partners;
  END IF;

  -- And that something survives. A file that empties the table is not this file.
  SELECT count(*) INTO v_total FROM public.home_services;
  IF v_total IS DISTINCT FROM 5 THEN
    RAISE EXCEPTION 'home_services holds % rows, expected 5 (4 test + 1 partner)', v_total;
  END IF;

  -- No DELETE trigger, read from pg_trigger rather than from the header above.
  SELECT count(*) INTO v_deltrig FROM pg_trigger
   WHERE tgrelid = 'public.home_services'::regclass AND NOT tgisinternal
     AND (tgtype & 8) <> 0;                       -- bit 3 = ROW DELETE
  IF v_deltrig IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'home_services has % DELETE trigger(s) — this file assumes none', v_deltrig;
  END IF;

  -- Orphans are COUNTED and PRINTED, not assumed. entity_id has no FK on purpose, so
  -- nothing cascades and nothing errors; the number is the only way to know.
  SELECT count(*) INTO v_orphans FROM public.contact_events
   WHERE module = 'homeServices'
     AND entity_id IN ('ecc59457-0e36-4aeb-9cd1-dea30a4f09a8',
                       '3a3f7e1a-9d17-4cf8-b8a4-fb43729ab2dc',
                       '6084b642-212c-407e-9cd3-cde37fe61490',
                       '7736d6ce-2d0c-4ce6-ac80-1de082f0fe32');

  RAISE NOTICE '── pre-flight ───────────────────────────────────────────';
  RAISE NOTICE '  ids matched: %   of which partners: %', v_match, v_partners;
  RAISE NOTICE '  table holds % row(s) before the delete', v_total;
  RAISE NOTICE '  DELETE triggers on home_services: %', v_deltrig;
  RAISE NOTICE '  contact_events rows that will be orphaned: %', v_orphans;
  IF v_orphans > 0 THEN
    RAISE NOTICE '  ^ non-zero. Nothing breaks — entity_id is polymorphic with no FK — but';
    RAISE NOTICE '    those taps can no longer be joined to a name. Decide before COMMIT.';
  END IF;
  RAISE NOTICE '──────────────────────────────────────────────────────────';
END $$;

-- ─── 3. The delete — all four, one statement ────────────────────────────────
DELETE FROM public.home_services
 WHERE id IN ('ecc59457-0e36-4aeb-9cd1-dea30a4f09a8',   -- Mehmet Usta Plumbing
              '3a3f7e1a-9d17-4cf8-b8a4-fb43729ab2dc',   -- Nicosia Electric
              '6084b642-212c-407e-9cd3-cde37fe61490',   -- Ali Carpenter & Painter
              '7736d6ce-2d0c-4ce6-ac80-1de082f0fe32');  -- Kaju Usta elektirikci

-- ─── 4. Verification ────────────────────────────────────────────────────────
DO $$
DECLARE
  v_left    int;
  v_total   int;
  v_name    text;
  v_partner boolean;
  v_anon    int;
BEGIN
  SELECT count(*) INTO v_left FROM public.home_services
   WHERE id IN ('ecc59457-0e36-4aeb-9cd1-dea30a4f09a8',
                '3a3f7e1a-9d17-4cf8-b8a4-fb43729ab2dc',
                '6084b642-212c-407e-9cd3-cde37fe61490',
                '7736d6ce-2d0c-4ce6-ac80-1de082f0fe32');
  IF v_left IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION '% of the four rows survived the delete', v_left;
  END IF;

  SELECT count(*) INTO v_total FROM public.home_services;
  IF v_total IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'home_services holds % rows after the delete, expected exactly 1', v_total;
  END IF;

  SELECT name, is_partner INTO v_name, v_partner FROM public.home_services;
  IF v_name IS DISTINCT FROM 'TadilArt Cyprus' OR v_partner IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'the surviving row is "%" (is_partner=%) — expected TadilArt Cyprus, true',
      coalesce(v_name,'<null>'), v_partner;
  END IF;

  -- What a user sees. Still zero, because the partner is is_partner but not yet active —
  -- the delete must not have changed that either way. RESET ROLE before anything else:
  -- counting as the table owner bypasses RLS and would prove nothing.
  SET LOCAL ROLE anon;
  SELECT count(*) INTO v_anon FROM public.home_services;
  RESET ROLE;
  IF v_anon IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'anon can read % row(s) — the partner should still be pending', v_anon;
  END IF;

  RAISE NOTICE '── after ─────────────────────────────────────────────────';
  RAISE NOTICE '  the four test rows: GONE';
  RAISE NOTICE '  home_services now holds % row: % (is_partner=%)', v_total, v_name, v_partner;
  RAISE NOTICE '  rows anon can read: % — the partner is still pending', v_anon;
  RAISE NOTICE '  NEXT: going live is the SQL block in constants/flags.js, not a button.';
  RAISE NOTICE '──────────────────────────────────────────────────────────';
END $$;

COMMIT;
RESET ROLE;

-- ─── REVERT ────────────────────────────────────────────────────────────────
-- There is none, and that is the honest statement. A DELETE of four rows is not
-- reversible from a migration file: re-inserting them would need their created_at, and
-- the three seed rows carried invented phone numbers that should not come back anyway.
-- If they are wanted again, supabase/home_services_migration.sql still holds the seed
-- INSERT for the first three; the fourth was a form submission and is gone for good.
--
-- The protection is therefore BEFORE the fact, not after it: section 1 prints every row
-- and section 2 refuses to proceed unless there are exactly four, none of them a
-- partner, and one row left over. If anything there surprises you, ROLLBACK instead of
-- COMMIT and the table is untouched.
