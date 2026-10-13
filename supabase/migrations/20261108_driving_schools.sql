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
--     Public business-directory data (name, phone numbers, Instagram link); no personal data.
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

-- ─── driving_school_branches ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.driving_school_branches (
  id          bigint           GENERATED ALWAYS AS IDENTITY,
  school_id   uuid             NOT NULL,
  region      text             NOT NULL,
  lat         double precision,
  lng         double precision,
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
INSERT INTO public.driving_schools (id, name, logo_key, phones, whatsapp, instagram_url, featured, sort_order, is_active)
VALUES ('7b1e0c2a-5d4f-4e8b-9a61-3c2f8e0d4b17', 'Seyhun Bıkmaz Şoför Okulu', 'seyhun/logo',
        ARRAY['+90 533 854 39 99','+90 533 887 39 99','+90 539 107 39 99'], NULL,
        'https://instagram.com/seyhunbikmazsoforokulu', true, 0, false)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.driving_school_branches (school_id, region, sort_order)
VALUES ('7b1e0c2a-5d4f-4e8b-9a61-3c2f8e0d4b17', 'nicosia', 0),
       ('7b1e0c2a-5d4f-4e8b-9a61-3c2f8e0d4b17', 'morphou', 1)
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
      INSERT INTO public.driving_school_branches (school_id, region, lat) VALUES (v_probe_on, 'lefke', 35.1);
      v_bad_coords := 'ACCEPTED';
    EXCEPTION WHEN check_violation THEN v_bad_coords := 'refused';
    END;
    BEGIN
      INSERT INTO public.driving_schools (name, phones, instagram_url) VALUES ('zz badinsta', ARRAY['+90 533 000 00 04'], 'http://instagram.com/x');
      v_bad_insta := 'ACCEPTED';
    EXCEPTION WHEN check_violation THEN v_bad_insta := 'refused';
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
VALUES ('20261108_driving_schools.sql', '45e0518a0deaf8e1d0b81172de9d306272e2642eb8219eae6342b15e853d54ad')
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
