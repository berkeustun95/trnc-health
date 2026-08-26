-- ═══ facilities — geocode provenance, and a coordinate that cannot exist without it ═══
--
-- WHY A COLUMN AND NOT A MANIFEST FILE. The photo backfill records provenance in a
-- committed JSON manifest, and that was right there: photos are curated one at a time and
-- the question you ask later is "what licence is this one under", which a file answers.
-- Coordinates are different. The question you ask later is
--
--     "Google turned out to be systematically off in Güzelyurt — show me every pin that
--      came from Google, in Güzelyurt, that nothing else corroborated."
--
-- That is a query, and a JSON file cannot answer it. A deliberate divergence from the
-- photo pattern, not an inconsistency.
--
-- ─── THE CONSTRAINT IS THE POINT ────────────────────────────────────────────
--
-- `facilities_coords_need_provenance` makes the safe failure STRUCTURAL: a row may have
-- no coordinates, or it may have coordinates AND a recorded source. It may never have
-- coordinates from nowhere.
--
-- This is the "unverified stays NULL" decision, built in at the start rather than taken
-- under fatigue at the end of a long geocoding pass. A pharmacy absent from the map makes
-- someone search for it. A pharmacy on the wrong street makes them DRIVE there. Absent is
-- the safe failure, and the constraint is what stops a tired hand from writing 40 shaky
-- coordinates at 1am "to be tidied later".
--
-- It also closes the door the 387-row Nominatim seed walked through: that file would fail
-- this constraint outright, because it carries no provenance for anything.
--
-- ─── lat/lng ARE BOTH-OR-NEITHER ────────────────────────────────────────────
--
-- Enforced too. A row with a latitude and no longitude is not a partial answer, it is a
-- row that renders nowhere and reads as data. Nothing in the app checks for the half case.
--
-- ─── BACKFILL: THE SEVEN ROWS THAT ALREADY HAVE COORDINATES ─────────────────
--
-- The constraint is added VALID, so the existing seven must be stamped in the same
-- transaction. Their real provenance, not a placeholder:
--
--   6 public hospitals — placed BY HAND in Google Maps on the ENTRANCE (not centre of
--     grounds), each cross-checked against the Google Places coordinate for the same
--     facility, each passed through resolveRegion() against its seeded `city`. All six
--     matched. See 20260914_public_health_coordinates.sql, which documents the one
--     divergence it examined rather than averaged away (Gazimağusa, 121 m).
--     → source 'manual', tier 3, corroborated by google_places + region_audit.
--
--   1 private clinic — provider-owned row, so the coordinate came from the provider
--     placing their own pin in MapPinPicker. That is a real and reasonably trustworthy
--     source (the owner knows where their clinic is) but it is not one WE verified.
--     → source 'provider', tier NULL, no corroboration claimed.
--
-- Recording "we did not verify this" honestly is the whole value of the column. A
-- provenance field that says 'manual' for everything is a field nobody can act on.
--
-- ─── WHAT THE TIERS MEAN ────────────────────────────────────────────────────
--
--   1  OSM name match corroborated by the address town — two independent sources agree
--   2  Google Places, accepted ONLY when it agrees with the address town and, where the
--      number is a landline on a >=90%-pure exchange, with the phone prefix
--   3  placed by hand on satellite imagery
--   NULL  provenance recorded but no tier claimed (e.g. provider-supplied)
--
-- Apply by hand: SQL editor, Role = postgres. Then `node scripts/migration-ledger.mjs`
-- and re-run supabase/migration_ledger_check.sql.

SET ROLE postgres;
BEGIN;

ALTER TABLE public.facilities
  ADD COLUMN IF NOT EXISTS geocode_source        text,
  ADD COLUMN IF NOT EXISTS geocode_tier          smallint,
  ADD COLUMN IF NOT EXISTS geocode_corroboration text[],
  ADD COLUMN IF NOT EXISTS geocoded_at           timestamptz;

COMMENT ON COLUMN public.facilities.geocode_source IS
  'Where this coordinate came from: osm | google_places | manual | provider | partner. NOT NULL whenever latitude/longitude are set — see facilities_coords_need_provenance.';
COMMENT ON COLUMN public.facilities.geocode_tier IS
  '1 = OSM name match + address-town agreement. 2 = Google Places, corroborated by town and (landline only) phone exchange. 3 = hand-placed on satellite. NULL = provenance recorded, no tier claimed.';
COMMENT ON COLUMN public.facilities.geocode_corroboration IS
  'What INDEPENDENTLY agreed with this coordinate: address_town, phone_exchange, region_audit, google_places, osm, visual_satellite. Empty/NULL means nothing did — which is a fact worth storing, not a gap to hide.';
COMMENT ON COLUMN public.facilities.geocoded_at IS
  'When the coordinate was established. Lets a later pass find everything placed before a method was known to be faulty.';

-- ── Backfill BEFORE the constraint, or it cannot be added VALID ──────────────
UPDATE public.facilities
   SET geocode_source        = 'manual',
       geocode_tier          = 3,
       geocode_corroboration = ARRAY['google_places','region_audit']::text[],
       geocoded_at           = '2026-09-14T00:00:00Z'
 WHERE id IN ('e83f3d1d-c0c0-4e68-993c-03a8164286c1',   -- Dr. Burhan Nalbantoğlu Devlet Hastanesi
              '3d108354-79cd-4a11-8173-e7c996d4bcd0',   -- Barış Ruh ve Sinir Hastalıkları Hastanesi
              '56614fa9-d7ba-4528-9fe4-f372e9f9286a',   -- Acil Durum Hastanesi
              '32dafd70-73fb-4aec-afb2-6c940d07e9b9',   -- Lefke Cengiz Topel Hastanesi
              'ed83578f-1866-4e54-9253-705feb093c22',   -- Gazimağusa Devlet Hastanesi
              '7a1c598d-bc43-4b50-9f42-f94adffffe5d');  -- Girne Dr. Akçiçek Devlet Hastanesi

UPDATE public.facilities
   SET geocode_source        = 'provider',
       geocode_tier          = NULL,
       geocode_corroboration = NULL,
       geocoded_at           = created_at
 WHERE id = 'f7cf30b4-23f6-44f3-b37a-1512465ef947';     -- Nutripedia Wellness Centre

ALTER TABLE public.facilities
  DROP CONSTRAINT IF EXISTS facilities_geocode_source_check;
ALTER TABLE public.facilities
  ADD CONSTRAINT facilities_geocode_source_check
  CHECK (geocode_source IS NULL
         OR geocode_source IN ('osm','google_places','manual','provider','partner'));

ALTER TABLE public.facilities
  DROP CONSTRAINT IF EXISTS facilities_geocode_tier_check;
ALTER TABLE public.facilities
  ADD CONSTRAINT facilities_geocode_tier_check
  CHECK (geocode_tier IS NULL OR geocode_tier BETWEEN 1 AND 3);

-- Both-or-neither. NULL-safe by construction: every branch is an explicit IS NULL /
-- IS NOT NULL test, so no comparison can evaluate to UNKNOWN and pass by default —
-- the failure mode 20260904's feed_precision_check was written to avoid.
ALTER TABLE public.facilities
  DROP CONSTRAINT IF EXISTS facilities_coords_both_or_neither;
ALTER TABLE public.facilities
  ADD CONSTRAINT facilities_coords_both_or_neither
  CHECK ((latitude IS NULL AND longitude IS NULL)
         OR (latitude IS NOT NULL AND longitude IS NOT NULL));

-- THE ONE THAT MATTERS. A coordinate without a recorded source cannot be written.
ALTER TABLE public.facilities
  DROP CONSTRAINT IF EXISTS facilities_coords_need_provenance;
ALTER TABLE public.facilities
  ADD CONSTRAINT facilities_coords_need_provenance
  CHECK (latitude IS NULL OR geocode_source IS NOT NULL);

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
VALUES ('20260919_facilities_geocode_provenance.sql', '291f52ee0b3f03dd8c25a4c260038366a682a895df8a7069045b7784822a587b')
ON CONFLICT (filename) DO UPDATE
  SET checksum = excluded.checksum, applied_at = now(), applied_by = current_user;
-- ─── ledger:stamp:end ────────────────────────────────────────────────
COMMIT;
RESET ROLE;

-- ADD COLUMN → PostgREST's schema cache must be refreshed, or the REST API reports
-- 42703 "column does not exist" for the new columns even though Postgres has them.
NOTIFY pgrst, 'reload schema';

-- ─── Verification (Role = postgres) ─────────────────────────────────────────
--   -- 1. all four columns exist:
--   SELECT column_name, data_type FROM information_schema.columns
--    WHERE table_schema='public' AND table_name='facilities'
--      AND column_name LIKE 'geocode%' ORDER BY column_name;   -- expect 4 rows
--
--   -- 2. the seven existing coordinates all carry provenance:
--   SELECT geocode_source, geocode_tier, count(*) FROM public.facilities
--    WHERE latitude IS NOT NULL GROUP BY 1,2;
--   -- expect: manual/3 → 6,  provider/NULL → 1
--
--   -- 3. THE CONSTRAINT ACTUALLY BITES — run it, it must ERROR:
--   BEGIN;
--     UPDATE public.facilities SET latitude = 35.2, longitude = 33.3
--      WHERE id = (SELECT id FROM public.facilities WHERE latitude IS NULL LIMIT 1);
--   -- expect: new row violates check constraint "facilities_coords_need_provenance"
--   ROLLBACK;
--   -- A constraint nobody has watched refuse something is a decoration. Watch it refuse.

-- ─── Rollback ───────────────────────────────────────────────────────────────
--   SET ROLE postgres; BEGIN;
--   ALTER TABLE public.facilities DROP CONSTRAINT IF EXISTS facilities_coords_need_provenance;
--   ALTER TABLE public.facilities DROP CONSTRAINT IF EXISTS facilities_coords_both_or_neither;
--   ALTER TABLE public.facilities DROP CONSTRAINT IF EXISTS facilities_geocode_tier_check;
--   ALTER TABLE public.facilities DROP CONSTRAINT IF EXISTS facilities_geocode_source_check;
--   ALTER TABLE public.facilities
--     DROP COLUMN IF EXISTS geocode_source, DROP COLUMN IF EXISTS geocode_tier,
--     DROP COLUMN IF EXISTS geocode_corroboration, DROP COLUMN IF EXISTS geocoded_at;
--   DELETE FROM public.schema_migrations_applied WHERE filename = '20260919_facilities_geocode_provenance.sql';
--   COMMIT; RESET ROLE;
--   NOTIFY pgrst, 'reload schema';
--   -- Dropping the columns discards which pins were verified and how. That information
--   -- cannot be reconstructed from the coordinates themselves.
