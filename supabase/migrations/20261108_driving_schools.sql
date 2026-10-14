-- ═══════════════════════════════════════════════════════════════════════════
-- 20261108 — Ehliyet: driving schools (partner directory), DARK
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Two tables on the towing_companies precedent (20260905 / 20260907): an admin-seeded partner
-- directory that ships INACTIVE and is activated by one UPDATE (SOP step 3). Not home_services:
-- that table carries owner/status semantics we do not want here.
--
-- ─── WHO CAN READ / WRITE ───────────────────────────────────────────────────
--   • driving_schools, READ: anyone using the app (anon, signed-in, guest) sees a school only
--     while it is active (is_active). An inactive school is invisible to every client role.
--     Public business-directory data (name, phone number, WhatsApp number, Instagram and Facebook
--     links, e-mail address, licence classes taught, branch town and street address); a
--     business's own published contact details, no personal data.
--   • driving_school_branches, READ: anyone sees a branch only while its school is active (the
--     policy asks driving_schools, so a branch can never outlive its school's visibility).
--   • WRITE, both tables: service_role only (migrations / the admin's SQL). No client write
--     policy and no client write privilege: a customer, a provider and a guest cannot insert,
--     edit or delete a school or a branch.
--   • Neither table holds anything about the person reading it.
--
-- ─── ACTIVATION (separate from MODULE_FLAGS.ehliyet) ────────────────────────
--   UPDATE public.driving_schools SET is_active = true WHERE id = '<id>';
--
-- ─── phones validation, no helper function ──────────────────────────────────
-- A CHECK cannot hold a subquery, so per-element validation would need an IMMUTABLE helper
-- function (a new object to register, own and drop). Instead the array is joined with a newline
-- (which the element alphabet [0-9 ] cannot contain, so element boundaries are unambiguous) and
-- matched against 'element(\nelement)*'. array_to_string SKIPS NULL elements, so a NULL element
-- is refused separately via array_position(phones, NULL).
--
-- Apply: gh workflow run supabase-migrate -f file=20261108_driving_schools.sql (dry), then
-- -f apply=true. New tables ⇒ ends with NOTIFY pgrst (after COMMIT).
-- ═══════════════════════════════════════════════════════════════════════════

SET ROLE postgres;

BEGIN;

SET LOCAL lock_timeout = '5s';

-- ─── driving_schools ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.driving_schools (
  id            uuid        NOT NULL DEFAULT gen_random_uuid(),
  name          text        NOT NULL,
  logo_key      text,
  phones        text[]      NOT NULL,
  whatsapp      text,
  instagram_url text,
  facebook_url  text,
  email         text,
  licence_classes text[]    NOT NULL DEFAULT '{}',
  featured      boolean     NOT NULL DEFAULT false,
  sort_order    int         NOT NULL DEFAULT 0,
  is_active     boolean     NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT driving_schools_pkey PRIMARY KEY (id)
);
ALTER TABLE public.driving_schools DROP CONSTRAINT IF EXISTS driving_schools_name_check;
ALTER TABLE public.driving_schools ADD  CONSTRAINT driving_schools_name_check
  CHECK (length(btrim(name)) BETWEEN 2 AND 120);
ALTER TABLE public.driving_schools DROP CONSTRAINT IF EXISTS driving_schools_logo_key_check;
ALTER TABLE public.driving_schools ADD  CONSTRAINT driving_schools_logo_key_check
  CHECK (logo_key IS NULL OR logo_key ~ '^[a-z0-9-]+/[a-z0-9-]+$');
ALTER TABLE public.driving_schools DROP CONSTRAINT IF EXISTS driving_schools_phones_check;
ALTER TABLE public.driving_schools ADD  CONSTRAINT driving_schools_phones_check
  CHECK (cardinality(phones) BETWEEN 1 AND 5
         AND array_ndims(phones) = 1
         AND array_position(phones, NULL) IS NULL
         AND array_to_string(phones, E'\n') ~ E'^\\+[0-9][0-9 ]{7,19}(\\n\\+[0-9][0-9 ]{7,19})*$');
ALTER TABLE public.driving_schools DROP CONSTRAINT IF EXISTS driving_schools_whatsapp_check;
ALTER TABLE public.driving_schools ADD  CONSTRAINT driving_schools_whatsapp_check
  CHECK (whatsapp IS NULL OR whatsapp ~ '^\+[0-9][0-9 ]{7,19}$');
ALTER TABLE public.driving_schools DROP CONSTRAINT IF EXISTS driving_schools_instagram_url_check;
ALTER TABLE public.driving_schools ADD  CONSTRAINT driving_schools_instagram_url_check
  CHECK (instagram_url IS NULL OR instagram_url ~ '^https://(www\.)?instagram\.com/[A-Za-z0-9._]+/?$');

ALTER TABLE public.driving_schools DROP CONSTRAINT IF EXISTS driving_schools_facebook_url_check;
ALTER TABLE public.driving_schools ADD  CONSTRAINT driving_schools_facebook_url_check
  CHECK (facebook_url IS NULL OR facebook_url ~ '^https://(www\.)?facebook\.com/[A-Za-z0-9.]+/?$');
ALTER TABLE public.driving_schools DROP CONSTRAINT IF EXISTS driving_schools_email_check;
ALTER TABLE public.driving_schools ADD  CONSTRAINT driving_schools_email_check
  CHECK (email IS NULL OR (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' AND length(email) <= 254));
-- licence_classes: a subset of the twelve classes, one dimension, no NULL element, no repeats.
-- The repeat test is a backreference over the comma-joined array (no helper function; the
-- alphabet cannot contain a comma, so ['H','H1'] is not a repeat but ['H','H'] is).
ALTER TABLE public.driving_schools DROP CONSTRAINT IF EXISTS driving_schools_licence_classes_check;
ALTER TABLE public.driving_schools ADD  CONSTRAINT driving_schools_licence_classes_check
  CHECK (cardinality(licence_classes) <= 12
         AND COALESCE(array_ndims(licence_classes), 1) = 1
         AND array_position(licence_classes, NULL) IS NULL
         AND licence_classes <@ ARRAY['A','B','C','D','E','F','G','H','H1','H2','J','K']::text[]
         AND array_to_string(licence_classes, ',') !~ '(^|,)([^,]+),(.*,)?\2(,|$)');

-- ─── driving_school_branches ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.driving_school_branches (
  id          bigint           GENERATED ALWAYS AS IDENTITY,
  school_id   uuid             NOT NULL,
  region      text             NOT NULL,
  address     text,
  lat         double precision,
  lng         double precision,
  geocode_source text,
  sort_order  int              NOT NULL DEFAULT 0,
  CONSTRAINT driving_school_branches_pkey PRIMARY KEY (id)
);
ALTER TABLE public.driving_school_branches DROP CONSTRAINT IF EXISTS driving_school_branches_school_id_fkey;
ALTER TABLE public.driving_school_branches ADD  CONSTRAINT driving_school_branches_school_id_fkey
  FOREIGN KEY (school_id) REFERENCES public.driving_schools (id) ON DELETE CASCADE;
ALTER TABLE public.driving_school_branches DROP CONSTRAINT IF EXISTS driving_school_branches_school_region_key;
ALTER TABLE public.driving_school_branches ADD  CONSTRAINT driving_school_branches_school_region_key UNIQUE (school_id, region);
ALTER TABLE public.driving_school_branches DROP CONSTRAINT IF EXISTS driving_school_branches_region_check;
ALTER TABLE public.driving_school_branches ADD  CONSTRAINT driving_school_branches_region_check
  CHECK (region IN ('nicosia','kyrenia','famagusta','morphou','iskele','lefke','karpaz'));
ALTER TABLE public.driving_school_branches DROP CONSTRAINT IF EXISTS driving_school_branches_coords_check;
ALTER TABLE public.driving_school_branches ADD  CONSTRAINT driving_school_branches_coords_check
  CHECK (((lat IS NULL) = (lng IS NULL))
         AND (lat IS NULL OR (lat BETWEEN 34.5 AND 35.8 AND lng BETWEEN 32.2 AND 34.8)));
ALTER TABLE public.driving_school_branches DROP CONSTRAINT IF EXISTS driving_school_branches_address_check;
ALTER TABLE public.driving_school_branches ADD  CONSTRAINT driving_school_branches_address_check
  CHECK (address IS NULL OR length(btrim(address)) BETWEEN 5 AND 200);
-- OSM only: Google Places pins are an accepted risk for pharmacies and hotels, not here.
ALTER TABLE public.driving_school_branches DROP CONSTRAINT IF EXISTS driving_school_branches_geocode_source_check;
ALTER TABLE public.driving_school_branches ADD  CONSTRAINT driving_school_branches_geocode_source_check
  CHECK (geocode_source IS NULL OR geocode_source IN ('osm'));
-- Two-way: a pin has a provenance and a provenance has a pin (as hotels_coords_provenance_check).
ALTER TABLE public.driving_school_branches DROP CONSTRAINT IF EXISTS driving_school_branches_provenance_check;
ALTER TABLE public.driving_school_branches ADD  CONSTRAINT driving_school_branches_provenance_check
  CHECK ((lat IS NULL) = (geocode_source IS NULL));

CREATE INDEX IF NOT EXISTS driving_school_branches_school_idx ON public.driving_school_branches (school_id);

-- ─── RLS and grants ─────────────────────────────────────────────────────────
ALTER TABLE public.driving_schools         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.driving_school_branches ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.driving_schools, public.driving_school_branches FROM anon, authenticated;
GRANT SELECT ON TABLE public.driving_schools, public.driving_school_branches TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.driving_schools, public.driving_school_branches TO service_role;

DROP POLICY IF EXISTS driving_schools_select_active ON public.driving_schools;
CREATE POLICY driving_schools_select_active ON public.driving_schools
  FOR SELECT TO anon, authenticated
  USING (is_active);

DROP POLICY IF EXISTS driving_school_branches_select_active ON public.driving_school_branches;
CREATE POLICY driving_school_branches_select_active ON public.driving_school_branches
  FOR SELECT TO anon, authenticated
  USING (EXISTS (SELECT 1 FROM public.driving_schools s WHERE s.id = driving_school_branches.school_id AND s.is_active));

-- ─── Seed: Seyhun Bıkmaz Şoför Okulu, INACTIVE ─────────────────────────────
-- The id is fixed: the app's preview fixture uses the same id.
INSERT INTO public.driving_schools (id, name, logo_key, phones, whatsapp, instagram_url, facebook_url, email,
                                     licence_classes, featured, sort_order, is_active)
VALUES ('7b1e0c2a-5d4f-4e8b-9a61-3c2f8e0d4b17', 'Seyhun Bıkmaz Şoför Okulu', 'seyhun/logo',
        ARRAY['+90 533 887 39 99'], '+90 533 887 39 99',
        'https://instagram.com/seyhunbikmazsoforokulu',
        'https://www.facebook.com/seyhunbikmazsoforokulu',
        'seyhunbikmazsoforokulu@gmail.com',
        ARRAY['A','B','C','D','E','F','G','H','H1','H2','J','K'], true, 0, false)
ON CONFLICT (id) DO NOTHING;

-- Lefkoşa has a street address; Güzelyurt stays town-only (no address, no pin). Both pin columns
-- and geocode_source are NULL unless an OSM element corroborated the address (see the
-- geocode_source CHECK: OSM only).
INSERT INTO public.driving_school_branches (school_id, region, address, lat, lng, geocode_source, sort_order)
VALUES ('7b1e0c2a-5d4f-4e8b-9a61-3c2f8e0d4b17', 'nicosia', 'Şehit Fevait Ali Sokak 4/B, Göçmenköy, Lefkoşa', NULL, NULL, NULL, 0),
       ('7b1e0c2a-5d4f-4e8b-9a61-3c2f8e0d4b17', 'morphou', NULL, NULL, NULL, NULL, 1)
ON CONFLICT (school_id, region) DO NOTHING;

-- ─── Assertions (inside the transaction; a failure rolls the file back) ─────
DO $$
DECLARE
  v_policies   text;
  v_n_sch      int;
  v_n_br       int;
  v_nonsel     int;
  v_badroles   int;
  v_rls        int;
  v_priv       text;
  v_def        text;
  v_seed_act   boolean;
  v_seed_n     int;
  v_seed_br    int;
  v_probe_on   uuid;
  v_probe_off  uuid;
  v_anon_sch   int; v_anon_br int;
  v_auth_sch   int; v_auth_br int;
  v_own_sch    int; v_own_br  int;
  v_anon_write text := 'not run';
  v_auth_write text := 'not run';
  v_br_write   text := 'not run';
  v_bad_phone  text := 'not run';
  v_bad_null   text := 'not run';
  v_bad_region text := 'not run';
  v_bad_coords text := 'not run';
  v_bad_insta  text := 'not run';
  v_bad_fb     text := 'not run';
  v_bad_fbhost text := 'not run';
  v_bad_email  text := 'not run';
  v_bad_emlong text := 'not run';
  v_bad_class  text := 'not run';
  v_bad_dup    text := 'not run';
  v_bad_clnull text := 'not run';
  v_bad_clmd   text := 'not run';
  v_bad_addr   text := 'not run';
  v_bad_addrlg text := 'not run';
  v_bad_gsrc   text := 'not run';
  v_bad_provA  text := 'not run';
  v_bad_provB  text := 'not run';
  v_good_sch   text := 'not run';
  v_good_br    text := 'not run';
  v_sd         public.driving_schools%ROWTYPE;
  v_nic        public.driving_school_branches%ROWTYPE;
  v_mor        public.driving_school_branches%ROWTYPE;
BEGIN
  -- The FULL policy set on both tables, printed: presence of mine never proves absence of others.
  SELECT count(*) FILTER (WHERE tablename = 'driving_schools'),
         count(*) FILTER (WHERE tablename = 'driving_school_branches'),
         count(*) FILTER (WHERE cmd IS DISTINCT FROM 'SELECT' OR permissive IS DISTINCT FROM 'PERMISSIVE'),
         count(*) FILTER (WHERE roles::text[] IS DISTINCT FROM ARRAY['anon','authenticated']::text[]),
         string_agg(tablename || '.' || policyname || ' ' || cmd || ' ' || array_to_string(roles, ',') || ' USING ' || coalesce(qual, '<none>'), '; ' ORDER BY tablename, policyname)
    INTO v_n_sch, v_n_br, v_nonsel, v_badroles, v_policies
    FROM pg_policies WHERE schemaname = 'public' AND tablename IN ('driving_schools','driving_school_branches');
  IF v_n_sch IS DISTINCT FROM 1 OR v_n_br IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'policy set: driving_schools % (want 1), driving_school_branches % (want 1): %', v_n_sch, v_n_br, v_policies;
  END IF;
  IF v_nonsel IS DISTINCT FROM 0 OR v_badroles IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'a policy is not a permissive SELECT for exactly {anon,authenticated}: %', v_policies;
  END IF;

  SELECT count(*) INTO v_rls FROM pg_class
   WHERE oid IN ('public.driving_schools'::regclass, 'public.driving_school_branches'::regclass) AND relrowsecurity;
  IF v_rls IS DISTINCT FROM 2 THEN RAISE EXCEPTION 'RLS is not enabled on both tables (% of 2)', v_rls; END IF;

  -- Grants, per role, derived from the catalog. Denial and the positive control side by side.
  SELECT string_agg(t || ':' || r || ' sel=' || has_table_privilege(r, t, 'SELECT')
                    || ' write=' || has_table_privilege(r, t, 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'), '; ' ORDER BY t, r)
    INTO v_priv
    FROM unnest(ARRAY['public.driving_schools','public.driving_school_branches']) t,
         unnest(ARRAY['anon','authenticated']) r;
  IF EXISTS (SELECT 1 FROM unnest(ARRAY['public.driving_schools','public.driving_school_branches']) t,
                                unnest(ARRAY['anon','authenticated']) r
              WHERE NOT has_table_privilege(r, t, 'SELECT')
                 OR has_table_privilege(r, t, 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')) THEN
    RAISE EXCEPTION 'client grants wrong (want SELECT only): %', v_priv;
  END IF;
  IF NOT (has_table_privilege('service_role', 'public.driving_schools', 'SELECT,INSERT,UPDATE,DELETE')
      AND has_table_privilege('service_role', 'public.driving_school_branches', 'SELECT,INSERT,UPDATE,DELETE')) THEN
    RAISE EXCEPTION 'CONTROL FAILED: service_role lost write access';
  END IF;

  IF (SELECT column_default FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'driving_schools' AND column_name = 'is_active') IS DISTINCT FROM 'false' THEN
    RAISE EXCEPTION 'driving_schools.is_active DEFAULT is not false';
  END IF;
  IF (SELECT count(*) FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'driving_schools' AND column_name = 'licence_classes'
         AND is_nullable = 'NO' AND column_default LIKE '''{}''::text[]%') IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'driving_schools.licence_classes is not NOT NULL DEFAULT {}: %',
      (SELECT column_default || ' nullable=' || is_nullable FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'driving_schools' AND column_name = 'licence_classes');
  END IF;

  -- Seed: present, inactive, two branches.
  SELECT count(*), bool_or(is_active) INTO v_seed_n, v_seed_act FROM public.driving_schools
   WHERE id = '7b1e0c2a-5d4f-4e8b-9a61-3c2f8e0d4b17';
  SELECT count(*) INTO v_seed_br FROM public.driving_school_branches
   WHERE school_id = '7b1e0c2a-5d4f-4e8b-9a61-3c2f8e0d4b17';
  IF v_seed_n IS DISTINCT FROM 1 OR v_seed_act IS DISTINCT FROM false OR v_seed_br IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION 'seed: rows=% is_active=% branches=% (want 1 / false / 2)', v_seed_n, v_seed_act, v_seed_br;
  END IF;
  IF (SELECT count(*) FROM public.driving_schools) IS DISTINCT FROM (SELECT count(*) FROM public.driving_schools WHERE NOT is_active) THEN
    RAISE EXCEPTION 'an active school exists before activation';
  END IF;

  -- Seed values, field by field (order-sensitive for licence_classes).
  SELECT * INTO v_sd  FROM public.driving_schools WHERE id = '7b1e0c2a-5d4f-4e8b-9a61-3c2f8e0d4b17';
  SELECT * INTO v_nic FROM public.driving_school_branches WHERE school_id = v_sd.id AND region = 'nicosia';
  SELECT * INTO v_mor FROM public.driving_school_branches WHERE school_id = v_sd.id AND region = 'morphou';
  IF v_sd.phones IS DISTINCT FROM ARRAY['+90 533 887 39 99']::text[]
     OR v_sd.whatsapp IS DISTINCT FROM '+90 533 887 39 99'
     OR v_sd.instagram_url IS DISTINCT FROM 'https://instagram.com/seyhunbikmazsoforokulu'
     OR v_sd.facebook_url IS DISTINCT FROM 'https://www.facebook.com/seyhunbikmazsoforokulu'
     OR v_sd.email IS DISTINCT FROM 'seyhunbikmazsoforokulu@gmail.com'
     OR v_sd.licence_classes IS DISTINCT FROM ARRAY['A','B','C','D','E','F','G','H','H1','H2','J','K']::text[] THEN
    RAISE EXCEPTION 'seed school: phones=% whatsapp=% instagram=% facebook=% email=% classes=%',
      v_sd.phones, v_sd.whatsapp, v_sd.instagram_url, v_sd.facebook_url, v_sd.email, v_sd.licence_classes;
  END IF;
  IF v_nic.address IS DISTINCT FROM 'Şehit Fevait Ali Sokak 4/B, Göçmenköy, Lefkoşa'
     OR v_nic.lat IS DISTINCT FROM NULL::double precision OR v_nic.lng IS DISTINCT FROM NULL::double precision
     OR v_nic.geocode_source IS DISTINCT FROM NULL::text THEN
    RAISE EXCEPTION 'seed nicosia branch: address=% lat=% lng=% source=%', v_nic.address, v_nic.lat, v_nic.lng, v_nic.geocode_source;
  END IF;
  IF v_mor.address IS NOT NULL OR v_mor.lat IS NOT NULL OR v_mor.lng IS NOT NULL OR v_mor.geocode_source IS NOT NULL THEN
    RAISE EXCEPTION 'seed morphou branch must be town-only: address=% lat=% lng=% source=%', v_mor.address, v_mor.lat, v_mor.lng, v_mor.geocode_source;
  END IF;

  -- BEHAVIOUR, rolled back by a sentinel. PL/pgSQL variables survive it; rows do not.
  BEGIN
    INSERT INTO public.driving_schools (name, phones, is_active) VALUES ('zz on',  ARRAY['+90 533 000 00 01'], true)  RETURNING id INTO v_probe_on;
    INSERT INTO public.driving_schools (name, phones, is_active) VALUES ('zz off', ARRAY['+90 533 000 00 02'], false) RETURNING id INTO v_probe_off;
    INSERT INTO public.driving_school_branches (school_id, region) VALUES (v_probe_on, 'kyrenia'), (v_probe_off, 'kyrenia');

    SET LOCAL ROLE anon;
    SELECT count(*) INTO v_anon_sch FROM public.driving_schools WHERE name LIKE 'zz %';
    SELECT count(*) INTO v_anon_br  FROM public.driving_school_branches WHERE school_id IN (v_probe_on, v_probe_off);
    BEGIN
      INSERT INTO public.driving_schools (name, phones) VALUES ('zz anon', ARRAY['+90 533 000 00 03']);
      v_anon_write := 'ALLOWED';
    EXCEPTION WHEN insufficient_privilege THEN v_anon_write := 'denied';
    END;
    RESET ROLE;

    -- authenticated covers every signed-in user AND every guest.
    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text, true);
    SELECT count(*) INTO v_auth_sch FROM public.driving_schools WHERE name LIKE 'zz %';
    SELECT count(*) INTO v_auth_br  FROM public.driving_school_branches WHERE school_id IN (v_probe_on, v_probe_off);
    BEGIN
      UPDATE public.driving_schools SET name = 'zz hijack' WHERE id = v_probe_on;
      v_auth_write := 'ALLOWED';
    EXCEPTION WHEN insufficient_privilege THEN v_auth_write := 'denied';
    END;
    BEGIN
      DELETE FROM public.driving_school_branches WHERE school_id = v_probe_on;
      v_br_write := 'ALLOWED';
    EXCEPTION WHEN insufficient_privilege THEN v_br_write := 'denied';
    END;
    PERFORM set_config('request.jwt.claims', '', true);
    RESET ROLE;

    -- Control: the owner sees both probe schools and both probe branches, so a 1 above is the policy.
    SELECT count(*) INTO v_own_sch FROM public.driving_schools WHERE name LIKE 'zz %';
    SELECT count(*) INTO v_own_br  FROM public.driving_school_branches WHERE school_id IN (v_probe_on, v_probe_off);

    BEGIN
      INSERT INTO public.driving_schools (name, phones) VALUES ('zz badphone', ARRAY['+90 533 000 00 04','0533 000 00 05']);
      v_bad_phone := 'ACCEPTED';
    EXCEPTION WHEN check_violation THEN v_bad_phone := 'refused';
    END;
    BEGIN
      INSERT INTO public.driving_schools (name, phones) VALUES ('zz nullphone', ARRAY['+90 533 000 00 04', NULL]);
      v_bad_null := 'ACCEPTED';
    EXCEPTION WHEN check_violation THEN v_bad_null := 'refused';
    END;
    BEGIN
      INSERT INTO public.driving_school_branches (school_id, region) VALUES (v_probe_on, 'mars');
      v_bad_region := 'ACCEPTED';
    EXCEPTION WHEN check_violation THEN v_bad_region := 'refused';
    END;
    BEGIN
      INSERT INTO public.driving_school_branches (school_id, region, lat, geocode_source) VALUES (v_probe_on, 'lefke', 35.1, 'osm');
      v_bad_coords := 'ACCEPTED';
    EXCEPTION WHEN check_violation THEN v_bad_coords := 'refused';
    END;
    DELETE FROM public.driving_school_branches WHERE school_id = v_probe_on AND region = 'lefke';  -- a wrongly ACCEPTED probe must not turn the next one into a unique-key error
    BEGIN
      INSERT INTO public.driving_school_branches (school_id, region, address) VALUES (v_probe_on, 'lefke', '  ');
      v_bad_addr := 'ACCEPTED';
    EXCEPTION WHEN check_violation THEN v_bad_addr := 'refused';
    END;
    DELETE FROM public.driving_school_branches WHERE school_id = v_probe_on AND region = 'lefke';  -- a wrongly ACCEPTED probe must not turn the next one into a unique-key error
    BEGIN
      INSERT INTO public.driving_school_branches (school_id, region, address) VALUES (v_probe_on, 'lefke', repeat('x', 201));
      v_bad_addrlg := 'ACCEPTED';
    EXCEPTION WHEN check_violation THEN v_bad_addrlg := 'refused';
    END;
    DELETE FROM public.driving_school_branches WHERE school_id = v_probe_on AND region = 'lefke';  -- a wrongly ACCEPTED probe must not turn the next one into a unique-key error
    BEGIN
      INSERT INTO public.driving_school_branches (school_id, region, lat, lng, geocode_source) VALUES (v_probe_on, 'lefke', 35.1, 33.3, 'google_places');
      v_bad_gsrc := 'ACCEPTED';
    EXCEPTION WHEN check_violation THEN v_bad_gsrc := 'refused';
    END;
    DELETE FROM public.driving_school_branches WHERE school_id = v_probe_on AND region = 'lefke';  -- a wrongly ACCEPTED probe must not turn the next one into a unique-key error
    BEGIN
      INSERT INTO public.driving_school_branches (school_id, region, lat, lng) VALUES (v_probe_on, 'lefke', 35.1, 33.3);
      v_bad_provA := 'ACCEPTED';
    EXCEPTION WHEN check_violation THEN v_bad_provA := 'refused';
    END;
    DELETE FROM public.driving_school_branches WHERE school_id = v_probe_on AND region = 'lefke';  -- a wrongly ACCEPTED probe must not turn the next one into a unique-key error
    BEGIN
      INSERT INTO public.driving_school_branches (school_id, region, geocode_source) VALUES (v_probe_on, 'lefke', 'osm');
      v_bad_provB := 'ACCEPTED';
    EXCEPTION WHEN check_violation THEN v_bad_provB := 'refused';
    END;
    DELETE FROM public.driving_school_branches WHERE school_id = v_probe_on AND region = 'lefke';  -- a wrongly ACCEPTED probe must not turn the next one into a unique-key error
    -- Positive control for the branch CHECKs: a well-formed OSM-pinned branch is accepted.
    BEGIN
      INSERT INTO public.driving_school_branches (school_id, region, address, lat, lng, geocode_source)
        VALUES (v_probe_on, 'lefke', 'Zz Sokak 1, Lefke', 35.1, 33.3, 'osm');
      v_good_br := 'accepted';
    EXCEPTION WHEN check_violation THEN v_good_br := 'REFUSED';
    END;
    BEGIN
      INSERT INTO public.driving_schools (name, phones, instagram_url) VALUES ('zz badinsta', ARRAY['+90 533 000 00 04'], 'http://instagram.com/x');
      v_bad_insta := 'ACCEPTED';
    EXCEPTION WHEN check_violation THEN v_bad_insta := 'refused';
    END;
    BEGIN
      INSERT INTO public.driving_schools (name, phones, facebook_url) VALUES ('zz badfb', ARRAY['+90 533 000 00 04'], 'http://www.facebook.com/x');
      v_bad_fb := 'ACCEPTED';
    EXCEPTION WHEN check_violation THEN v_bad_fb := 'refused';
    END;
    BEGIN
      INSERT INTO public.driving_schools (name, phones, facebook_url) VALUES ('zz badfbhost', ARRAY['+90 533 000 00 04'], 'https://evil.example/?u=https://www.facebook.com/x');
      v_bad_fbhost := 'ACCEPTED';
    EXCEPTION WHEN check_violation THEN v_bad_fbhost := 'refused';
    END;
    BEGIN
      INSERT INTO public.driving_schools (name, phones, email) VALUES ('zz bademail', ARRAY['+90 533 000 00 04'], 'not-an-address');
      v_bad_email := 'ACCEPTED';
    EXCEPTION WHEN check_violation THEN v_bad_email := 'refused';
    END;
    BEGIN
      INSERT INTO public.driving_schools (name, phones, email) VALUES ('zz longemail', ARRAY['+90 533 000 00 04'], 'a@' || repeat('b', 250) || '.com');
      v_bad_emlong := 'ACCEPTED';
    EXCEPTION WHEN check_violation THEN v_bad_emlong := 'refused';
    END;
    BEGIN
      INSERT INTO public.driving_schools (name, phones, licence_classes) VALUES ('zz badclass', ARRAY['+90 533 000 00 04'], ARRAY['B','Z']);
      v_bad_class := 'ACCEPTED';
    EXCEPTION WHEN check_violation THEN v_bad_class := 'refused';
    END;
    BEGIN
      INSERT INTO public.driving_schools (name, phones, licence_classes) VALUES ('zz dupclass', ARRAY['+90 533 000 00 04'], ARRAY['B','H','B']);
      v_bad_dup := 'ACCEPTED';
    EXCEPTION WHEN check_violation THEN v_bad_dup := 'refused';
    END;
    BEGIN
      INSERT INTO public.driving_schools (name, phones, licence_classes) VALUES ('zz nullclass', ARRAY['+90 533 000 00 04'], ARRAY['B', NULL]);
      v_bad_clnull := 'ACCEPTED';
    EXCEPTION WHEN check_violation THEN v_bad_clnull := 'refused';
    END;
    BEGIN
      INSERT INTO public.driving_schools (name, phones, licence_classes) VALUES ('zz mdclass', ARRAY['+90 533 000 00 04'], ARRAY[['B','C'],['D','E']]);
      v_bad_clmd := 'ACCEPTED';
    EXCEPTION WHEN check_violation THEN v_bad_clmd := 'refused';
    END;
    -- Positive control for the school CHECKs: well-formed values are accepted, including H beside
    -- H1 (a prefix of another element is not a repeat) and a mixed-case e-mail.
    BEGIN
      INSERT INTO public.driving_schools (name, phones, facebook_url, email, licence_classes)
        VALUES ('zz good', ARRAY['+90 533 000 00 04'], 'https://www.facebook.com/zz.good', 'Zz.Good@Example.com', ARRAY['B','H','H1']);
      v_good_sch := 'accepted';
    EXCEPTION WHEN check_violation THEN v_good_sch := 'REFUSED';
    END;

    RAISE EXCEPTION 'ZZ_PROBE_ROLLBACK';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM IS DISTINCT FROM 'ZZ_PROBE_ROLLBACK' THEN RAISE; END IF;
  END;

  IF v_anon_sch IS DISTINCT FROM 1 OR v_anon_br IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'anon sees % probe schools / % branches (want 1 / 1: active school only)', v_anon_sch, v_anon_br; END IF;
  IF v_auth_sch IS DISTINCT FROM 1 OR v_auth_br IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'authenticated sees % probe schools / % branches (want 1 / 1)', v_auth_sch, v_auth_br; END IF;
  IF v_own_sch IS DISTINCT FROM 2 OR v_own_br IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION 'CONTROL FAILED: owner sees % probe schools / % branches (want 2 / 2)', v_own_sch, v_own_br; END IF;
  IF v_anon_write IS DISTINCT FROM 'denied' THEN RAISE EXCEPTION 'anon driving_schools INSERT was %', v_anon_write; END IF;
  IF v_auth_write IS DISTINCT FROM 'denied' THEN RAISE EXCEPTION 'authenticated driving_schools UPDATE was %', v_auth_write; END IF;
  IF v_br_write   IS DISTINCT FROM 'denied' THEN RAISE EXCEPTION 'authenticated branches DELETE was %', v_br_write; END IF;
  IF v_bad_phone  IS DISTINCT FROM 'refused' THEN RAISE EXCEPTION 'CONTROL FAILED: malformed phone element was %', v_bad_phone; END IF;
  IF v_bad_null   IS DISTINCT FROM 'refused' THEN RAISE EXCEPTION 'CONTROL FAILED: NULL phone element was %', v_bad_null; END IF;
  IF v_bad_region IS DISTINCT FROM 'refused' THEN RAISE EXCEPTION 'CONTROL FAILED: unknown region was %', v_bad_region; END IF;
  IF v_bad_coords IS DISTINCT FROM 'refused' THEN RAISE EXCEPTION 'CONTROL FAILED: lat without lng was %', v_bad_coords; END IF;
  IF v_bad_insta  IS DISTINCT FROM 'refused' THEN RAISE EXCEPTION 'CONTROL FAILED: http instagram url was %', v_bad_insta; END IF;
  IF v_bad_fb     IS DISTINCT FROM 'refused' THEN RAISE EXCEPTION 'CONTROL FAILED: http facebook url was %', v_bad_fb; END IF;
  IF v_bad_fbhost IS DISTINCT FROM 'refused' THEN RAISE EXCEPTION 'CONTROL FAILED: foreign-host facebook url was %', v_bad_fbhost; END IF;
  IF v_bad_email  IS DISTINCT FROM 'refused' THEN RAISE EXCEPTION 'CONTROL FAILED: malformed e-mail was %', v_bad_email; END IF;
  IF v_bad_emlong IS DISTINCT FROM 'refused' THEN RAISE EXCEPTION 'CONTROL FAILED: 258-character e-mail was %', v_bad_emlong; END IF;
  IF v_bad_class  IS DISTINCT FROM 'refused' THEN RAISE EXCEPTION 'CONTROL FAILED: unknown licence class was %', v_bad_class; END IF;
  IF v_bad_dup    IS DISTINCT FROM 'refused' THEN RAISE EXCEPTION 'CONTROL FAILED: repeated licence class was %', v_bad_dup; END IF;
  IF v_bad_clnull IS DISTINCT FROM 'refused' THEN RAISE EXCEPTION 'CONTROL FAILED: NULL licence class element was %', v_bad_clnull; END IF;
  IF v_bad_clmd   IS DISTINCT FROM 'refused' THEN RAISE EXCEPTION 'CONTROL FAILED: 2-D licence_classes was %', v_bad_clmd; END IF;
  IF v_good_sch   IS DISTINCT FROM 'accepted' THEN RAISE EXCEPTION 'CONTROL FAILED: well-formed facebook/email/classes row was %', v_good_sch; END IF;
  IF v_bad_addr   IS DISTINCT FROM 'refused' THEN RAISE EXCEPTION 'CONTROL FAILED: blank branch address was %', v_bad_addr; END IF;
  IF v_bad_addrlg IS DISTINCT FROM 'refused' THEN RAISE EXCEPTION 'CONTROL FAILED: 201-character branch address was %', v_bad_addrlg; END IF;
  IF v_bad_gsrc   IS DISTINCT FROM 'refused' THEN RAISE EXCEPTION 'CONTROL FAILED: geocode_source google_places was %', v_bad_gsrc; END IF;
  IF v_bad_provA  IS DISTINCT FROM 'refused' THEN RAISE EXCEPTION 'CONTROL FAILED: coordinates without a source was %', v_bad_provA; END IF;
  IF v_bad_provB  IS DISTINCT FROM 'refused' THEN RAISE EXCEPTION 'CONTROL FAILED: a source without coordinates was %', v_bad_provB; END IF;
  IF v_good_br    IS DISTINCT FROM 'accepted' THEN RAISE EXCEPTION 'CONTROL FAILED: well-formed OSM-pinned branch was %', v_good_br; END IF;
  IF EXISTS (SELECT 1 FROM public.driving_schools WHERE name LIKE 'zz %') THEN
    RAISE EXCEPTION 'probe rows survived the rollback';
  END IF;
  RAISE NOTICE 'driving_schools policies: %', v_policies;
  RAISE NOTICE 'driving_schools grants: %', v_priv;
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
VALUES ('20261108_driving_schools.sql', '693dc2b4357a2aa1f237f62df106dee279a96901e9837c4eedfbba277c9536ef')
ON CONFLICT (filename) DO UPDATE
  SET checksum = excluded.checksum, applied_at = now(), applied_by = current_user;
-- ─── ledger:stamp:end ────────────────────────────────────────────────
COMMIT;
RESET ROLE;

NOTIFY pgrst, 'reload schema';

-- ─── Verification after applying (read-only, run alone) ─────────────────────
--   Run supabase/verify_schema.sql QUERY 1: every 1108_driving_schools row must read OK.
--
-- ─── Rollback (only if the module is abandoned) ──
--   DROP TABLE IF EXISTS public.driving_school_branches, public.driving_schools;
