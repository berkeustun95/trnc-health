-- ═══════════════════════════════════════════════════════════════════════════
-- 20261206 — move the Alagadi Turtle Beach pin onto the beach (places, ONE row, TWO columns)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- WHAT: public.places row 'Alagadi Turtle Beach' (category beach, id fa39492b-57e6-4ebd-b22c-89a9cf20ffe2)
-- has its latitude / longitude changed. Nothing else: no other column, no other row, no policy,
-- no DDL, no trigger, no function.
--
--   BEFORE  latitude 35.3302    longitude 33.4972
--   AFTER   latitude 35.332504  longitude 33.48512
--
-- WHY: the live pin sits 952 m from the nearest edge of the main mapped beach (OSM natural=beach
-- way 226555170 "Alagadi 2") and 572 m from the nearest of the three mapped Alagadi polygons;
-- geotagged photos of the beach lie ~0.9 km west of the pin. The new point is 1125 m from the old.
--
-- SOURCE of the new point: the polygon centroid of OpenStreetMap way 226555170 ("Alagadi 2",
-- name:en "Alagadi Turtle Beach 2", natural=beach, surface=sand), the largest of the three mapped
-- Alagadi beach polygons (64 296 m2, against way 487959702 "Alagadi Beach 1" 49 991 m2 and way
-- 226555171 "Alagadi Beach 3" 32 988 m2). The centroid lies INSIDE the polygon, 31.5 m from its
-- nearest edge, inside the TRNC frame, and resolveRegion() still answers 'kyrenia'.
-- Geometry read from the main Overpass server, base timestamp 2026-11-15T18:55Z.
-- © OpenStreetMap contributors, ODbL (https://www.openstreetmap.org/copyright).
--
-- Not touched on purpose: the legacy table public.beaches carries the same id with the old
-- coordinates (Berke: ONLY the places row). search_content reads places since 20261047.
--
-- ─── HOW THE ONE-ROW, TWO-COLUMN SCOPE IS A CHECKED FACT ────────────────────
--   • The UPDATE runs INSIDE the DO block, keyed by the primary key AND the exact old values
--     (compare-and-set), and GET DIAGNOSTICS must report 0 or 1 rows.
--   • The row is captured as jsonb before and after; with latitude and longitude removed the two
--     documents must be EQUAL: this row's OTHER COLUMNS are checked by jsonb equality. If anything
--     else changed, the apply aborts and names the KEYS that differ (never the values: a places
--     row can carry submitted_by / provider_id and this file's output is public).
--   • Side effects ELSEWHERE (other rows, other tables) are invisible to that comparison, so they
--     are excluded another way: BEFORE the UPDATE the DO block reads the enabled, non-internal
--     triggers on public.places that fire on UPDATE and RAISEs unless ALL of them are BEFORE ROW
--     triggers AND there are exactly 5 (the five listed below). An AFTER trigger, or a sixth
--     trigger of any kind, aborts the apply and the message carries the count and the trigger
--     names (schema names, not data).
--   • updated_at is NOT set here: "only latitude/longitude" is literal. No places updated_at
--     trigger is defined in supabase/migrations/; the jsonb check would catch one.
--   • First run moves the pin; a re-run finds the new values and does nothing; a row someone has
--     since moved to a THIRD value aborts the whole file and prints what it found.
--   • No ACCESS EXCLUSIVE lock (that was 20261045's DDL); the UPDATE takes ROW EXCLUSIVE, which
--     blocks no reader. lock_timeout 5 s turns any wait into a clean abort (55P03): run it again.
--
-- Triggers that fire on a places UPDATE and what each does here (role postgres, auth.uid() NULL).
-- The 5 is derived from supabase/migrations/: places triggers are created in 20260824 (guard_place_moderation,
-- check_place_content), 20260825 (places_guard_insert = INSERT only, so it does not count; and
-- places_guard_update), 20261045 (places_guard_source) and 20261155 (places_guard_official_visit);
-- supabase/verify_schema.sql lists the same functions in its D-section (trigger-function checks).
--   places_guard_update          BEFORE UPDATE  body per 20260829_place_resubmit.sql: reads the GUCs
--                                app.trusted_place_write and app.trusted_place_resubmit first (both
--                                unset here, so neither escape branch runs), then returns NEW at
--                                once when auth.uid() IS NULL
--   places_guard_source          BEFORE I/U     returns NEW at once when auth.uid() IS NULL
--   places_guard_official_visit  BEFORE I/U     returns NEW at once when auth.uid() IS NULL
--   guard_place_moderation       BEFORE UPDATE  guard_moderation_columns('place'): get_my_role() is
--                                NULL with no session, so it is not admin; hidden_at / hidden_reason
--                                are unchanged, so it returns NEW
--   check_place_content          BEFORE I/U     name / name_i18n / description_i18n unchanged: returns NEW
-- None touches another column or flips status. The DO block asserts the live set (above) and also
-- prints it as a NOTICE (supabase-migrate does not surface NOTICEs; the assertion is what protects).
--
-- Apply: gh workflow run supabase-migrate -f file=20261206_alagadi_pin.sql  (dry), then -f apply=true
-- after Berke approves production-db. Data only: nothing to register in verify_schema.sql.
-- ═══════════════════════════════════════════════════════════════════════════

SET ROLE postgres;
BEGIN;

SET LOCAL lock_timeout = '5s';

DO $$
DECLARE
  c_id      constant uuid             := 'fa39492b-57e6-4ebd-b22c-89a9cf20ffe2';
  c_old_lat constant double precision := 35.3302;
  c_old_lng constant double precision := 33.4972;
  c_new_lat constant double precision := 35.332504;
  c_new_lng constant double precision := 33.48512;
  r         public.places%ROWTYPE;
  v_before  jsonb;
  v_after   jsonb;
  v_n       int := 0;
  v_diff    text;
  v_trg     text;
  v_ntrg    int;
  v_nbad    int;
BEGIN
  SELECT * INTO r FROM public.places WHERE id = c_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'places row % not found', c_id;
  END IF;
  IF r.category IS DISTINCT FROM 'beach' OR r.name IS DISTINCT FROM 'Alagadi Turtle Beach' THEN
    RAISE EXCEPTION 'places row % does not match the category / name this file expects for the Alagadi beach', c_id;
  END IF;
  v_before := to_jsonb(r);

  -- 5 = places_guard_update, places_guard_source, places_guard_official_visit, guard_place_moderation,
  -- check_place_content (see header: derived from supabase/migrations/ + verify_schema.sql).
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
  RAISE NOTICE 'enabled UPDATE triggers on places (%): %', v_ntrg, v_trg;

  IF r.latitude IS NOT DISTINCT FROM c_old_lat AND r.longitude IS NOT DISTINCT FROM c_old_lng THEN
    UPDATE public.places
       SET latitude = c_new_lat, longitude = c_new_lng
     WHERE id = c_id AND latitude = c_old_lat AND longitude = c_old_lng;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n <> 1 THEN
      RAISE EXCEPTION 'expected to update exactly 1 places row, updated %', v_n;
    END IF;
    RAISE NOTICE 'moved Alagadi pin: % , % -> % , %', c_old_lat, c_old_lng, c_new_lat, c_new_lng;
  ELSIF r.latitude IS NOT DISTINCT FROM c_new_lat AND r.longitude IS NOT DISTINCT FROM c_new_lng THEN
    RAISE NOTICE 'Alagadi pin already at % , %: nothing to do', c_new_lat, c_new_lng;
  ELSE
    RAISE EXCEPTION 'Alagadi pin is at % , % — neither the old (% , %) nor the new (% , %) value; refusing to overwrite',
      r.latitude, r.longitude, c_old_lat, c_old_lng, c_new_lat, c_new_lng;
  END IF;

  SELECT to_jsonb(p) INTO v_after FROM public.places p WHERE id = c_id;
  IF v_after IS NULL
     OR (v_after ->> 'latitude')::double precision  IS DISTINCT FROM c_new_lat
     OR (v_after ->> 'longitude')::double precision IS DISTINCT FROM c_new_lng THEN
    RAISE EXCEPTION 'Alagadi pin is not at the new value after the update';
  END IF;

  SELECT string_agg(k, ', ' ORDER BY k) INTO v_diff
    FROM (SELECT key AS k FROM jsonb_each(v_before - 'latitude' - 'longitude') b
           WHERE (v_after - 'latitude' - 'longitude') -> key IS DISTINCT FROM b.value
          UNION
          SELECT key FROM jsonb_object_keys(v_after - 'latitude' - 'longitude') key
           WHERE NOT (v_before ? key)) d;
  IF v_diff IS NOT NULL THEN
    RAISE EXCEPTION 'another column of the Alagadi row changed (keys: %); aborting', v_diff;
  END IF;
  RAISE NOTICE 'verified: exactly this row, only latitude/longitude differ (rows updated this run: %)', v_n;
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
VALUES ('20261206_alagadi_pin.sql', '8fff41bc998007533c75a6000892f05c2baa618f28f3fb7ada7d11bedf5561e1')
ON CONFLICT (filename) DO UPDATE
  SET checksum = excluded.checksum, applied_at = now(), applied_by = current_user;
-- ─── ledger:stamp:end ────────────────────────────────────────────────
COMMIT;

RESET ROLE;

-- ─── Rollback (a new migration, never an edit of this one) ──────────────────
--   UPDATE public.places SET latitude = 35.3302, longitude = 33.4972
--    WHERE id = 'fa39492b-57e6-4ebd-b22c-89a9cf20ffe2' AND latitude = 35.332504 AND longitude = 33.48512;
