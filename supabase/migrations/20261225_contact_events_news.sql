-- ─── contact_events: module 'news' (Veles Bit Postası Home banner) ──────────
--
-- ONE CHECK CONSTRAINT. contact_events_module_check gains 'news'. No new table, column, grant,
-- policy or function.
--
-- WHY: the Home banner for the Veles Bit Postası news feed counts taps (action = 'website', lang =
-- the app language as a full English name, e.g. 'Turkish'). logContactEvent is fire-and-forget, so a
-- row this CHECK rejects is swallowed silently: taps would read zero. Apply this BEFORE the banner ships.
--
-- WHO CAN READ / WRITE WHAT (unchanged; stated so the review does not have to hunt for it):
--   - INSERT: anon and authenticated (guests included) may insert only the granted columns
--     (id, module, entity_id, action, region, item_id, lang) through ce_insert_public (WITH CHECK true).
--     created_at is not client-writable.
--   - SELECT: admins only, through ce_select_admin. anon cannot read this table at all.
--   - UPDATE / DELETE: nobody on the client; ce_no_update and ce_no_delete are RESTRICTIVE (false).
--   - The probe rows below are written as anon and removed as the table owner (postgres bypasses RLS).
--
-- SOURCE OF THE LIST: the latest definition in the repo is 20261165_vehicles.sql (17 modules). The live
-- pg_get_constraintdef is the authority and this file is intent. So the file first reads the live
-- definition and REFUSES if it holds any module outside this file's list (a value added live but not
-- in the repo would otherwise be silently dropped by the rebuild), or lacks one of the 17 it re-adds.
-- Re-runnable: after an apply the live list is the 18 and the same checks pass.
--
-- The list is static on purpose: scripts/audit-schema-drift.mjs reads CHECK literals from this file.

SET ROLE postgres;

BEGIN;

-- ─── 1. Pre-state: the live list must be exactly the 17 (or the 17 plus news) ──
DO $$
DECLARE
  v_def   text;
  v_live  text[];
  v_want  text[] := ARRAY['accommodation','events','explore','garages','grooming','homeServices','hotels',
                          'insurance','jobs','pets','studentHub','towing','transport','ehliyet','connectivity','eatery','cars'];
  v_extra text[];
  v_miss  text[];
BEGIN
  SELECT pg_get_constraintdef(oid) INTO v_def FROM pg_constraint
   WHERE conrelid = to_regclass('public.contact_events') AND conname = 'contact_events_module_check';
  IF v_def IS NULL THEN
    RAISE EXCEPTION 'contact_events_module_check does not exist';
  END IF;
  RAISE NOTICE 'contact_events_module_check before: %', v_def;

  SELECT coalesce(array_agg(DISTINCT m[1]), ARRAY[]::text[]) INTO v_live
    FROM regexp_matches(v_def, '''([^'']+)''::text', 'g') AS m;

  SELECT coalesce(array_agg(x ORDER BY x), ARRAY[]::text[]) INTO v_extra
    FROM unnest(v_live) x WHERE x <> 'news' AND x <> ALL (v_want);
  IF cardinality(v_extra) > 0 THEN
    RAISE EXCEPTION 'REFUSING: the live CHECK has modules this file would drop: %. Rebuild from the live definition. def=%', v_extra, v_def;
  END IF;

  SELECT coalesce(array_agg(x ORDER BY x), ARRAY[]::text[]) INTO v_miss
    FROM unnest(v_want) x WHERE x <> ALL (v_live);
  IF cardinality(v_miss) > 0 THEN
    RAISE EXCEPTION 'REFUSING: the live CHECK lacks modules this file re-adds: %. def=%', v_miss, v_def;
  END IF;
END $$;

-- ─── 2. The change ──────────────────────────────────────────────────────────
ALTER TABLE public.contact_events DROP CONSTRAINT contact_events_module_check;
ALTER TABLE public.contact_events ADD CONSTRAINT contact_events_module_check
  CHECK (module IN ('accommodation','events','explore','garages','grooming','homeServices','hotels',
                    'insurance','jobs','pets','studentHub','towing','transport','ehliyet','connectivity','eatery','cars','news'));

-- ─── 3. Post-state, read from the catalog ───────────────────────────────────
DO $$
DECLARE
  v_def  text;
  v_live text[];
BEGIN
  SELECT pg_get_constraintdef(oid) INTO v_def FROM pg_constraint
   WHERE conrelid = to_regclass('public.contact_events') AND conname = 'contact_events_module_check';
  SELECT coalesce(array_agg(DISTINCT m[1]), ARRAY[]::text[]) INTO v_live
    FROM regexp_matches(coalesce(v_def, ''), '''([^'']+)''::text', 'g') AS m;
  IF cardinality(v_live) IS DISTINCT FROM 18 OR position('''news''' in coalesce(v_def, '')) = 0 THEN
    RAISE EXCEPTION 'contact_events_module_check post-state is not the 17 + news. def=%', v_def;
  END IF;
  RAISE NOTICE 'contact_events_module_check after: %', v_def;
END $$;

-- ─── 4. Behaviour: positive and negative control, as anon ───────────────────
-- Only the probe's own uuid is used (as id and entity_id). Rows are verified and deleted as the owner,
-- because anon cannot SELECT this table.
DO $$
DECLARE
  v_probe uuid := '00000000-0000-4000-8000-0000000071e5';
  v_role  text;
  v_bogus text := 'unset';
  v_n     int;
BEGIN
  IF EXISTS (SELECT 1 FROM public.contact_events WHERE id = v_probe OR entity_id = v_probe) THEN
    RAISE EXCEPTION 'a probe row already exists before the test';
  END IF;

  SET LOCAL ROLE anon;
  v_role := current_user;
  INSERT INTO public.contact_events (id, module, entity_id, action, region, lang)
  VALUES (v_probe, 'news', v_probe, 'website', NULL, 'Turkish');
  -- negative control: the CHECK still rejects an unknown module
  BEGIN
    INSERT INTO public.contact_events (module, entity_id, action, region)
    VALUES ('not_a_real_module', v_probe, 'website', NULL);
    v_bogus := 'ACCEPTED';
  EXCEPTION WHEN check_violation THEN v_bogus := 'rejected';
  END;
  RESET ROLE;

  IF v_role IS DISTINCT FROM 'anon' THEN RAISE EXCEPTION 'probe did not run as anon (ran as %)', v_role; END IF;
  IF v_bogus IS DISTINCT FROM 'rejected' THEN RAISE EXCEPTION 'CONTROL FAILED: a bogus module was %', v_bogus; END IF;

  SELECT count(*) INTO v_n FROM public.contact_events
   WHERE id = v_probe AND module = 'news' AND action = 'website' AND lang = 'Turkish';
  IF v_n IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'the news probe row was not stored exactly once (found %)', v_n; END IF;
  RAISE NOTICE 'anon can insert a news/website tap; a bogus module is rejected';

  DELETE FROM public.contact_events WHERE id = v_probe OR entity_id = v_probe;
  IF EXISTS (SELECT 1 FROM public.contact_events WHERE id = v_probe OR entity_id = v_probe) THEN
    RAISE EXCEPTION 'probe rows survived the cleanup';
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
VALUES ('20261225_contact_events_news.sql', '6bef39657e3f067967abfd657cb2919f1da9d52129043b1e84071bdc311a2b6a')
ON CONFLICT (filename) DO UPDATE
  SET checksum = excluded.checksum, applied_at = now(), applied_by = current_user;
-- ─── ledger:stamp:end ────────────────────────────────────────────────
COMMIT;
RESET ROLE;

-- ─── REVERT ────────────────────────────────────────────────────────────────
-- Safe only while no 'news' rows exist (the ADD would fail against them, which is the right outcome).
--   Drop and re-add contact_events_module_check with the 17-module list from 20261165_vehicles.sql, then
--   delete this file's schema_migrations_applied row. Reverting makes the banner stop counting silently.
