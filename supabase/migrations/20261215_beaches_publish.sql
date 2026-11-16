-- ═══════════════════════════════════════════════════════════
-- 20261215 — beaches go-live, step 1: publish the 30 staged beaches (status 'staged' -> 'active', data only, 30 rows)
-- ═══════════════════════════════════════════════════════════
--
-- The 30 beaches of data/explore/beaches.json (28 osm + 2 visitncy_beaches, inserted staged by 20261207, el names by 20261214) become
-- status 'active': after this file the whole Explore beach list is visible to everybody. The ONLY column that changes is status.
-- The 4 live beaches (source NULL) are not touched here; their missing locales are 20261216.
-- Berke approved writing and dry-running this file 2026-11-16; it is applied later, together with 20261216, in ONE supabase-migrate run.
--
-- Safety:
--   • The 30 (source, source_id) pairs are an embedded literal, asserted to hold 30 entries. Before any write every pair must resolve to
--     exactly one places row with category 'beach' AND status 'staged', else RAISE (counts only, never a name or an id).
--   • UPDATE only WHERE category = 'beach' AND status = 'staged' AND the pair is one of the 30. GET DIAGNOSTICS must report exactly 30.
--   • The 30 rows are compared with to_jsonb(p) - 'status' before and after: no other column may differ. Every row outside the 30 (staged
--     shops, the 4 live beaches, submissions, everything) is hashed (md5 of the whole row) before and after and must be identical.
--   • The count of status 'staged' rows that are NOT beaches (the staged shops) is read before and after and must be equal. It is compared,
--     not hardcoded: a remembered number is content, not a user total, but it would rot with the next staging; equality is what matters.
--   • Before the first UPDATE the enabled UPDATE triggers on places are read and the file RAISES unless they are exactly the 5 BEFORE ROW
--     ones of 20261206 (an AFTER trigger with side effects elsewhere would otherwise run unnoticed). They run as in 20261214 (role postgres,
--     auth.uid() NULL: they return NEW).
--   • Afterwards all 30 rows are active and no beach is staged any more.
-- One-shot: a re-run after a successful apply raises (the pre-check finds no staged targets).
--
-- Apply: gh workflow run supabase-migrate -f files="20261215_beaches_publish.sql 20261216_beaches_live4_locales.sql" (dry), then -f apply=true
-- after Berke approves production-db. Data only: no schema change, nothing to register in verify_schema.sql.

SET ROLE postgres;

BEGIN;

SET LOCAL lock_timeout = '5s';

DO $$
DECLARE
  -- [source, source_id]
  v_rows jsonb := '[["visitncy_beaches","kervansaray-beach"],["visitncy_beaches","long-beach"],["osm","way/225386412"],["osm","way/608212204"],["osm","way/225382750"],["osm","way/1484271058"],["osm","way/286275732"],["osm","way/603986283"],["osm","way/208150337"],["osm","way/286276160"],["osm","way/208111924"],["osm","way/229043037"],["osm","way/225383964"],["osm","way/244561269"],["osm","node/11994931556"],["osm","way/208241783"],["osm","way/666114116"],["osm","node/11231014679"],["osm","way/435771323"],["osm","relation/15456405"],["osm","way/606238631"],["osm","way/1365670207"],["osm","way/309623318"],["osm","way/1395325670"],["osm","way/952236170"],["osm","relation/13040159"],["osm","node/1951274050"],["osm","way/510986434"],["osm","way/435772839"],["osm","way/603896219"]]'::jsonb;
  c_expected constant int := 30;
  v_others_before text;
  v_others_after  text;
  v_keys_before jsonb;
  v_keys_after  jsonb;
  v_nb_before int;
  v_nb_after  int;
  v_n int;
  v_bad int;
  v_trg text;
  v_ntrg int;
  v_nbad int;
BEGIN
  IF jsonb_array_length(v_rows) <> c_expected THEN
    RAISE EXCEPTION 'file lists % pairs, expected %', jsonb_array_length(v_rows), c_expected;
  END IF;
  IF (SELECT count(DISTINCT e->>0 || '|' || (e->>1)) FROM jsonb_array_elements(v_rows) e) <> c_expected THEN
    RAISE EXCEPTION 'the % pairs of this file are not all distinct', c_expected;
  END IF;

  -- 5 = places_guard_update, places_guard_source, places_guard_official_visit, guard_place_moderation, check_place_content (as 20261206 / 20261214).
  SELECT count(*),
         string_agg(t.tgname || CASE WHEN (t.tgtype & 3) = 3 THEN ' (before row)' ELSE ' (NOT before row)' END, ', ' ORDER BY t.tgname),
         count(*) FILTER (WHERE (t.tgtype & 3) <> 3)
    INTO v_ntrg, v_trg, v_nbad
    FROM pg_trigger t
   WHERE t.tgrelid = 'public.places'::regclass AND NOT t.tgisinternal AND t.tgenabled <> 'D'
     AND (t.tgtype & 16) = 16;
  IF v_nbad <> 0 OR v_ntrg <> 5 THEN
    RAISE EXCEPTION 'places has % enabled UPDATE triggers (% not before-row), expected exactly 5 before-row ones: %',
      v_ntrg, v_nbad, coalesce(v_trg, '(none)');
  END IF;

  -- pre-check: every pair is exactly one places row, a staged beach
  SELECT count(*) INTO v_bad
    FROM jsonb_array_elements(v_rows) AS e(v)
   WHERE (SELECT count(*) FROM public.places p
           WHERE p.source IS NOT DISTINCT FROM e.v->>0 AND p.source_id IS NOT DISTINCT FROM e.v->>1) <> 1
      OR (SELECT count(*) FROM public.places p
           WHERE p.source IS NOT DISTINCT FROM e.v->>0 AND p.source_id IS NOT DISTINCT FROM e.v->>1
             AND p.category IS NOT DISTINCT FROM 'beach' AND p.status IS NOT DISTINCT FROM 'staged') <> 1;
  IF v_bad <> 0 THEN
    RAISE EXCEPTION '% of the % target pairs are missing, duplicated, or not a staged beach', v_bad, c_expected;
  END IF;

  SELECT count(*) INTO v_nb_before FROM public.places WHERE status IS NOT DISTINCT FROM 'staged' AND category IS DISTINCT FROM 'beach';

  SELECT md5(coalesce(string_agg(to_jsonb(p)::text, '|' ORDER BY p.id), '')) INTO v_others_before
    FROM public.places p
   WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_rows) e WHERE e->>0 IS NOT DISTINCT FROM p.source AND e->>1 IS NOT DISTINCT FROM p.source_id);

  SELECT jsonb_object_agg(p.id::text, to_jsonb(p) - 'status') INTO v_keys_before
    FROM public.places p
   WHERE EXISTS (SELECT 1 FROM jsonb_array_elements(v_rows) e WHERE e->>0 IS NOT DISTINCT FROM p.source AND e->>1 IS NOT DISTINCT FROM p.source_id);

  UPDATE public.places p
     SET status = 'active'
    FROM jsonb_array_elements(v_rows) AS e(v)
   WHERE p.category = 'beach' AND p.status = 'staged'
     AND p.source IS NOT DISTINCT FROM e.v->>0 AND p.source_id IS NOT DISTINCT FROM e.v->>1;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> c_expected THEN
    RAISE EXCEPTION 'expected to publish exactly % staged beach rows, updated %', c_expected, v_n;
  END IF;

  SELECT md5(coalesce(string_agg(to_jsonb(p)::text, '|' ORDER BY p.id), '')) INTO v_others_after
    FROM public.places p
   WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_rows) e WHERE e->>0 IS NOT DISTINCT FROM p.source AND e->>1 IS NOT DISTINCT FROM p.source_id);
  IF v_others_after IS DISTINCT FROM v_others_before THEN
    RAISE EXCEPTION 'a places row outside the 30 changed; aborting';
  END IF;

  SELECT jsonb_object_agg(p.id::text, to_jsonb(p) - 'status') INTO v_keys_after
    FROM public.places p
   WHERE EXISTS (SELECT 1 FROM jsonb_array_elements(v_rows) e WHERE e->>0 IS NOT DISTINCT FROM p.source AND e->>1 IS NOT DISTINCT FROM p.source_id);
  IF v_keys_after IS DISTINCT FROM v_keys_before THEN
    RAISE EXCEPTION 'a column other than status changed on one of the 30 rows; aborting';
  END IF;

  SELECT count(*) INTO v_nb_after FROM public.places WHERE status IS NOT DISTINCT FROM 'staged' AND category IS DISTINCT FROM 'beach';
  IF v_nb_after IS DISTINCT FROM v_nb_before THEN
    RAISE EXCEPTION 'the count of staged non-beach rows changed (% -> %); aborting', v_nb_before, v_nb_after;
  END IF;

  SELECT count(*) INTO v_bad
    FROM jsonb_array_elements(v_rows) AS e(v)
    LEFT JOIN public.places p ON p.category = 'beach' AND p.status = 'active'
         AND p.source IS NOT DISTINCT FROM e.v->>0 AND p.source_id IS NOT DISTINCT FROM e.v->>1
   WHERE p.id IS NULL;
  IF v_bad <> 0 THEN
    RAISE EXCEPTION '% of the 30 rows are not active after the update', v_bad;
  END IF;

  SELECT count(*) INTO v_bad FROM public.places WHERE category IS NOT DISTINCT FROM 'beach' AND status IS NOT DISTINCT FROM 'staged';
  IF v_bad <> 0 THEN
    RAISE EXCEPTION '% beaches are still staged after the update', v_bad;
  END IF;

  RAISE NOTICE '20261215 OK: % staged beaches published, all other rows byte-identical, only status changed, staged non-beach rows unchanged (%)', v_n, v_nb_after;
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
VALUES ('20261215_beaches_publish.sql', '2231bd13f97c4b03d54f5ad0b73d08ba1311b691635af59de7db910bb52bb815')
ON CONFLICT (filename) DO UPDATE
  SET checksum = excluded.checksum, applied_at = now(), applied_by = current_user;
-- ─── ledger:stamp:end ────────────────────────────────────────────────
COMMIT;

RESET ROLE;
