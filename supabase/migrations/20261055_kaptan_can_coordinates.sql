-- ═══════════════════════════════════════════════════════════════════════════
-- 20261055 — coordinates for KAPTAN CAN ECZANESİ (Ortaköy, Lefkoşa)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- The KTEB 2026-27 roster spells it KAPTANCAN; utils/dutyFacilityMatch.js resolves that to
-- this facilities row (1d94dc5), but the row has no pin, so its duty card shows no distance.
-- One row: b5d09138-7828-4106-b538-424799865868.
--
-- ─── THE EVIDENCE (Google Places, supplied by Berke; NOT re-queried here — there is no ───
--     Places key on the machine this was written on, so it is taken as given)
--   place_id  ChIJ7f2OQq8R3hQReXQFNd-IhZ0 · "KAPTANCAN ECZANE"
--   location  35.2003364, 33.3280142
--   address   Yavuz Konnolu Sk 11-a, Ortaköy
--   phone     +90 392 224 06 66
--
-- ─── PROVENANCE, PER 20260919 / 20261005 ────────────────────────────────────
--   geocode_source         'google_places'
--   geocode_tier           2 — Google Places accepted on town agreement plus a pure exchange
--   geocode_corroboration  {address_town, phone_exchange}
--
--   address_town   — Google's "…Ortaköy" and this row's "…Ortaköy, Lefkoşa" both resolve to
--                    Lefkoşa through the geocoder's own townOf(). Same STREET too (Yavuz
--                    Konnolu); the DOOR differs — Google 11-a, Gazette and this row 11B.
--                    Noted, not blocking: town and street agree.
--   phone_exchange — ⚠ from the GAZETTE landline (0392) 224 06 66, NOT from this row's
--                    `phone`, which is still the stale mobile (0548) 853 54 78 and has no
--                    exchange at all. Exchange 224 is 100% Lefkoşa across the 6 pharmacies
--                    carrying it (geocoder rule: ≥90% and ≥3), measured 2026-09-26. The
--                    Gazette number is also Google's listed phone EXACTLY — stronger than a
--                    prefix, but the vocabulary has no term for it, so it is not claimed.
--
--   NOT claimed:
--   name_match       — 20261005 defines it operationally: Places displayName tokens ∩ facility
--                      name tokens, noise = ECZANESİ/ECZANESI/ECZNESİ/PHARMACY. Here that is
--                      {kaptancan, eczane} ∩ {kaptan, can} = ∅. Google's spelling matches the
--                      KTEB ROSTER spelling (the alias), which is real identity evidence — but
--                      it is not what that term means, so it is not recorded as it.
--   visual_satellite — not checked.
--
-- Unclaimed pharmacies already carry tier-2 pins (the geocode-pharmacies-tier2 pass); this
-- adds one more on the same terms and does not change search visibility (0924 hides
-- unclaimed pharmacies from search_content by provider_id, not by coordinates).
--
-- Apply: SQL Editor, Role = postgres, whole file ONCE. Re-runnable: a second paste finds the
-- pin already equal to these values and changes nothing. It REFUSES to overwrite a pin from
-- anywhere else — clearing or replacing a live coordinate is a bigger act than this file.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

SET LOCAL lock_timeout = '5s';

DO $$
DECLARE
  c_id    constant uuid   := 'b5d09138-7828-4106-b538-424799865868';
  c_lat   constant double precision := 35.2003364;
  c_lng   constant double precision := 33.3280142;
  c_src   constant text   := 'google_places';
  c_tier  constant int    := 2;
  c_corr  constant text[] := ARRAY['address_town','phone_exchange'];
  v_n     int;
  v_rows  int;
  f       record;
  v_bad   text;
BEGIN
  -- Exactly one row, by id AND name AND type.
  SELECT count(*) INTO v_n FROM public.facilities
   WHERE id = c_id AND name = 'KAPTAN CAN ECZANESİ' AND type = 'pharmacy';
  IF v_n IS DISTINCT FROM 1 THEN
    SELECT string_agg(format('%s|%s|%s', id, name, type), '; ') INTO v_bad
      FROM public.facilities WHERE id = c_id OR name ILIKE '%KAPTAN%CAN%';
    RAISE EXCEPTION 'expected exactly 1 row (id+name+type), matched %. Read: %', v_n, coalesce(v_bad, '(nothing)');
  END IF;

  SELECT latitude, longitude, geocode_source, geocode_tier, geocode_corroboration
    INTO f FROM public.facilities WHERE id = c_id;

  -- Already pinned: pass only if it is THIS pin; never overwrite another source's.
  IF f.latitude IS NOT NULL THEN
    IF f.latitude IS DISTINCT FROM c_lat OR f.longitude IS DISTINCT FROM c_lng
       OR f.geocode_source IS DISTINCT FROM c_src OR f.geocode_tier IS DISTINCT FROM c_tier
       OR f.geocode_corroboration IS DISTINCT FROM c_corr THEN
      RAISE EXCEPTION 'already pinned from elsewhere, not overwriting: %,% source=% tier=% corr=%',
        f.latitude, f.longitude, f.geocode_source, f.geocode_tier, f.geocode_corroboration;
    END IF;
    RETURN;  -- re-run: identical pin already in place
  END IF;

  -- Shared point, over ALL facility types: two facilities cannot occupy one coordinate.
  SELECT string_agg(format('%s (%s) %s,%s', name, type, latitude, longitude), '; ') INTO v_bad
    FROM public.facilities
   WHERE id <> c_id
     AND latitude  >= 35.2003 AND latitude  < 35.2004
     AND longitude >= 33.3280 AND longitude < 33.3281;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'point 35.2003,33.3280 (4dp) is already held by: %', v_bad;
  END IF;

  UPDATE public.facilities
     SET latitude = c_lat, longitude = c_lng,
         geocode_source = c_src, geocode_tier = c_tier,
         geocode_corroboration = c_corr, geocoded_at = now()
   WHERE id = c_id AND latitude IS NULL;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'UPDATE touched % rows, expected 1', v_rows;
  END IF;

  SELECT latitude, longitude, geocode_source, geocode_tier, geocode_corroboration
    INTO f FROM public.facilities WHERE id = c_id;
  IF f.latitude IS DISTINCT FROM c_lat OR f.longitude IS DISTINCT FROM c_lng
     OR f.geocode_source IS DISTINCT FROM c_src OR f.geocode_tier IS DISTINCT FROM c_tier
     OR f.geocode_corroboration IS DISTINCT FROM c_corr THEN
    RAISE EXCEPTION 'read-back differs: %,% source=% tier=% corr=%',
      f.latitude, f.longitude, f.geocode_source, f.geocode_tier, f.geocode_corroboration;
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
VALUES ('20261055_kaptan_can_coordinates.sql', '80a574b289ff649d9127d44747e059eb40b91eca62bb0bec90ee5af2fce9d21f')
ON CONFLICT (filename) DO UPDATE
  SET checksum = excluded.checksum, applied_at = now(), applied_by = current_user;
-- ─── ledger:stamp:end ────────────────────────────────────────────────
COMMIT;

-- ─── Result (read-only, run alone) ──────────────────────────────────────────
--   SELECT id, name, latitude, longitude, geocode_source, geocode_tier,
--          geocode_corroboration, geocoded_at
--     FROM public.facilities WHERE id = 'b5d09138-7828-4106-b538-424799865868';
--   -- expect 35.2003364 | 33.3280142 | google_places | 2 | {address_town,phone_exchange} | today
--
-- ─── Rollback ───────────────────────────────────────────────────────────────
--   UPDATE public.facilities
--      SET latitude = NULL, longitude = NULL, geocode_source = NULL, geocode_tier = NULL,
--          geocode_corroboration = NULL, geocoded_at = NULL
--    WHERE id = 'b5d09138-7828-4106-b538-424799865868';
