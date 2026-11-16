-- ═══════════════════════════════════════════════════════════
-- 20261214 — staged beaches: Greek (el) names become the official Turkish names (data only, 30 rows + 2 descriptions)
-- ═══════════════════════════════════════════════════════════
--
-- Berke, 2026-11-16: in the Greek locale beaches carry the official Turkish name in Latin letters, exactly as in tr
-- (e.g. "Lapta Belediye Plajı"), like the other languages: no traditional Greek village names, no Greek-script transliteration.
-- 20261207 inserted the 30 staged beaches with Greek names; this file replaces name_i18n->'el' of those rows and description_i18n->'el' of the 2 Ministry rows, nothing else.
-- 23 of the 30 change; 7 already equal their tr name (Long Beach, Chamada Beach Club, Lido Cyprus, Shayna, Suna's ..., Club Di Mare,
-- Honey Beach - Balcı Plaza) and are matched and re-set to the same value so the count is a clean 30.
-- The same file also rewrites description_i18n->'el' of the 2 Ministry rows (kervansaray-beach, long-beach): the Greek place names inside
-- (Κερύνειας, Κερβανσαράι, Σαλαμίνας, Αμμοχώστου) become Girne, Kervansaray, Salamis, Gazimağusa, keeping the Greek grammar. Same compare-and-set
-- (current el description = the expected old text), exactly 2 rows, the other 8 description languages untouched.
-- Data source: data/explore/beaches-translations.json (name_i18n.el), checked by scripts/beaches-list.mjs.
-- The 4 LIVE beaches are not touched here (their extra locales are a separate, not-yet-applied file).
--
-- Safety:
--   • UPDATE only WHERE category = 'beach' AND status = 'staged' AND (source, source_id) is one of the 30 AND the current el value
--     equals the expected OLD value (compare-and-set). Active rows, non-beach rows and the 399 staged shops are outside the WHERE.
--   • GET DIAGNOSTICS must report exactly 30 rows, else RAISE and roll back. So if a beach was already published, or someone
--     edited an el name since 20261207, the whole file aborts (and names the count only, never a value).
--   • Every row outside the 30 is hashed (md5 of the whole row) before and after and must be identical; the 30 rows must
--     differ in no key but name_i18n / description_i18n, name_i18n minus its 'el' key must be unchanged, description_i18n minus 'el' likewise; afterwards all 30 carry el = the expected new value.
--   • name_i18n is rewritten with jsonb_set on the 'el' key only (the other 8 languages stay as they are).
--   • Before the first UPDATE the enabled UPDATE triggers on places are read and the file RAISES unless they are exactly the 5 BEFORE ROW
--     ones of 20261206 (an AFTER trigger with side effects elsewhere would otherwise run unnoticed). They run as in 20261206 (role postgres, auth.uid() NULL: they return NEW);
--     check_place_content re-scans the new text with the word filter and would abort the whole file on a hit.
-- Re-running after a successful apply raises (the old values are gone): this is a one-shot.
--
-- Apply: gh workflow run supabase-migrate -f file=20261214_beaches_el_turkish_names.sql (dry), then -f apply=true after
-- Berke approves production-db. Data only: no schema change, nothing to register in verify_schema.sql.

SET ROLE postgres;

BEGIN;

SET LOCAL lock_timeout = '5s';

DO $$
DECLARE
  -- [source, source_id, expected OLD el, NEW el]
  v_rows jsonb := '[["visitncy_beaches","kervansaray-beach","Παραλία Κερβανσαράι","Kervansaray Plajı"],["visitncy_beaches","long-beach","Long Beach","Long Beach"],["osm","way/225386412","Παραλία Bamboo","Bamboo Beach"],["osm","way/608212204","Παραλία Bella Marin","Bella Marin Beach"],["osm","way/225382750","Παραλία Camelot","Camelot Beach"],["osm","way/1484271058","Chamada Beach Club","Chamada Beach Club"],["osm","way/286275732","Παραλία Diana","Diana Beach"],["osm","way/603986283","Δημοτική παραλία Τράπεζα","Esentepe Belediye Halk Plajı"],["osm","way/208150337","Παραλία Αγίου Γεωργίου","Karaoğlanoğlu Plajı"],["osm","way/286276160","Παραλία Korenium","Korenium Beach"],["osm","way/208111924","Δημοτική παραλία Λάπηθος","Lapta Belediye Plajı"],["osm","way/229043037","Lido Cyprus","Lido Cyprus"],["osm","way/225383964","Δημοτική παραλία Καραβάς","Alsancak Belediye Plajı"],["osm","way/244561269","Παραλία Riviera","Riviera Beach"],["osm","node/11994931556","Παραλία Sandouka","Sandouka Beach"],["osm","way/208241783","Παραλία Sardunya","Sardunya Beach"],["osm","way/666114116","Shayna","Shayna"],["osm","node/11231014679","Suna''s Beach and Restaurant","Suna''s Beach and Restaurant"],["osm","way/435771323","Παραλία Kocareis","Kocareis Beach"],["osm","relation/15456405","Παραλία Μακένζι","Makenzi Plajı"],["osm","way/606238631","Παραλία Silver","Silver Beach"],["osm","way/1365670207","Δημόσια παραλία Αγίου Σεργίου","Yeni Boğaziçi Halk Plajı"],["osm","way/309623318","Παραλία Δαυλός","Kaplıca Plajı"],["osm","way/1395325670","Δημοτική παραλία Λεύκα","Lefke Belediyesi Halk Plajı"],["osm","way/952236170","Παραλία Αγίου Φίλωνα","Ayfilon Plajı"],["osm","relation/13040159","Club Di Mare","Club Di Mare"],["osm","node/1951274050","Honey Beach - Balcı Plaza","Honey Beach - Balcı Plaza"],["osm","way/510986434","Παραλία Ισσίζ","Issız Plaj"],["osm","way/435772839","Παραλία Βοκολίδα","Mehmetçik Belediye Bafra Plajı"],["osm","way/603896219","Δημόσια παραλία Γιούντι","Yudi Halk Plajı"]]'::jsonb;
  -- [source, source_id, expected OLD el description, NEW el description] (Ministry rows only)
  v_desc jsonb := '[["visitncy_beaches","kervansaray-beach","Λειτουργεί από τον Δήμο Κερύνειας και είναι ένας δημοφιλής χώρος αναψυχής ανοιχτός στο κοινό, στην περιοχή Κερβανσαράι. Διαθέτει ξαπλώστρες και ομπρέλες, αποδυτήρια και ντους, εστιατόρια, χώρο στάθμευσης για άτομα με αναπηρία με εύκολη πρόσβαση στην παραλία και ζώνη κολύμβησης οριοθετημένη με σημαδούρες. Υπάρχει πύργος ναυαγοσωστών με πρώτες βοήθειες.","Λειτουργεί από τον Δήμο Girne και είναι ένας δημοφιλής χώρος αναψυχής ανοιχτός στο κοινό, στην περιοχή Kervansaray. Διαθέτει ξαπλώστρες και ομπρέλες, αποδυτήρια και ντους, εστιατόρια, χώρο στάθμευσης για άτομα με αναπηρία με εύκολη πρόσβαση στην παραλία και ζώνη κολύμβησης οριοθετημένη με σημαδούρες. Υπάρχει πύργος ναυαγοσωστών με πρώτες βοήθειες."],["visitncy_beaches","long-beach","Αυτή η αμμώδης παραλία βρίσκεται στον κόλπο της Σαλαμίνας, 15 χλμ. βόρεια της Αμμοχώστου και κοντά στα ερείπια της Σαλαμίνας, και προσφέρει μια σειρά από παροχές. Λειτουργεί υπηρεσία μεταφοράς από την πόλη προς την παραλία.","Αυτή η αμμώδης παραλία βρίσκεται στον κόλπο της Salamis, 15 χλμ. βόρεια της Gazimağusa και κοντά στα ερείπια της Salamis, και προσφέρει μια σειρά από παροχές. Λειτουργεί υπηρεσία μεταφοράς από την πόλη προς την παραλία."]]'::jsonb;
  c_expected constant int := 30;
  c_expected_desc constant int := 2;
  v_desc_before jsonb;
  v_desc_after jsonb;
  v_nd int;
  v_others_before text;
  v_others_after  text;
  v_keys_before jsonb;
  v_keys_after  jsonb;
  v_n int;
  v_bad int;
  v_diff text;
  v_trg text;
  v_ntrg int;
  v_nbad int;
  v_nm_before jsonb;
  v_nm_after jsonb;
BEGIN
  IF jsonb_array_length(v_rows) <> c_expected THEN
    RAISE EXCEPTION 'file lists % rows, expected %', jsonb_array_length(v_rows), c_expected;
  END IF;

  -- 5 = places_guard_update, places_guard_source, places_guard_official_visit, guard_place_moderation, check_place_content (as 20261206).
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

  v_nm_before := (SELECT jsonb_object_agg(p.id::text, p.name_i18n - 'el') FROM public.places p
   WHERE p.category IS NOT DISTINCT FROM 'beach' AND p.status IS NOT DISTINCT FROM 'staged' AND EXISTS (
           SELECT 1 FROM jsonb_array_elements(v_rows) e WHERE e->>0 IS NOT DISTINCT FROM p.source AND e->>1 IS NOT DISTINCT FROM p.source_id));

  SELECT md5(coalesce(string_agg(to_jsonb(p)::text, '|' ORDER BY p.id), '')) INTO v_others_before
    FROM public.places p
   WHERE NOT (p.category IS NOT DISTINCT FROM 'beach' AND p.status IS NOT DISTINCT FROM 'staged' AND EXISTS (
           SELECT 1 FROM jsonb_array_elements(v_rows) e WHERE e->>0 IS NOT DISTINCT FROM p.source AND e->>1 IS NOT DISTINCT FROM p.source_id));

  SELECT jsonb_object_agg(p.id::text, to_jsonb(p) - 'name_i18n' - 'description_i18n') INTO v_keys_before
    FROM public.places p
   WHERE p.category IS NOT DISTINCT FROM 'beach' AND p.status IS NOT DISTINCT FROM 'staged' AND EXISTS (
           SELECT 1 FROM jsonb_array_elements(v_rows) e WHERE e->>0 IS NOT DISTINCT FROM p.source AND e->>1 IS NOT DISTINCT FROM p.source_id);

  v_desc_before := (SELECT jsonb_object_agg(p.id::text, p.description_i18n - 'el') FROM public.places p
   WHERE p.category IS NOT DISTINCT FROM 'beach' AND p.status IS NOT DISTINCT FROM 'staged' AND EXISTS (
           SELECT 1 FROM jsonb_array_elements(v_rows) e WHERE e->>0 IS NOT DISTINCT FROM p.source AND e->>1 IS NOT DISTINCT FROM p.source_id));

  UPDATE public.places p
     SET name_i18n = jsonb_set(p.name_i18n, '{el}', to_jsonb(e.v->>3), false)
    FROM jsonb_array_elements(v_rows) AS e(v)
   WHERE p.category = 'beach' AND p.status = 'staged'
     AND p.source IS NOT DISTINCT FROM e.v->>0 AND p.source_id IS NOT DISTINCT FROM e.v->>1
     AND p.name_i18n->>'el' IS NOT DISTINCT FROM e.v->>2;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> c_expected THEN
    RAISE EXCEPTION 'expected to update exactly % staged beach rows, updated %', c_expected, v_n;
  END IF;

  UPDATE public.places p
     SET description_i18n = jsonb_set(p.description_i18n, '{el}', to_jsonb(e.v->>3), false)
    FROM jsonb_array_elements(v_desc) AS e(v)
   WHERE p.category = 'beach' AND p.status = 'staged'
     AND p.source IS NOT DISTINCT FROM e.v->>0 AND p.source_id IS NOT DISTINCT FROM e.v->>1
     AND p.description_i18n->>'el' IS NOT DISTINCT FROM e.v->>2;
  GET DIAGNOSTICS v_nd = ROW_COUNT;
  IF v_nd <> c_expected_desc THEN
    RAISE EXCEPTION 'expected to update exactly % el descriptions, updated %', c_expected_desc, v_nd;
  END IF;
  v_desc_after := (SELECT jsonb_object_agg(p.id::text, p.description_i18n - 'el') FROM public.places p
   WHERE p.category IS NOT DISTINCT FROM 'beach' AND p.status IS NOT DISTINCT FROM 'staged' AND EXISTS (
           SELECT 1 FROM jsonb_array_elements(v_rows) e WHERE e->>0 IS NOT DISTINCT FROM p.source AND e->>1 IS NOT DISTINCT FROM p.source_id));
  IF v_desc_after IS DISTINCT FROM v_desc_before THEN
    RAISE EXCEPTION 'a description language other than el changed; aborting';
  END IF;

  v_nm_after := (SELECT jsonb_object_agg(p.id::text, p.name_i18n - 'el') FROM public.places p
   WHERE p.category IS NOT DISTINCT FROM 'beach' AND p.status IS NOT DISTINCT FROM 'staged' AND EXISTS (
           SELECT 1 FROM jsonb_array_elements(v_rows) e WHERE e->>0 IS NOT DISTINCT FROM p.source AND e->>1 IS NOT DISTINCT FROM p.source_id));
  IF v_nm_after IS DISTINCT FROM v_nm_before THEN
    RAISE EXCEPTION 'a name_i18n language other than el changed on one of the 30 rows; aborting';
  END IF;

  SELECT md5(coalesce(string_agg(to_jsonb(p)::text, '|' ORDER BY p.id), '')) INTO v_others_after
    FROM public.places p
   WHERE NOT (p.category IS NOT DISTINCT FROM 'beach' AND p.status IS NOT DISTINCT FROM 'staged' AND EXISTS (
           SELECT 1 FROM jsonb_array_elements(v_rows) e WHERE e->>0 IS NOT DISTINCT FROM p.source AND e->>1 IS NOT DISTINCT FROM p.source_id));
  IF v_others_after IS DISTINCT FROM v_others_before THEN
    RAISE EXCEPTION 'a places row outside the 30 changed; aborting';
  END IF;

  SELECT jsonb_object_agg(p.id::text, to_jsonb(p) - 'name_i18n' - 'description_i18n') INTO v_keys_after
    FROM public.places p
   WHERE p.category IS NOT DISTINCT FROM 'beach' AND p.status IS NOT DISTINCT FROM 'staged' AND EXISTS (
           SELECT 1 FROM jsonb_array_elements(v_rows) e WHERE e->>0 IS NOT DISTINCT FROM p.source AND e->>1 IS NOT DISTINCT FROM p.source_id);
  IF v_keys_after IS DISTINCT FROM v_keys_before THEN
    RAISE EXCEPTION 'a column other than name_i18n / description_i18n changed on one of the 30 rows; aborting';
  END IF;

  SELECT count(*) INTO v_bad
    FROM jsonb_array_elements(v_rows) AS e(v)
    LEFT JOIN public.places p ON p.category = 'beach' AND p.status = 'staged'
         AND p.source IS NOT DISTINCT FROM e.v->>0 AND p.source_id IS NOT DISTINCT FROM e.v->>1
   WHERE p.id IS NULL OR p.name_i18n->>'el' IS DISTINCT FROM e.v->>3 OR p.name_i18n->>'el' IS DISTINCT FROM p.name_i18n->>'tr';
  IF v_bad <> 0 THEN
    RAISE EXCEPTION '% of the 30 rows do not carry el = the expected Turkish name after the update', v_bad;
  END IF;

  SELECT count(*) INTO v_bad FROM jsonb_array_elements(v_desc) AS e(v)
    LEFT JOIN public.places p ON p.category = 'beach' AND p.status = 'staged'
         AND p.source IS NOT DISTINCT FROM e.v->>0 AND p.source_id IS NOT DISTINCT FROM e.v->>1
   WHERE p.id IS NULL OR p.description_i18n->>'el' IS DISTINCT FROM e.v->>3;
  IF v_bad <> 0 THEN
    RAISE EXCEPTION '% of the 2 Ministry rows do not carry the expected el description after the update', v_bad;
  END IF;

  RAISE NOTICE '20261214 OK: % staged beach rows updated, all other rows byte-identical, only name_i18n (30) and el descriptions (%) changed', v_n, v_nd;
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
VALUES ('20261214_beaches_el_turkish_names.sql', '4a1e71430edbac9fadeb372243d49c33a672cd10a6d42695be3ff1c4e27ba181')
ON CONFLICT (filename) DO UPDATE
  SET checksum = excluded.checksum, applied_at = now(), applied_by = current_user;
-- ─── ledger:stamp:end ────────────────────────────────────────────────
COMMIT;

RESET ROLE;
