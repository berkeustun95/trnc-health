-- ═══════════════════════════════════════════════════════════════════════════
-- 20261116 — Yeme-İçme dish photos: eatery_menu_items.photo_path/photo_width/photo_height, UNIQUE (partner_id, storage_path)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- SCHEMA ONLY, NO DATA. Three nullable columns on eatery_menu_items (a dish's own photo, a path inside
-- the public eatery-images bucket, plus its pixel size so the app can reserve space), and a
-- per-partner UNIQUE on eatery_photos so one image file cannot be registered twice for a partner.
--
-- ─── WHO CAN READ / WRITE (UNCHANGED from 20261115) ─────────────────────────
--   • READ: anyone using the app (anon, signed-in, guest) sees a menu item, and therefore its
--     photo_path, only while its partner is active. The policy is the row-level one 20261115 wrote
--     (parent partner is_active); the new columns ride under it. An item of an inactive partner is
--     invisible with its photo_path. The table-level SELECT grant to anon/authenticated covers the new
--     columns (asserted with has_column_privilege).
--   • WRITE: service_role only. No client write policy and no client INSERT/UPDATE privilege, on the
--     table or on the new columns.
--   • This file creates, alters and drops NO policy and NO grant, and touches no storage.objects policy.
--     It asserts the full policy set on the three eatery tables is exactly what 20261115 left (1/1/1,
--     names printed), before AND after.
--   • Nothing here concerns the person reading it.
--
-- ─── CHECKS ─────────────────────────────────────────────────────────────────
--   eatery_menu_items_photo_path_check          path shape = logo_path / eatery_photos.storage_path shape
--   eatery_menu_items_photo_size_check          (width IS NULL) = (height IS NULL), and both > 0 when set
--   eatery_menu_items_photo_size_needs_path_check   no size without a photo
--   eatery_photos_partner_path_key              UNIQUE (partner_id, storage_path)
--
-- ─── RE-RUNNABLE ────────────────────────────────────────────────────────────
-- Pre-state accepts the three columns ALL absent, or ALL present exactly as this file creates them
-- (text / integer / integer, nullable, no default). A partial state raises with the live rows.
-- The duplicate (partner_id, storage_path) groups are counted and printed BEFORE the UNIQUE is added,
-- so a duplicate gives a readable message instead of a bare unique_violation.
--
-- Apply: gh workflow run supabase-migrate -f file=20261116_eatery_dish_photos.sql (dry), then
-- -f apply=true. ADDs columns ⇒ ends with NOTIFY pgrst (after COMMIT and RESET ROLE).
-- ═══════════════════════════════════════════════════════════════════════════

SET ROLE postgres;

BEGIN;

SET LOCAL lock_timeout = '5s';

-- ─── Pre-state ──────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_cols     text[];
  v_live     text;
  v_dups     int;
  v_dup_list text;
  v_pol_n    int;
  v_pol_names text[];
  v_rls      int;
BEGIN
  IF to_regclass('public.eatery_menu_items') IS NULL OR to_regclass('public.eatery_photos') IS NULL
     OR to_regclass('public.eatery_partners') IS NULL THEN
    RAISE EXCEPTION '20261115 is not applied: an eatery table is missing (partners % / items % / photos %)',
      to_regclass('public.eatery_partners'), to_regclass('public.eatery_menu_items'), to_regclass('public.eatery_photos');
  END IF;

  -- Columns: all absent, or all present exactly as this file creates them.
  SELECT array_agg(column_name::text ORDER BY column_name),
         string_agg(column_name || ' ' || data_type || ' nullable=' || is_nullable || ' default=' || coalesce(column_default, '<none>'), '; ' ORDER BY column_name)
    INTO v_cols, v_live
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'eatery_menu_items'
     AND column_name IN ('photo_path', 'photo_width', 'photo_height');
  IF v_cols IS NOT NULL THEN
    IF NOT (v_cols @> ARRAY['photo_height','photo_path','photo_width'] AND v_cols <@ ARRAY['photo_height','photo_path','photo_width']) THEN
      RAISE EXCEPTION 'eatery_menu_items has a PARTIAL set of the photo columns (want none or all three): %', v_live;
    END IF;
    IF (SELECT count(*) FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'eatery_menu_items' AND is_nullable = 'YES' AND column_default IS NULL
           AND ((column_name = 'photo_path' AND data_type = 'text')
             OR (column_name IN ('photo_width', 'photo_height') AND data_type = 'integer'))) IS DISTINCT FROM 3 THEN
      RAISE EXCEPTION 'eatery_menu_items photo columns exist but not as this file creates them (text/integer/integer, nullable, no default): %', v_live;
    END IF;
    RAISE NOTICE 'pre-state: photo columns already present (re-apply): %', v_live;
  ELSE
    RAISE NOTICE 'pre-state: photo columns absent (first apply)';
  END IF;

  -- No (partner_id, storage_path) duplicates today. Counted and printed, never assumed.
  SELECT count(*), string_agg(partner_id || ' ' || storage_path || ' x' || n, '; ' ORDER BY partner_id, storage_path)
    INTO v_dups, v_dup_list
    FROM (SELECT partner_id, storage_path, count(*) AS n FROM public.eatery_photos
           GROUP BY partner_id, storage_path HAVING count(*) > 1) d;
  RAISE NOTICE 'pre-state: % duplicate (partner_id, storage_path) groups among % eatery_photos rows: %',
    v_dups, (SELECT count(*) FROM public.eatery_photos), coalesce(v_dup_list, '<none>');
  IF v_dups IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'cannot add UNIQUE (partner_id, storage_path): % duplicate group(s): %', v_dups, v_dup_list;
  END IF;

  -- RLS is exactly what 20261115 left: ONE policy per table, by name (constants, no delimiter to mismatch).
  SELECT count(*), array_agg(tablename || '.' || policyname ORDER BY tablename, policyname)
    INTO v_pol_n, v_pol_names
    FROM pg_policies WHERE schemaname = 'public' AND tablename IN ('eatery_partners','eatery_menu_items','eatery_photos');
  IF v_pol_n IS DISTINCT FROM 3 OR v_pol_names IS DISTINCT FROM ARRAY['eatery_menu_items.eatery_menu_items_select_active',
       'eatery_partners.eatery_partners_select_active','eatery_photos.eatery_photos_select_active'] THEN
    RAISE EXCEPTION 'pre-state: the eatery policy set is not the 20261115 set (% policies): %', v_pol_n, v_pol_names;
  END IF;
  SELECT count(*) INTO v_rls FROM pg_class
   WHERE oid IN ('public.eatery_partners'::regclass, 'public.eatery_menu_items'::regclass, 'public.eatery_photos'::regclass) AND relrowsecurity;
  IF v_rls IS DISTINCT FROM 3 THEN RAISE EXCEPTION 'pre-state: RLS not enabled on all three eatery tables (% of 3)', v_rls; END IF;
END $$;

-- ─── eatery_menu_items: a dish's photo ──────────────────────────────────────
ALTER TABLE public.eatery_menu_items ADD COLUMN IF NOT EXISTS photo_path   text;
ALTER TABLE public.eatery_menu_items ADD COLUMN IF NOT EXISTS photo_width  int;
ALTER TABLE public.eatery_menu_items ADD COLUMN IF NOT EXISTS photo_height int;

ALTER TABLE public.eatery_menu_items DROP CONSTRAINT IF EXISTS eatery_menu_items_photo_path_check;
ALTER TABLE public.eatery_menu_items ADD  CONSTRAINT eatery_menu_items_photo_path_check
  CHECK (photo_path IS NULL OR photo_path ~ '^[a-z0-9-]+(/[a-z0-9][a-z0-9_-]*)+\.(jpg|jpeg|png|webp)$');
ALTER TABLE public.eatery_menu_items DROP CONSTRAINT IF EXISTS eatery_menu_items_photo_size_check;
ALTER TABLE public.eatery_menu_items ADD  CONSTRAINT eatery_menu_items_photo_size_check
  CHECK (((photo_width IS NULL) = (photo_height IS NULL)) AND (photo_width IS NULL OR (photo_width > 0 AND photo_height > 0)));
ALTER TABLE public.eatery_menu_items DROP CONSTRAINT IF EXISTS eatery_menu_items_photo_size_needs_path_check;
ALTER TABLE public.eatery_menu_items ADD  CONSTRAINT eatery_menu_items_photo_size_needs_path_check
  CHECK (photo_width IS NULL OR photo_path IS NOT NULL);

-- ─── eatery_photos: one registration per file per partner ───────────────────
ALTER TABLE public.eatery_photos DROP CONSTRAINT IF EXISTS eatery_photos_partner_path_key;
ALTER TABLE public.eatery_photos ADD  CONSTRAINT eatery_photos_partner_path_key UNIQUE (partner_id, storage_path);

-- ─── Assertions (inside the transaction; a failure rolls the file back) ─────
DO $$
DECLARE
  v_pol_n      int;
  v_pol_names  text[];
  v_pol_text   text;
  v_nonsel     int;
  v_badroles   int;
  v_rls        int;
  v_priv       text;
  v_cols       text;
  v_defs       text;
  v_probe_on   uuid;
  v_probe_off  uuid;
  v_item_id    bigint;
  v_cases_run  int := 0;
  v_fail       text := '';
  c            record;
  v_anon_all int; v_anon_ph int; v_anon_off int; v_anon_val text;
  v_auth_all int; v_auth_ph int; v_auth_off int; v_auth_val text;
  v_own_all  int; v_own_ph  int; v_own_off  int;
  v_anon_u text := 'not run'; v_auth_u text := 'not run';
  v_dup text := 'not run'; v_dup_other_partner text := 'not run'; v_dup_other_path text := 'not run';
  v_clear_path text := 'not run'; v_clear_all text := 'not run'; v_path_only text := 'not run';
BEGIN
  -- Columns, from information_schema.
  SELECT string_agg(column_name || ' ' || data_type || ' nullable=' || is_nullable || ' default=' || coalesce(column_default, '<none>'), '; ' ORDER BY column_name)
    INTO v_cols FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'eatery_menu_items' AND column_name IN ('photo_path', 'photo_width', 'photo_height');
  IF (SELECT count(*) FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'eatery_menu_items' AND is_nullable = 'YES' AND column_default IS NULL
         AND ((column_name = 'photo_path' AND data_type = 'text')
           OR (column_name IN ('photo_width', 'photo_height') AND data_type = 'integer'))) IS DISTINCT FROM 3 THEN
    RAISE EXCEPTION 'photo columns wrong: %', coalesce(v_cols, '<absent>');
  END IF;

  -- The FULL policy set, again, after the changes: presence of mine never proves absence of others.
  SELECT count(*), array_agg(tablename || '.' || policyname ORDER BY tablename, policyname),
         count(*) FILTER (WHERE cmd IS DISTINCT FROM 'SELECT' OR permissive IS DISTINCT FROM 'PERMISSIVE'),
         count(*) FILTER (WHERE roles::text[] IS DISTINCT FROM ARRAY['anon','authenticated']::text[]),
         string_agg(tablename || '.' || policyname || ' ' || cmd || ' ' || array_to_string(roles, ',') || ' USING ' || coalesce(qual, '<none>'), '; ' ORDER BY tablename, policyname)
    INTO v_pol_n, v_pol_names, v_nonsel, v_badroles, v_pol_text
    FROM pg_policies WHERE schemaname = 'public' AND tablename IN ('eatery_partners','eatery_menu_items','eatery_photos');
  IF v_pol_n IS DISTINCT FROM 3 OR v_pol_names IS DISTINCT FROM ARRAY['eatery_menu_items.eatery_menu_items_select_active',
       'eatery_partners.eatery_partners_select_active','eatery_photos.eatery_photos_select_active'] THEN
    RAISE EXCEPTION 'policy set changed: % policies (want exactly the three 20261115 SELECT policies): %', v_pol_n, v_pol_text;
  END IF;
  IF v_nonsel IS DISTINCT FROM 0 OR v_badroles IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'a policy is not a permissive SELECT for exactly {anon,authenticated}: %', v_pol_text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'eatery_partners' AND qual = 'is_active')
     OR NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'eatery_menu_items'
                     AND qual LIKE '%eatery_partners%' AND qual LIKE '%is_active%')
     OR NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'eatery_photos'
                     AND qual LIKE '%eatery_partners%' AND qual LIKE '%is_active%') THEN
    RAISE EXCEPTION 'a policy qualifier is no longer "partner is active": %', v_pol_text;
  END IF;
  SELECT count(*) INTO v_rls FROM pg_class
   WHERE oid IN ('public.eatery_partners'::regclass, 'public.eatery_menu_items'::regclass, 'public.eatery_photos'::regclass) AND relrowsecurity;
  IF v_rls IS DISTINCT FROM 3 THEN RAISE EXCEPTION 'RLS is not enabled on all three tables (% of 3)', v_rls; END IF;

  -- Grants: clients SELECT-only on the table AND on the new columns; service_role writes (positive control).
  SELECT string_agg(r || ' photo_path sel=' || has_column_privilege(r, 'public.eatery_menu_items', 'photo_path', 'SELECT')
                    || ' photo_width sel=' || has_column_privilege(r, 'public.eatery_menu_items', 'photo_width', 'SELECT')
                    || ' photo_height sel=' || has_column_privilege(r, 'public.eatery_menu_items', 'photo_height', 'SELECT')
                    || ' write=' || has_column_privilege(r, 'public.eatery_menu_items', 'photo_path', 'INSERT,UPDATE,REFERENCES')
                              || '/' || has_column_privilege(r, 'public.eatery_menu_items', 'photo_width', 'INSERT,UPDATE,REFERENCES')
                              || '/' || has_column_privilege(r, 'public.eatery_menu_items', 'photo_height', 'INSERT,UPDATE,REFERENCES'),
                    '; ' ORDER BY r)
    INTO v_priv FROM unnest(ARRAY['anon','authenticated','service_role']) r;
  IF EXISTS (SELECT 1 FROM unnest(ARRAY['anon','authenticated']) r, unnest(ARRAY['photo_path','photo_width','photo_height']) col
              WHERE NOT has_column_privilege(r, 'public.eatery_menu_items', col, 'SELECT')
                 OR has_column_privilege(r, 'public.eatery_menu_items', col, 'INSERT,UPDATE,REFERENCES')) THEN
    RAISE EXCEPTION 'client column privileges wrong on the photo columns (want SELECT only): %', v_priv;
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(ARRAY['public.eatery_menu_items','public.eatery_photos']) t, unnest(ARRAY['anon','authenticated']) r
              WHERE NOT has_table_privilege(r, t, 'SELECT')
                 OR has_table_privilege(r, t, 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')) THEN
    RAISE EXCEPTION 'client table grants on eatery_menu_items / eatery_photos are not SELECT-only';
  END IF;
  IF NOT (has_column_privilege('service_role', 'public.eatery_menu_items', 'photo_path', 'SELECT,INSERT,UPDATE')
      AND has_table_privilege('service_role', 'public.eatery_menu_items', 'SELECT,INSERT,UPDATE,DELETE')
      AND has_table_privilege('service_role', 'public.eatery_photos', 'SELECT,INSERT,UPDATE,DELETE')) THEN
    RAISE EXCEPTION 'CONTROL FAILED: service_role cannot write photo_path / the eatery tables';
  END IF;

  -- BEHAVIOUR, rolled back by a sentinel (re-runnable; no row survives).
  BEGIN
    -- An ACTIVE launch-complete probe partner (positive control) and an INACTIVE one; each has TWO items,
    -- one with a photo and one without, so every count below compares more than one row.
    INSERT INTO public.eatery_partners (slug, name, category, lat, lng, geocode_source, logo_path, menu_verified_on, is_active)
      VALUES ('zz-on', 'zz on', 'cafe', 35.1, 33.3, 'partner', 'zz-on/logo.png', DATE '2026-10-01', true) RETURNING id INTO v_probe_on;
    INSERT INTO public.eatery_partners (slug, name, category, is_active)
      VALUES ('zz-off', 'zz off', 'cafe', false) RETURNING id INTO v_probe_off;
    INSERT INTO public.eatery_menu_items (partner_id, section, name, photo_path, photo_width, photo_height) VALUES
      (v_probe_on,  'zz', 'zz on photo',  'zz-on/dish-1.jpg',  800, 600),
      (v_probe_on,  'zz', 'zz on bare',   NULL, NULL, NULL),
      (v_probe_off, 'zz', 'zz off photo', 'zz-off/dish-1.jpg', 800, 600),
      (v_probe_off, 'zz', 'zz off bare',  NULL, NULL, NULL);
    INSERT INTO public.eatery_photos (partner_id, kind, storage_path) VALUES
      (v_probe_on, 'gallery', 'zz-on/zz-1.jpg'), (v_probe_off, 'gallery', 'zz-off/zz-1.jpg');

    SET LOCAL ROLE anon;
    PERFORM set_config('request.jwt.claims', '', true);
    SELECT count(*), count(*) FILTER (WHERE photo_path IS NOT NULL), count(*) FILTER (WHERE partner_id = v_probe_off),
           max(photo_path)
      INTO v_anon_all, v_anon_ph, v_anon_off, v_anon_val
      FROM public.eatery_menu_items WHERE partner_id IN (v_probe_on, v_probe_off);
    BEGIN
      UPDATE public.eatery_menu_items SET photo_path = 'zz-on/hijack.jpg' WHERE partner_id = v_probe_on;
      v_anon_u := 'ALLOWED';
    EXCEPTION WHEN insufficient_privilege THEN v_anon_u := 'denied';
    END;
    RESET ROLE;

    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text, true);
    SELECT count(*), count(*) FILTER (WHERE photo_path IS NOT NULL), count(*) FILTER (WHERE partner_id = v_probe_off),
           max(photo_path)
      INTO v_auth_all, v_auth_ph, v_auth_off, v_auth_val
      FROM public.eatery_menu_items WHERE partner_id IN (v_probe_on, v_probe_off);
    BEGIN
      UPDATE public.eatery_menu_items SET photo_path = 'zz-on/hijack.jpg' WHERE partner_id = v_probe_on;
      v_auth_u := 'ALLOWED';
    EXCEPTION WHEN insufficient_privilege THEN v_auth_u := 'denied';
    END;
    PERFORM set_config('request.jwt.claims', '', true);
    RESET ROLE;

    -- Control: the owner sees everything, so the clients' numbers are the policy and not an empty table.
    SELECT count(*), count(*) FILTER (WHERE photo_path IS NOT NULL), count(*) FILTER (WHERE partner_id = v_probe_off)
      INTO v_own_all, v_own_ph, v_own_off
      FROM public.eatery_menu_items WHERE partner_id IN (v_probe_on, v_probe_off);

    -- Constraint negatives, each paired with a good control, on a FRESH bare item per case so the CHECK
    -- under test is the only thing that can fire and no case inherits another's state.
    FOR c IN SELECT * FROM (VALUES
      ('path with ../',            'photo_path = ''../x.png''',                    'photo_path = ''zz-on/dish-2.jpg'''),
      ('uppercase path',           'photo_path = ''zz-on/Dish.JPG''',              'photo_path = ''zz-on/dish-2.jpg'''),
      ('path with a scheme',       'photo_path = ''https://x.example/a.jpg''',     'photo_path = ''zz-on/dish-2.webp'''),
      ('path with a bad extension','photo_path = ''zz-on/dish-2.gif''',           'photo_path = ''zz-on/dish-2.png'''),
      ('size without a path',      'photo_width = 100, photo_height = 80',         'photo_path = ''zz-on/dish-2.jpg'', photo_width = 100, photo_height = 80'),
      ('width without height',     'photo_path = ''zz-on/dish-2.jpg'', photo_width = 100', 'photo_path = ''zz-on/dish-2.jpg'', photo_width = 100, photo_height = 80'),
      ('height without width',     'photo_path = ''zz-on/dish-2.jpg'', photo_height = 80', 'photo_path = ''zz-on/dish-2.jpg'', photo_width = 100, photo_height = 80'),
      ('zero width',               'photo_path = ''zz-on/dish-2.jpg'', photo_width = 0, photo_height = 80',  'photo_path = ''zz-on/dish-2.jpg'', photo_width = 100, photo_height = 80'),
      ('zero height',              'photo_path = ''zz-on/dish-2.jpg'', photo_width = 100, photo_height = 0', 'photo_path = ''zz-on/dish-2.jpg'', photo_width = 100, photo_height = 80'),
      ('negative width',           'photo_path = ''zz-on/dish-2.jpg'', photo_width = -5, photo_height = 80', 'photo_path = ''zz-on/dish-2.jpg'', photo_width = 100, photo_height = 80')
    ) AS t(label, bad_set, good_set) LOOP
      v_cases_run := v_cases_run + 1;
      INSERT INTO public.eatery_menu_items (partner_id, section, name) VALUES (v_probe_on, 'zz', 'zz case ' || v_cases_run) RETURNING id INTO v_item_id;
      BEGIN
        EXECUTE format('UPDATE public.eatery_menu_items SET %s WHERE id = %L', c.bad_set, v_item_id);
        v_fail := v_fail || ' ACCEPTED(' || c.label || ')';
      EXCEPTION WHEN check_violation THEN NULL;
      END;
      BEGIN
        EXECUTE format('UPDATE public.eatery_menu_items SET %s WHERE id = %L', c.good_set, v_item_id);
      EXCEPTION WHEN check_violation THEN v_fail := v_fail || ' GOOD-REFUSED(' || c.label || ')';
      END;
    END LOOP;

    -- A path alone is legal (size is optional); removing the photo while its size remains is not; removing all is.
    INSERT INTO public.eatery_menu_items (partner_id, section, name) VALUES (v_probe_on, 'zz', 'zz clear') RETURNING id INTO v_item_id;
    BEGIN
      UPDATE public.eatery_menu_items SET photo_path = 'zz-on/dish-3.jpg' WHERE id = v_item_id;
      v_path_only := 'accepted';
    EXCEPTION WHEN check_violation THEN v_path_only := 'REFUSED';
    END;
    UPDATE public.eatery_menu_items SET photo_width = 10, photo_height = 10 WHERE id = v_item_id;
    BEGIN
      UPDATE public.eatery_menu_items SET photo_path = NULL WHERE id = v_item_id;
      v_clear_path := 'ACCEPTED';
    EXCEPTION WHEN check_violation THEN v_clear_path := 'refused';
    END;
    BEGIN
      UPDATE public.eatery_menu_items SET photo_path = NULL, photo_width = NULL, photo_height = NULL WHERE id = v_item_id;
      v_clear_all := 'accepted';
    EXCEPTION WHEN check_violation THEN v_clear_all := 'REFUSED';
    END;

    -- UNIQUE (partner_id, storage_path): a duplicate is refused; the same path under ANOTHER partner and
    -- another path under the SAME partner are accepted (so it is a per-partner key, not a global one).
    BEGIN
      INSERT INTO public.eatery_photos (partner_id, kind, storage_path) VALUES (v_probe_on, 'menu', 'zz-on/zz-1.jpg');
      v_dup := 'ACCEPTED';
    EXCEPTION WHEN unique_violation THEN v_dup := 'refused';
    END;
    BEGIN
      INSERT INTO public.eatery_photos (partner_id, kind, storage_path) VALUES (v_probe_off, 'gallery', 'zz-on/zz-1.jpg');
      v_dup_other_partner := 'accepted';
    EXCEPTION WHEN unique_violation THEN v_dup_other_partner := 'REFUSED';
    END;
    BEGIN
      INSERT INTO public.eatery_photos (partner_id, kind, storage_path) VALUES (v_probe_on, 'gallery', 'zz-on/zz-2.jpg');
      v_dup_other_path := 'accepted';
    EXCEPTION WHEN unique_violation THEN v_dup_other_path := 'REFUSED';
    END;

    RAISE EXCEPTION 'ZZ_PROBE_ROLLBACK';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM IS DISTINCT FROM 'ZZ_PROBE_ROLLBACK' THEN RAISE; END IF;
  END;

  IF v_own_all IS DISTINCT FROM 4 OR v_own_ph IS DISTINCT FROM 2 OR v_own_off IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION 'CONTROL FAILED: owner sees % items / % with a photo / % of the inactive partner (want 4/2/2)', v_own_all, v_own_ph, v_own_off; END IF;
  IF v_anon_off IS DISTINCT FROM 0 OR v_auth_off IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'an inactive partner''s items are visible: anon % / authenticated % (want 0 / 0)', v_anon_off, v_auth_off; END IF;
  IF v_anon_all IS DISTINCT FROM 2 OR v_anon_ph IS DISTINCT FROM 1 OR v_anon_val IS DISTINCT FROM 'zz-on/dish-1.jpg' THEN
    RAISE EXCEPTION 'anon reads % items / % with a photo_path / value % (want 2 / 1 / zz-on/dish-1.jpg: the ACTIVE partner only)', v_anon_all, v_anon_ph, v_anon_val; END IF;
  IF v_auth_all IS DISTINCT FROM 2 OR v_auth_ph IS DISTINCT FROM 1 OR v_auth_val IS DISTINCT FROM 'zz-on/dish-1.jpg' THEN
    RAISE EXCEPTION 'authenticated reads % items / % with a photo_path / value % (want 2 / 1 / zz-on/dish-1.jpg)', v_auth_all, v_auth_ph, v_auth_val; END IF;
  IF v_anon_u IS DISTINCT FROM 'denied' OR v_auth_u IS DISTINCT FROM 'denied' THEN
    RAISE EXCEPTION 'UPDATE photo_path: anon % / authenticated % (want denied x2)', v_anon_u, v_auth_u; END IF;
  IF v_fail <> '' THEN RAISE EXCEPTION 'constraint cases failed (% run):%', v_cases_run, v_fail; END IF;
  IF v_cases_run IS DISTINCT FROM 10 THEN RAISE EXCEPTION 'constraint case loop ran % cases (want 10)', v_cases_run; END IF;
  IF v_path_only IS DISTINCT FROM 'accepted' THEN RAISE EXCEPTION 'CONTROL FAILED: a path without a size was %', v_path_only; END IF;
  IF v_clear_path IS DISTINCT FROM 'refused' THEN RAISE EXCEPTION 'clearing photo_path while a size remains was %', v_clear_path; END IF;
  IF v_clear_all IS DISTINCT FROM 'accepted' THEN RAISE EXCEPTION 'CONTROL FAILED: clearing path and size together was %', v_clear_all; END IF;
  IF v_dup IS DISTINCT FROM 'refused' THEN RAISE EXCEPTION 'a duplicate (partner_id, storage_path) was %', v_dup; END IF;
  IF v_dup_other_partner IS DISTINCT FROM 'accepted' OR v_dup_other_path IS DISTINCT FROM 'accepted' THEN
    RAISE EXCEPTION 'CONTROL FAILED: same path under another partner was %, another path under the same partner was %', v_dup_other_partner, v_dup_other_path; END IF;
  IF EXISTS (SELECT 1 FROM public.eatery_partners WHERE slug LIKE 'zz-%') THEN
    RAISE EXCEPTION 'probe partners survived the rollback'; END IF;

  -- The constraints as the catalog renders them, printed. The UNIQUE must be exactly (partner_id, storage_path).
  SELECT string_agg(conname || ': ' || pg_get_constraintdef(oid), E'\n  ' ORDER BY conname) INTO v_defs
    FROM pg_constraint
   WHERE (conrelid = 'public.eatery_menu_items'::regclass AND conname LIKE 'eatery_menu_items_photo_%')
      OR (conrelid = 'public.eatery_photos'::regclass AND conname = 'eatery_photos_partner_path_key');
  IF (SELECT count(*) FROM pg_constraint
       WHERE (conrelid = 'public.eatery_menu_items'::regclass AND conname IN
                ('eatery_menu_items_photo_path_check', 'eatery_menu_items_photo_size_check', 'eatery_menu_items_photo_size_needs_path_check'))
          OR (conrelid = 'public.eatery_photos'::regclass AND conname = 'eatery_photos_partner_path_key')) IS DISTINCT FROM 4 THEN
    RAISE EXCEPTION 'expected 4 new constraints, live: %', coalesce(v_defs, '<none>');
  END IF;
  IF (SELECT pg_get_constraintdef(oid) FROM pg_constraint
       WHERE conrelid = 'public.eatery_photos'::regclass AND conname = 'eatery_photos_partner_path_key')
     IS DISTINCT FROM 'UNIQUE (partner_id, storage_path)' THEN
    RAISE EXCEPTION 'eatery_photos_partner_path_key is not UNIQUE (partner_id, storage_path): %', v_defs;
  END IF;

  RAISE NOTICE 'photo columns: %', v_cols;
  RAISE NOTICE 'eatery policies (% total, unchanged): %', v_pol_n, v_pol_text;
  RAISE NOTICE 'photo column privileges: %', v_priv;
  RAISE NOTICE 'constraint cases run: % (bad refused + good accepted); anon read %/% items (photo_path value %), authenticated %/% (value %), owner %/%, inactive partner visible to anon/authenticated %/%',
    v_cases_run, v_anon_ph, v_anon_all, v_anon_val, v_auth_ph, v_auth_all, v_auth_val, v_own_ph, v_own_all, v_anon_off, v_auth_off;
  RAISE NOTICE 'new constraints: %', E'\n  ' || v_defs;
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
VALUES ('20261116_eatery_dish_photos.sql', 'c4759792506faf4b1988551e8cb2af701792f81ee09f9d3427df57f63a9f26fa')
ON CONFLICT (filename) DO UPDATE
  SET checksum = excluded.checksum, applied_at = now(), applied_by = current_user;
-- ─── ledger:stamp:end ────────────────────────────────────────────────
COMMIT;
RESET ROLE;

NOTIFY pgrst, 'reload schema';

-- ─── Verification after applying (read-only, run alone) ─────────────────────
--   Run supabase/verify_schema.sql QUERY 1: every 1116_eatery_dish_photos row must read OK.
--
-- ─── Rollback (only if the dish-photo feature is abandoned) ──
--   ALTER TABLE public.eatery_photos DROP CONSTRAINT IF EXISTS eatery_photos_partner_path_key;
--   ALTER TABLE public.eatery_menu_items DROP CONSTRAINT IF EXISTS eatery_menu_items_photo_size_needs_path_check,
--     DROP CONSTRAINT IF EXISTS eatery_menu_items_photo_size_check, DROP CONSTRAINT IF EXISTS eatery_menu_items_photo_path_check;
--   ALTER TABLE public.eatery_menu_items DROP COLUMN IF EXISTS photo_width, DROP COLUMN IF EXISTS photo_height, DROP COLUMN IF EXISTS photo_path;
