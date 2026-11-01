-- ═══════════════════════════════════════════════════════════════════════════
-- 20261153 — Döveç Construction: second partner source on the Novest rails
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Döveç is a developer, not an agency: its feed is PROJECTS (a site with a status, a build
-- progress and a delivery date) holding UNITS (the flats/villas for sale). The units go on the
-- existing rails — public.properties + property_images, source = 'dovec', the same content_hash
-- sync, the same image mirror, the same "no photo = hidden" rule. The project is the one thing
-- `properties` cannot hold, so it gets its own small table and every unit points at it.
--
-- WHAT THIS FILE DOES
--   1. public.property_projects — one row per Döveç project (source-aware, so a second developer
--      is data, not a migration). Exact coordinates are allowed HERE: a construction site is a
--      public place, unlike a flat for sale (units stay 'area', properties_feed_precision_check).
--   2. properties.project_id (FK) + properties.price_on_request. price becomes nullable, coupled:
--      price_on_request = true  <=> price IS NULL. Every existing row has price NOT NULL and the
--      new column defaults false, so every existing row satisfies the coupling with no backfill.
--   3. props_hide_photoless_novest is WIDENED to every feed source (same name, so the policy count
--      stays 8 and every reference to it in scripts/docs stays true for Novest). For a Novest row
--      the rule is unchanged: source = 'novest' satisfies `source IS NOT NULL` exactly as before.
--   4. The Döveç estate_agencies row, status 'pending'. THAT STATUS IS THE PUBLISH SWITCH:
--      sync-dovec writes new units/projects as 'pending' while the agency is pending, and the
--      go-live step flips agency + rows to 'active' together (module go-live SOP step 1/3).
--      Nothing in this file is readable by an app user.
--
-- WHO CAN READ / WRITE WHAT AFTER THIS (plain English)
--   property_projects SELECT
--     • anon, guests, customers: a project only when status = 'active' AND it has a mirrored cover
--       photo. Pending / delisted / photo-less projects are invisible.
--     • admins: every project, any status (is_admin()).
--     • service_role (sync-dovec, mirror-dovec-images): bypasses RLS.
--   property_projects INSERT / UPDATE / DELETE: nobody but service_role. No client grant at all.
--   properties: unchanged, except the photo rule now also hides a photo-less Döveç unit, and a
--     pending Döveç unit is invisible because props_select_public already requires status='active'.
--   estate_agencies: the Döveç row is 'pending', so agencies_select_public hides it from everyone
--     but admins until go-live.
--
-- Apply: gh workflow run supabase-migrate -f file=20261153_dovec_partner_feed.sql (dry), then
--        -f apply=true (waits for production-db). Then verify_schema.sql QUERY 1.
-- ═══════════════════════════════════════════════════════════════════════════

SET ROLE postgres;
BEGIN;
SET LOCAL lock_timeout = '5s';

-- ─── 0. PRE-FLIGHT ──────────────────────────────────────────────────────────
DO $$
DECLARE n int; names text;
BEGIN
  IF to_regclass('public.property_projects') IS NOT NULL THEN
    RAISE EXCEPTION '20261153: property_projects already exists — read it before re-running';
  END IF;
  IF to_regprocedure('private.property_has_photo(uuid)') IS NULL THEN
    RAISE EXCEPTION '20261153: private.property_has_photo(uuid) is absent (apply 20261068 first)';
  END IF;
  SELECT count(*), string_agg(policyname, ', ' ORDER BY policyname) INTO n, names
    FROM pg_policies WHERE schemaname = 'public' AND tablename = 'properties';
  IF n IS DISTINCT FROM 8 THEN
    RAISE EXCEPTION '20261153: properties has % policies, expected the 8 20261068 left: %', n, names;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'properties'
                  AND policyname = 'props_hide_photoless_novest' AND permissive = 'RESTRICTIVE' AND cmd = 'SELECT') THEN
    RAISE EXCEPTION '20261153: props_hide_photoless_novest is not a RESTRICTIVE SELECT policy today';
  END IF;
  IF EXISTS (SELECT 1 FROM public.properties WHERE source = 'dovec') THEN
    RAISE EXCEPTION '20261153: properties already holds source=dovec rows';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE role = 'admin') THEN
    RAISE EXCEPTION '20261153: no admin profile to own the Döveç agency row';
  END IF;
END $$;

-- ─── 1. PROJECTS ────────────────────────────────────────────────────────────
CREATE TABLE public.property_projects (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source                text NOT NULL,
  external_id           text NOT NULL,
  agency_id             uuid NOT NULL REFERENCES public.estate_agencies(id),
  name                  text NOT NULL,
  description           text,
  project_status        text NOT NULL,
  construction_progress int,
  delivery_date         date,
  unit_types            text[],
  price_from            numeric,
  currency              text,
  price_on_request      boolean NOT NULL DEFAULT false,
  district              text,
  area                  text,
  address               text,
  latitude              numeric,
  longitude             numeric,
  location_precision    text,
  cover_image_url       text,
  cover_source_url      text,
  source_url            text,
  status                text NOT NULL DEFAULT 'pending',
  content_hash          text,
  last_seen_at          timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT property_projects_external_id_unique UNIQUE (external_id),
  CONSTRAINT property_projects_name_check CHECK (char_length(name) BETWEEN 1 AND 200),
  CONSTRAINT property_projects_status_check CHECK (status IN ('pending','active','delisted')),
  CONSTRAINT property_projects_project_status_check
    CHECK (project_status IN ('selling','under_construction','delivered')),
  -- A delivered project is built: a progress figure other than 100 would contradict its status.
  CONSTRAINT property_projects_progress_check
    CHECK (construction_progress IS NULL
           OR (construction_progress BETWEEN 0 AND 100
               AND (project_status <> 'delivered' OR construction_progress = 100))),
  CONSTRAINT property_projects_unit_types_shape_check
    CHECK (unit_types IS NULL
           OR (cardinality(unit_types) BETWEEN 1 AND 30
               AND char_length(array_to_string(unit_types, ',')) <= 600)),
  CONSTRAINT property_projects_currency_check
    CHECK (currency IS NULL OR currency IN ('GBP','TRY','EUR','USD')),
  -- price_on_request is NOT NULL, so this cannot pass on UNKNOWN.
  CONSTRAINT property_projects_price_check
    CHECK ((price_on_request AND price_from IS NULL)
           OR (NOT price_on_request AND (price_from IS NULL OR (price_from > 0 AND currency IS NOT NULL)))),
  CONSTRAINT property_projects_district_check
    CHECK (district IS NULL OR district IN ('nicosia','kyrenia','famagusta','morphou','iskele','lefke','karpaz')),
  CONSTRAINT property_projects_location_precision_check
    CHECK (location_precision IS NULL OR location_precision IN ('exact','area')),
  -- Both or neither, inside Cyprus, and never without a declared precision. The box is the one
  -- coordsInCyprus() uses for Novest (_shared/novest-feed.mjs), widened to the island's west tip.
  CONSTRAINT property_projects_coords_check
    CHECK ((latitude IS NULL AND longitude IS NULL)
           OR (latitude IS NOT NULL AND longitude IS NOT NULL AND location_precision IS NOT NULL
               AND latitude BETWEEN 34.5 AND 35.8 AND longitude BETWEEN 32.2 AND 34.7))
);

COMMENT ON TABLE public.property_projects IS
  'Developer projects from a partner feed (source = ''dovec'' today). Written only by '
  'sync-dovec (service_role). Units are properties rows with project_id. A project is public '
  'only while status = ''active'' AND cover_image_url IS NOT NULL (pp_select_public).';
COMMENT ON COLUMN public.property_projects.status IS
  'ADA visibility, owned by the sync: pending (pre-launch, while the agency row is pending) | '
  'active | delisted (gone from the feed, row kept). NOT the build status — see project_status.';
COMMENT ON COLUMN public.property_projects.delivery_date IS
  'The partner''s planned delivery. A quarter ("2027-Q2") is stored as the quarter''s FIRST day '
  'and rendered as a quarter, never as a day.';
COMMENT ON COLUMN public.property_projects.cover_image_url IS
  'Mirrored cover photo in property-images/partner/dovec/… (mirror-dovec-images.mjs). NULL = '
  'not mirrored yet, and the project is hidden from app users until it is.';

CREATE INDEX property_projects_agency_status_idx ON public.property_projects (agency_id, status);

ALTER TABLE public.property_projects ENABLE ROW LEVEL SECURITY;
-- Supabase's default privileges hand anon/authenticated ALL on a new table; take it back to
-- SELECT only. service_role keeps ALL (it bypasses RLS and is the only writer).
REVOKE ALL ON public.property_projects FROM anon, authenticated;
GRANT SELECT ON public.property_projects TO anon, authenticated;

CREATE POLICY pp_select_public ON public.property_projects
  FOR SELECT TO public
  USING ((status = 'active' AND cover_image_url IS NOT NULL) OR public.is_admin());

-- ─── 2. UNITS ON properties ─────────────────────────────────────────────────
ALTER TABLE public.properties ADD COLUMN project_id uuid
  REFERENCES public.property_projects(id) ON DELETE SET NULL;
ALTER TABLE public.properties ADD COLUMN price_on_request boolean NOT NULL DEFAULT false;
ALTER TABLE public.properties ALTER COLUMN price DROP NOT NULL;

ALTER TABLE public.properties ADD CONSTRAINT properties_price_on_request_check
  CHECK ((price_on_request AND price IS NULL) OR (NOT price_on_request AND price IS NOT NULL));
-- Only a partner-feed row belongs to a partner project; an agent listing never does.
ALTER TABLE public.properties ADD CONSTRAINT properties_project_feed_check
  CHECK (project_id IS NULL OR source IS NOT NULL);

COMMENT ON COLUMN public.properties.project_id IS
  'The developer project a partner unit belongs to (property_projects). NULL for every agent '
  'listing and every Novest listing.';
COMMENT ON COLUMN public.properties.price_on_request IS
  'true = the partner publishes no price ("fiyat sorunuz"); price is then NULL, enforced by '
  'properties_price_on_request_check. Clients must render a label, never "£null".';

CREATE INDEX properties_project_id_idx ON public.properties (project_id) WHERE project_id IS NOT NULL;

-- ─── 3. THE PHOTO RULE, FOR EVERY FEED SOURCE ───────────────────────────────
DROP POLICY props_hide_photoless_novest ON public.properties;
CREATE POLICY props_hide_photoless_novest ON public.properties
  AS RESTRICTIVE
  FOR SELECT TO public
  USING (source IS NULL OR public.is_admin() OR private.property_has_photo(id));

COMMENT ON POLICY props_hide_photoless_novest ON public.properties IS
  'Every PARTNER-FEED listing (source IS NOT NULL: novest, dovec) with no property_images row is '
  'hidden from non-admins; agent listings are untouched. Name kept from 20261068 (Novest-only '
  'then) so scripts and docs that name it stay true. Widened by 20261153.';

-- ─── 4. THE DÖVEÇ AGENCY ROW (pending = not launched) ───────────────────────
INSERT INTO public.estate_agencies (id, owner_id, name, status, website, description,
                                    contact_phone, contact_whatsapp)
SELECT '00000000-0000-4000-9000-000000000003'::uuid,
       p.id,
       'Döveç Construction',
       'pending',
       'https://www.dovecconstruction.com',
       'Partner developer (Döveç Group). Projects and units are mirrored one-way from the '
       'developer''s API and are not editable in ADA.',
       '+905391050515',
       '+905391050515'
  FROM public.profiles p
 WHERE p.role = 'admin'
 ORDER BY p.id
 LIMIT 1;

-- ─── 5. ASSERTIONS — any failure rolls back the whole file ──────────────────
-- (a) Catalog post-state, derived and printed.
DO $$
DECLARE n int; names text; q text;
BEGIN
  SELECT count(*), string_agg(policyname, ', ' ORDER BY policyname) INTO n, names
    FROM pg_policies WHERE schemaname = 'public' AND tablename = 'properties';
  IF n IS DISTINCT FROM 8 THEN RAISE EXCEPTION '20261153: properties has % policies after, expected 8: %', n, names; END IF;
  SELECT qual INTO q FROM pg_policies WHERE schemaname = 'public' AND tablename = 'properties'
     AND policyname = 'props_hide_photoless_novest' AND permissive = 'RESTRICTIVE' AND cmd = 'SELECT';
  IF q IS NULL OR q NOT LIKE '%source IS NULL%' OR q NOT LIKE '%is_admin()%' OR q NOT LIKE '%property_has_photo(id)%' OR q LIKE '%novest%' THEN
    RAISE EXCEPTION '20261153: widened photo policy reads %', coalesce(q, '<missing>');
  END IF;
  SELECT count(*), string_agg(policyname || ':' || permissive || ':' || cmd, ', ' ORDER BY policyname) INTO n, names
    FROM pg_policies WHERE schemaname = 'public' AND tablename = 'property_projects';
  IF n IS DISTINCT FROM 1 THEN RAISE EXCEPTION '20261153: property_projects has % policies, expected 1: %', n, names; END IF;
  IF has_table_privilege('anon', 'public.property_projects', 'INSERT,UPDATE,DELETE,TRUNCATE')
     OR has_table_privilege('authenticated', 'public.property_projects', 'INSERT,UPDATE,DELETE,TRUNCATE') THEN
    RAISE EXCEPTION '20261153: a client role can write property_projects';
  END IF;
  IF NOT has_table_privilege('anon', 'public.property_projects', 'SELECT') THEN
    RAISE EXCEPTION '20261153: CONTROL FAILED — anon cannot SELECT property_projects at all';
  END IF;
  IF (SELECT status FROM public.estate_agencies WHERE id = '00000000-0000-4000-9000-000000000003') IS DISTINCT FROM 'pending' THEN
    RAISE EXCEPTION '20261153: Döveç agency row missing or not pending';
  END IF;
END $$;

-- (b) Behaviour, with probe rows that are DELETED before COMMIT. Four projects/units cover every
-- arm: active+cover, active without cover, pending+cover; unit with photo, without, pending.
INSERT INTO public.property_projects (id, source, external_id, agency_id, name, project_status, status, cover_image_url)
VALUES ('00000000-0000-4000-9153-000000000001', 'dovec', 'zz-probe-1153-a', '00000000-0000-4000-9000-000000000003', 'probe a', 'selling', 'active', 'https://x/a.jpg'),
       ('00000000-0000-4000-9153-000000000002', 'dovec', 'zz-probe-1153-b', '00000000-0000-4000-9000-000000000003', 'probe b', 'selling', 'active', NULL),
       ('00000000-0000-4000-9153-000000000003', 'dovec', 'zz-probe-1153-c', '00000000-0000-4000-9000-000000000003', 'probe c', 'selling', 'pending', 'https://x/c.jpg');
INSERT INTO public.properties (id, source, external_id, agency_id, project_id, title, intent, property_type,
                               price, price_on_request, currency, price_period, status, location_precision)
VALUES ('00000000-0000-4000-9153-0000000000a1', 'dovec', 'zz-probe-1153-u1', '00000000-0000-4000-9000-000000000003',
        '00000000-0000-4000-9153-000000000001', 'probe unit photo', 'sale', 'apartment', NULL, true, 'GBP', 'total', 'active', 'area'),
       ('00000000-0000-4000-9153-0000000000a2', 'dovec', 'zz-probe-1153-u2', '00000000-0000-4000-9000-000000000003',
        '00000000-0000-4000-9153-000000000001', 'probe unit no photo', 'sale', 'apartment', 150000, false, 'GBP', 'total', 'active', 'area'),
       ('00000000-0000-4000-9153-0000000000a3', 'dovec', 'zz-probe-1153-u3', '00000000-0000-4000-9000-000000000003',
        '00000000-0000-4000-9153-000000000001', 'probe unit pending', 'sale', 'apartment', 150000, false, 'GBP', 'total', 'pending', 'area');
INSERT INTO public.property_images (property_id, url, is_primary)
VALUES ('00000000-0000-4000-9153-0000000000a1', 'https://x/u1.jpg', true),
       ('00000000-0000-4000-9153-0000000000a3', 'https://x/u3.jpg', true);

-- The coupling refuses both broken shapes (sub-blocks roll back their own insert).
DO $$
DECLARE r1 text := 'not run'; r2 text := 'not run';
BEGIN
  BEGIN
    INSERT INTO public.properties (source, external_id, agency_id, title, intent, property_type, price, price_on_request, currency, status, location_precision)
    VALUES ('dovec', 'zz-probe-1153-bad1', '00000000-0000-4000-9000-000000000003', 'x', 'sale', 'apartment', NULL, false, 'GBP', 'pending', 'area');
    r1 := 'ACCEPTED';
  EXCEPTION WHEN check_violation THEN r1 := 'refused';
  END;
  BEGIN
    INSERT INTO public.properties (source, external_id, agency_id, title, intent, property_type, price, price_on_request, currency, status, location_precision)
    VALUES ('dovec', 'zz-probe-1153-bad2', '00000000-0000-4000-9000-000000000003', 'x', 'sale', 'apartment', 1, true, 'GBP', 'pending', 'area');
    r2 := 'ACCEPTED';
  EXCEPTION WHEN check_violation THEN r2 := 'refused';
  END;
  IF r1 IS DISTINCT FROM 'refused' THEN RAISE EXCEPTION '20261153: price NULL without price_on_request was %', r1; END IF;
  IF r2 IS DISTINCT FROM 'refused' THEN RAISE EXCEPTION '20261153: a price WITH price_on_request was %', r2; END IF;
  PERFORM set_config('mig1153.admin', (SELECT id::text FROM public.profiles WHERE role = 'admin' ORDER BY id LIMIT 1), true);
END $$;

SET LOCAL ROLE anon;
DO $$
DECLARE projects text; units text;
BEGIN
  SELECT string_agg(external_id, ',' ORDER BY external_id) INTO projects FROM public.property_projects WHERE external_id LIKE 'zz-probe-1153-%';
  SELECT string_agg(external_id, ',' ORDER BY external_id) INTO units FROM public.properties WHERE external_id LIKE 'zz-probe-1153-%';
  IF projects IS DISTINCT FROM 'zz-probe-1153-a' THEN RAISE EXCEPTION '20261153 anon: sees projects %, expected only a (active + cover)', projects; END IF;
  IF units IS DISTINCT FROM 'zz-probe-1153-u1' THEN RAISE EXCEPTION '20261153 anon: sees units %, expected only u1 (active + photo)', units; END IF;
END $$;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000011f3","role":"authenticated","is_anonymous":true}', true);
DO $$
DECLARE projects text; units text;
BEGIN
  SELECT string_agg(external_id, ',' ORDER BY external_id) INTO projects FROM public.property_projects WHERE external_id LIKE 'zz-probe-1153-%';
  SELECT string_agg(external_id, ',' ORDER BY external_id) INTO units FROM public.properties WHERE external_id LIKE 'zz-probe-1153-%';
  IF projects IS DISTINCT FROM 'zz-probe-1153-a' THEN RAISE EXCEPTION '20261153 guest: sees projects %, expected only a', projects; END IF;
  IF units IS DISTINCT FROM 'zz-probe-1153-u1' THEN RAISE EXCEPTION '20261153 guest: sees units %, expected only u1', units; END IF;
  IF EXISTS (SELECT 1 FROM public.estate_agencies WHERE id = '00000000-0000-4000-9000-000000000003') THEN
    RAISE EXCEPTION '20261153 guest: the pending Döveç agency row is readable';
  END IF;
END $$;

SELECT set_config('request.jwt.claims', json_build_object('sub', current_setting('mig1153.admin'), 'role', 'authenticated')::text, true);
DO $$
DECLARE n_p int; n_u int;
BEGIN
  SELECT count(*) INTO n_p FROM public.property_projects WHERE external_id LIKE 'zz-probe-1153-%';
  SELECT count(*) INTO n_u FROM public.properties WHERE external_id LIKE 'zz-probe-1153-%';
  IF n_p IS DISTINCT FROM 3 OR n_u IS DISTINCT FROM 3 THEN
    RAISE EXCEPTION '20261153 admin: sees % projects / % units, expected all 3 / 3', n_p, n_u;
  END IF;
END $$;

SELECT set_config('request.jwt.claims', '', true);
SET LOCAL ROLE postgres;

DELETE FROM public.properties WHERE external_id LIKE 'zz-probe-1153-%';
DELETE FROM public.property_projects WHERE external_id LIKE 'zz-probe-1153-%';
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.properties WHERE external_id LIKE 'zz-probe-1153-%')
     OR EXISTS (SELECT 1 FROM public.property_projects WHERE external_id LIKE 'zz-probe-1153-%')
     OR EXISTS (SELECT 1 FROM public.property_images WHERE url LIKE 'https://x/u%.jpg') THEN
    RAISE EXCEPTION '20261153: probe rows survived the cleanup';
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
VALUES ('20261153_dovec_partner_feed.sql', 'd1ca92fbd64562602c542323b93aa8e56aeafffe81c1b433e3b3e00ba9ec7be4')
ON CONFLICT (filename) DO UPDATE
  SET checksum = excluded.checksum, applied_at = now(), applied_by = current_user;
-- ─── ledger:stamp:end ────────────────────────────────────────────────
COMMIT;
RESET ROLE;

NOTIFY pgrst, 'reload schema';

-- ─── Rollback (only while no source='dovec' row exists) ─────────────────────
--   DROP POLICY props_hide_photoless_novest ON public.properties;
--   CREATE POLICY props_hide_photoless_novest ON public.properties AS RESTRICTIVE FOR SELECT TO public
--     USING (source IS DISTINCT FROM 'novest' OR public.is_admin() OR private.property_has_photo(id));
--   ALTER TABLE public.properties DROP CONSTRAINT properties_price_on_request_check,
--     DROP CONSTRAINT properties_project_feed_check, DROP COLUMN price_on_request, DROP COLUMN project_id;
--   ALTER TABLE public.properties ALTER COLUMN price SET NOT NULL;
--   DROP TABLE public.property_projects;
--   DELETE FROM public.estate_agencies WHERE id = '00000000-0000-4000-9000-000000000003';
