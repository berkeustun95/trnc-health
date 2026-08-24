-- ─── Verification — 20260911_facilities_public_health.sql ────────────────────
--
-- Run AFTER applying the migration. SQL editor, Role selector = postgres.
--
-- ▶ HOW TO RUN: the SQL editor shows only the LAST result set, so run the blocks
--   ONE AT A TIME — select from a `═══ BLOCK Vn ═══` banner down to the next banner.
--
-- NOTHING IS PERSISTED. Every block is BEGIN … ROLLBACK, fixtures included.
--
-- BLOCKS V2e, V4, V4b, V4c, V4d, V7 AND V7b ARE EXPECTED TO ERROR — THE ERROR IS THE PASS.
-- SEVEN BLOCKS, and V5b is NOT one of them (it expects 'OK'). In a file whose whole
-- contract is "the error is the pass", a block listed in the wrong column is worse than
-- no list at all — it teaches the operator to read a success as a failure. Check this
-- line against the block headers if you ever edit either.
--
-- ⚠ ON V7, POSTGRES ATTACHES NO MISLEADING HINT — but on V4c it may suggest widening
-- a CHECK. Do not. The refusal is the design.
--
-- BLOCK V0 IS A LIVE-DB PRE-FLIGHT, not a check — it asserts nothing and answers the
-- two questions the repo cannot. Run it FIRST.
--
-- BLOCKS V2b-V2e CHECK THE SEVEN LIVE STATE HOSPITALS that BLOCK V0 discovered and that
-- migration section 6b corrects: V2b values row-by-row, V2c that 'unknown' has not
-- spread, V2d/V2e that all seven are now unclaimable. V2d is the present-tense one —
-- before this migration those seven were claimable in production.
--
-- BLOCK V8 CANNOT BE DONE IN SQL. Everything above it proves the database is correct.
-- None of it proves the app still renders. Do V8.


-- ═══ BLOCK V0 — LIVE PRE-FLIGHT (not a check) — run alone, run FIRST ══════
-- Nothing here asserts; it tells you what you are about to change. Three questions
-- the repo cannot answer:
--
--   1. Did any state facility get hand-entered through AdminScreen before this slice?
--      ✅ ANSWERED 2026-08-24, AND THE ANSWER WAS YES — SEVEN OF THEM, all status='active',
--      all provider_id NULL, all city NULL, none in any repo seed. That is why the
--      migration now carries section 6b. Re-run this query anyway: it is the check that
--      section 6b's DO block is about to match, and if an eighth has appeared since, the
--      DO block will RAISE rather than silently skip it.
--   2. Which SELECT policies are actually live?
--      ✅ ANSWERED 2026-08-24: THREE permissive SELECT policies, not two —
--        `facilities_select_public`   (0718 shape: status IN (active,trial) AND is_public)
--        `public read live facilities` (0820 shape: hidden_at IS NULL AND status IN (...))
--        `owner reads own facility`
--      plus both admin ALL policies. 20260820 did NOT drop the 0718-shape policy; they OR
--      together. `draft` is excluded by ALL of them, so the design holds — and the fact
--      that the 0820 shape has no `is_public` term is what makes `is_public` decorative
--      rather than load-bearing on this table.
--   3. Is anything already sitting on a status this migration does not expect?
--
-- ⚠⚠ SELECT * — DO NOT NARROW THIS. The first version of this block listed
-- `id, name, type, city, provider_id` and Slice 2 then held every hospital phone on the
-- belief the column was empty. ALL SEVEN ALREADY HAD phone AND address, hand-entered.
-- THE COLUMNS ASSUMED EMPTY WERE THE COLUMNS NOT LOOKED AT. A pre-flight that asks only
-- about the columns you already have questions about merely confirms your assumptions.
BEGIN;
SELECT type, status, count(*) FROM public.facilities GROUP BY 1,2 ORDER BY 3 DESC;
SELECT * FROM public.facilities WHERE type IN ('hospital','clinic') ORDER BY name;
SELECT policyname, permissive, roles, cmd, qual
  FROM pg_policies WHERE schemaname='public' AND tablename='facilities'
 ORDER BY cmd, policyname;
ROLLBACK;


-- ═══ BLOCK V1 / 8 — SCHEMA SHAPE — run alone ═══════════════════════════════
-- Expect: EVERY row status = 'OK'. Anything else floats to the top.
BEGIN;
WITH report AS (
SELECT 'column' AS kind, e.o AS object,
       CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns ic
              WHERE ic.table_schema='public' AND ic.table_name='facilities'
                AND ic.column_name=e.o) THEN 'OK' ELSE 'MISSING' END AS status
FROM (VALUES ('sector'),('public_facility_type'),('tier'),
             ('parent_facility_id'),('name_official')) e(o)
UNION ALL
-- `name` must SURVIVE. The brief asked for name_official + name_common; we kept `name`
-- as the common name instead, so a `name_common` appearing here means somebody added
-- the second display column after all — and two display names always drift apart.
SELECT 'column-ABSENT-by-design', 'facilities.name_common',
       CASE WHEN NOT EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema='public' AND table_name='facilities' AND column_name='name_common')
            THEN 'OK' ELSE 'FAIL ← second display name added; name/name_common will drift' END
UNION ALL
SELECT 'column', 'facilities.name (must still exist)',
       CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema='public' AND table_name='facilities' AND column_name='name')
            THEN 'OK' ELSE 'FAIL ← name was RENAMED; ~40 client sites now read undefined' END
UNION ALL
SELECT 'constraint', e.o,
       CASE WHEN EXISTS (SELECT 1 FROM pg_constraint WHERE conname=e.o) THEN 'OK' ELSE 'MISSING' END
FROM (VALUES ('facilities_sector_check'),('facilities_public_facility_type_check'),
             ('facilities_public_type_sector_check'),('facilities_tier_check'),
             ('facilities_public_tier_required_check'),('facilities_parent_not_self_check'),
             ('facilities_parent_facility_id_fkey'),('facilities_status_check')) e(o)
UNION ALL
SELECT 'index', 'idx_facilities_parent_facility_id',
       CASE WHEN to_regclass('public.idx_facilities_parent_facility_id') IS NOT NULL
            THEN 'OK' ELSE 'MISSING' END
UNION ALL
-- The three behaviour facts no existence check can see (same three as the H tokens).
SELECT 'behaviour', 'facilities_status_check allows draft',
       CASE WHEN EXISTS (SELECT 1 FROM pg_constraint WHERE conname='facilities_status_check'
              AND pg_get_constraintdef(oid) ILIKE '%draft%')
            THEN 'OK' ELSE 'FAIL ← seeding will be rejected row by row' END
UNION ALL
SELECT 'behaviour', 'claim guard refuses sector=public',
       CASE WHEN EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
              WHERE n.nspname='public' AND p.proname='claim_requests_guard_insert'
                AND pg_get_functiondef(p.oid) ILIKE '%public health facilities cannot be claimed%')
            THEN 'OK' ELSE 'FAIL ← a state hospital is claimable' END
UNION ALL
-- SECURITY DEFINER is load-bearing on that guard: as INVOKER the sector lookup returns
-- no row for a draft facility under the caller's RLS and the check passes vacuously.
SELECT 'behaviour', 'claim guard is SECURITY DEFINER',
       CASE WHEN EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
              WHERE n.nspname='public' AND p.proname='claim_requests_guard_insert' AND p.prosecdef)
            THEN 'OK' ELSE 'FAIL ← guard passes vacuously on draft rows' END
UNION ALL
SELECT 'behaviour', 'tier CHECK allows unknown',
       CASE WHEN EXISTS (SELECT 1 FROM pg_constraint WHERE conname='facilities_tier_check'
              AND pg_get_constraintdef(oid) ILIKE '%unknown%')
            THEN 'OK' ELSE 'FAIL ← Acil Durum cannot be stored' END
UNION ALL
-- The half-coupling must be GLOBAL. A row-scoped exemption was considered and REJECTED
-- (it would put a uuid in a CHECK). If a literal id ever appears in this constraint,
-- somebody re-introduced that idea.
SELECT 'behaviour', 'tier requirement is global, no per-row carve-out',
       CASE WHEN EXISTS (SELECT 1 FROM pg_constraint WHERE conname='facilities_public_tier_required_check'
              AND pg_get_constraintdef(oid) ILIKE '%tier IS NOT NULL%'
              AND pg_get_constraintdef(oid) NOT ILIKE '%id =%')
            THEN 'OK' ELSE 'FAIL ← the tier guarantee was relaxed or given a uuid carve-out' END
UNION ALL
SELECT 'behaviour', 'search_content matches name_official',
       CASE WHEN (SELECT pg_get_functiondef('public.search_content(text,double precision,double precision)'::regprocedure)
                    ILIKE '%f.name_official%')
            THEN 'OK' ELSE 'FAIL ← eponyms unsearchable' END
UNION ALL
-- The towing arm must have survived this rewrite. Basing the new body on 20260820
-- instead of 20260906 would delete it silently — the function would still exist, still
-- work, and simply stop returning tow firms.
SELECT 'behaviour', 'search_content still has the towing arm',
       CASE WHEN (SELECT pg_get_functiondef('public.search_content(text,double precision,double precision)'::regprocedure)
                    ILIKE '%towing_companies%')
            THEN 'OK' ELSE 'FAIL ← towing arm clobbered by this migration' END
UNION ALL
-- type CHECK must be UNCHANGED. If somebody "helpfully" added health_centre to it, the
-- HomeScreen chip row and MapScreen marker map both silently stop rendering those rows.
SELECT 'unchanged-by-design', 'facilities_type_check has no new values',
       CASE WHEN EXISTS (SELECT 1 FROM pg_constraint WHERE conname='facilities_type_check'
              AND pg_get_constraintdef(oid) ILIKE '%garage%'
              AND pg_get_constraintdef(oid) NOT ILIKE '%health_centre%')
            THEN 'OK' ELSE 'FAIL ← type CHECK was widened; client type maps are now blind' END
)
SELECT * FROM report ORDER BY (status = 'OK'), kind, object;
ROLLBACK;


-- ═══ BLOCK V2 / 8 — BACKFILL + THE SEVEN CORRECTIONS — run alone ══════════
-- Expect: all four columns 'OK'.
--
-- ⚠ THIS BLOCK WAS REWRITTEN after V0 found seven live state hospitals. It previously
-- asserted that EVERY pre-existing row is 'private', which section 6b now deliberately
-- makes false for seven of them. Left as it was, the designed outcome would read as a
-- FAIL — in the one file whose entire contract is that the operator can trust what the
-- header says. A verification file that has to be mentally overridden is worse than none.
BEGIN;
SELECT
  CASE WHEN count(*) FILTER (WHERE sector IS NULL) = 0
       THEN 'OK' ELSE 'FAIL ← '||count(*) FILTER (WHERE sector IS NULL)||' NULL sector rows' END AS no_nulls,
  CASE WHEN count(*) FILTER (WHERE sector NOT IN ('public','private')) = 0
       THEN 'OK' ELSE 'FAIL ← unexpected sector value present' END AS values_valid,
  -- EXACTLY seven public rows, and they are exactly the seven named in 6b. Not ">= 7":
  -- an eighth would mean something else got flipped and nobody noticed.
  CASE WHEN count(*) FILTER (WHERE sector = 'public') = 7
       THEN 'OK' ELSE 'FAIL ← expected 7 public rows, found '||count(*) FILTER (WHERE sector='public') END AS seven_public,
  CASE WHEN count(*) FILTER (WHERE sector = 'public' AND name IN (
         'Dr. Burhan Nalbantoğlu Devlet Hastanesi','Gazimağusa Devlet Hastanesi',
         'Girne Dr. Akçiçek Devlet Hastanesi','Girne Devlet Hastanesi',
         'Lefke Cengiz Topel Hastanesi','Barış Ruh ve Sinir Hastalıkları Hastanesi',
         'Acil Durum Hastanesi')) = 7
       THEN 'OK' ELSE 'FAIL ← the 7 public rows are not the 7 expected ones' END AS correct_seven
FROM public.facilities;
ROLLBACK;


-- ═══ BLOCK V2b — THE SEVEN, ROW BY ROW, BY ID — run alone ══════════════════
-- Expect: every row 'OK', and all_seven_matched 'OK'.
--
-- V2 counts; this one checks values. Seven rows with the wrong tiers still count as
-- seven, so counting alone would pass a tier typo straight through to the routing screen.
--
-- Keyed on ID, matching the migration. Two assertions here look like gaps and are not:
--   • Acil Durum's expected tier is 'unknown' — the honest placeholder. Anything else
--     there means somebody guessed a classification that no source states.
--   • The Girne DUPLICATE's expected status is 'draft'. It is hidden, not merged and not
--     deleted; Dr. Akçiçek is canonical and must still be 'active'. If the duplicate
--     reads 'active', two Girne hospitals are rendering in the directory again.
BEGIN;
SELECT e.label,
       CASE WHEN f.sector = 'public'
                 AND f.public_facility_type = 'hospital'
                 AND f.tier   = e.expected_tier
                 AND f.status = e.expected_status
            THEN 'OK'
            ELSE 'FAIL ← got sector='||coalesce(f.sector,'∅')
                 ||' type='||coalesce(f.public_facility_type,'∅')
                 ||' tier='||coalesce(f.tier,'∅')
                 ||' status='||coalesce(f.status,'∅')
                 ||', expected tier='||e.expected_tier||' status='||e.expected_status END AS status
FROM (VALUES
  ('56614fa9-d7ba-4528-9fe4-f372e9f9286a'::uuid, 'Acil Durum Hastanesi',        'unknown',   'active'),
  ('3d108354-79cd-4a11-8173-e7c996d4bcd0'::uuid, 'Barış Ruh ve Sinir',          'secondary', 'active'),
  ('e83f3d1d-c0c0-4e68-993c-03a8164286c1'::uuid, 'Dr. Burhan Nalbantoğlu',      'tertiary',  'active'),
  ('ed83578f-1866-4e54-9253-705feb093c22'::uuid, 'Gazimağusa Devlet',           'secondary', 'active'),
  ('91338177-85d8-4f38-8b0f-2c395638d2d4'::uuid, 'Girne Devlet (DUPLICATE)',    'secondary', 'draft'),
  ('7a1c598d-bc43-4b50-9f42-f94adffffe5d'::uuid, 'Girne Dr. Akçiçek (CANON)',   'secondary', 'active'),
  ('32dafd70-73fb-4aec-afb2-6c940d07e9b9'::uuid, 'Lefke Cengiz Topel',          'secondary', 'active')
) e(fid, label, expected_tier, expected_status)
JOIN public.facilities f ON f.id = e.fid
ORDER BY (f.sector='public' AND f.public_facility_type='hospital'
          AND f.tier = e.expected_tier AND f.status = e.expected_status), e.label;

-- Seven rows must come back. Fewer means an id did not match — which the 6b DO block
-- RAISES on, so fewer than seven here also means 6b never ran.
SELECT CASE WHEN count(*) = 7 THEN 'OK' ELSE 'FAIL ← only '||count(*)||' of 7 ids matched' END AS all_seven_matched
FROM public.facilities WHERE id IN (
  '56614fa9-d7ba-4528-9fe4-f372e9f9286a','3d108354-79cd-4a11-8173-e7c996d4bcd0',
  'e83f3d1d-c0c0-4e68-993c-03a8164286c1','ed83578f-1866-4e54-9253-705feb093c22',
  '91338177-85d8-4f38-8b0f-2c395638d2d4','7a1c598d-bc43-4b50-9f42-f94adffffe5d',
  '32dafd70-73fb-4aec-afb2-6c940d07e9b9');

-- The two private clinics must be UNTOUCHED by all of this.
SELECT CASE WHEN count(*) = 2 THEN 'OK'
            ELSE 'FAIL ← a private clinic was caught by the correction' END AS private_clinics_untouched
FROM public.facilities
WHERE sector = 'private' AND provider_id IS NOT NULL
  AND name IN ('ACK Clinic','Nutripedia Wellness Centre');
ROLLBACK;


-- ═══ BLOCK V2c — 'unknown' HAS NOT SPREAD — run alone ══════════════════════
-- Expect: 'OK'. EXACTLY ONE row, and it must be Acil Durum.
--
-- This is the block that stops 'unknown' becoming the lazy default. A placeholder that
-- costs nothing to reach for gets reached for — Slice 2 reconciles ten more hospital-tier
-- rows, and 'unknown' is the easiest thing to type for every one of them whose source is
-- awkward. The constraint cannot express "at most one"; this can.
--
-- If this FAILS, do not widen it. Go and classify whatever got added.
BEGIN;
SELECT
  CASE WHEN count(*) = 1 THEN 'OK'
       ELSE 'FAIL ← '||count(*)||' rows carry tier=''unknown''; it is a one-off, not a default' END AS exactly_one_unknown,
  CASE WHEN count(*) FILTER (WHERE id = '56614fa9-d7ba-4528-9fe4-f372e9f9286a') = 1
       THEN 'OK' ELSE 'FAIL ← the unknown-tier row is not Acil Durum' END AS and_it_is_acil_durum
FROM public.facilities WHERE tier = 'unknown';
ROLLBACK;


-- ═══ BLOCK V2d — THE SEVEN ARE NOW UNCLAIMABLE — run alone ═════════════════
-- Expect: both columns 'OK'. THIS IS THE PRESENT-TENSE FIX, and the reason 6b shares a
-- transaction with the claim guard.
--
-- Before this migration these seven were status='active' with provider_id IS NULL, which
-- made every TRNC state hospital a valid claim target for any provider account. Not a
-- future risk from a future seed — open in production.
--
-- THE DRAFT DUPLICATE IS INCLUDED DELIBERATELY, and it is the important one: the claim
-- guard's `SELECT … FROM facilities` runs SECURITY DEFINER precisely so that it can still
-- see a row the caller's own RLS hides. On a draft row an INVOKER lookup would return
-- nothing, target_sector would be NULL, and the guard would pass vacuously. If the guard
-- is ever "tidied" to invoker, this row is where it breaks first and silently.
BEGIN;
SELECT
  CASE WHEN count(*) = 7 THEN 'OK'
       ELSE 'FAIL ← only '||count(*)||' of 7 state hospitals carry sector=public; the rest are claimable' END AS seven_protected,
  CASE WHEN count(*) FILTER (WHERE status = 'draft') = 1 THEN 'OK'
       ELSE 'FAIL ← the Girne duplicate is not hidden; two Girne hospitals render' END AS duplicate_hidden
FROM public.facilities
WHERE sector = 'public'
  AND id IN ('56614fa9-d7ba-4528-9fe4-f372e9f9286a','3d108354-79cd-4a11-8173-e7c996d4bcd0',
             'e83f3d1d-c0c0-4e68-993c-03a8164286c1','ed83578f-1866-4e54-9253-705feb093c22',
             '91338177-85d8-4f38-8b0f-2c395638d2d4','7a1c598d-bc43-4b50-9f42-f94adffffe5d',
             '32dafd70-73fb-4aec-afb2-6c940d07e9b9');
ROLLBACK;


-- ═══ BLOCK V2e — THE HIDDEN DUPLICATE CANNOT BE CLAIMED — run alone ════════
-- EXPECTED TO ERROR: 'claim_requests: public health facilities cannot be claimed'.
-- THE ERROR IS THE PASS.
--
-- V7 proves the guard refuses a synthetic ACTIVE public row. This proves it refuses the
-- real DRAFT one — the case where a SECURITY DEFINER lookup is the only thing that can
-- see the row at all. Run it against the actual duplicate, not a fixture.
BEGIN;
SELECT set_config('request.jwt.claims',
                  (SELECT json_build_object('sub', id, 'role', 'authenticated')::text
                   FROM public.profiles WHERE role='provider' LIMIT 1), true);
SET LOCAL ROLE authenticated;
INSERT INTO public.claim_requests (facility_id, requester_id, requested_tier, tax_registration_no)
VALUES ('91338177-85d8-4f38-8b0f-2c395638d2d4',
        (current_setting('request.jwt.claims', true)::json->>'sub')::uuid, 'basic', 'VERIFY-TAX-3');
ROLLBACK;


-- ═══ BLOCK V3 / 8 — A DRAFT PUBLIC FACILITY IS INVISIBLE — run alone ═══════
-- Expect: all four columns 'OK'. THE MOST IMPORTANT BLOCK IN THIS FILE.
--
-- This is the whole point of the 'draft' value, and it is asserted BEHAVIOURALLY rather
-- than by reading the policy text — the policy could be right and a second, older,
-- permissive policy could still be OR'ing rows back in (see V0 question 2). Only an
-- actual read as an actual role can catch that.
BEGIN;
INSERT INTO public.facilities (name, name_official, type, sector, public_facility_type, tier, status, is_public)
VALUES ('Verify Draft Hospital', 'Dr Verify Fixture Devlet Hastanesi', 'hospital',
        'public', 'hospital', 'tertiary', 'draft', false);

SET LOCAL ROLE anon;
SELECT CASE WHEN (SELECT count(*) FROM public.facilities WHERE name='Verify Draft Hospital') = 0
            THEN 'OK' ELSE 'FAIL ← a signed-out visitor can see unfinished seed data' END AS anon_blind;
RESET ROLE;

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000d1","role":"authenticated"}';
SELECT CASE WHEN (SELECT count(*) FROM public.facilities WHERE name='Verify Draft Hospital') = 0
            THEN 'OK' ELSE 'FAIL ← a normal customer can see unfinished seed data' END AS customer_blind;
RESET ROLE;

-- search_content is SECURITY INVOKER, so this runs under the anon policies. Searching
-- the OFFICIAL name, not the common one: this simultaneously proves the draft is hidden
-- AND that name_official is in the WHERE at all (a typo'd column name would silently
-- return zero here and look like a pass — which is why V5 searches an ACTIVE row).
SET LOCAL ROLE anon;
SELECT CASE WHEN (SELECT count(*) FROM public.search_content('Verify Fixture')) = 0
            THEN 'OK' ELSE 'FAIL ← draft row is globally searchable' END AS search_blind;
RESET ROLE;

SELECT CASE WHEN (SELECT count(*) FROM public.facilities WHERE name='Verify Draft Hospital') = 1
            THEN 'OK' ELSE 'FAIL ← the fixture never inserted; every check above is vacuous' END AS fixture_real;
ROLLBACK;


-- ═══ BLOCK V4 / 8 — sector=public WITHOUT public_facility_type MUST FAIL ═══
-- EXPECTED TO ERROR: facilities_public_type_sector_check. THE ERROR IS THE PASS.
BEGIN;
INSERT INTO public.facilities (name, type, sector, tier, status, is_public)
VALUES ('Verify Untyped', 'hospital', 'public', 'secondary', 'draft', false);
ROLLBACK;


-- ═══ BLOCK V4b — sector=public WITHOUT tier MUST FAIL — run alone ══════════
-- EXPECTED TO ERROR: facilities_public_tier_required_check. THE ERROR IS THE PASS.
-- A tierless public row is one the routing screen cannot answer for — it would appear
-- in the directory and be missing from "where should I go", which is the one question
-- this module exists to answer.
--
-- NOTE: NULL is what is refused here, and 'unknown' is NOT NULL. The one hospital nobody
-- can classify (Acil Durum) carries tier='unknown', a real enum value — so this
-- constraint stayed global and needed no exemption. A fixture with tier='unknown' would
-- INSERT fine; this one omits tier entirely, which is the case that must fail.
BEGIN;
INSERT INTO public.facilities (name, type, sector, public_facility_type, status, is_public)
VALUES ('Verify Untiered', 'hospital', 'public', 'hospital', 'draft', false);
ROLLBACK;


-- ═══ BLOCK V4c — A PRIVATE ROW CARRYING public_facility_type MUST FAIL ═════
-- EXPECTED TO ERROR: facilities_public_type_sector_check. THE ERROR IS THE PASS.
-- The other half of the coupling. Without it, a private clinic could be tagged
-- 'health_centre' and would surface in the state-network filter.
--
-- ⚠ If Postgres suggests relaxing the CHECK, ignore it. The refusal is the design.
BEGIN;
INSERT INTO public.facilities (name, type, sector, public_facility_type, status, is_public)
VALUES ('Verify Mislabelled', 'clinic', 'private', 'health_centre', 'draft', false);
ROLLBACK;


-- ═══ BLOCK V4d — A ROW PARENTING ITSELF MUST FAIL — run alone ══════════════
-- EXPECTED TO ERROR: facilities_parent_not_self_check. THE ERROR IS THE PASS.
BEGIN;
INSERT INTO public.facilities (id, name, type, sector, status, is_public, parent_facility_id)
VALUES ('eeeeeeee-0000-0000-0000-000000000001','Verify Self Parent','clinic','private','draft',false,
        'eeeeeeee-0000-0000-0000-000000000001');
ROLLBACK;


-- ═══ BLOCK V5 / 8 — name_official IS ACTUALLY SEARCHABLE — run alone ═══════
-- Expect: both columns 'OK'.
--
-- V3 proved a DRAFT row is NOT findable — which a mis-typed column name would also
-- produce. This proves the positive: an ACTIVE row IS findable by its official name,
-- which is the only result that distinguishes "the filter works" from "the filter
-- never matches anything".
BEGIN;
INSERT INTO public.facilities (name, name_official, type, sector, public_facility_type, tier, status, is_public)
VALUES ('Verify Live Centre', 'Dr Verify Eponym Sağlık Merkezi', 'clinic',
        'public', 'health_centre', 'primary', 'active', true);
SELECT
  CASE WHEN (SELECT count(*) FROM public.search_content('Verify Eponym')) >= 1
       THEN 'OK' ELSE 'FAIL ← name_official is not in the search WHERE' END AS by_official_name,
  CASE WHEN (SELECT count(*) FROM public.search_content('Verify Live Centre')) >= 1
       THEN 'OK' ELSE 'FAIL ← plain name search regressed' END AS by_common_name;
ROLLBACK;


-- ═══ BLOCK V5b — parent_facility_id ACCEPTS A REAL PARENT — run alone ══════
-- Expect: 'OK'. The mirror of V4d, and NOT a formality: an FK that rejects a valid
-- parent (wrong target table, wrong column) would look identical to V4d passing.
BEGIN;
INSERT INTO public.facilities (id, name, type, sector, public_facility_type, tier, status, is_public)
VALUES ('eeeeeeee-0000-0000-0000-00000000000a','Verify Parent Hospital','hospital',
        'public','hospital','tertiary','draft',false);
INSERT INTO public.facilities (name, type, sector, public_facility_type, tier, status, is_public, parent_facility_id)
VALUES ('Verify Attached Unit','hospital','public','hospital','tertiary','draft',false,
        'eeeeeeee-0000-0000-0000-00000000000a');
SELECT CASE WHEN (SELECT parent_facility_id FROM public.facilities WHERE name='Verify Attached Unit')
                 = 'eeeeeeee-0000-0000-0000-00000000000a'
            THEN 'OK' ELSE 'FAIL ← attached units cannot be linked to their hospital' END AS parent_link_ok;
ROLLBACK;


-- ═══ BLOCK V6 / 8 — A PRIVATE FACILITY IS STILL CLAIMABLE — run alone ══════
-- Expect: 'OK'. RUN THIS BEFORE V7.
--
-- V7 proves the new refusal fires. On its own that is worthless: a guard that rejects
-- EVERYTHING also passes V7, while having silently killed the entire provider-signup
-- funnel. This block is the one that proves V7's error is specific.
BEGIN;
INSERT INTO public.facilities (id, name, type, sector, status, is_public, provider_id)
VALUES ('eeeeeeee-0000-0000-0000-00000000000b','Verify Private Clinic','clinic','private','active',true,NULL);
SELECT set_config('request.jwt.claims',
                  (SELECT json_build_object('sub', id, 'role', 'authenticated')::text
                   FROM public.profiles WHERE role='provider' LIMIT 1), true);
SELECT set_config('verify.provider_found',
                  (SELECT (count(*) > 0)::text FROM public.profiles WHERE role='provider'), true);
SET LOCAL ROLE authenticated;
INSERT INTO public.claim_requests (facility_id, requester_id, requested_tier, tax_registration_no)
VALUES ('eeeeeeee-0000-0000-0000-00000000000b',
        (current_setting('request.jwt.claims', true)::json->>'sub')::uuid, 'basic', 'VERIFY-TAX-1');
SET LOCAL ROLE postgres;
SELECT
  CASE WHEN current_setting('verify.provider_found', true) = 'true'
       THEN 'OK' ELSE 'NONE ← no provider profile; this block proved nothing' END AS provider_fixture_found,
  CASE WHEN EXISTS (SELECT 1 FROM public.claim_requests
                    WHERE facility_id='eeeeeeee-0000-0000-0000-00000000000b')
       THEN 'OK' ELSE 'FAIL ← the guard now rejects LEGITIMATE claims too' END AS private_still_claimable;
ROLLBACK;


-- ═══ BLOCK V7 / 8 — A PUBLIC FACILITY CANNOT BE CLAIMED — run alone ════════
-- EXPECTED TO ERROR: 'claim_requests: public health facilities cannot be claimed'.
-- THE ERROR IS THE PASS.
--
-- Note the fixture is status='active', NOT 'draft'. That is deliberate and it is the
-- entire reason this guard was pulled into Slice 1: while the rows are draft, RLS hides
-- them and the hole is closed BY ACCIDENT. This block simulates the day somebody flips
-- one live — the day the accident stops protecting us.
--
-- If this SUCCEEDS, Dr. Burhan Nalbantoğlu Devlet Hastanesi is claimable by any provider
-- account that can type a tax number. Read the ERROR as the pass and move on.
BEGIN;
INSERT INTO public.facilities (id, name, type, sector, public_facility_type, tier, status, is_public, provider_id)
VALUES ('eeeeeeee-0000-0000-0000-00000000000c','Verify State Hospital','hospital',
        'public','hospital','tertiary','active',true,NULL);
SELECT set_config('request.jwt.claims',
                  (SELECT json_build_object('sub', id, 'role', 'authenticated')::text
                   FROM public.profiles WHERE role='provider' LIMIT 1), true);
SET LOCAL ROLE authenticated;
INSERT INTO public.claim_requests (facility_id, requester_id, requested_tier, tax_registration_no)
VALUES ('eeeeeeee-0000-0000-0000-00000000000c',
        (current_setting('request.jwt.claims', true)::json->>'sub')::uuid, 'basic', 'VERIFY-TAX-2');
ROLLBACK;


-- ═══ BLOCK V7b — AN OWNER CANNOT DECLARE THEMSELVES A STATE FACILITY ═══════
-- EXPECTED TO ERROR: 'facilities: sector is admin-only'. THE ERROR IS THE PASS.
--
-- The mirror of V7 and the more dangerous half. V7 stops a provider CLAIMING a state
-- facility; this stops them BECOMING one. facilities_guard_update is a deny-list, so
-- every column added by this migration was owner-writable until step 7 named it.
--
-- Success here means any provider can set sector='public' + tier on their own row and
-- be handed to users by the Slice 5 routing screen as a state health facility. There is
-- no CHECK that would catch it — the values are all individually legal.
BEGIN;
SELECT set_config('verify.provider_found',
                  (SELECT (count(*) > 0)::text FROM public.profiles WHERE role='provider'), true);
-- Fixture owned by a REAL provider: provider_id is FK'd to auth.users, so a synthetic
-- owner cannot be inserted without fabricating an auth user. If provider_found is false
-- this block proves nothing — check it in V6, which prints it.
INSERT INTO public.facilities (id, name, type, sector, status, is_public, provider_id)
VALUES ('eeeeeeee-0000-0000-0000-00000000000d','Verify Owned Clinic','clinic','private','active',true,
        (SELECT id FROM public.profiles WHERE role='provider' LIMIT 1));
SELECT set_config('request.jwt.claims',
                  (SELECT json_build_object('sub', id, 'role', 'authenticated')::text
                   FROM public.profiles WHERE role='provider' LIMIT 1), true);
SET LOCAL ROLE authenticated;
UPDATE public.facilities
   SET sector = 'public', public_facility_type = 'health_centre', tier = 'primary'
 WHERE id = 'eeeeeeee-0000-0000-0000-00000000000d';
ROLLBACK;


-- ═══ BLOCK V7c — AN OWNER CAN STILL EDIT WHAT THEY ALWAYS COULD — run alone ═
-- Expect: 'OK'. RUN THIS AFTER V7b.
--
-- V7b proves the new locks fire. On its own that is worthless: a guard that rejects
-- EVERY owner update also passes V7b, having silently broken the provider dashboard
-- (photos, specialty, availability, map pin). This proves V7b's refusal is specific.
BEGIN;
INSERT INTO public.facilities (id, name, type, sector, status, is_public, provider_id)
VALUES ('eeeeeeee-0000-0000-0000-00000000000e','Verify Owned Clinic 2','clinic','private','active',true,
        (SELECT id FROM public.profiles WHERE role='provider' LIMIT 1));
SELECT set_config('request.jwt.claims',
                  (SELECT json_build_object('sub', id, 'role', 'authenticated')::text
                   FROM public.profiles WHERE role='provider' LIMIT 1), true);
SET LOCAL ROLE authenticated;
UPDATE public.facilities SET latitude = 35.1856, longitude = 33.3823, specialty = ARRAY['dental']
 WHERE id = 'eeeeeeee-0000-0000-0000-00000000000e';
SET LOCAL ROLE postgres;
SELECT CASE WHEN (SELECT latitude FROM public.facilities
                  WHERE id='eeeeeeee-0000-0000-0000-00000000000e') = 35.1856
            THEN 'OK' ELSE 'FAIL ← the new locks broke legitimate owner edits' END AS owner_edits_still_work;
ROLLBACK;


-- ═══ BLOCK V8 / 8 — THE DEVICE PASS — CANNOT BE DONE IN SQL ════════════════
--
-- EVERYTHING ABOVE PROVES THE DATABASE IS CORRECT. NONE OF IT PROVES THE APP STILL
-- RENDERS. This slice changed two client files, and one of them changed the search
-- filter every health user touches.
--
-- No OTA is required to check this — run the dev client (`npx expo start -c`).
-- NOTHING IN THIS SLICE SHIPS.
--
--   1. HOME DIRECTORY SEARCH STILL WORKS AT ALL.
--      HomeScreen's filter moved from plain .toLowerCase() to normalize(). Type a
--      pharmacy name you know is listed. If the list goes empty for every query, the
--      import of normalize() is wrong and the whole health directory is unsearchable.
--
--   2. TURKISH FOLDING — TYPE IT WITHOUT THE DIACRITICS.
--      Search `ozankoy` for a facility whose name contains "Ozanköy"; search `sehit`
--      for one containing "Şehit". Both must match now and did NOT before. This is the
--      only part of the change a user would ever notice, so it is the part to see work.
--
--   3. ADMIN → FACILITIES: the switch in the editor now reads "Listed in directory",
--      not "Public facility". Confirm it still toggles is_public (save, reopen).
--      Rows show a grey "Draft" pill only if status='draft' — there are none yet, so
--      the correct result today is NO Draft pills anywhere. Seeing one means something
--      got seeded that should not have been.
--
--   4. SPOT-CHECK IN TURKISH. Switch the app language to Türkçe and repeat 1 and 2.
--      Turkish labels are longer and this is the standing rule, not a formality.
