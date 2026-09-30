-- ═══════════════════════════════════════════════════════════════════════════
-- 20261062 — hotels: Google Places pins allowed again, as a KNOWN RISK
-- ═══════════════════════════════════════════════════════════════════════════
--
-- DECISION (Berke, 2026-09-29, the evening of 20261061): every hotel should have an exact pin,
-- so hotels take corroborated Google Places coordinates like the 282 pharmacies do. This
-- undoes ONE part of 20261061 — 'google_places' returns to hotels_geocode_source_check.
-- google_place_id (format CHECK + UNIQUE) stays exactly as 1061 made it.
--
-- THE RISK, STATED WHERE THE DATA LIVES: Google's Maps Platform terms cap caching of Places
-- coordinates at 30 days (the place ID is exempt). Accepted with no deadline; every Google pin
-- is listed in data/geocode-exceptions/google-pins.csv (CLAUDE.md, geocoding policy). Hotels are
-- shown only through a Google Maps link (the Harita button), never on an in-app Apple map.
--
-- ONE NEW CONSTRAINT — hotels_google_places_traceable_check: a google_places row carries its
-- google_place_id and tier 2. The place ID is what lets a known-risk pin be re-checked or
-- replaced later; a Google pin without it could be neither. The geocoder writes both anyway,
-- so this refuses only a writer that forgot.
--
-- Tier, for hotels, after this file:
--   1 = OSM coordinate agreeing with a corroborated Places match ('google_places' in corroboration)
--   2 = Google Places coordinate, corroborated (region + address town, plus phone, name or OSM)
--   3 = hand-placed (MOST trustworthy)       NULL = no tier claimed (partner)
--
-- No RLS or policy change; no column added (so no NOTIFY pgrst).
-- Apply: SQL Editor, Role = postgres, whole file ONCE, copied from disk. Idempotent.
-- ═══════════════════════════════════════════════════════════════════════════

SET ROLE postgres;

BEGIN;

SET LOCAL lock_timeout = '5s';

ALTER TABLE public.hotels DROP CONSTRAINT IF EXISTS hotels_geocode_source_check;
ALTER TABLE public.hotels ADD  CONSTRAINT hotels_geocode_source_check
  CHECK (geocode_source IS NULL OR geocode_source IN ('google_places','osm','manual','partner'));

ALTER TABLE public.hotels DROP CONSTRAINT IF EXISTS hotels_google_places_traceable_check;
ALTER TABLE public.hotels ADD  CONSTRAINT hotels_google_places_traceable_check
  CHECK (geocode_source IS DISTINCT FROM 'google_places'
         OR (google_place_id IS NOT NULL AND geocode_tier = 2));

COMMENT ON COLUMN public.hotels.geocode_source IS
  'Where lat/lng came from: google_places | osm | manual | partner. google_places was removed by 20261061 and re-allowed by 20261062 as a KNOWN RISK (Google caching terms; every such pin is listed in data/geocode-exceptions/google-pins.csv). Present exactly when lat/lng are (hotels_coords_provenance_check).';
COMMENT ON COLUMN public.hotels.geocode_tier IS
  '1 = OSM coordinate agreeing with a corroborated Places match (google_places in geocode_corroboration). 2 = Google Places coordinate, corroborated (region + address town, plus phone, name or OSM); requires google_place_id (hotels_google_places_traceable_check). 3 = hand-placed (MOST trustworthy). NULL = no tier claimed (partner).';
COMMENT ON COLUMN public.hotels.google_place_id IS
  'Google Places place ID of the matched Place (exempt from the Places caching limit). For a google_places pin it is REQUIRED (hotels_google_places_traceable_check): it is how a known-risk pin is re-checked or replaced. UNIQUE: two hotels cannot match one Place.';

-- ─── Assertions ─────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_id uuid; v_n int;
  r_gp text := 'unset'; r_no_id text := 'unset'; r_no_lat text := 'unset';
  r_bad_src text := 'unset'; r_tier1 text := 'unset'; r_osm text := 'unset';
BEGIN
  SELECT count(*) INTO v_n FROM pg_policies WHERE schemaname = 'public' AND tablename = 'hotels';
  IF v_n IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'hotels carries % policies, expected 1', v_n; END IF;

  BEGIN
    INSERT INTO public.hotels (external_id, name, kitob_class, region, is_kitob_member, source_list_date, content_hash)
    VALUES ('kitob-zzgp62', 'zz gp probe 62', 'star3', 'kyrenia', true, DATE '2026-01-01', 'zz') RETURNING id INTO v_id;

    -- Positive control: a corroborated Google pin, traceable.
    BEGIN
      UPDATE public.hotels SET lat = 35.3364, lng = 33.319, geocode_source = 'google_places', geocode_tier = 2,
             geocode_corroboration = ARRAY['region_audit','address_town','phone_match'], geocoded_at = now(),
             google_place_id = 'ChIJzzProbePlaceId62' WHERE id = v_id;
      r_gp := 'accepted';
    EXCEPTION WHEN check_violation OR unique_violation THEN r_gp := 'REFUSED';
    END;
    -- A Google pin that lost its place id.
    BEGIN
      UPDATE public.hotels SET google_place_id = NULL WHERE id = v_id;
      r_no_id := 'ACCEPTED';
    EXCEPTION WHEN check_violation THEN r_no_id := 'refused';
    END;
    -- A Google pin claiming tier 1.
    BEGIN
      UPDATE public.hotels SET geocode_tier = 1 WHERE id = v_id;
      r_tier1 := 'ACCEPTED';
    EXCEPTION WHEN check_violation THEN r_tier1 := 'refused';
    END;
    -- The 1060 two-way rule still binds: google_places with no coordinates.
    BEGIN
      UPDATE public.hotels SET lat = NULL, lng = NULL WHERE id = v_id;
      r_no_lat := 'ACCEPTED';
    EXCEPTION WHEN check_violation THEN r_no_lat := 'refused';
    END;
    -- Vocabulary: an unknown source.
    BEGIN
      UPDATE public.hotels SET geocode_source = 'geonames' WHERE id = v_id;
      r_bad_src := 'ACCEPTED';
    EXCEPTION WHEN check_violation THEN r_bad_src := 'refused';
    END;
    -- The new constraint is about google_places only: an osm pin needs no place id.
    BEGIN
      UPDATE public.hotels SET geocode_source = 'osm', geocode_tier = 1, google_place_id = NULL WHERE id = v_id;
      r_osm := 'accepted';
    EXCEPTION WHEN check_violation THEN r_osm := 'REFUSED';
    END;
    RAISE EXCEPTION 'ZZ_PROBE_ROLLBACK';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM IS DISTINCT FROM 'ZZ_PROBE_ROLLBACK' THEN RAISE; END IF;
  END;

  IF v_id IS NULL THEN RAISE EXCEPTION 'probe row was not created, nothing was tested'; END IF;
  IF r_gp      IS DISTINCT FROM 'accepted' THEN RAISE EXCEPTION 'a corroborated google_places pin was %', r_gp; END IF;
  IF r_osm     IS DISTINCT FROM 'accepted' THEN RAISE EXCEPTION 'an osm pin without a place id was %', r_osm; END IF;
  IF r_no_id   IS DISTINCT FROM 'refused'  THEN RAISE EXCEPTION 'a google_places pin without a place id was %', r_no_id; END IF;
  IF r_tier1   IS DISTINCT FROM 'refused'  THEN RAISE EXCEPTION 'a google_places pin at tier 1 was %', r_tier1; END IF;
  IF r_no_lat  IS DISTINCT FROM 'refused'  THEN RAISE EXCEPTION 'google_places without coordinates was %', r_no_lat; END IF;
  IF r_bad_src IS DISTINCT FROM 'refused'  THEN RAISE EXCEPTION 'CONTROL FAILED: geocode_source geonames was %', r_bad_src; END IF;
  IF EXISTS (SELECT 1 FROM public.hotels WHERE external_id = 'kitob-zzgp62') THEN
    RAISE EXCEPTION 'probe row survived the rollback';
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
VALUES ('20261062_hotels_google_places_pins.sql', '5d34c8c9a9d3af84ced89ccfec6b8e475f6812349b11db0b4638020ed52b4c3c')
ON CONFLICT (filename) DO UPDATE
  SET checksum = excluded.checksum, applied_at = now(), applied_by = current_user;
-- ─── ledger:stamp:end ────────────────────────────────────────────────
COMMIT;
RESET ROLE;

-- ─── Verification after applying (read-only, run alone) ─────────────────────
--   Run supabase/verify_schema.sql QUERY 1: every 1062_hotels_google_places row must read OK.
--
-- ─── Rollback ───────────────────────────────────────────────────────────────
--   Do NOT "roll back" by re-pasting 20261061: once any hotel carries google_places, 1061's
--   guard refuses (by design) and nothing applies. To really undo this decision, first
--   re-source or clear every google_places hotel pin (and its google-pins.csv row), then:
--   ALTER TABLE public.hotels DROP CONSTRAINT IF EXISTS hotels_google_places_traceable_check;
--   and re-apply 1061's hotels_geocode_source_check.
