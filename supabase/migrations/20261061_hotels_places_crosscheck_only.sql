-- ═══════════════════════════════════════════════════════════════════════════
-- 20261061 — hotels: Google Places is a CROSS-CHECK ONLY (geocoding storage policy)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- POLICY (Berke, 2026-09-29; recorded in CLAUDE.md): Google Places latitude/longitude is never
-- stored. The Maps Platform terms cap caching of Places content (the place ID is exempt), and
-- on iOS ADA's maps are Apple Maps (react-native-maps default), where Places content may not be
-- shown at all. Stored coordinates come from OSM where it agrees with Places, or from hand
-- placement.
--
-- This file makes that structural for hotels:
--   1. hotels_geocode_source_check loses 'google_places': {osm, manual, partner}. Guarded — the
--      DO block asserts no row carries it before the constraint is rebuilt (today: 0; nothing
--      was ever written with it).
--   2. hotels.google_place_id — the one piece of Places data we MAY keep. It lets a hotel be
--      re-checked against Places without a fresh text search, and a hand-placer open the
--      candidate. Format CHECK, and UNIQUE: no two hotels may be matched to the same Place
--      (the dry run's sanity check, done by hand, becomes a constraint).
--      It is INDEPENDENT of hotels_coords_provenance_check (20261060): a hotel on the
--      hand-placement list has a Places cross-check id and no coordinates, and that is correct.
--
-- ─── TIER MEANING, CORRECTED FOR THIS POLICY ────────────────────────────────
-- 20261060's COMMENT says "2 = Google Places, corroborated". That tier can no longer be written
-- for hotels. An OSM coordinate that agrees with a corroborated Places match is written as
-- geocode_source 'osm', tier 1, with 'google_places' in geocode_corroboration. 3 = hand-placed.
-- The applied 1060 file is not edited; the COMMENT is replaced here.
--
-- ─── OSM IS ODbL ────────────────────────────────────────────────────────────
-- OSM-sourced coordinates are a produced work: "© OpenStreetMap contributors" attribution is
-- required where they are shown (same obligation as 20261049's walking legs).
--
-- No RLS or policy change. Facilities are NOT touched here: 349 pharmacy pins still carry
-- 'google_places' and their re-sourcing is a separate decision.
--
-- Apply: SQL Editor, Role = postgres, whole file ONCE, copied from disk. Idempotent.
-- ADD COLUMN ⇒ ends with NOTIFY pgrst (after COMMIT).
-- ═══════════════════════════════════════════════════════════════════════════

SET ROLE postgres;

BEGIN;

SET LOCAL lock_timeout = '5s';

-- Guard BEFORE the rebuild: the tightened CHECK would otherwise fail on existing rows with a
-- less useful message, or (NOT VALID) leave them in place.
DO $$
DECLARE v_n int;
BEGIN
  SELECT count(*) INTO v_n FROM public.hotels WHERE geocode_source = 'google_places';
  IF v_n IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION '% hotel(s) still carry geocode_source = google_places — re-source them before removing it from the vocabulary', v_n;
  END IF;
END $$;

ALTER TABLE public.hotels DROP CONSTRAINT IF EXISTS hotels_geocode_source_check;
ALTER TABLE public.hotels ADD  CONSTRAINT hotels_geocode_source_check
  CHECK (geocode_source IS NULL OR geocode_source IN ('osm','manual','partner'));

ALTER TABLE public.hotels ADD COLUMN IF NOT EXISTS google_place_id text;

ALTER TABLE public.hotels DROP CONSTRAINT IF EXISTS hotels_google_place_id_check;
ALTER TABLE public.hotels ADD  CONSTRAINT hotels_google_place_id_check
  CHECK (google_place_id IS NULL OR google_place_id ~ '^[A-Za-z0-9_-]{10,}$');

ALTER TABLE public.hotels DROP CONSTRAINT IF EXISTS hotels_google_place_id_key;
ALTER TABLE public.hotels ADD  CONSTRAINT hotels_google_place_id_key UNIQUE (google_place_id);

COMMENT ON COLUMN public.hotels.google_place_id IS
  'Google Places place ID of the cross-check match — the only Places data ADA stores (exempt from the caching limits). Never store Places lat/lng. UNIQUE: two hotels cannot match one Place. Independent of the coordinate columns.';
COMMENT ON COLUMN public.hotels.geocode_source IS
  'Where lat/lng came from: osm | manual | partner. google_places was removed by 20261061 (storage policy: Places is a cross-check only). Present exactly when lat/lng are (hotels_coords_provenance_check).';
COMMENT ON COLUMN public.hotels.geocode_tier IS
  '1 = OSM coordinate agreeing with a corroborated Places match (google_places in geocode_corroboration). 3 = hand-placed on satellite (MOST trustworthy). NULL = no tier claimed (partner). 2 is no longer written for hotels (it meant a stored Places coordinate).';

-- ─── Assertions ─────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_h regclass := to_regclass('public.hotels');
  v_id uuid; v_id2 uuid;
  r_gp text := 'unset'; r_osm text := 'unset'; r_bad_id text := 'unset'; r_dup text := 'unset';
  r_id_only text := 'unset'; v_n int;
BEGIN
  SELECT count(*) INTO v_n FROM pg_policies WHERE schemaname = 'public' AND tablename = 'hotels';
  IF v_n IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'hotels carries % policies, expected 1', v_n; END IF;

  BEGIN
    INSERT INTO public.hotels (external_id, name, kitob_class, region, is_kitob_member, source_list_date, content_hash)
    VALUES ('kitob-zzgp1', 'zz gp probe 1', 'star3', 'kyrenia', true, DATE '2026-01-01', 'zz') RETURNING id INTO v_id;
    INSERT INTO public.hotels (external_id, name, kitob_class, region, is_kitob_member, source_list_date, content_hash)
    VALUES ('kitob-zzgp2', 'zz gp probe 2', 'star3', 'kyrenia', true, DATE '2026-01-01', 'zz') RETURNING id INTO v_id2;

    -- Positive control: an OSM coordinate with a Places cross-check id.
    BEGIN
      UPDATE public.hotels SET lat = 35.3364, lng = 33.319, geocode_source = 'osm', geocode_tier = 1,
             geocode_corroboration = ARRAY['google_places','name_match'], geocoded_at = now(),
             google_place_id = 'ChIJzzProbePlaceId01' WHERE id = v_id;
      r_osm := 'accepted';
    EXCEPTION WHEN check_violation OR unique_violation THEN r_osm := 'REFUSED';
    END;
    -- A place id with NO coordinates (the hand-placement case) is fine.
    BEGIN
      UPDATE public.hotels SET google_place_id = 'ChIJzzProbePlaceId02' WHERE id = v_id2;
      r_id_only := 'accepted';
    EXCEPTION WHEN check_violation OR unique_violation THEN r_id_only := 'REFUSED';
    END;
    BEGIN
      UPDATE public.hotels SET geocode_source = 'google_places' WHERE id = v_id;
      r_gp := 'ACCEPTED';
    EXCEPTION WHEN check_violation THEN r_gp := 'refused';
    END;
    BEGIN
      UPDATE public.hotels SET google_place_id = 'not a place id!' WHERE id = v_id2;
      r_bad_id := 'ACCEPTED';
    EXCEPTION WHEN check_violation THEN r_bad_id := 'refused';
    END;
    BEGIN
      UPDATE public.hotels SET google_place_id = 'ChIJzzProbePlaceId01' WHERE id = v_id2;
      r_dup := 'ACCEPTED';
    EXCEPTION WHEN unique_violation THEN r_dup := 'refused';
    END;
    RAISE EXCEPTION 'ZZ_PROBE_ROLLBACK';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM IS DISTINCT FROM 'ZZ_PROBE_ROLLBACK' THEN RAISE; END IF;
  END;

  IF v_id IS NULL OR v_id2 IS NULL THEN RAISE EXCEPTION 'probe rows were not created, nothing was tested'; END IF;
  IF r_osm     IS DISTINCT FROM 'accepted' THEN RAISE EXCEPTION 'an OSM coordinate with a place id was %', r_osm; END IF;
  IF r_id_only IS DISTINCT FROM 'accepted' THEN RAISE EXCEPTION 'a place id without coordinates was %', r_id_only; END IF;
  IF r_gp      IS DISTINCT FROM 'refused'  THEN RAISE EXCEPTION 'geocode_source google_places was %', r_gp; END IF;
  IF r_bad_id  IS DISTINCT FROM 'refused'  THEN RAISE EXCEPTION 'CONTROL FAILED: a malformed place id was %', r_bad_id; END IF;
  IF r_dup     IS DISTINCT FROM 'refused'  THEN RAISE EXCEPTION 'two hotels sharing one place id was %', r_dup; END IF;
  IF EXISTS (SELECT 1 FROM public.hotels WHERE external_id LIKE 'kitob-zzgp%') THEN
    RAISE EXCEPTION 'probe rows survived the rollback';
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
VALUES ('20261061_hotels_places_crosscheck_only.sql', '55753d57aa3c6c195812745bdc39379b46b0e1bde1a884affa09e447628d7026')
ON CONFLICT (filename) DO UPDATE
  SET checksum = excluded.checksum, applied_at = now(), applied_by = current_user;
-- ─── ledger:stamp:end ────────────────────────────────────────────────
COMMIT;
RESET ROLE;

NOTIFY pgrst, 'reload schema';

-- ─── Verification after applying (read-only, run alone) ─────────────────────
--   Run supabase/verify_schema.sql QUERY 1: every 1061_hotels_places_crosscheck row must read OK.
--
-- ─── Rollback ───────────────────────────────────────────────────────────────
--   ALTER TABLE public.hotels DROP CONSTRAINT IF EXISTS hotels_google_place_id_key,
--     DROP CONSTRAINT IF EXISTS hotels_google_place_id_check;
--   ALTER TABLE public.hotels DROP COLUMN IF EXISTS google_place_id;
--   (Re-adding google_places to hotels_geocode_source_check would reverse the storage policy —
--    do not, without changing the policy first.)
