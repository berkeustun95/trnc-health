-- ═══════════════════════════════════════════════════════════════════════════
-- 20261060 — hotels: geocode provenance (every coordinate says where it came from)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- The KITOB list carries no coordinates. They are found by scripts/geocode-kitob-hotels.mjs
-- (Google Places, corroborated) or placed by hand, and each one records how. Same four
-- columns and the same tier semantics as facilities (20260919), so one reading of "tier"
-- holds across the app:
--
--   geocode_source         google_places | osm | manual | partner
--   geocode_tier           1 = OSM name match + address-town agreement
--                          2 = Google Places, corroborated (see geocode_corroboration)
--                          3 = hand-placed on satellite
--                          NULL = provenance recorded, no tier claimed (partner-supplied)
--                          ⚠ 3 is the MOST trustworthy. Never write `tier <= 2` meaning "good".
--   geocode_corroboration  what independently agreed: address_town, phone_match,
--                          phone_exchange, name_match, osm, google_places, region_audit,
--                          visual_satellite. Enforced as a vocabulary (unlike facilities,
--                          where it is prose in a COMMENT).
--   geocoded_at            when the coordinate was established.
--
-- ─── THE RULE IS TWO-WAY, STRICTER THAN facilities ──────────────────────────
-- facilities_coords_need_provenance only says "coordinates need a source". Here the source
-- also needs coordinates: (lat IS NULL) = (geocode_source IS NULL). The reason is the KITOB
-- importer: every list update upserts every changed hotel, and an upsert that carried
-- lat/lng = NULL would wipe a geocoded pin while leaving its provenance behind, pointing at
-- nothing. The importer no longer sends lat/lng unless the file supplies them; this
-- constraint makes the same mistake impossible rather than merely unlikely — a clobbering
-- write is REFUSED with 23514, not noticed later.
-- geocoded_at travels with the source for the same reason.
--
-- No RLS or policy change: hotels_select_public (20261059) is untouched and the new columns
-- are covered by the existing table-level SELECT grant. Writes stay service_role only.
--
-- Apply: SQL Editor, Role = postgres, whole file ONCE, copied from disk. Idempotent.
-- ADD COLUMN ⇒ ends with NOTIFY pgrst (after COMMIT).
-- ═══════════════════════════════════════════════════════════════════════════

SET ROLE postgres;

BEGIN;

SET LOCAL lock_timeout = '5s';

ALTER TABLE public.hotels
  ADD COLUMN IF NOT EXISTS geocode_source        text,
  ADD COLUMN IF NOT EXISTS geocode_tier          smallint,
  ADD COLUMN IF NOT EXISTS geocode_corroboration text[],
  ADD COLUMN IF NOT EXISTS geocoded_at           timestamptz;

ALTER TABLE public.hotels DROP CONSTRAINT IF EXISTS hotels_geocode_source_check;
ALTER TABLE public.hotels ADD  CONSTRAINT hotels_geocode_source_check
  CHECK (geocode_source IS NULL OR geocode_source IN ('google_places','osm','manual','partner'));

ALTER TABLE public.hotels DROP CONSTRAINT IF EXISTS hotels_geocode_tier_check;
ALTER TABLE public.hotels ADD  CONSTRAINT hotels_geocode_tier_check
  CHECK (geocode_tier IS NULL OR geocode_tier BETWEEN 1 AND 3);

ALTER TABLE public.hotels DROP CONSTRAINT IF EXISTS hotels_geocode_corroboration_check;
ALTER TABLE public.hotels ADD  CONSTRAINT hotels_geocode_corroboration_check
  CHECK (geocode_corroboration IS NULL
         OR geocode_corroboration <@ ARRAY['address_town','phone_match','phone_exchange','name_match',
                                           'osm','google_places','region_audit','visual_satellite']::text[]);

ALTER TABLE public.hotels DROP CONSTRAINT IF EXISTS hotels_coords_provenance_check;
ALTER TABLE public.hotels ADD  CONSTRAINT hotels_coords_provenance_check
  CHECK ((lat IS NULL) = (geocode_source IS NULL)
         AND (geocode_source IS NULL) = (geocoded_at IS NULL));

COMMENT ON COLUMN public.hotels.geocode_source IS
  'Where lat/lng came from: google_places | osm | manual | partner. Present exactly when lat/lng are (hotels_coords_provenance_check, two-way).';
COMMENT ON COLUMN public.hotels.geocode_tier IS
  '1 = OSM name match + address-town agreement. 2 = Google Places, corroborated. 3 = hand-placed on satellite (MOST trustworthy). NULL = no tier claimed (partner).';
COMMENT ON COLUMN public.hotels.geocode_corroboration IS
  'What independently agreed with the coordinate: address_town, phone_match, phone_exchange, name_match, osm, google_places, region_audit, visual_satellite. Vocabulary enforced by hotels_geocode_corroboration_check. For a hand-placed pin visual_satellite is mandatory.';
COMMENT ON COLUMN public.hotels.geocoded_at IS
  'When the coordinate was established. Lets a later pass find everything placed before a method was known to be faulty.';

-- ─── Assertions. Each derives what it checks and prints what it read. ───────
DO $$
DECLARE
  v_h    regclass := to_regclass('public.hotels');
  v_n    int;
  v_def  text;
  v_id   uuid;
  v_cols text;
  r_ok text := 'unset'; r_coords_only text := 'unset'; r_source_only text := 'unset';
  r_clobber text := 'unset'; r_bad_source text := 'unset'; r_bad_tier text := 'unset';
  r_bad_corr text := 'unset'; r_no_time text := 'unset';
BEGIN
  IF v_h IS NULL THEN RAISE EXCEPTION 'public.hotels not visible — apply 20261059 first'; END IF;

  SELECT string_agg(column_name || ':' || data_type, ', ' ORDER BY column_name) INTO v_cols
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'hotels'
     AND column_name IN ('geocode_source','geocode_tier','geocode_corroboration','geocoded_at');
  IF v_cols IS DISTINCT FROM 'geocode_corroboration:ARRAY, geocode_source:text, geocode_tier:smallint, geocoded_at:timestamp with time zone' THEN
    RAISE EXCEPTION 'provenance columns are not as declared: %', coalesce(v_cols, '(none)');
  END IF;

  -- RLS untouched: still exactly one permissive SELECT policy (20261059's).
  SELECT count(*) INTO v_n FROM pg_policies WHERE schemaname = 'public' AND tablename = 'hotels';
  IF v_n IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'hotels now carries % policies, expected 1', v_n; END IF;

  SELECT pg_get_constraintdef(oid) INTO v_def FROM pg_constraint
   WHERE conrelid = v_h AND conname = 'hotels_coords_provenance_check';
  IF v_def IS NULL THEN RAISE EXCEPTION 'hotels_coords_provenance_check missing'; END IF;

  -- ── BEHAVIOUR, rolled back by a sentinel. Every refusal is paired with the legitimate path.
  BEGIN
    INSERT INTO public.hotels (external_id, name, kitob_class, region, is_kitob_member,
                               source_list_date, content_hash)
    VALUES ('kitob-zzgeo', 'zz geo probe', 'star3', 'kyrenia', true, DATE '2026-01-01', 'zz')
    RETURNING id INTO v_id;

    -- Positive control: a full, well-formed geocode is accepted.
    BEGIN
      UPDATE public.hotels SET lat = 35.3364, lng = 33.319, geocode_source = 'google_places',
             geocode_tier = 2, geocode_corroboration = ARRAY['address_town','phone_match'],
             geocoded_at = now() WHERE id = v_id;
      r_ok := 'accepted';
    EXCEPTION WHEN check_violation THEN r_ok := 'REFUSED';
    END;
    -- THE CLOBBER: an update that nulls the coordinates but leaves the provenance.
    BEGIN
      UPDATE public.hotels SET lat = NULL, lng = NULL WHERE id = v_id;
      r_clobber := 'ACCEPTED';
    EXCEPTION WHEN check_violation THEN r_clobber := 'refused';
    END;
    BEGIN
      UPDATE public.hotels SET geocode_source = NULL, geocoded_at = NULL, geocode_tier = NULL,
             geocode_corroboration = NULL WHERE id = v_id;
      r_coords_only := 'ACCEPTED';
    EXCEPTION WHEN check_violation THEN r_coords_only := 'refused';
    END;
    BEGIN
      UPDATE public.hotels SET geocoded_at = NULL WHERE id = v_id;
      r_no_time := 'ACCEPTED';
    EXCEPTION WHEN check_violation THEN r_no_time := 'refused';
    END;
    BEGIN
      UPDATE public.hotels SET geocode_source = 'nominatim' WHERE id = v_id;
      r_bad_source := 'ACCEPTED';
    EXCEPTION WHEN check_violation THEN r_bad_source := 'refused';
    END;
    BEGIN
      UPDATE public.hotels SET geocode_tier = 4 WHERE id = v_id;
      r_bad_tier := 'ACCEPTED';
    EXCEPTION WHEN check_violation THEN r_bad_tier := 'refused';
    END;
    BEGIN
      UPDATE public.hotels SET geocode_corroboration = ARRAY['vibes'] WHERE id = v_id;
      r_bad_corr := 'ACCEPTED';
    EXCEPTION WHEN check_violation THEN r_bad_corr := 'refused';
    END;
    -- Clear the coordinates properly (all together) so the source-only probe starts clean.
    UPDATE public.hotels SET lat = NULL, lng = NULL, geocode_source = NULL, geocode_tier = NULL,
           geocode_corroboration = NULL, geocoded_at = NULL WHERE id = v_id;
    BEGIN
      UPDATE public.hotels SET geocode_source = 'manual', geocoded_at = now() WHERE id = v_id;
      r_source_only := 'ACCEPTED';
    EXCEPTION WHEN check_violation THEN r_source_only := 'refused';
    END;

    RAISE EXCEPTION 'ZZ_PROBE_ROLLBACK';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM IS DISTINCT FROM 'ZZ_PROBE_ROLLBACK' THEN RAISE; END IF;
  END;

  IF v_id IS NULL THEN RAISE EXCEPTION 'probe: the hotel INSERT produced no row, nothing was tested'; END IF;
  IF r_ok          IS DISTINCT FROM 'accepted' THEN RAISE EXCEPTION 'a well-formed geocode was %', r_ok; END IF;
  IF r_clobber     IS DISTINCT FROM 'refused'  THEN RAISE EXCEPTION 'nulling lat/lng while keeping the source was %', r_clobber; END IF;
  IF r_coords_only IS DISTINCT FROM 'refused'  THEN RAISE EXCEPTION 'coordinates without a source were %', r_coords_only; END IF;
  IF r_no_time     IS DISTINCT FROM 'refused'  THEN RAISE EXCEPTION 'a source without geocoded_at was %', r_no_time; END IF;
  IF r_source_only IS DISTINCT FROM 'refused'  THEN RAISE EXCEPTION 'a source without coordinates was %', r_source_only; END IF;
  IF r_bad_source  IS DISTINCT FROM 'refused'  THEN RAISE EXCEPTION 'CONTROL FAILED: geocode_source nominatim was %', r_bad_source; END IF;
  IF r_bad_tier    IS DISTINCT FROM 'refused'  THEN RAISE EXCEPTION 'CONTROL FAILED: geocode_tier 4 was %', r_bad_tier; END IF;
  IF r_bad_corr    IS DISTINCT FROM 'refused'  THEN RAISE EXCEPTION 'CONTROL FAILED: corroboration vibes was %', r_bad_corr; END IF;
  IF EXISTS (SELECT 1 FROM public.hotels WHERE external_id = 'kitob-zzgeo') THEN
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
VALUES ('20261060_hotels_geocode_provenance.sql', '01670c372d30597a344b1188fde0b055abe0d41ac83ce9bef40fcea78372e8a5')
ON CONFLICT (filename) DO UPDATE
  SET checksum = excluded.checksum, applied_at = now(), applied_by = current_user;
-- ─── ledger:stamp:end ────────────────────────────────────────────────
COMMIT;
RESET ROLE;

NOTIFY pgrst, 'reload schema';

-- ─── Verification after applying (read-only, run alone) ─────────────────────
--   Run supabase/verify_schema.sql QUERY 1: every 1060_hotels_geocode row must read OK.
--   SELECT geocode_source, geocode_tier, count(*) FROM public.hotels GROUP BY 1, 2;
--
-- ─── Rollback ───────────────────────────────────────────────────────────────
--   ALTER TABLE public.hotels DROP CONSTRAINT IF EXISTS hotels_coords_provenance_check,
--     DROP CONSTRAINT IF EXISTS hotels_geocode_corroboration_check,
--     DROP CONSTRAINT IF EXISTS hotels_geocode_tier_check,
--     DROP CONSTRAINT IF EXISTS hotels_geocode_source_check;
--   ALTER TABLE public.hotels DROP COLUMN IF EXISTS geocode_source, DROP COLUMN IF EXISTS geocode_tier,
--     DROP COLUMN IF EXISTS geocode_corroboration, DROP COLUMN IF EXISTS geocoded_at;
