-- ─── Public health — Slice 2.5b: six coordinates, one phone removed ──────────
--
-- DATA ONLY. Six hospital pins, placed BY HAND in Google Maps (entrance, not
-- centre-of-grounds) and each cross-checked against the Google Places coordinate for the
-- same facility. Divergences were examined rather than averaged away — the largest,
-- Gazimağusa at 121 m, is explained: Google's entry sits on the Cerrahi Servisi block
-- while the pin here is the main entrance. For a user being told where to go, the main
-- entrance is the right answer.
--
-- Truncated to 6 decimal places. Past that is noise — the 7th dp is ~11 mm.
--
-- ⚠ NOT PLACED, AND EACH FOR ITS OWN REASON:
--   Thalassaemia Merkezi + Radyasyon Onkoloji Merkezi — INHERIT BNDH's pin. They are
--     units inside that building (module note §14.6). Two more markers on one roof is
--     noise, not precision.
--   Kronik Hastalıklar Hastanesi — still draft. Place it at go-live, not before.
--   Girne Devlet Hastanesi (91338177) — retiring duplicate. A pin on a row scheduled for
--     deletion is work that gets thrown away.
--
-- ─── THE REGION AUDIT RAN. ALL SIX MATCH. ───────────────────────────────────
--
-- Every placed coordinate was passed through resolveRegion() and compared against the
-- `city` seeded in 20260912 §2 — the audit designed for exactly this moment, using the
-- classifier City Welcome already ships.
--
--   BNDH           nicosia   → nicosia    MATCH   (nearest anchor 0.4 km)
--   Barış Ruh      nicosia   → nicosia    MATCH   (0.4 km)
--   Acil Durum     nicosia   → nicosia    MATCH   (0.2 km)
--   Girne Akçiçek  kyrenia   → kyrenia    MATCH   (0.5 km)
--   Gazimağusa     famagusta → famagusta  MATCH   (0.1 km)
--   Cengiz Topel   lefke     → lefke      MATCH   (1.6 km)
--
-- ⚠ CENGİZ TOPEL WAS THE ONE EXPECTED TO FLAG, AND IT DID NOT — the classifier was
-- right and so was the seed. Its physical site is YEŞİLYURT: 1.6 km from the Yeşilyurt
-- anchor, 5.2 km from Lefke centre, and 12.2 km from Güzelyurt. So the ministry's
-- "Güzelyurt bölgesinde bulunan" describes the health region it SERVES, not where the
-- building stands. `city='lefke'` (where it is) and a Güzelyurt+Lefke CATCHMENT (who it
-- serves) are both correct and are different facts — which is the whole reason catchment
-- was recorded as a Slice 5 routing fact rather than forced into `city`. Independently
-- confirmed from two directions now. constants/regions.js needs no adjustment.
--
-- ─── GAZİMAĞUSA'S PHONE — REMOVED, AND WHY THE EARLIER DECISION FLIPPED ─────
--
-- 20260913 deliberately did NOT null this number, on the reasoning that a collision is a
-- CERTAIN defect while an odd prefix is merely UNVERIFIED, and that removing a
-- possibly-correct number on weak evidence is its own harm. That reasoning still holds.
-- What changed is the evidence, not the rule:
--
--   1. Prefix: we store 630 89 00. The 58 Famagusta pharmacies in our own seed use
--      365 / 366 / 378. 630 matches no observed local block.
--   2. Google publishes +90 392 364 89 87 for this hospital — 364 sits squarely in that
--      family, and it supplies a plausible REPLACEMENT rather than just doubt.
--
-- The same rule is applied to Girne Akçiçek's ADDRESS in §2b. Absence of support is a
-- reason to hold; positive evidence against is a reason to remove. One rule, both columns.
--
-- Two independent indicators now agree, and the second explains the first. That is no
-- longer weak evidence. Null it, dial, restore on confirmation — the Acil Durum treatment.
--
-- ⚠ GOOGLE'S NUMBER IS NOT WRITTEN. It is a lead, not a source. The dial is the
-- verification, exactly as it is for every other number in this module.
--
-- EXECUTION: Role = postgres. latitude/longitude and phone are not on
-- facilities_guard_update's deny-list, and auth.uid() IS NULL early-returns regardless.
-- No moderation column is touched, so guard_moderation_columns never fires.

SET ROLE postgres;

BEGIN;

-- ─── 1. The six coordinates ─────────────────────────────────────────────────
DO $$
DECLARE r record; n int;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('e83f3d1d-c0c0-4e68-993c-03a8164286c1'::uuid, 'BNDH',          35.207028, 33.331092),
      ('3d108354-79cd-4a11-8173-e7c996d4bcd0'::uuid, 'Barış Ruh',     35.206441, 33.331473),
      ('56614fa9-d7ba-4528-9fe4-f372e9f9286a'::uuid, 'Acil Durum',    35.206016, 33.334736),
      ('7a1c598d-bc43-4b50-9f42-f94adffffe5d'::uuid, 'Girne Akçiçek', 35.337780, 33.325582),
      ('ed83578f-1866-4e54-9253-705feb093c22'::uuid, 'Gazimağusa',    35.155739, 33.903464),
      ('32dafd70-73fb-4aec-afb2-6c940d07e9b9'::uuid, 'Cengiz Topel',  35.157803, 32.868170)
    ) AS t(fid, label, lat, lng)
  LOOP
    SELECT count(*) INTO n FROM public.facilities WHERE id = r.fid;
    IF n <> 1 THEN
      RAISE EXCEPTION 'coordinates: expected exactly 1 facility with id % (%), found %', r.fid, r.label, n;
    END IF;
    UPDATE public.facilities SET latitude = r.lat, longitude = r.lng WHERE id = r.fid;
  END LOOP;

  -- Every placed pin must be inside the TRNC outline's rough bounds. Not a substitute for
  -- the resolveRegion audit above — a cheap catch for the classic transposition, writing
  -- longitude into latitude, which would silently drop a hospital into the Mediterranean
  -- and render a pin nobody looks twice at.
  SELECT count(*) INTO n FROM public.facilities
   WHERE sector = 'public' AND latitude IS NOT NULL
     AND (latitude NOT BETWEEN 35.0 AND 35.7 OR longitude NOT BETWEEN 32.6 AND 34.6);
  IF n > 0 THEN
    RAISE EXCEPTION 'coordinates: % public row(s) outside TRNC bounds — lat/lng transposed?', n;
  END IF;
END $$;

-- ─── 2. Gazimağusa's phone — REMOVED pending the dial ───────────────────────
-- See the header. Google's +90 392 364 89 87 is a LEAD and is deliberately not written.
UPDATE public.facilities
   SET phone = NULL
 WHERE id = 'ed83578f-1866-4e54-9253-705feb093c22';

-- ─── 2b. Girne Akçiçek's address — REMOVED, and this one is mine to own ─────
--
-- 20260913 §1 wrote 'Dr. Fazıl Küçük Blv., Girne' onto this row by HARVESTING it from the
-- retiring duplicate — on the reasoning that it was the only real street address in the
-- set and a merge would destroy it silently. Google gives a different street entirely:
-- Mustafa Çağatay Caddesi. Both are real Girne roads.
--
-- So either the hospital sits on a corner, or the duplicate's hand-entered address was
-- wrong and THE HARVEST CARRIED THAT ERROR ONTO THE CANONICAL ROW. The harvest was my
-- suggestion; if it is the latter, this migration is undoing damage I introduced.
--
-- WHY NULL AND NOT HOLD. Holding was right while the only problem was absence of support.
-- It is not right now that there is positive evidence AGAINST the value. A wrong street on
-- a live row is the address version of a wrong phone number — and this module has already
-- settled how it treats those. ONE RULE ACROSS BOTH COLUMNS, not one standard for phones
-- and a softer one for addresses.
--
-- The coordinate placed in §1 is the authoritative locator, so nothing a user needs is
-- lost: the profile still navigates. The address is presentational, and "what is your
-- street address?" is already on the call script.
UPDATE public.facilities
   SET address = NULL
 WHERE id = '7a1c598d-bc43-4b50-9f42-f94adffffe5d';

-- ─── 3. Report ──────────────────────────────────────────────────────────────
DO $$
DECLARE n_coord int; n_phone int;
BEGIN
  SELECT count(*) FILTER (WHERE latitude IS NOT NULL),
         count(*) FILTER (WHERE phone IS NOT NULL)
    INTO n_coord, n_phone
    FROM public.facilities
   WHERE sector = 'public' AND public_facility_type = 'hospital' AND status <> 'draft';
  RAISE NOTICE 'slice 2.5b: % of the live state hospitals now have coordinates; % still publish a phone (all UNVERIFIED — call-list pending).', n_coord, n_phone;
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
VALUES ('20260914_public_health_coordinates.sql', '4720cb19fc79708c11e793b8eee4e149569abe64155a17baffdbdbd42b7dbc46')
ON CONFLICT (filename) DO UPDATE
  SET checksum = excluded.checksum, applied_at = now(), applied_by = current_user;
-- ─── ledger:stamp:end ────────────────────────────────────────────────
COMMIT;

RESET ROLE;

-- ─── Verification ───────────────────────────────────────────────────────────
-- supabase/verify_public_health_coordinates.sql. Coordinates asserted BY ID, to 6 dp.

-- ─── Rollback ───────────────────────────────────────────────────────────────
--   SET ROLE postgres; BEGIN;
--   UPDATE public.facilities SET latitude=NULL, longitude=NULL
--    WHERE id IN ('e83f3d1d-c0c0-4e68-993c-03a8164286c1','3d108354-79cd-4a11-8173-e7c996d4bcd0',
--                 '56614fa9-d7ba-4528-9fe4-f372e9f9286a','7a1c598d-bc43-4b50-9f42-f94adffffe5d',
--                 'ed83578f-1866-4e54-9253-705feb093c22','32dafd70-73fb-4aec-afb2-6c940d07e9b9');
--   UPDATE public.facilities SET phone='(0392) 630 89 00' WHERE id='ed83578f-1866-4e54-9253-705feb093c22';
--   UPDATE public.facilities SET address='Dr. Fazıl Küçük Blv., Girne' WHERE id='7a1c598d-bc43-4b50-9f42-f94adffffe5d';
--   COMMIT; RESET ROLE;
--   -- Restoring either re-publishes a value that positive evidence contradicts.
