-- ─── Slice 1 verification — 20260904_accommodation_partner_feed.sql ──────────
--
-- Run AFTER applying the migration. SQL editor, Role selector = postgres.
--
-- ▶ HOW TO RUN: the SQL editor shows only the LAST result set, so run the blocks
--   ONE AT A TIME — select from a `═══ BLOCK Vn ═══` banner down to the next banner.
--
-- NOTHING IS PERSISTED. Every block is BEGIN … ROLLBACK, fixtures included.
-- Blocks V3, V4, V5a, V5b, V5c are EXPECTED TO ERROR — the error IS the pass.
--
-- WHY FIXTURES ARE CREATED RATHER THAN QUERIED: there are 0 partner rows and 0
-- anon-visible properties today, so there is nothing real to assert against. Each
-- block builds exactly the rows its cases need, as REAL rows through the REAL
-- constraints, and rolls them back. This is not a `WHERE false` dry run.


-- ═══ BLOCK V1 / 9 — SCHEMA SHAPE — run alone ═══════════════════════════════
-- Expect: EVERY row status = 'OK'. Any other value means the paste was truncated.
BEGIN;
SELECT 'column' AS kind, e.o AS object,
       CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns ic
              WHERE ic.table_schema='public'
                AND ic.table_name=split_part(e.o,'.',1)
                AND ic.column_name=split_part(e.o,'.',2))
            THEN 'OK' ELSE 'MISSING' END AS status
FROM (VALUES
  ('properties.source'),('properties.external_id'),('properties.source_url'),
  ('properties.last_seen_at'),('properties.content_hash'),('properties.updated_at'),
  ('properties.published_at'),('properties.deed_type'),('properties.net_area_sqm'),
  ('properties.plot_sqm'),('properties.covered_area_sqm'),('properties.floor'),
  ('properties.total_floors'),('properties.building_age_band'),('properties.living_rooms'),
  ('properties.ensuite_count'),('properties.deposit'),('properties.deposit_currency'),
  ('properties.min_term_months'),('properties.bills_included'),('properties.amenities'),
  ('properties.area'),('properties.development_name'),
  ('properties.swap_available'),('properties.gated_community'),
  ('properties.location_precision'),
  ('property_images.source_url'),('property_images.content_hash'),
  ('property_images.is_primary'),
  ('estate_agencies.contact_name'),('estate_agencies.contact_phone'),
  ('estate_agencies.contact_whatsapp')
) e(o)
UNION ALL
SELECT 'constraint', e.o,
       CASE WHEN EXISTS (SELECT 1 FROM pg_constraint WHERE conname=e.o)
            THEN 'OK' ELSE 'MISSING' END
FROM (VALUES
  ('properties_source_agent_xor_check'),('properties_deed_type_check'),
  ('properties_deposit_currency_check'),('properties_amenities_shape_check'),
  ('properties_structure_range_check'),('properties_external_id_unique'),
  ('properties_location_precision_check'),('properties_coords_precision_check'),
  ('properties_feed_precision_check')
) e(o)
UNION ALL
SELECT 'index', e.o,
       CASE WHEN EXISTS (SELECT 1 FROM pg_indexes
              WHERE schemaname='public' AND indexname=e.o)
            THEN 'OK' ELSE 'MISSING' END
FROM (VALUES
  ('properties_browse_idx'),('property_images_property_id_idx'),
  ('property_images_primary_unique'),('properties_external_id_unique')
) e(o)
UNION ALL
SELECT 'trigger','properties_touch_updated_at',
       CASE WHEN EXISTS (SELECT 1 FROM pg_trigger
              WHERE tgname='properties_touch_updated_at' AND NOT tgisinternal)
            THEN 'OK' ELSE 'MISSING' END
UNION ALL
SELECT 'nullable','properties.agent_id',
       CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema='public' AND table_name='properties'
                AND column_name='agent_id' AND is_nullable='YES')
            THEN 'OK' ELSE 'STILL NOT NULL' END
UNION ALL
-- The four WIDENED checks keep their names, so existence proves nothing.
SELECT 'behaviour', z.label, CASE WHEN z.ok THEN 'OK' ELSE 'STALE' END
FROM (
  SELECT 'status_check has delisted' label, EXISTS(SELECT 1 FROM pg_constraint
    WHERE conname='properties_status_check' AND pg_get_constraintdef(oid) ILIKE '%delisted%') ok
  UNION ALL SELECT 'currency_check has USD', EXISTS(SELECT 1 FROM pg_constraint
    WHERE conname='properties_currency_check' AND pg_get_constraintdef(oid) ILIKE '%USD%')
  UNION ALL SELECT 'district_check has lefke+karpaz', EXISTS(SELECT 1 FROM pg_constraint
    WHERE conname='properties_district_check' AND pg_get_constraintdef(oid) ILIKE '%lefke%'
      AND pg_get_constraintdef(oid) ILIKE '%karpaz%')
  UNION ALL SELECT 'price_period_check has weekly+yearly', EXISTS(SELECT 1 FROM pg_constraint
    WHERE conname='properties_price_period_check' AND pg_get_constraintdef(oid) ILIKE '%weekly%'
      AND pg_get_constraintdef(oid) ILIKE '%yearly%')
  UNION ALL SELECT 'props_select_public has source branch', EXISTS(SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='properties'
      AND policyname='props_select_public' AND qual ILIKE '%source IS NOT NULL%')
  UNION ALL SELECT 'images_select_public uses LEFT JOIN', EXISTS(SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='property_images'
      AND policyname='images_select_public' AND qual ILIKE '%LEFT JOIN%')
  UNION ALL SELECT 'props_update_agent has explicit WITH CHECK', EXISTS(
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='properties'
      AND policyname='props_update_agent' AND with_check IS NOT NULL)
  UNION ALL SELECT 'storage upload excludes partner/', EXISTS(SELECT 1 FROM pg_policies
    WHERE schemaname='storage' AND tablename='objects'
      AND policyname='property_images_upload' AND with_check ILIKE '%partner%')
  UNION ALL SELECT 'trigger body is conditional', EXISTS(SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='properties_touch_updated_at'
      AND pg_get_functiondef(p.oid) ILIKE '%last_seen_at%'
      AND pg_get_functiondef(p.oid) ILIKE '%view_count%')
  UNION ALL SELECT 'location_precision DEFAULT is exact', EXISTS(
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='properties'
      AND column_name='location_precision' AND column_default LIKE '%exact%')
  UNION ALL SELECT 'feed_precision_check is NULL-safe', EXISTS(
    SELECT 1 FROM pg_constraint WHERE conname='properties_feed_precision_check'
      AND pg_get_constraintdef(oid) ILIKE '%IS NOT NULL%')
  UNION ALL SELECT 'building_age_band is text (a band, not a number)', EXISTS(
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='properties'
      AND column_name='building_age_band' AND data_type='text')
  UNION ALL SELECT 'structure_range_check excludes building_age_band', NOT EXISTS(
    SELECT 1 FROM pg_constraint WHERE conname='properties_structure_range_check'
      AND pg_get_constraintdef(oid) ILIKE '%building_age_band%')
  UNION ALL SELECT 'ledger row present', EXISTS(SELECT 1
    FROM public.schema_migrations_applied
    WHERE filename='20260904_accommodation_partner_feed.sql')
) z
ORDER BY 1,2;
ROLLBACK;


-- ═══ BLOCK V2 / 9 — VISIBILITY CASE TABLE — run alone ══════════════════════
-- Cases 1-10, 17, 18. Expect: EVERY row verdict = 'PASS'. One result set.
BEGIN;

-- ─── THREE IDENTITIES, AND WHY THE THIRD EXISTS ─────────────────────────────
-- The first version of this block used only agent_user and admin_id. In this database
-- they are THE SAME PERSON: the sole estate_agents row belongs to a profile with
-- role='admin'. Every case run "as the agent" therefore also satisfied the admin branch
-- of props_select_public, and cases 8 and 10 PASSED VIA THE ADMIN BRANCH while claiming
-- to prove the public one. A test that passes for the wrong reason is worse than a
-- failing test, because it is silent.
--
-- third_id is a FABRICATED uuid with NO row in profiles, estate_agents or auth.users.
-- That is deliberate, and it is what makes it the right instrument:
--     agent_id IN (SELECT ... WHERE user_id = auth.uid())  -> empty subquery -> FALSE
--     EXISTS   (SELECT 1 FROM profiles ... role='admin')   -> no row        -> FALSE
-- so the PUBLIC branch is the only one that can possibly grant. Nothing else can fire,
-- which is exactly the isolation these cases need.
--
-- Picking a real non-admin profile instead would work today and rot silently the moment
-- that person is promoted — the same failure mode being fixed here.
DO $$
DECLARE
  v_third uuid := '00000000-0000-4000-8000-00000000dead';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.estate_agents) THEN
    RAISE EXCEPTION 'No estate_agents row exists — cases 4,5,6 cannot be built.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE role='admin') THEN
    RAISE EXCEPTION 'No admin profile exists — cases 7,9 cannot be built.';
  END IF;
  -- COLLISION GUARD. If third_id resolves to a real identity, it can hit the owner or
  -- admin branch and cases 8/81/10 silently go back to proving nothing.
  IF EXISTS (SELECT 1 FROM public.profiles      WHERE id      = v_third)
  OR EXISTS (SELECT 1 FROM public.estate_agents WHERE user_id = v_third)
  OR EXISTS (SELECT 1 FROM auth.users           WHERE id      = v_third) THEN
    RAISE EXCEPTION 'third_id % resolves to a real identity — choose another uuid.', v_third;
  END IF;
  IF v_third = (SELECT user_id FROM public.estate_agents ORDER BY created_at LIMIT 1)
  OR v_third = (SELECT id FROM public.profiles WHERE role='admin' ORDER BY id LIMIT 1) THEN
    RAISE EXCEPTION 'third_id collides with agent_user or admin_id.';
  END IF;
END $$;

CREATE TEMP TABLE fx AS SELECT
  (SELECT id      FROM public.estate_agents   ORDER BY created_at LIMIT 1) AS agent_id,
  (SELECT user_id FROM public.estate_agents   ORDER BY created_at LIMIT 1) AS agent_user,
  (SELECT id      FROM public.profiles WHERE role='admin' ORDER BY id LIMIT 1) AS admin_id,
  (SELECT id      FROM public.estate_agencies ORDER BY created_at LIMIT 1) AS agency_id,
  '00000000-0000-4000-8000-00000000dead'::uuid                             AS third_id;
CREATE TEMP TABLE res (case_no int, description text, expected text, actual text);
GRANT SELECT          ON fx  TO anon, authenticated, service_role;
GRANT SELECT, INSERT  ON res TO anon, authenticated, service_role;

-- Feed rows: agent_id NULL + source set (the XOR's second branch).
-- location_precision='area' is REQUIRED on every feed fixture. Omit it and the row takes
-- the DEFAULT 'exact', which properties_feed_precision_check rejects (23514) — this whole
-- block would abort at fixture creation, before a single case ran. CHECK constraints bind
-- postgres too; only RLS is bypassed.
INSERT INTO public.properties (id, agent_id, agency_id, source, external_id, title,
       intent, property_type, price, currency, status, location_precision)
SELECT '00000000-0000-4000-8000-000000000001', NULL, fx.agency_id, 'novest', 'V-FEED-ACTIVE',
       'V2 feed active', 'sale', 'apartment', 100000, 'GBP', 'active', 'area' FROM fx;
INSERT INTO public.properties (id, agent_id, agency_id, source, external_id, title,
       intent, property_type, price, currency, status, location_precision)
SELECT '00000000-0000-4000-8000-000000000002', NULL, fx.agency_id, 'novest', 'V-FEED-DELISTED',
       'V2 feed delisted', 'sale', 'apartment', 100000, 'GBP', 'delisted', 'area' FROM fx;
-- Agent rows: agent_id set + source NULL (the XOR's first branch).
INSERT INTO public.properties (id, agent_id, title, intent, property_type, price, currency, status)
SELECT '00000000-0000-4000-8000-000000000003', fx.agent_id,
       'V2 agent pending', 'sale', 'apartment', 100000, 'GBP', 'pending' FROM fx;
INSERT INTO public.properties (id, agent_id, title, intent, property_type, price, currency, status)
SELECT '00000000-0000-4000-8000-000000000004', fx.agent_id,
       'V2 agent active', 'sale', 'apartment', 100000, 'GBP', 'active' FROM fx;
-- One image on the active FEED row — the LEFT JOIN proof.
INSERT INTO public.property_images (id, property_id, url, sort_order, is_primary)
VALUES ('00000000-0000-4000-8000-0000000000f1',
        '00000000-0000-4000-8000-000000000001', 'https://example.invalid/1.jpg', 0, true);

-- ── CASE 4: active agent listing, subscription EXPIRED, anon ──
UPDATE public.estate_agents SET subscription_expires_at = now() - interval '1 day'
WHERE id = (SELECT agent_id FROM fx);
SELECT set_config('request.jwt.claims', '', true);   -- no identity: a true anon
SET LOCAL ROLE anon;
INSERT INTO res SELECT 4,'active agent listing, EXPIRED subscription, anon','HIDDEN',
  CASE WHEN count(*)=0 THEN 'HIDDEN' ELSE 'VISIBLE' END
  FROM public.properties WHERE id='00000000-0000-4000-8000-000000000004';
RESET ROLE;

-- ── CASE 5: active agent listing, subscription VALID, anon ──
UPDATE public.estate_agents SET subscription_expires_at = now() + interval '30 days'
WHERE id = (SELECT agent_id FROM fx);
SELECT set_config('request.jwt.claims', '', true);
SET LOCAL ROLE anon;
INSERT INTO res SELECT 5,'active agent listing, VALID subscription, anon','VISIBLE',
  CASE WHEN count(*)=1 THEN 'VISIBLE' ELSE 'HIDDEN' END
  FROM public.properties WHERE id='00000000-0000-4000-8000-000000000004';
-- ── CASES 1, 2, 3, 18: anon ──
INSERT INTO res SELECT 1,'active FEED listing, anon','VISIBLE',
  CASE WHEN count(*)=1 THEN 'VISIBLE' ELSE 'HIDDEN' END
  FROM public.properties WHERE id='00000000-0000-4000-8000-000000000001';
INSERT INTO res SELECT 2,'DELISTED feed listing, anon','HIDDEN',
  CASE WHEN count(*)=0 THEN 'HIDDEN' ELSE 'VISIBLE' END
  FROM public.properties WHERE id='00000000-0000-4000-8000-000000000002';
INSERT INTO res SELECT 3,'PENDING agent listing, anon','HIDDEN',
  CASE WHEN count(*)=0 THEN 'HIDDEN' ELSE 'VISIBLE' END
  FROM public.properties WHERE id='00000000-0000-4000-8000-000000000003';
INSERT INTO res SELECT 18,'images of active FEED listing, anon (LEFT JOIN proof)','VISIBLE',
  CASE WHEN count(*)=1 THEN 'VISIBLE' ELSE 'HIDDEN' END
  FROM public.property_images WHERE id='00000000-0000-4000-8000-0000000000f1';
RESET ROLE;

-- ── CASES 7, 9: admin. THESE MUST RUN BEFORE THE DEMOTION BELOW. ──
-- admin_id and agent_user are the same person in this database, so demoting agent_user
-- to isolate the owner branch also removes the only admin. Order is load-bearing here.
SELECT set_config('request.jwt.claims',
  json_build_object('sub',(SELECT admin_id FROM fx),'role','authenticated')::text, true);
SET LOCAL ROLE authenticated;
INSERT INTO res SELECT 7,'admin, PENDING agent listing','VISIBLE',
  CASE WHEN count(*)=1 THEN 'VISIBLE' ELSE 'HIDDEN' END
  FROM public.properties WHERE id='00000000-0000-4000-8000-000000000003';
INSERT INTO res SELECT 9,'admin, DELISTED feed listing','VISIBLE',
  CASE WHEN count(*)=1 THEN 'VISIBLE' ELSE 'HIDDEN' END
  FROM public.properties WHERE id='00000000-0000-4000-8000-000000000002';
RESET ROLE;

-- ── ISOLATE THE OWNER BRANCH: temporarily demote the owning agent's profile ──
-- Rolled back with everything else. Without this, case 6 is satisfied by BOTH the owner
-- branch and the admin branch, so it cannot prove the owner branch works — it would pass
-- unchanged even if that branch were deleted. 'estate_agent' is a valid profiles.role and
-- is the semantically correct role for someone holding an estate_agents row.
UPDATE public.profiles SET role = 'estate_agent' WHERE id = (SELECT agent_user FROM fx);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.profiles
             WHERE id = (SELECT agent_user FROM fx) AND role = 'admin') THEN
    RAISE EXCEPTION
      'agent_user is STILL an admin after demotion — case 6 would pass via the admin '
      'branch and prove nothing about the owner branch.';
  END IF;
END $$;

-- ── CASE 6: the owning agent, now provably NOT an admin ──
SELECT set_config('request.jwt.claims',
  json_build_object('sub',(SELECT agent_user FROM fx),'role','authenticated')::text, true);
SET LOCAL ROLE authenticated;
INSERT INTO res SELECT 6,'owning agent (non-admin), own PENDING listing','VISIBLE',
  CASE WHEN count(*)=1 THEN 'VISIBLE' ELSE 'HIDDEN' END
  FROM public.properties WHERE id='00000000-0000-4000-8000-000000000003';
RESET ROLE;

-- ── CASES 8, 81: the THIRD identity — authenticated, not admin, not the owner ──
-- Only the public branch of props_select_public can grant here. That is the point.
SELECT set_config('request.jwt.claims',
  json_build_object('sub',(SELECT third_id FROM fx),'role','authenticated')::text, true);
SET LOCAL ROLE authenticated;
INSERT INTO res SELECT 8,'unrelated authenticated user vs active FEED listing','VISIBLE',
  CASE WHEN count(*)=1 THEN 'VISIBLE' ELSE 'HIDDEN' END
  FROM public.properties WHERE id='00000000-0000-4000-8000-000000000001';
INSERT INTO res SELECT 81,'unrelated authenticated user vs DELISTED feed listing','HIDDEN',
  CASE WHEN count(*)=0 THEN 'HIDDEN' ELSE 'VISIBLE' END
  FROM public.properties WHERE id='00000000-0000-4000-8000-000000000002';
INSERT INTO res SELECT 82,'unrelated authenticated user vs PENDING agent listing','HIDDEN',
  CASE WHEN count(*)=0 THEN 'HIDDEN' ELSE 'VISIBLE' END
  FROM public.properties WHERE id='00000000-0000-4000-8000-000000000003';
RESET ROLE;

-- ── CASE 10: guest (anonymous session) READS match anon ──
-- Also on the third identity: on agent_user this proved the admin branch, not that a
-- guest can read a feed listing.
SELECT set_config('request.jwt.claims',
  json_build_object('sub',(SELECT third_id FROM fx),'role','authenticated',
                    'is_anonymous',true)::text, true);
SET LOCAL ROLE authenticated;
INSERT INTO res SELECT 10,'guest (anonymous session), active FEED listing — READ','VISIBLE',
  CASE WHEN count(*)=1 THEN 'VISIBLE' ELSE 'HIDDEN' END
  FROM public.properties WHERE id='00000000-0000-4000-8000-000000000001';
RESET ROLE;

-- ── CASE 17: service_role bypasses RLS — the import path ──
SET LOCAL ROLE service_role;
INSERT INTO res SELECT 17,'service_role, DELISTED feed listing (import path)','VISIBLE',
  CASE WHEN count(*)=1 THEN 'VISIBLE' ELSE 'HIDDEN' END
  FROM public.properties WHERE id='00000000-0000-4000-8000-000000000002';
RESET ROLE;

SELECT case_no, description, expected, actual,
       CASE WHEN expected=actual THEN 'PASS' ELSE '*** FAIL ***' END AS verdict
FROM res ORDER BY case_no;
ROLLBACK;


-- ═══ BLOCK V3 / 9 — ATTACK, CASE 13 — run alone ════════════════════════════
-- An agent whose subscription has EXPIRED tries to buy permanent free visibility
-- by setting `source` on their OWN row, keeping agent_id.
--
--   ✅ PASS = ERROR 23514  check_violation
--             "violates check constraint "properties_source_agent_xor_check""
--   ❌ FAIL = "UPDATE 1"   — every expired agent can bypass the paywall.
--
-- RLS PERMITS this statement: the row is still theirs. The CHECK is the only guard.
BEGIN;
CREATE TEMP TABLE fx3 AS SELECT
  (SELECT id FROM public.estate_agents ORDER BY created_at LIMIT 1) AS agent_id,
  (SELECT user_id FROM public.estate_agents ORDER BY created_at LIMIT 1) AS agent_user;
GRANT SELECT ON fx3 TO authenticated;
INSERT INTO public.properties (id, agent_id, title, intent, property_type, price, currency, status)
SELECT '00000000-0000-4000-8000-0000000000a1', fx3.agent_id,
       'V3 attack target','sale','apartment',100000,'GBP','active' FROM fx3;
UPDATE public.estate_agents SET subscription_expires_at = now() - interval '1 day'
WHERE id = (SELECT agent_id FROM fx3);

-- DEMOTE THE OWNING AGENT. In this database the sole estate_agents row belongs to an
-- ADMIN, and props_update_agent grants admins everything. Without this the attack below
-- is authorised by the ADMIN branch and the test proves nothing. Rolled back with the
-- rest of the block.
UPDATE public.profiles SET role = 'estate_agent' WHERE id = (SELECT agent_user FROM fx3);
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.profiles
             WHERE id = (SELECT agent_user FROM fx3) AND role = 'admin') THEN
    RAISE EXCEPTION 'acting identity is still an admin — this test would prove nothing.';
  END IF;
END $$;
SELECT set_config('request.jwt.claims',
  json_build_object('sub',(SELECT agent_user FROM fx3),'role','authenticated')::text, true);
SET LOCAL ROLE authenticated;

-- location_precision='area' is set so the attacker ALSO satisfies
-- properties_feed_precision_check, leaving the XOR as the ONLY constraint violated.
-- Without it the row breaks two constraints at once and which one Postgres names depends
-- on evaluation order — the test would still fail closed, but it would stop proving
-- WHICH guard stopped it.
UPDATE public.properties SET source = 'novest', location_precision = 'area'
WHERE id = '00000000-0000-4000-8000-0000000000a1';

ROLLBACK;


-- ═══ BLOCK V4 / 9 — ATTACK, CASE 14 — run alone ════════════════════════════
-- The same agent instead converts the row outright: agent_id = NULL AND source set.
-- This SATISFIES the XOR, so the CHECK does not fire — RLS must reject it.
--
--   ✅ PASS = ERROR 42501
--             "new row violates row-level security policy for table "properties""
--   ❌ FAIL = "UPDATE 1"   — an agent can launder a listing into a partner listing.
--
-- This is the case the now-EXPLICIT WITH CHECK on props_update_agent guarantees,
-- rather than inheriting implicitly from USING.
--
-- ⚠ THE DEMOTION BELOW IS NOT OPTIONAL. props_update_agent's WITH CHECK is
--       agent_id IN (their agents)  OR  caller is admin
--   With an ADMIN identity the second branch is TRUE, the new row is accepted, and the
--   UPDATE SUCCEEDS — correctly, because an admin may manage any listing. The attack is
--   only an attack when mounted by a NON-ADMIN agent. Run this on an admin and the block
--   reports UPDATE 1, which looks exactly like a missing protection and is not one.
BEGIN;
CREATE TEMP TABLE fx4 AS SELECT
  (SELECT id FROM public.estate_agents ORDER BY created_at LIMIT 1) AS agent_id,
  (SELECT user_id FROM public.estate_agents ORDER BY created_at LIMIT 1) AS agent_user;
GRANT SELECT ON fx4 TO authenticated;
INSERT INTO public.properties (id, agent_id, title, intent, property_type, price, currency, status)
SELECT '00000000-0000-4000-8000-0000000000a2', fx4.agent_id,
       'V4 attack target','sale','apartment',100000,'GBP','active' FROM fx4;

-- DEMOTE THE OWNING AGENT. In this database the sole estate_agents row belongs to an
-- ADMIN, and props_update_agent grants admins everything. Without this the attack below
-- is authorised by the ADMIN branch and the test proves nothing. Rolled back with the
-- rest of the block.
UPDATE public.profiles SET role = 'estate_agent' WHERE id = (SELECT agent_user FROM fx4);
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.profiles
             WHERE id = (SELECT agent_user FROM fx4) AND role = 'admin') THEN
    RAISE EXCEPTION 'acting identity is still an admin — this test would prove nothing.';
  END IF;
END $$;
SELECT set_config('request.jwt.claims',
  json_build_object('sub',(SELECT agent_user FROM fx4),'role','authenticated')::text, true);
SET LOCAL ROLE authenticated;

-- Note how COMPLETE this attack is: agent_id NULL + source set satisfies the XOR, and
-- location_precision='area' satisfies properties_feed_precision_check. The new row breaks
-- NO table constraint whatsoever. RLS is the only thing left standing, and it must reject.
-- (Without the precision the feed CHECK fires first and masks the RLS denial — the test
-- would appear to pass for entirely the wrong reason.)
UPDATE public.properties SET agent_id = NULL, source = 'novest', location_precision = 'area'
WHERE id = '00000000-0000-4000-8000-0000000000a2';

ROLLBACK;


-- ═══ BLOCK V5a / 9 — CASE 12 — run alone ═══════════════════════════════════
-- An authenticated agent tries to INSERT a partner row directly.
--   ✅ PASS = ERROR 42501 (RLS). props_insert_agent requires agent_id to be their
--             own active agent, and NULL IN (…) is not TRUE.
--   ❌ FAIL = "INSERT 0 1".
--
-- NO DEMOTION NEEDED HERE (unlike V2/V3/V4). props_insert_agent's WITH CHECK is ONLY
--   agent_id IN (SELECT id FROM estate_agents WHERE user_id = auth.uid() AND status='active')
-- with NO admin branch at all — verified against 20260718_capture_5_rls_policies.sql. An
-- admin cannot insert a property through RLS either, so this test is immune to the
-- identity-collision problem that contaminated V2.
BEGIN;
CREATE TEMP TABLE fx5 AS SELECT
  (SELECT user_id FROM public.estate_agents ORDER BY created_at LIMIT 1) AS agent_user;
GRANT SELECT ON fx5 TO authenticated;
SELECT set_config('request.jwt.claims',
  json_build_object('sub',(SELECT agent_user FROM fx5),'role','authenticated')::text, true);
SET LOCAL ROLE authenticated;

-- 'area' declared so every table CHECK passes and RLS is the only possible objection.
INSERT INTO public.properties (agent_id, source, external_id, title, intent,
       property_type, price, currency, status, location_precision)
VALUES (NULL,'novest','V5-EVIL','evil','sale','apartment',1,'GBP','active','area');

ROLLBACK;


-- ═══ BLOCK V5b / 9 — CASE 15 — run alone ═══════════════════════════════════
-- An authenticated user tries to attach an image to a FEED property.
--   ✅ PASS = ERROR 42501 (RLS). images_insert_agent joins properties→estate_agents
--             on agent_id; NULL never matches, so no authenticated path exists.
--   ❌ FAIL = "INSERT 0 1".
--
-- NO DEMOTION NEEDED. images_insert_agent's WITH CHECK is the property_id IN (…) join
-- alone — no admin branch. Immune to the identity collision.
BEGIN;
CREATE TEMP TABLE fx6 AS SELECT
  (SELECT user_id FROM public.estate_agents   ORDER BY created_at LIMIT 1) AS agent_user,
  (SELECT id      FROM public.estate_agencies ORDER BY created_at LIMIT 1) AS agency_id;
GRANT SELECT ON fx6 TO authenticated;
INSERT INTO public.properties (id, agent_id, agency_id, source, external_id, title,
       intent, property_type, price, currency, status, location_precision)
SELECT '00000000-0000-4000-8000-0000000000b1', NULL, fx6.agency_id,'novest','V5-FEED',
       'V5 feed row','sale','apartment',100000,'GBP','active','area' FROM fx6;
SELECT set_config('request.jwt.claims',
  json_build_object('sub',(SELECT agent_user FROM fx6),'role','authenticated')::text, true);
SET LOCAL ROLE authenticated;

INSERT INTO public.property_images (property_id, url, sort_order)
VALUES ('00000000-0000-4000-8000-0000000000b1','https://example.invalid/x.jpg',0);

ROLLBACK;


-- ═══ BLOCK V5c / 9 — CASE 11 — run alone ═══════════════════════════════════
-- A GUEST (anonymous session) attempts any write.
--   ✅ PASS = ERROR 42501 — the RESTRICTIVE no_anon_insert_properties policy.
--   ❌ FAIL = "INSERT 0 1".
--
-- NO DEMOTION NEEDED. A RESTRICTIVE policy is ANDed with the permissive ones and
-- no_anon_insert_properties has no admin exemption, so an anonymous session is blocked
-- whatever the caller's role. Immune to the identity collision.
BEGIN;
CREATE TEMP TABLE fx7 AS SELECT
  (SELECT id      FROM public.estate_agents ORDER BY created_at LIMIT 1) AS agent_id,
  (SELECT user_id FROM public.estate_agents ORDER BY created_at LIMIT 1) AS agent_user;
GRANT SELECT ON fx7 TO authenticated;
SELECT set_config('request.jwt.claims',
  json_build_object('sub',(SELECT agent_user FROM fx7),'role','authenticated',
                    'is_anonymous',true)::text, true);
SET LOCAL ROLE authenticated;

INSERT INTO public.properties (agent_id, title, intent, property_type, price, currency, status)
SELECT fx7.agent_id,'guest write','sale','apartment',1,'GBP','active' FROM fx7;

ROLLBACK;


-- ═══ BLOCK V6 / 9 — CASE 16, storage predicate — run alone ═════════════════
-- Asserted on the policy body rather than by inserting into storage.objects, which
-- would need a real bucket object and prove less. Expect verdict 'PASS'.
SELECT 'authenticated cannot write under property-images/partner/' AS test,
       CASE WHEN EXISTS (SELECT 1 FROM pg_policies
              WHERE schemaname='storage' AND tablename='objects'
                AND policyname='property_images_upload'
                AND with_check ILIKE '%foldername%'
                AND with_check ILIKE '%partner%')
            THEN 'PASS' ELSE '*** FAIL — partner/ prefix is WRITABLE ***' END AS verdict;


-- ═══ BLOCK V7 / 9 — updated_at TRIGGER — run alone ═════════════════════════
-- The trigger must IGNORE last_seen_at (stamped on every row every sync run) and
-- view_count (bumped on every detail open), and fire only on real content change.
-- Expect: all three verdicts 'PASS'.
BEGIN;
CREATE TEMP TABLE fx8 AS SELECT
  (SELECT id FROM public.estate_agents ORDER BY created_at LIMIT 1) AS agent_id;
INSERT INTO public.properties (id, agent_id, title, intent, property_type, price,
       currency, status, updated_at)
SELECT '00000000-0000-4000-8000-0000000000c1', fx8.agent_id,'V7 trigger target',
       'sale','apartment',100000,'GBP','active', now() - interval '10 days' FROM fx8;
CREATE TEMP TABLE res7 (test text, expected text, actual text);

UPDATE public.properties SET last_seen_at = now()
WHERE id='00000000-0000-4000-8000-0000000000c1';
INSERT INTO res7 SELECT 'last_seen_at only -> updated_at unchanged','unchanged',
  CASE WHEN updated_at < now() - interval '9 days' THEN 'unchanged' ELSE '*** MOVED ***' END
  FROM public.properties WHERE id='00000000-0000-4000-8000-0000000000c1';

UPDATE public.properties SET view_count = COALESCE(view_count,0)+1
WHERE id='00000000-0000-4000-8000-0000000000c1';
INSERT INTO res7 SELECT 'view_count only -> updated_at unchanged','unchanged',
  CASE WHEN updated_at < now() - interval '9 days' THEN 'unchanged' ELSE '*** MOVED ***' END
  FROM public.properties WHERE id='00000000-0000-4000-8000-0000000000c1';

UPDATE public.properties SET price = 123456
WHERE id='00000000-0000-4000-8000-0000000000c1';
INSERT INTO res7 SELECT 'price change -> updated_at stamped','stamped',
  CASE WHEN updated_at > now() - interval '1 minute' THEN 'stamped' ELSE '*** NOT STAMPED ***' END
  FROM public.properties WHERE id='00000000-0000-4000-8000-0000000000c1';

SELECT test, expected, actual,
       CASE WHEN expected=actual THEN 'PASS' ELSE '*** FAIL ***' END AS verdict FROM res7;
ROLLBACK;


-- ═══ BLOCK V8 / 9 — CONSTRAINTS ACTUALLY BITE — run alone ══════════════════
-- Each sub-block must ERROR with 23514. Run them ONE AT A TIME; each is its own
-- transaction because the first error aborts whichever one it is in.
-- Uncomment one at a time.

-- (a) amenities: empty array must be REJECTED (cardinality, not array_length)
-- BEGIN; INSERT INTO public.properties (agent_id, title, intent, property_type, price,
--   currency, status, amenities)
--   SELECT id,'x','sale','apartment',1,'GBP','active', '{}'::text[]
--   FROM public.estate_agents LIMIT 1; ROLLBACK;

-- (b) deed_type: unknown value REJECTED
-- BEGIN; INSERT INTO public.properties (agent_id, title, intent, property_type, price,
--   currency, status, deed_type)
--   SELECT id,'x','sale','apartment',1,'GBP','active','freehold'
--   FROM public.estate_agents LIMIT 1; ROLLBACK;

-- (c) XOR: neither source nor agent_id REJECTED
-- BEGIN; INSERT INTO public.properties (agent_id, title, intent, property_type, price,
--   currency, status) VALUES (NULL,'x','sale','apartment',1,'GBP','active'); ROLLBACK;

-- (d) external_id UNIQUE: a duplicate REJECTED (23505, not 23514).
--     location_precision='area' is REQUIRED on both rows. Without it the first INSERT
--     takes the 'exact' DEFAULT and dies on properties_feed_precision_check (23514)
--     before the second row can ever collide — the test reports the wrong error for the
--     wrong reason and never exercises the UNIQUE constraint at all.
-- BEGIN;
-- INSERT INTO public.properties (agent_id, source, external_id, title, intent,
--   property_type, price, currency, status, location_precision)
--   VALUES (NULL,'novest','DUP-1','a','sale','apartment',1,'GBP','active','area');
-- INSERT INTO public.properties (agent_id, source, external_id, title, intent,
--   property_type, price, currency, status, location_precision)
--   VALUES (NULL,'novest','DUP-1','b','sale','apartment',1,'GBP','active','area');
-- ROLLBACK;

-- (e) POSITIVE control — these MUST SUCCEED, proving the widenings landed.
--     Run as one block; it rolls back.
-- BEGIN;
-- INSERT INTO public.properties (agent_id, source, external_id, title, intent,
--   property_type, price, currency, price_period, status, district, deed_type,
--   amenities, area, location_precision)
-- VALUES (NULL,'novest','POS-1','positive control','rent','apartment',500,'USD',
--         'yearly','delisted','karpaz','exchange',
--         ARRAY['pool','sea_view','UNMAPPED_FROM_FEED'],'ozankoy','area');
-- ROLLBACK;

-- (f) SOURCE-SHAPED control — the real Novest listing #554769, field for field.
--     MUST SUCCEED. Proves building_age_band accepts a BAND and the new columns exist.
-- BEGIN;
-- INSERT INTO public.properties (agent_id, source, external_id, source_url, title,
--   intent, property_type, price, currency, price_period, status,
--   district, area, area_sqm, bedrooms, living_rooms, bathrooms,
--   total_floors, floor, building_age_band, swap_available, gated_community,
--   amenities, content_hash, last_seen_at, location_precision)
-- VALUES (NULL,'novest','554769',
--         'https://www.101evler.com/north-cyprus/property-for-sale/nicosia-gonyeli-flat-554769.html',
--         '2+1 Flat in Gönyeli','sale','apartment',107500,'GBP','total','active',
--         'nicosia','gonyeli', 90, 2, 1, 1,
--         3, 0, '6 - 10', 'Not Available', false,
--         ARRAY['garden'], 'deadbeef', now(), 'area');
-- ROLLBACK;

-- (f2) THE DEFAULT TRAP — a feed INSERT that OMITS location_precision.
--      MUST FAIL 23514 on properties_feed_precision_check. The row inherits the
--      'exact' DEFAULT and is rejected rather than landing as trustworthy.
--      THIS IS THE ONE THAT PROVES SLICE 2 CANNOT FORGET THE COLUMN.
-- BEGIN; INSERT INTO public.properties (agent_id, source, external_id, title, intent,
--   property_type, price, currency, status)
--   VALUES (NULL,'novest','PREC-1','x','sale','apartment',1,'GBP','active'); ROLLBACK;

-- (f3) NULL-SAFETY — a feed INSERT setting location_precision EXPLICITLY to NULL.
--      MUST ALSO FAIL 23514. If this one SUCCEEDS, the constraint was written as the
--      naive `source IS NULL OR location_precision = 'area'` and passes on UNKNOWN —
--      the precise hole this check exists to close.
-- BEGIN; INSERT INTO public.properties (agent_id, source, external_id, title, intent,
--   property_type, price, currency, status, location_precision)
--   VALUES (NULL,'novest','PREC-2','x','sale','apartment',1,'GBP','active',NULL); ROLLBACK;

-- (f4) A feed INSERT declaring 'area' MUST SUCCEED.
-- BEGIN; INSERT INTO public.properties (agent_id, source, external_id, title, intent,
--   property_type, price, currency, status, location_precision)
--   VALUES (NULL,'novest','PREC-3','x','sale','apartment',1,'GBP','active','area'); ROLLBACK;

-- (f5) A feed INSERT claiming 'exact' MUST FAIL 23514 — deliberate friction; relaxing
--      it for a future partner requires its own migration.
-- BEGIN; INSERT INTO public.properties (agent_id, source, external_id, title, intent,
--   property_type, price, currency, status, location_precision)
--   VALUES (NULL,'novest','PREC-4','x','sale','apartment',1,'GBP','active','exact'); ROLLBACK;

-- (f6) LEGACY PATH UNBROKEN — an AGENT insert with a pin and NO precision column,
--      exactly as PropertySubmitScreen writes it. MUST SUCCEED via the DEFAULT.
-- BEGIN; INSERT INTO public.properties (agent_id, title, intent, property_type, price,
--   currency, status, latitude, longitude)
--   SELECT id,'legacy pin','sale','apartment',1,'GBP','active',35.3408,33.3186
--   FROM public.estate_agents LIMIT 1; ROLLBACK;

-- (g) COORDINATE COUPLING — MUST FAIL 23514 naming properties_coords_precision_check.
--     Uses an AGENT row with an EXPLICIT NULL precision. A feed row CANNOT test this in
--     isolation any more: omitting precision takes the 'exact' default, so
--     properties_feed_precision_check fires instead and the coupling is never reached.
-- BEGIN; INSERT INTO public.properties (agent_id, title, intent, property_type, price,
--   currency, status, latitude, longitude, location_precision)
--   SELECT id,'coupling test','sale','apartment',1,'GBP','active',35.2100,33.3200,NULL
--   FROM public.estate_agents LIMIT 1; ROLLBACK;

-- (h) …the same row WITH precision declared MUST SUCCEED.
-- BEGIN; INSERT INTO public.properties (agent_id, title, intent, property_type, price,
--   currency, status, latitude, longitude, location_precision)
--   SELECT id,'coupling test','sale','apartment',1,'GBP','active',35.2100,33.3200,'exact'
--   FROM public.estate_agents LIMIT 1; ROLLBACK;


-- ═══ BLOCK V9 / 9 — LEDGER + DRIFT — run alone ═════════════════════════════
-- Then run these two files separately; BOTH must return ZERO rows:
--   supabase/migration_ledger_check.sql   (L1/L2/L3 — applied and unedited)
--   supabase/verify_schema.sql            (QUERY 1: scan for status <> 'OK')
SELECT filename, left(checksum,12)||'…' AS checksum, applied_by, applied_at
FROM public.schema_migrations_applied
WHERE filename = '20260904_accommodation_partner_feed.sql';
-- expect exactly ONE row, checksum 3d67911cde…, applied_by = postgres
