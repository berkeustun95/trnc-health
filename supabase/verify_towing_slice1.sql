-- ─── Slice 1 verification — 20260905_towing_companies.sql ────────────────────
--
-- Run AFTER applying the migration. SQL editor, Role selector = postgres.
--
-- ▶ HOW TO RUN: the SQL editor shows only the LAST result set, so run the blocks
--   ONE AT A TIME — select from a `═══ BLOCK Vn ═══` banner down to the next banner.
--
-- NOTHING IS PERSISTED. Every block is BEGIN … ROLLBACK, fixtures included.
-- Blocks V3, V4, V5 and V6 are EXPECTED TO ERROR — the error IS the pass. If one of
-- them SUCCEEDS, the constraint it targets is missing and the paste was truncated.
--
-- BLOCK V9 CANNOT BE DONE IN SQL. It is the bucket's end-to-end upload + public-fetch
-- proof, and it is the one that actually matters: the security audit found the
-- provider-documents and estate-agent-documents buckets had never worked since launch
-- because everyone treated "the bucket exists" as evidence that writing to it works.
-- It is not. Do V9.


-- ═══ BLOCK V1 / 9 — SCHEMA SHAPE — run alone ═══════════════════════════════
-- Expect: EVERY row status = 'OK'.
BEGIN;
SELECT 'column' AS kind, e.o AS object,
       CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns ic
              WHERE ic.table_schema='public' AND ic.table_name='towing_companies'
                AND ic.column_name=e.o) THEN 'OK' ELSE 'MISSING' END AS status
FROM (VALUES
  ('id'),('name'),('slug'),('logo_url'),('phone'),('whatsapp'),
  ('base_region'),('coverage_regions'),('vehicle_classes'),('services'),
  ('is_24_7'),('opening_hours'),('starting_price'),('price_updated_at'),
  ('is_featured'),('is_active'),('sort_order'),('created_at'),('updated_at')
) e(o)
UNION ALL
SELECT 'constraint', e.o,
       CASE WHEN EXISTS (SELECT 1 FROM pg_constraint WHERE conname=e.o) THEN 'OK' ELSE 'MISSING' END
FROM (VALUES
  ('towing_slug_check'),('towing_base_region_check'),('towing_coverage_regions_check'),
  ('towing_base_in_coverage_check'),('towing_vehicle_classes_check'),
  ('towing_services_check'),('towing_starting_price_check'),('towing_opening_hours_check'),
  ('towing_companies_slug_key'),('towing_companies_pkey')
) e(o)
UNION ALL
SELECT 'function', e.o,
       CASE WHEN EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
              WHERE n.nspname='public' AND p.proname=e.o) THEN 'OK' ELSE 'MISSING' END
FROM (VALUES ('towing_hours_valid'),('towing_touch_updated_at')) e(o)
UNION ALL
SELECT 'trigger', 'towing_touch_updated_at',
       CASE WHEN EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='towing_touch_updated_at'
              AND tgrelid='public.towing_companies'::regclass) THEN 'OK' ELSE 'MISSING' END
UNION ALL
SELECT 'index', 'idx_towing_companies_coverage',
       CASE WHEN to_regclass('public.idx_towing_companies_coverage') IS NOT NULL THEN 'OK' ELSE 'MISSING' END
UNION ALL
SELECT 'rls-enabled', 'towing_companies',
       CASE WHEN (SELECT relrowsecurity FROM pg_class WHERE oid='public.towing_companies'::regclass)
            THEN 'OK' ELSE 'OFF ← FIX' END
UNION ALL
SELECT 'policy', e.o,
       CASE WHEN EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
              AND tablename='towing_companies' AND policyname=e.o) THEN 'OK' ELSE 'MISSING' END
FROM (VALUES
  ('towing_select_public'),('towing_select_admin_all'),('towing_insert_admin'),('towing_update_admin'),('towing_delete_admin'),
  ('no_anon_insert_towing_companies'),('no_anon_update_towing_companies'),('no_anon_delete_towing_companies')
) e(o)
UNION ALL
SELECT 'storage-policy', e.o,
       CASE WHEN EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage'
              AND tablename='objects' AND policyname=e.o) THEN 'OK' ELSE 'MISSING' END
FROM (VALUES
  ('towing_logos_public_read'),('towing_logos_admin_insert'),
  ('towing_logos_admin_update'),('towing_logos_admin_delete')
) e(o)
UNION ALL
SELECT 'bucket', 'towing-logos',
       CASE WHEN EXISTS (SELECT 1 FROM storage.buckets WHERE id='towing-logos' AND public)
            THEN 'OK' ELSE 'MISSING or NOT PUBLIC' END
ORDER BY 3 DESC, 1, 2;   -- anything not OK floats to the top
ROLLBACK;


-- ═══ BLOCK V2 / 9 — A VALID ROW INSERTS — run alone ════════════════════════
-- Expect: 1 row, all checks 'OK'. Proves the constraint set does not reject good data.
--
-- ⚠ `defaults_inactive` IS NOT A TYPO AND IS NOT INVERTED BY MISTAKE. Before
-- 20260907_towing_is_active_default_false.sql this block asserted the OPPOSITE
-- (`defaults_active`), because is_active used to DEFAULT true like every other such
-- flag in the schema. That default was deliberately inverted: search_content indexes
-- any active row and does NOT respect MODULE_FLAGS, so a row that publishes itself on
-- omission is publicly searchable before the module launches. An INSERT that omits
-- is_active MUST now land invisible. Do not "restore" this assertion.
BEGIN;
INSERT INTO public.towing_companies
  (name, slug, phone, base_region, coverage_regions, vehicle_classes, services, is_24_7, opening_hours)
VALUES
  ('V2 Fixture','v2-fixture','+90 000','kyrenia',ARRAY['kyrenia','nicosia'],ARRAY['car','heavy'],
   ARRAY['towing','recovery','machinery_transport'], false,
   '{"mon":{"open":"08:00","close":"18:00"},"sat":{"open":"20:00","close":"04:00"},"sun":null}'::jsonb);

SELECT
  CASE WHEN count(*)=1                          THEN 'OK' ELSE 'FAIL' END AS inserted,
  CASE WHEN bool_and(NOT is_active)             THEN 'OK' ELSE 'FAIL ← omitted is_active published the row' END AS defaults_inactive,
  CASE WHEN bool_and(NOT is_featured)           THEN 'OK' ELSE 'FAIL' END AS defaults_unfeatured,
  CASE WHEN bool_and(sort_order = 0)            THEN 'OK' ELSE 'FAIL' END AS defaults_sort_zero,
  CASE WHEN bool_and(updated_at IS NOT NULL)    THEN 'OK' ELSE 'FAIL' END AS touch_set_updated,
  CASE WHEN bool_and(price_updated_at IS NULL)  THEN 'OK' ELSE 'FAIL' END AS no_price_no_stamp
FROM public.towing_companies WHERE slug='v2-fixture';
ROLLBACK;


-- ═══ BLOCK V3 / 9 — BAD REGION KEYS MUST FAIL — run alone ══════════════════
-- EXPECTED TO ERROR (towing_base_region_check). Region keys must match
-- constants/regions.js exactly — 'girne' is the Turkish label, not the canonical key.
BEGIN;
INSERT INTO public.towing_companies
  (name, slug, phone, base_region, coverage_regions, vehicle_classes)
VALUES ('V3','v3','+90 000','girne',ARRAY['girne'],ARRAY['car']);
ROLLBACK;


-- ═══ BLOCK V4 / 9 — BASE REGION OUTSIDE COVERAGE MUST FAIL — run alone ═════
-- EXPECTED TO ERROR (towing_base_in_coverage_check). A firm based in Lefkoşa that
-- does not cover Lefkoşa would be invisible in its own region.
BEGIN;
INSERT INTO public.towing_companies
  (name, slug, phone, base_region, coverage_regions, vehicle_classes)
VALUES ('V4','v4','+90 000','nicosia',ARRAY['kyrenia'],ARRAY['car']);
ROLLBACK;


-- ═══ BLOCK V5 / 9 — NON-EMPTY GUARDS USE cardinality() — run alone ═════════
--
-- THIS BLOCK DOES NOT ERROR. It inspects the constraint definitions instead, and the
-- reason is worth reading before "fixing" it back into an INSERT test.
--
-- The empty-coverage case is NOT BEHAVIOURALLY PROVABLE in isolation. base_region is
-- NOT NULL and towing_base_in_coverage_check requires base_region ∈ coverage_regions,
-- so an empty coverage_regions ALWAYS violates that check too — and Postgres reports
-- whichever constraint it evaluates first, with no ordering guarantee. An INSERT test
-- here would error either way and prove nothing about the guard it claims to target.
-- (Found the hard way: the first version of this block "passed" against a
-- towing_coverage_regions_check that was a silent no-op.)
--
-- What actually needs proving is that neither guard uses array_length: for an empty
-- array array_length(...,1) returns NULL, and a CHECK ACCEPTS a NULL result, so the
-- array_length form lets empty arrays straight through. cardinality() returns 0.
-- V5b proves the identical guard behaves live on vehicle_classes, where base_region
-- does not interfere.
--
-- Expect: both rows 'OK'.
BEGIN;
SELECT e.o AS constraint_name,
       CASE
         WHEN d IS NULL                     THEN 'MISSING'
         WHEN d ILIKE '%array_length%'      THEN 'FAIL ← array_length is a no-op on empty arrays'
         WHEN d ILIKE '%cardinality%'       THEN 'OK'
         ELSE 'FAIL ← no non-empty guard at all'
       END AS status,
       d AS definition
FROM (VALUES ('towing_coverage_regions_check'),('towing_vehicle_classes_check')) e(o)
LEFT JOIN LATERAL (
  SELECT pg_get_constraintdef(oid) AS d FROM pg_constraint WHERE conname = e.o
) x ON true
ORDER BY status DESC;
ROLLBACK;

-- ═══ BLOCK V5b — EMPTY vehicle_classes MUST FAIL — run alone ═══════════════
-- EXPECTED TO ERROR (towing_vehicle_classes_check). This is the LIVE behavioural proof
-- of the cardinality() guard that V5 can only inspect statically: vehicle_classes has
-- no companion constraint to interfere, so an empty array can violate exactly one
-- check and the error names it unambiguously.
BEGIN;
INSERT INTO public.towing_companies
  (name, slug, phone, base_region, coverage_regions, vehicle_classes)
VALUES ('V5b','v5b','+90 000','nicosia',ARRAY['nicosia'],ARRAY[]::text[]);
ROLLBACK;


-- ═══ BLOCK V6 / 9 — DOMAIN VIOLATIONS MUST FAIL — run alone ════════════════
-- EXPECTED TO ERROR (towing_vehicle_classes_check). 'motorcycle' is NOT a third
-- vehicle class — motorcycles are covered by 'car'. This is the constraint that
-- keeps that product decision from being quietly undone by a seed.
BEGIN;
INSERT INTO public.towing_companies
  (name, slug, phone, base_region, coverage_regions, vehicle_classes)
VALUES ('V6','v6','+90 000','nicosia',ARRAY['nicosia'],ARRAY['car','motorcycle']);
ROLLBACK;

-- ═══ BLOCK V6b — MALFORMED opening_hours MUST FAIL — run alone ═════════════
-- EXPECTED TO ERROR (towing_opening_hours_check). '8:00' is not zero-padded and
-- 'monday' is not the pinned key. Run V6c after it.
BEGIN;
INSERT INTO public.towing_companies
  (name, slug, phone, base_region, coverage_regions, vehicle_classes, opening_hours)
VALUES ('V6b','v6b','+90 000','nicosia',ARRAY['nicosia'],ARRAY['car'],
        '{"monday":{"open":"8:00","close":"18:00"}}'::jsonb);
ROLLBACK;

-- ═══ BLOCK V6c — MALFORMED slug MUST FAIL — run alone ══════════════════════
-- EXPECTED TO ERROR (towing_slug_check).
BEGIN;
INSERT INTO public.towing_companies
  (name, slug, phone, base_region, coverage_regions, vehicle_classes)
VALUES ('V6c','Ada Kurtarma','+90 000','nicosia',ARRAY['nicosia'],ARRAY['car']);
ROLLBACK;


-- ═══ BLOCK V7 / 9 — price_updated_at TRIGGER — run alone ═══════════════════
-- Expect: all four columns 'OK'.
--
-- WHY THE FIXTURE CARRIES AN EXPLICIT 2020 STAMP: now() in Postgres is
-- transaction_timestamp() — it is FIXED for the whole transaction. This block runs
-- inside one BEGIN…ROLLBACK, so a trigger that correctly re-stamps on change writes
-- the SAME value it wrote on insert, and a naive `price_updated_at > p0` assertion
-- fails against a working trigger. Seeding the row with 2020-01-01 (which the
-- trigger's INSERT branch preserves via COALESCE) gives the two states something to
-- actually differ by.
--
--   stamped_on_insert   an explicit stamp survives INSERT (COALESCE branch)
--   held_on_rewrite     re-writing the SAME price does NOT move it — the point of the
--                       column: it answers "how old is this price", not "when was this
--                       row last touched" (that is updated_at's job)
--   moved_on_change     changing the price DOES move it, to this transaction's now()
--   autostamp_on_insert a row inserted with a price and NO explicit stamp still gets one
--
-- NOTE: these fixtures omit is_active, so since 20260907 they land INACTIVE. That does
-- not affect this block — it runs as postgres and asserts only on the price stamps — but
-- do not reuse these fixtures in a test that reads back through RLS as a normal user.
BEGIN;
INSERT INTO public.towing_companies
  (name, slug, phone, base_region, coverage_regions, vehicle_classes, starting_price, price_updated_at)
VALUES ('V7','v7','+90 000','nicosia',ARRAY['nicosia'],ARRAY['car'], 1500, '2020-01-01T00:00:00Z');

-- A second row with no explicit stamp, to prove the auto-stamp branch.
INSERT INTO public.towing_companies
  (name, slug, phone, base_region, coverage_regions, vehicle_classes, starting_price)
VALUES ('V7b','v7b','+90 000','nicosia',ARRAY['nicosia'],ARRAY['car'], 900);

CREATE TABLE public.v7_probe AS
  SELECT price_updated_at AS p0 FROM public.towing_companies WHERE slug='v7';

UPDATE public.towing_companies SET starting_price = 1500 WHERE slug='v7';   -- SAME price
CREATE TABLE public.v7_probe2 AS
  SELECT price_updated_at AS p1 FROM public.towing_companies WHERE slug='v7';

UPDATE public.towing_companies SET starting_price = 2000 WHERE slug='v7';   -- CHANGED

SELECT
  CASE WHEN (SELECT p0 FROM public.v7_probe) = '2020-01-01T00:00:00Z'::timestamptz
       THEN 'OK' ELSE 'FAIL' END AS stamped_on_insert,
  CASE WHEN (SELECT p1 FROM public.v7_probe2) = '2020-01-01T00:00:00Z'::timestamptz
       THEN 'OK' ELSE 'FAIL ← same-price rewrite moved the stamp' END AS held_on_rewrite,
  CASE WHEN (SELECT price_updated_at FROM public.towing_companies WHERE slug='v7') = now()
       THEN 'OK' ELSE 'FAIL ← price changed but the stamp did not move' END AS moved_on_change,
  CASE WHEN (SELECT price_updated_at FROM public.towing_companies WHERE slug='v7b') IS NOT NULL
       THEN 'OK' ELSE 'FAIL' END AS autostamp_on_insert;
ROLLBACK;


-- ═══ BLOCK V8 / 9 — RLS MATRIX — FOUR SEPARATE BLOCKS, run each alone ═════
--
-- NO SHARED PROBE TABLE. An earlier version accumulated results into
-- `public.v8_probe` and granted it to anon/authenticated; that throws 42P01 after
-- SET LOCAL ROLE under Supabase's default privileges on `public`. Each block below
-- therefore returns its own result directly.
--
-- ── V8a — a signed-out guest CAN read active firms, CANNOT read inactive ones ──
-- Expect: both columns 'OK'. This is the public-directory read path — a roadside user
-- is very often not signed in, so a FAIL here means the module is dead for guests.
BEGIN;
INSERT INTO public.towing_companies
  (name, slug, phone, base_region, coverage_regions, vehicle_classes, is_active)
VALUES ('V8 live','v8-live','+90 000','nicosia',ARRAY['nicosia'],ARRAY['car'], true),
       ('V8 dark','v8-dark','+90 000','nicosia',ARRAY['nicosia'],ARRAY['car'], false);
SET LOCAL ROLE anon;
SELECT
  CASE WHEN EXISTS (SELECT 1 FROM public.towing_companies WHERE slug='v8-live')
       THEN 'OK' ELSE 'FAIL ← public directory unreadable signed out' END AS anon_sees_active,
  CASE WHEN NOT EXISTS (SELECT 1 FROM public.towing_companies WHERE slug='v8-dark')
       THEN 'OK' ELSE 'FAIL ← inactive firm leaked to a guest' END AS anon_blind_inactive;
ROLLBACK;


-- ── V8b — a signed-out guest CANNOT insert ──
-- EXPECTED TO ERROR: 42501 new row violates row-level security policy. The error IS
-- the pass. Success here means anyone on the internet can add a towing firm.
BEGIN;
SET LOCAL ROLE anon;
INSERT INTO public.towing_companies
  (name, slug, phone, base_region, coverage_regions, vehicle_classes)
VALUES ('V8 anon','v8-anon','+90 000','nicosia',ARRAY['nicosia'],ARRAY['car']);
ROLLBACK;


-- ── V8c — a signed-in NON-admin customer CANNOT insert ──
-- EXPECTED TO ERROR: 42501. The error IS the pass.
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000c1","role":"authenticated"}';
INSERT INTO public.towing_companies
  (name, slug, phone, base_region, coverage_regions, vehicle_classes)
VALUES ('V8 cust','v8-cust','+90 000','nicosia',ARRAY['nicosia'],ARRAY['car']);
ROLLBACK;


-- ── V8d — a signed-in NON-admin customer CANNOT edit a firm ──
-- Expect: 'OK'. NOTE THIS ONE DOES NOT ERROR, and that is correct: no permissive
-- UPDATE policy matches a non-admin, so RLS filters the row out of the UPDATE's scope
-- and it silently affects ZERO rows rather than raising. A silent no-op is
-- indistinguishable from a successful edit unless you read the value back — so read it
-- back. The phone must still be the original.
BEGIN;
INSERT INTO public.towing_companies
  (name, slug, phone, base_region, coverage_regions, vehicle_classes, is_active)
VALUES ('V8 live','v8-live','+90 000','nicosia',ARRAY['nicosia'],ARRAY['car'], true);

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000c1","role":"authenticated"}';
UPDATE public.towing_companies SET phone='+90 666 HACKED' WHERE slug='v8-live';
RESET ROLE;

SELECT CASE WHEN phone = '+90 000'
            THEN 'OK'
            ELSE 'FAIL ← a customer edited a firm: ' || phone END AS customer_cannot_update
FROM public.towing_companies WHERE slug='v8-live';
ROLLBACK;


-- ═══ BLOCK V9 / 9 — BUCKET END-TO-END. NOT SQL. DO NOT SKIP. ═══════════════
--
-- V1 already proved the bucket row and its four policies exist. That is NOT proof
-- the bucket works — provider-documents and estate-agent-documents both existed,
-- both looked correct, and neither had ever accepted a single upload.
--
-- The proof is: a file goes IN, and a public URL brings it BACK.
--
--   1. Supabase dashboard → Storage → towing-logos → Upload file.
--      Upload any small PNG named  _healthcheck.png
--      (Dashboard upload runs as service_role, which bypasses RLS. That checks the
--       bucket accepts objects at all.)
--
--   2. Copy the public URL. It looks like:
--      https://<project>.supabase.co/storage/v1/object/public/towing-logos/_healthcheck.png
--
--   3. Fetch it SIGNED OUT:
--        curl -sSI '<public url>' | head -1
--      Expect  HTTP/2 200.  A 400/404 means the bucket is not actually public, or the
--      object never landed.
--
--      ⚠ WHAT THIS DOES *NOT* PROVE — measured 2026-08-23, not assumed.
--      For a bucket with public = true, Supabase Storage serves reads WITHOUT
--      evaluating RLS on storage.objects. Verified against this project: a request to
--      /object/towing-logos/_healthcheck.png with NO apikey and NO Authorization header
--      still returned 200 and the full bytes. So a green step 3 proves the bucket is
--      public and readable — it does NOT prove `towing_logos_public_read` is in force,
--      because nothing consults that policy on this path.
--      That policy is therefore belt-and-braces: it is what would keep reads working
--      if the bucket were ever flipped to private, and it costs nothing to keep. Do not
--      read a passing step 3 as evidence the policy works. The three ADMIN WRITE
--      policies are the ones doing real work here, and they are only exercised by an
--      upload from a non-service-role client (Slice 3's mirror pass runs as
--      service_role and bypasses them too).
--
--   4. Confirm bytes, not an error document:
--        curl -sS '<public url>' | file -
--      Expect  PNG image data.  If it says JSON/ASCII text, you fetched an error body
--      with a 200 wrapper — that is a FAIL.
--
--   5. Delete _healthcheck.png from the bucket.
--
-- Slice 1 is NOT done until step 4 returns PNG image data.
--
-- Listing of what SHOULD be there (eyeball cmd / roles / qual):
SELECT policyname, cmd, roles, qual, with_check
FROM pg_policies
WHERE schemaname='storage' AND tablename='objects' AND policyname LIKE 'towing_logos%'
ORDER BY policyname;
