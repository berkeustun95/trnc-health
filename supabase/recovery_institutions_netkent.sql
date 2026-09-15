-- ─── RECOVERY — Netkent (…000e) is back in institutions ─────────────────────────
--
-- SQL editor, Role selector = postgres. Run the WHOLE FILE. Not applied; run only when
-- the symptom below is present.
--
-- NOT A MIGRATION, and that is why it lives here and not in supabase/migrations/. The
-- ledger tracks that directory only, and a file there that is correctly never run would
-- sit in migration_ledger_check.sql as L1 "never applied" for good — a permanent red row
-- that teaches the reader to skim. No ledger stamp, for the same reason.
--
-- ─── SYMPTOM ─────────────────────────────────────────────────────────────────
-- verify_schema.sql's 1018 token "Netkent (…000e) absent" reads MISSING, and the
-- institutions count token reads one row high. Netkent shows up in both profile pickers.
--
-- ─── CAUSE ───────────────────────────────────────────────────────────────────
-- 20261018 deleted Netkent by id. 20261001's seed still lists it and is
-- ON CONFLICT (id) DO NOTHING, so a deleted row has nothing to conflict with: re-running
-- 20261001 inserts it again — ACTIVE, sort_order 140. Nothing else that seed wrote comes
-- back: İlim stays inactive and Final keeps its new name, because those rows still exist.
--
-- WHY NOT RE-RUN 20261018: its guard refuses once the eight added rows are in 20261020's
-- state, and it is right to — its INSERT would reset their short names to slugs.
--
-- ─── WHAT THIS DOES ──────────────────────────────────────────────────────────
-- Deletes …000e by id. Nothing else.
--   • Netkent already absent → prints a notice and changes nothing. Safe to run twice.
--   • The eight reconcile ids (…000f–…0016) not all present → REFUSES. Then 20261018 never
--     ran on this database, and Netkent was never deleted — it has not "come back".
--   • ANY profile references …000e → REFUSES and prints the profile ids. The FK is
--     ON DELETE SET NULL, so the delete would clear those users' institution with no
--     error. While resurrected the row is active and pickable, so this is reachable.
--     Decide what those profiles should hold first, then run this again.
-- Deliberately asserts no 22/21 total: this file must keep working after the three held
-- universities are added. It checks what the delete itself must change instead.

SET ROLE postgres;
BEGIN;

DO $$
DECLARE
  v_present  int;
  v_reconcile int;
  v_refs     int;
  v_ids      text;
  v_total    int;
BEGIN
  SELECT count(*) INTO v_present FROM public.institutions
   WHERE id = '00000000-0000-4000-b000-00000000000e';
  SELECT count(*) INTO v_total FROM public.institutions;
  PERFORM set_config('ada.recovery_total_before', v_total::text, true);

  IF v_present = 0 THEN
    RAISE NOTICE 'Netkent (…000e) is absent — nothing to recover. Changing nothing.';
    RETURN;
  END IF;

  SELECT count(*) INTO v_reconcile FROM public.institutions
   WHERE id BETWEEN '00000000-0000-4000-b000-00000000000f' AND '00000000-0000-4000-b000-000000000016';
  IF v_reconcile IS DISTINCT FROM 8 THEN
    RAISE EXCEPTION 'REFUSING: only % of the eight reconcile ids (…000f–…0016) exist, so 20261018 has not run here and Netkent was never deleted. Nothing changed.', v_reconcile;
  END IF;

  SELECT count(*), string_agg(id::text, ', ' ORDER BY id) INTO v_refs, v_ids
    FROM public.profiles WHERE institution_id = '00000000-0000-4000-b000-00000000000e';
  IF v_refs IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'REFUSING: % profile(s) reference Netkent (…000e): %. The FK is ON DELETE SET NULL, so deleting would silently clear their institution. Decide those rows first. Nothing changed.', v_refs, v_ids;
  END IF;

  RAISE NOTICE 'Netkent (…000e) present, 0 profiles reference it, reconcile rows present — deleting. institutions holds % rows before.', v_total;
END $$;

DELETE FROM public.institutions
WHERE id = '00000000-0000-4000-b000-00000000000e';

DO $$
DECLARE
  v_before int := current_setting('ada.recovery_total_before')::int;
  v_after  int;
  v_left   int;
BEGIN
  SELECT count(*) INTO v_left FROM public.institutions
   WHERE id = '00000000-0000-4000-b000-00000000000e';
  IF v_left IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'Netkent (…000e) is still present after the delete (% row)', v_left;
  END IF;

  -- Exactly one row fewer, or none fewer when there was nothing to recover. Anything else
  -- means this transaction removed a row it had no business removing.
  SELECT count(*) INTO v_after FROM public.institutions;
  IF v_before - v_after NOT IN (0, 1) THEN
    RAISE EXCEPTION 'institutions went from % to % rows — expected at most one fewer', v_before, v_after;
  END IF;

  RAISE NOTICE 'institutions: % → % rows. Now re-run verify_schema.sql QUERY 1; the 1018 tokens should read OK.', v_before, v_after;
END $$;

COMMIT;
RESET ROLE;
