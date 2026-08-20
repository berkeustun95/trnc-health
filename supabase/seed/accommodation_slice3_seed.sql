-- ─── Accommodation Slice 3 — render seed ────────────────────────────────────
--
-- TEST DATA ONLY. Ten listings shaped like the real 101evler feed, so Slice 3's
-- screens can be built and reviewed before Slice 2's importer exists.
--
-- ⚠ THESE ROWS MUST NOT SURVIVE INTO SLICE 2's FIRST REAL IMPORT.
--   Every row is double-marked — source = 'seed-slice3' AND external_id LIKE
--   'SEED3-%' — so removal is one statement and cannot catch a real row:
--
--       DELETE FROM public.properties WHERE source = 'seed-slice3';
--       DELETE FROM public.estate_agencies WHERE name = 'SEED — Novest (test data)';
--
--   property_images has ON DELETE CASCADE, so the first line takes the images too.
--   The full teardown is at the foot of this file.
--
-- WHY source='seed-slice3' AND NOT 'novest': if these ever leaked past teardown, a
-- WHERE source='novest' query in Slice 2 would treat them as real partner rows and
-- the importer would try to reconcile them against the feed. A distinct source keeps
-- them visible to the app (the RLS partner branch only tests source IS NOT NULL) while
-- keeping them unmistakable to any code that names the real partner.
--
-- WHAT THIS DELIBERATELY EXERCISES — each row earns its place:
--   #1  floor = 0        THE proof case. 0 is falsy in JS; a truthiness guard hides
--                        ground-floor listings, and this is the shape of the real
--                        listing #554769 the schema was designed against.
--   #4  currency USD     was rejected by the DB before Slice 1; renders 'USD450,000'
--                        if the symbol map was not widened.
--   #5  currency TRY     makes the cross-currency price-sort incoherence VISIBLE.
--                        A ₺4.75m flat sorting above a £107k flat is not a bug in the
--                        sort, it is the reason price sort is offered per-intent only.
--   #7  yearly period    renders with NO suffix if priceDisplay was not extended.
--   #8  weekly period    same.
--   #9  district karpaz  was uninsertable before Slice 1 widened the CHECK.
--   #10 no images        exercises the placeholder path.
--   #6  no is_primary    exercises the sort_order fallback (Slice 2 sets primaries).
--   #2  deed_type set    the ONLY non-NULL deed_type — everything else is NULL, which
--                        is why the deed filter is omitted from Slice 3.
--   #3, #6 coordinates   set WITH location_precision='area', so the map must say
--                        "approximate". Every other row has NULL coords: no dead chip.
--
-- NULLs match where the real feed is actually empty: net_area_sqm (the source gives a
-- single area figure), deed_type (not a structured field), published_at (no date shown
-- anywhere on the source), and coordinates (exact location is withheld by the source).
--
-- EXECUTION: SQL editor, Role selector = postgres. Re-runnable — it deletes its own
-- rows first, so applying twice does not duplicate.

SET ROLE postgres;
BEGIN;

-- Idempotency: clear any previous run before inserting.
DELETE FROM public.properties       WHERE source = 'seed-slice3';
DELETE FROM public.estate_agencies  WHERE name   = 'SEED — Novest (test data)';

-- ─── Agency ─────────────────────────────────────────────────────────────────
-- status must be 'active' or agencies_select_public hides it from anon and the card
-- shows no agency name. owner_id is NOT NULL, so it borrows the admin account —
-- the same shortcut supabase/dummy_listing.sql takes.
--
-- contact_name / contact_phone / contact_whatsapp are DELIBERATELY LEFT NULL. That is
-- the true current state, and it is what the contact bar's empty state must handle:
-- the bar renders with the agency name and NO buttons. To preview the populated bar,
-- run the commented UPDATE at the foot of this file.
INSERT INTO public.estate_agencies (id, owner_id, name, status, description)
SELECT '00000000-0000-4000-9000-000000000001',
       p.id,
       'SEED — Novest (test data)',
       'active',
       'Seed agency for Slice 3 rendering. Delete before Slice 2 imports.'
FROM public.profiles p WHERE p.role = 'admin' ORDER BY p.id LIMIT 1;

-- Fail loudly rather than silently seeding orphan listings.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.estate_agencies WHERE name = 'SEED — Novest (test data)') THEN
    RAISE EXCEPTION 'No admin profile found — the seed agency could not be created.';
  END IF;
END $$;

-- ─── Listings ───────────────────────────────────────────────────────────────
-- agent_id is NULL and source is NOT NULL on every row: the partner-feed branch of
-- properties_source_agent_xor_check. location_precision='area' on every row, which
-- properties_feed_precision_check REQUIRES for any row carrying a source.
INSERT INTO public.properties (
  id, agent_id, agency_id, source, external_id, source_url, last_seen_at,
  title, description, intent, property_type, price, currency, price_period,
  bedrooms, living_rooms, bathrooms, ensuite_count,
  area_sqm, net_area_sqm, plot_sqm, covered_area_sqm,
  floor, total_floors, building_age_band,
  furnished, deposit, deposit_currency, min_term_months, bills_included,
  district, area, development_name, latitude, longitude, location_precision,
  deed_type, swap_available, gated_community, amenities,
  status, published_at
) VALUES
-- 1 ── THE FLOOR-ZERO PROOF CASE. Shaped on real listing #554769.
('00000000-0000-4000-9001-000000000001', NULL, '00000000-0000-4000-9000-000000000001',
 'seed-slice3', 'SEED3-554769', 'https://www.101evler.com/north-cyprus/property-for-sale/nicosia-gonyeli-flat-554769.html', now(),
 'Ground Floor 2+1 Apartment with Turkish Title Deed',
 'Ground floor apartment in Gönyeli with a private garden. Walking distance to shops and the main road. Turkish title deed. Suitable for families or as a rental investment.',
 'sale', 'apartment', 107500, 'GBP', 'total',
 2, 1, 1, NULL,
 90, NULL, NULL, NULL,
 0, 3, '6 - 10',
 NULL, NULL, NULL, NULL, NULL,
 'nicosia', 'gonyeli', NULL, NULL, NULL, 'area',
 NULL, 'Not Available', false, ARRAY['garden'],
 'active', NULL),

-- 2 ── the ONLY non-NULL deed_type; also the only plot_sqm
('00000000-0000-4000-9001-000000000002', NULL, '00000000-0000-4000-9000-000000000001',
 'seed-slice3', 'SEED3-002', NULL, now(),
 'Detached 3+1 Villa with Private Pool — Ozanköy',
 'Detached villa set on a 620 m² plot with private pool and mature garden. Mountain and sea views from the upper terrace. Turkish title deed, ready to transfer.',
 'sale', 'villa', 285000, 'GBP', 'total',
 3, 1, 2, 1,
 210, NULL, 620, 185,
 NULL, 2, '0 - 5',
 NULL, NULL, NULL, NULL, NULL,
 'kyrenia', 'ozankoy', 'Ozanköy Hillside', NULL, NULL, 'area',
 'turkish', 'Available', true, ARRAY['pool','garden','sea_view','mountain_view','parking'],
 'active', NULL),

-- 3 ── EUR + coordinates present, so the map must say "approximate"
('00000000-0000-4000-9001-000000000003', NULL, '00000000-0000-4000-9000-000000000001',
 'seed-slice3', 'SEED3-003', NULL, now(),
 '2+1 Apartment in Central Famagusta',
 'Second floor apartment close to the university and the old town. Communal parking, lift access. Currently tenanted.',
 'sale', 'apartment', 165000, 'EUR', 'total',
 2, 1, 1, NULL,
 105, NULL, NULL, NULL,
 2, 5, '11 - 15',
 NULL, NULL, NULL, NULL, NULL,
 'famagusta', 'merkez', NULL, 35.1250, 33.9450, 'area',
 NULL, 'Not Available', false, ARRAY['lift','parking','balcony'],
 'active', NULL),

-- 4 ── USD PROOF CASE. Renders 'USD450,000' if the symbol map was not widened.
('00000000-0000-4000-9001-000000000004', NULL, '00000000-0000-4000-9000-000000000001',
 'seed-slice3', 'SEED3-004', NULL, now(),
 'Sea View 4+1 Villa — Esentepe',
 'Four bedroom villa with panoramic sea views, infinity pool and double garage. Underfloor heating throughout.',
 'sale', 'villa', 450000, 'USD', 'total',
 4, 1, 3, 2,
 320, NULL, 900, 280,
 NULL, 2, '0 - 5',
 NULL, NULL, NULL, NULL, NULL,
 'kyrenia', 'esentepe', 'Esentepe Ridge', NULL, NULL, 'area',
 NULL, 'Not Available', true, ARRAY['pool','sea_view','garage','underfloor_heating','garden'],
 'active', NULL),

-- 5 ── TRY PROOF CASE. Makes cross-currency price sort visibly incoherent.
('00000000-0000-4000-9001-000000000005', NULL, '00000000-0000-4000-9000-000000000001',
 'seed-slice3', 'SEED3-005', NULL, now(),
 '1+1 Apartment in Nicosia Centre',
 'Compact one bedroom apartment in the city centre, close to Dereboyu. Ideal for a single professional or student.',
 'sale', 'apartment', 4750000, 'TRY', 'total',
 1, 1, 1, NULL,
 55, NULL, NULL, NULL,
 4, 6, '16 - 20',
 NULL, NULL, NULL, NULL, NULL,
 'nicosia', 'dereboyu', NULL, NULL, NULL, 'area',
 NULL, 'Not Available', false, ARRAY['lift','air_conditioning'],
 'active', NULL),

-- 6 ── RENT monthly, furnished, deposit; coordinates present; NO is_primary image
('00000000-0000-4000-9001-000000000006', NULL, '00000000-0000-4000-9000-000000000001',
 'seed-slice3', 'SEED3-006', NULL, now(),
 'Furnished 2+1 Apartment — Alsancak',
 'Fully furnished two bedroom apartment five minutes from the beach. White goods included. Long term tenants preferred.',
 'rent', 'apartment', 650, 'GBP', 'monthly',
 2, 1, 1, NULL,
 95, NULL, NULL, NULL,
 1, 4, '6 - 10',
 true, 1300, 'GBP', 12, 'Bills not included',
 'kyrenia', 'alsancak', NULL, 35.3410, 33.2180, 'area',
 NULL, NULL, false, ARRAY['furnished','pool','parking','balcony'],
 'active', NULL),

-- 7 ── YEARLY PERIOD PROOF CASE. No suffix at all if priceDisplay was not extended.
('00000000-0000-4000-9001-000000000007', NULL, '00000000-0000-4000-9000-000000000001',
 'seed-slice3', 'SEED3-007', NULL, now(),
 'Unfurnished 3+1 House — Küçük Kaymaklı',
 'Three bedroom house with a small garden, let on an annual contract as is standard for family lets in Nicosia.',
 'rent', 'house', 7500, 'GBP', 'yearly',
 3, 1, 2, NULL,
 140, NULL, 300, NULL,
 0, 2, '21+',
 false, 1250, 'GBP', 12, 'Water included, electricity separate',
 'nicosia', 'kucuk-kaymakli', NULL, NULL, NULL, 'area',
 NULL, NULL, false, ARRAY['garden','parking'],
 'active', NULL),

-- 8 ── WEEKLY PERIOD PROOF CASE, EUR
('00000000-0000-4000-9001-000000000008', NULL, '00000000-0000-4000-9000-000000000001',
 'seed-slice3', 'SEED3-008', NULL, now(),
 'Studio Apartment — Long Beach İskele',
 'Studio in a resort complex with shared pool and gym. Available on weekly terms outside the summer season.',
 'rent', 'studio', 400, 'EUR', 'weekly',
 NULL, 1, 1, NULL,
 42, NULL, NULL, NULL,
 7, 12, '0 - 5',
 true, 400, 'EUR', 1, 'All bills included',
 'iskele', 'long-beach', 'Long Beach Resort', NULL, NULL, 'area',
 NULL, NULL, true, ARRAY['furnished','pool','gym','sea_view','lift'],
 'active', NULL),

-- 9 ── KARPAZ. Uninsertable before Slice 1 widened the district CHECK. Short-term.
('00000000-0000-4000-9001-000000000009', NULL, '00000000-0000-4000-9000-000000000001',
 'seed-slice3', 'SEED3-009', NULL, now(),
 'Stone Cottage — Dipkarpaz',
 'Restored stone cottage on the Karpaz peninsula. Let nightly to visitors. Wood burner, terrace, no through traffic.',
 'short_term', 'house', 55, 'GBP', 'nightly',
 2, 1, 1, NULL,
 70, NULL, NULL, NULL,
 0, 1, '21+',
 true, NULL, NULL, NULL, 'All bills included',
 'karpaz', 'dipkarpaz', NULL, NULL, NULL, 'area',
 NULL, NULL, false, ARRAY['furnished','garden','fireplace'],
 'active', NULL),

-- 10 ── NO IMAGES. Exercises the card and gallery placeholder paths.
('00000000-0000-4000-9001-000000000010', NULL, '00000000-0000-4000-9000-000000000001',
 'seed-slice3', 'SEED3-010', NULL, now(),
 'Land Plot with Sea View — Lefke',
 'Building plot with an approved layout and sea views. Services at the boundary. No photographs supplied by the vendor.',
 'sale', 'land', 62000, 'GBP', 'total',
 NULL, NULL, NULL, NULL,
 NULL, NULL, 1150, NULL,
 NULL, NULL, NULL,
 NULL, NULL, NULL, NULL, NULL,
 'lefke', 'merkez', NULL, NULL, NULL, 'area',
 NULL, 'Available', false, NULL,
 'active', NULL);

-- ─── Images ─────────────────────────────────────────────────────────────────
-- Unsplash URLs, matching the convention supabase/dummy_listing.sql already uses for
-- test data. Property #10 gets none (placeholder path) and #6 gets none flagged
-- is_primary (sort_order fallback path).
INSERT INTO public.property_images (property_id, url, sort_order, is_primary) VALUES
 ('00000000-0000-4000-9001-000000000001','https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?w=1200&q=80',0,true),
 ('00000000-0000-4000-9001-000000000001','https://images.unsplash.com/photo-1493809842364-78817add7ffb?w=1200&q=80',1,false),
 ('00000000-0000-4000-9001-000000000001','https://images.unsplash.com/photo-1484154218962-a197022b5858?w=1200&q=80',2,false),
 -- is_primary on a LATER sort_order, so the card proves it prefers primary over order
 ('00000000-0000-4000-9001-000000000002','https://images.unsplash.com/photo-1600585154340-be6161a56a0c?w=1200&q=80',0,false),
 ('00000000-0000-4000-9001-000000000002','https://images.unsplash.com/photo-1512917774080-9991f1c4c750?w=1200&q=80',1,true),
 ('00000000-0000-4000-9001-000000000002','https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?w=1200&q=80',2,false),
 ('00000000-0000-4000-9001-000000000003','https://images.unsplash.com/photo-1502005229762-cf1b2da7c5d6?w=1200&q=80',0,true),
 ('00000000-0000-4000-9001-000000000004','https://images.unsplash.com/photo-1613977257363-707ba9348227?w=1200&q=80',0,true),
 ('00000000-0000-4000-9001-000000000004','https://images.unsplash.com/photo-1580587771525-78b9dba3b914?w=1200&q=80',1,false),
 ('00000000-0000-4000-9001-000000000005','https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?w=1200&q=80',0,true),
 -- #6: NO is_primary anywhere -> the card must fall back to sort_order = 0
 ('00000000-0000-4000-9001-000000000006','https://images.unsplash.com/photo-1560185007-cde436f6a4d0?w=1200&q=80',0,false),
 ('00000000-0000-4000-9001-000000000006','https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?w=1200&q=80',1,false),
 ('00000000-0000-4000-9001-000000000007','https://images.unsplash.com/photo-1568605114967-8130f3a36994?w=1200&q=80',0,true),
 ('00000000-0000-4000-9001-000000000008','https://images.unsplash.com/photo-1554995207-c18c203602cb?w=1200&q=80',0,true),
 ('00000000-0000-4000-9001-000000000009','https://images.unsplash.com/photo-1449844908441-8829872d2607?w=1200&q=80',0,true);
 -- #10 deliberately has none.

COMMIT;
RESET ROLE;

NOTIFY pgrst, 'reload schema';

-- ─── Verification ───────────────────────────────────────────────────────────
--   SELECT intent, currency, price_period, count(*) FROM public.properties
--   WHERE source='seed-slice3' GROUP BY 1,2,3 ORDER BY 1,2;
--   -- expect 10 rows total: 6 sale, 3 rent, 1 short_term
--
--   -- The seeded rows must be visible to a LOGGED-OUT user, or the screens show
--   -- nothing. This is the partner branch of props_select_public doing its job.
--   SET LOCAL ROLE anon;
--   SELECT count(*) FROM public.properties WHERE source='seed-slice3';  -- expect 10
--   RESET ROLE;

-- ─── Preview the POPULATED contact bar (optional) ────────────────────────────
-- Leave these NULL to review the real empty state first.
--   UPDATE public.estate_agencies
--      SET contact_name = 'Hüseyin Kambur',
--          contact_phone = '+90 533 832 62 47',
--          contact_whatsapp = '+90 533 832 62 47'
--    WHERE name = 'SEED — Novest (test data)';

-- ─── TEARDOWN — run this before Slice 2's first import ──────────────────────
--   SET ROLE postgres;
--   DELETE FROM public.properties      WHERE source = 'seed-slice3';   -- cascades to images
--   DELETE FROM public.estate_agencies WHERE name   = 'SEED — Novest (test data)';
--   RESET ROLE;
--   -- confirm: SELECT count(*) FROM public.properties WHERE source='seed-slice3';  -- 0
