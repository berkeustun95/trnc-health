-- ─── Verification — 20260914_public_health_coordinates.sql ───────────────────
--
-- Role = postgres. Run each block alone. Every block is BEGIN … ROLLBACK.
-- ⚠ NO BLOCK HERE IS EXPECTED TO ERROR. Every one expects 'OK'.
--
-- Coordinates are asserted BY ID and BY VALUE. Not "is it non-null" — a transposed pair
-- and a pin in the wrong town are both non-null, and both are what this is looking for.


-- ═══ BLOCK X1 / 4 — THE SIX PINS, BY ID, TO 6 dp — run alone ═══════════════
-- Expect: every row 'OK', and all_six_placed 'OK'.
BEGIN;
SELECT e.label,
       CASE WHEN round(f.latitude::numeric, 6)  = e.lat
             AND round(f.longitude::numeric, 6) = e.lng
            THEN 'OK'
            ELSE 'FAIL ← got '||coalesce(f.latitude::text,'∅')||', '||coalesce(f.longitude::text,'∅')
                 ||' expected '||e.lat||', '||e.lng END AS status
FROM (VALUES
  ('BNDH',          'e83f3d1d-c0c0-4e68-993c-03a8164286c1'::uuid, 35.207028::numeric, 33.331092::numeric),
  ('Barış Ruh',     '3d108354-79cd-4a11-8173-e7c996d4bcd0'::uuid, 35.206441,          33.331473),
  ('Acil Durum',    '56614fa9-d7ba-4528-9fe4-f372e9f9286a'::uuid, 35.206016,          33.334736),
  ('Girne Akçiçek', '7a1c598d-bc43-4b50-9f42-f94adffffe5d'::uuid, 35.337780,          33.325582),
  ('Gazimağusa',    'ed83578f-1866-4e54-9253-705feb093c22'::uuid, 35.155739,          33.903464),
  ('Cengiz Topel',  '32dafd70-73fb-4aec-afb2-6c940d07e9b9'::uuid, 35.157803,          32.868170)
) e(label, fid, lat, lng)
JOIN public.facilities f ON f.id = e.fid
ORDER BY (round(f.latitude::numeric,6) = e.lat AND round(f.longitude::numeric,6) = e.lng), e.label;

SELECT CASE WHEN count(*) = 6 THEN 'OK' ELSE 'FAIL ← only '||count(*)||' of 6 ids matched' END AS all_six_placed
FROM public.facilities
WHERE latitude IS NOT NULL
  AND id IN ('e83f3d1d-c0c0-4e68-993c-03a8164286c1','3d108354-79cd-4a11-8173-e7c996d4bcd0',
             '56614fa9-d7ba-4528-9fe4-f372e9f9286a','7a1c598d-bc43-4b50-9f42-f94adffffe5d',
             'ed83578f-1866-4e54-9253-705feb093c22','32dafd70-73fb-4aec-afb2-6c940d07e9b9');
ROLLBACK;


-- ═══ BLOCK X2 / 4 — NOT PLACED, AND STILL NOT PLACED — run alone ═══════════
-- Expect: all three 'OK'.
--
-- The absences matter as much as the pins. Each is deliberate and each would look like a
-- simple oversight to somebody tidying up later.
BEGIN;
SELECT
  -- The two BNDH units INHERIT their parent's pin. Giving them their own would put three
  -- markers on one roof, and any drift between them becomes a lie about where they are.
  CASE WHEN (SELECT count(*) FROM public.facilities
              WHERE id IN ('a1b2c3d4-0001-4000-8000-000000000001',
                           'a1b2c3d4-0001-4000-8000-000000000002')
                AND latitude IS NULL) = 2
       THEN 'OK' ELSE 'FAIL ← an attached unit was given its own pin; it inherits BNDH''s' END AS units_unplaced,
  -- Still draft, so still unplaced. Placed at go-live, not before.
  CASE WHEN (SELECT latitude FROM public.facilities
              WHERE id='a1b2c3d4-0001-4000-8000-000000000003') IS NULL
       THEN 'OK' ELSE 'FAIL ← Kronik Hastalıklar was placed while still draft' END AS kronik_unplaced,
  -- Retiring. A pin here is work that gets deleted with the row.
  CASE WHEN (SELECT latitude FROM public.facilities
              WHERE id='91338177-85d8-4f38-8b0f-2c395638d2d4') IS NULL
       THEN 'OK' ELSE 'FAIL ← the retiring Girne duplicate was placed' END AS duplicate_unplaced;
ROLLBACK;


-- ═══ BLOCK X3 / 4 — SANITY ON THE PINS THEMSELVES — run alone ══════════════
-- Expect: all four 'OK'.
BEGIN;
SELECT
  -- Inside TRNC's rough bounding box. Catches the classic transposition (lat/lng swapped),
  -- which is non-null, plausible-looking, and lands the hospital in the sea.
  CASE WHEN (SELECT count(*) FROM public.facilities
              WHERE sector='public' AND latitude IS NOT NULL
                AND (latitude NOT BETWEEN 35.0 AND 35.7 OR longitude NOT BETWEEN 32.6 AND 34.6)) = 0
       THEN 'OK' ELSE 'FAIL ← a public pin is outside TRNC — lat/lng transposed?' END AS inside_trnc,
  -- No two hospitals share a pin. Identical coordinates on two rows means one was
  -- copy-pasted, which is how a whole town's hospital ends up on top of another's.
  CASE WHEN (SELECT count(DISTINCT (latitude, longitude)) FROM public.facilities
              WHERE sector='public' AND latitude IS NOT NULL)
            = (SELECT count(*) FROM public.facilities
                WHERE sector='public' AND latitude IS NOT NULL)
       THEN 'OK' ELSE 'FAIL ← two public rows share the exact same pin' END AS pins_distinct,
  -- 6 dp exactly. Beyond that is false precision — the 7th dp is ~11 mm, and a hand-placed
  -- pin is not accurate to a centimetre. Storing it claims an accuracy nobody has.
  -- Tolerance, not equality. A genuine 7th decimal place differs from its 6-dp rounding
  -- by ~1e-7; float8->numeric round-trip noise is ~1e-14. A bare <> would fire on the
  -- noise and teach you to ignore this row — the cries-wolf failure.
  CASE WHEN (SELECT count(*) FROM public.facilities
              WHERE sector='public' AND latitude IS NOT NULL
                AND (abs(latitude::numeric  - round(latitude::numeric, 6))  > 1e-9
                  OR abs(longitude::numeric - round(longitude::numeric, 6)) > 1e-9)) = 0
       THEN 'OK' ELSE 'FAIL ← a pin carries more than 6 dp; that is noise presented as precision' END AS six_dp,
  -- The Ortaköy cluster is REAL and must survive. BNDH and Barış are 74 m apart; if this
  -- ever reads much larger, a pin drifted. If it reads 0, they were merged.
  CASE WHEN (SELECT round((6371000 * acos(LEAST(1.0,
                 cos(radians(a.latitude))*cos(radians(b.latitude))
                   *cos(radians(b.longitude)-radians(a.longitude))
               + sin(radians(a.latitude))*sin(radians(b.latitude)))))::numeric)
             FROM public.facilities a, public.facilities b
            WHERE a.id='e83f3d1d-c0c0-4e68-993c-03a8164286c1'
              AND b.id='3d108354-79cd-4a11-8173-e7c996d4bcd0') BETWEEN 50 AND 120
       THEN 'OK' ELSE 'FAIL ← BNDH/Barış separation is not ~74 m; a pin moved' END AS ortakoy_pair_intact;
ROLLBACK;


-- ═══ BLOCK X4 / 4 — HELD VALUES, AND NONE VERIFIED — run alone ═════════════
-- Expect: all FOUR assertion columns 'OK', then a report table below them.
-- (An earlier draft of this header said "three". It has four — the Akçiçek address hold
--  was added later and the count was not. Check the header against the columns.)
--
-- ⚠ A GREEN no_duplicate_phones NO LONGER MEANS MUCH. Two numbers are held pending a
-- dial, so nothing can collide with them — and the numbers that REMAIN published are
-- corroborated by Google, which is agreement between two SECONDARY sources, not
-- verification. NOTHING IN THIS MODULE HAS BEEN DIALLED YET. The report table at the
-- bottom of this block says so per row; read that, not the green.
BEGIN;
SELECT
  CASE WHEN (SELECT phone FROM public.facilities
              WHERE id='56614fa9-d7ba-4528-9fe4-f372e9f9286a') IS NULL
       THEN 'OK — held (own site says (0392) 612 0500)'
       ELSE 'REVIEW ← Acil Durum has a phone again; correct ONLY if dialled' END AS acil_durum_held,
  CASE WHEN (SELECT phone FROM public.facilities
              WHERE id='ed83578f-1866-4e54-9253-705feb093c22') IS NULL
       THEN 'OK — held (Google suggests +90 392 364 89 87; NOT written)'
       ELSE 'REVIEW ← Gazimağusa has a phone again; correct ONLY if dialled' END AS gazimagusa_held,
  -- Held for the same reason as the two phones: positive evidence against the value, not
  -- merely absence of support. 20260913 harvested 'Dr. Fazıl Küçük Blv.' from the retiring
  -- duplicate; Google says Mustafa Çağatay Caddesi. One rule across both columns.
  CASE WHEN (SELECT address FROM public.facilities
              WHERE id='7a1c598d-bc43-4b50-9f42-f94adffffe5d') IS NULL
       THEN 'OK — held (Google says Mustafa Çağatay Cd; ours came from the retiring duplicate)'
       ELSE 'REVIEW ← Akçiçek has an address again; correct ONLY if confirmed on the call' END AS akcicek_address_held,
  -- Still no two user-visible public rows sharing a number, format-insensitively.
  CASE WHEN (SELECT count(DISTINCT right(regexp_replace(phone,'\D','','g'),10))
               FROM public.facilities
              WHERE sector='public' AND phone IS NOT NULL
                AND status <> 'draft' AND hidden_at IS NULL)
            = (SELECT count(*) FROM public.facilities
                WHERE sector='public' AND phone IS NOT NULL
                  AND status <> 'draft' AND hidden_at IS NULL)
       THEN 'OK' ELSE 'FAIL ← two visible state facilities share a number' END AS no_duplicate_phones;

-- REPORT — what is still published, and on what basis.
SELECT name, phone, address,
       CASE WHEN phone IS NULL THEN 'held — awaiting dial'
            ELSE 'published, UNVERIFIED (Google agrees; nobody has dialled)' END AS basis
  FROM public.facilities
 WHERE sector='public' AND public_facility_type='hospital' AND status <> 'draft'
 ORDER BY (phone IS NULL) DESC, name;
ROLLBACK;
