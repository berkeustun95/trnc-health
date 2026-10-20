-- ═══════════════════════════════════════════════════════════════════════════
-- 20261119 — is_previewer() + preview read policies on the three eatery tables
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Berke (2026-10-19) wants to see an INACTIVE eatery partner (Crunchy Express) on ADA Preview exactly
-- as a customer will, signed in as his own CUSTOMER account. Not an admin: an admin never reaches
-- Home, and `|| isAdmin` opens every dark module (root CLAUDE.md).
--
-- ─── public.is_previewer() ──────────────────────────────────────────────────
-- true ONLY for Berke's customer account 412cad91-2e3b-41b9-8186-175dfb8afa35 (hard-coded by his
-- decision; no table). Reusable by later modules under one contract: use it ONLY in SELECT policies,
-- and ALWAYS paired with an "unpublished" restriction (NOT is_active or equivalent), so it can only
-- ADD unpublished rows to what that account already reads. Never in a write policy, never alone.
-- STABLE, SECURITY INVOKER (reads no table), search_path ''. EXECUTE: authenticated only. A policy
-- expression runs as the querying role, so authenticated MUST keep EXECUTE (without it every signed-in
-- read of these tables fails with 42501); anon is revoked BY NAME (Supabase's default privileges grant
-- it by name, so REVOKE … FROM PUBLIC alone leaves anon with EXECUTE).
--
-- ─── WHO CAN READ / WRITE AFTER THIS FILE ───────────────────────────────────
--   • anon, guests (authenticated + is_anonymous) and every ordinary signed-in user: EXACTLY as before —
--     active partners, and the menu items / photos of active partners. 0 inactive rows.
--   • Berke's customer account (412cad91…): the above, PLUS inactive partners and their menu items
--     and photos. Read only.
--   • WRITE: unchanged. service_role only; no client role gains INSERT/UPDATE/DELETE.
--   • ⚠ The database no longer hides inactive rows from Berke's account in ANY build, production
--     included. Keeping production clean for his account is client-enforced: the app filters
--     is_active = true outside Preview builds (and both eatery flags are false today).
--   • The 1115 policies are untouched (permissive OR); each table gains one policy:
--       eatery_partners_select_preview   NOT is_active AND (SELECT is_previewer())
--       eatery_menu_items_select_preview (SELECT is_previewer()) AND parent partner NOT active
--       eatery_photos_select_preview     (SELECT is_previewer()) AND parent partner NOT active
--     (SELECT …) makes the call one InitPlan per statement instead of one call per row.
--   • search_content still has no eatery arm (asserted): it is SECURITY INVOKER, so an eatery arm
--     would hand Berke's account inactive partners in search.
--
-- ─── PROOF (inside, rolled back by a sentinel) ──────────────────────────────
-- Probe partners zz-on (active, launch-complete) and zz-off (inactive), one item + one photo each.
-- anon / guest / normal user: 0 inactive partners/items/photos, and still see zz-on (control).
-- Previewer: Crunchy 1 partner, 41 items, 16 with photo_path; zz-off's photo row (Crunchy has no
-- eatery_photos rows, its dish photos live on the items); INSERT/UPDATE/DELETE denied.
-- RE-RUNNABLE: pre-state accepts 1 policy per table (1115) or exactly these 2.
--
-- Apply: gh workflow run supabase-migrate -f file=20261119_eatery_preview_read.sql (dry), then
-- -f apply=true (Berke approves production-db).
-- ═══════════════════════════════════════════════════════════════════════════

SET ROLE postgres;

BEGIN;

SET LOCAL lock_timeout = '5s';

-- ─── Pre-state ──────────────────────────────────────────────────────────────
DO $$
DECLARE
  t text;
  v_names text[];
BEGIN
  FOREACH t IN ARRAY ARRAY['eatery_partners','eatery_menu_items','eatery_photos'] LOOP
    SELECT array_agg(policyname::text ORDER BY policyname) INTO v_names FROM pg_policies WHERE schemaname = 'public' AND tablename = t;
    IF v_names IS DISTINCT FROM ARRAY[t || '_select_active']
       AND v_names IS DISTINCT FROM ARRAY[t || '_select_active', t || '_select_preview'] THEN
      RAISE EXCEPTION 'pre-state: % has policies % — expected [%_select_active] (1115) or that plus %_select_preview (re-run). Nothing applied.',
        t, v_names, t, t;
    END IF;
  END LOOP;
END $$;

-- ─── Function ───────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.is_previewer()
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SET search_path = ''
AS $fn$
  SELECT COALESCE(auth.uid() = '412cad91-2e3b-41b9-8186-175dfb8afa35'::uuid, false)
$fn$;
REVOKE EXECUTE ON FUNCTION public.is_previewer() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_previewer() TO authenticated, service_role;
COMMENT ON FUNCTION public.is_previewer() IS
  'true only for Berke''s customer account (412cad91…). Use ONLY in SELECT policies, ALWAYS paired with an unpublished restriction (NOT is_active); never in a write policy, never alone. 20261119.';

-- ─── Policies ───────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS eatery_partners_select_preview ON public.eatery_partners;
CREATE POLICY eatery_partners_select_preview ON public.eatery_partners
  FOR SELECT TO authenticated
  USING (NOT is_active AND (SELECT public.is_previewer()));

DROP POLICY IF EXISTS eatery_menu_items_select_preview ON public.eatery_menu_items;
CREATE POLICY eatery_menu_items_select_preview ON public.eatery_menu_items
  FOR SELECT TO authenticated
  USING ((SELECT public.is_previewer())
         AND EXISTS (SELECT 1 FROM public.eatery_partners p WHERE p.id = eatery_menu_items.partner_id AND NOT p.is_active));

DROP POLICY IF EXISTS eatery_photos_select_preview ON public.eatery_photos;
CREATE POLICY eatery_photos_select_preview ON public.eatery_photos
  FOR SELECT TO authenticated
  USING ((SELECT public.is_previewer())
         AND EXISTS (SELECT 1 FROM public.eatery_partners p WHERE p.id = eatery_photos.partner_id AND NOT p.is_active));

-- ─── Post-state + proof ─────────────────────────────────────────────────────
DO $$
DECLARE
  c_prev   constant uuid := '412cad91-2e3b-41b9-8186-175dfb8afa35';
  c_crunch constant uuid := 'bb9dad05-6bb0-4c1c-90fb-cb0a4ad68434';
  t text;
  v_report text := '';
  v_n int;
  v_fn record;
  v_sc_def text;
  v_on uuid; v_off uuid;
  r record;
  v_p int; v_i int; v_ph int; v_on_seen int; v_on_i int; v_on_ph int; v_cr_p int; v_cr_i int; v_cr_ph int; v_off_f int;
  v_w text;
  v_owner_i int; v_owner_ph int;
BEGIN
  -- Function shape and grants.
  SELECT p.provolatile, p.prosecdef, p.prosrc AS def INTO v_fn
    FROM pg_proc p WHERE p.oid = to_regprocedure('public.is_previewer()');
  IF v_fn.provolatile IS DISTINCT FROM 's' OR v_fn.prosecdef IS DISTINCT FROM false
     OR v_fn.def NOT LIKE '%412cad91-2e3b-41b9-8186-175dfb8afa35%' THEN
    RAISE EXCEPTION 'is_previewer(): volatile=% definer=% or uuid missing', v_fn.provolatile, v_fn.prosecdef;
  END IF;
  IF has_function_privilege('anon', 'public.is_previewer()', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.is_previewer()', 'EXECUTE') THEN
    RAISE EXCEPTION 'is_previewer() EXECUTE: anon=% authenticated=% — expected false / true',
      has_function_privilege('anon', 'public.is_previewer()', 'EXECUTE'), has_function_privilege('authenticated', 'public.is_previewer()', 'EXECUTE');
  END IF;

  -- Full policy set: exactly 2 per table, printed.
  FOREACH t IN ARRAY ARRAY['eatery_partners','eatery_menu_items','eatery_photos'] LOOP
    SELECT count(*) INTO v_n FROM pg_policies WHERE schemaname = 'public' AND tablename = t;
    IF v_n IS DISTINCT FROM 2 THEN RAISE EXCEPTION '% has % policies, expected 2', t, v_n; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = t AND policyname = t || '_select_preview'
                   AND cmd = 'SELECT' AND permissive = 'PERMISSIVE' AND roles::text[] = ARRAY['authenticated']::text[]
                   AND qual LIKE '%is_previewer()%' AND qual LIKE '%is_active%' AND with_check IS NULL) THEN
      RAISE EXCEPTION '%_select_preview missing or wrong shape', t;
    END IF;
    FOR r IN SELECT policyname, roles::text AS roles, qual FROM pg_policies WHERE schemaname = 'public' AND tablename = t ORDER BY policyname LOOP
      v_report := v_report || E'\n  ' || r.policyname || ' ' || r.roles || ' USING ' || r.qual;
    END LOOP;
  END LOOP;
  RAISE NOTICE 'eatery policies:%', v_report;
  v_report := '';

  -- search_content: still no eatery arm (positive control: the places arm).
  v_sc_def := pg_get_functiondef(to_regprocedure('public.search_content(text,double precision,double precision)'));
  IF v_sc_def IS NULL OR v_sc_def NOT ILIKE '%FROM places p%' THEN
    RAISE EXCEPTION 'CONTROL FAILED: search_content definition not read, or lost its places arm';
  END IF;
  IF v_sc_def ILIKE '%FROM eatery_partners%' OR v_sc_def ILIKE '%FROM public.eatery_partners%'
     OR v_sc_def ILIKE '%JOIN eatery_partners%' OR v_sc_def ILIKE '%JOIN public.eatery_partners%' THEN
    RAISE EXCEPTION 'search_content has an eatery arm; with the preview policy it would return inactive partners to the previewer';
  END IF;

  -- Owner counts for the positive control (Crunchy, as postgres).
  SELECT count(*), count(*) FILTER (WHERE photo_path IS NOT NULL) INTO v_owner_i, v_owner_ph
    FROM public.eatery_menu_items WHERE partner_id = c_crunch;
  IF v_owner_i < 1 OR NOT EXISTS (SELECT 1 FROM public.eatery_partners WHERE id = c_crunch AND NOT is_active) THEN
    RAISE EXCEPTION 'CONTROL FAILED: Crunchy (%) missing, active, or without items (owner sees % items)', c_crunch, v_owner_i;
  END IF;

  -- BEHAVIOUR, rolled back by the sentinel at the end of this block.
  BEGIN
    INSERT INTO public.eatery_partners (slug, name, category, lat, lng, geocode_source, logo_path, menu_verified_on, is_active)
      VALUES ('zz-on', 'zz on', 'cafe', 35.1, 33.3, 'partner', 'zz-on/logo.png', current_date, true) RETURNING id INTO v_on;
    INSERT INTO public.eatery_partners (slug, name, category, is_active) VALUES ('zz-off', 'zz off', 'cafe', false) RETURNING id INTO v_off;
    INSERT INTO public.eatery_menu_items (partner_id, section, name) VALUES (v_on, 'zz', 'zz on'), (v_off, 'zz', 'zz off');
    INSERT INTO public.eatery_photos (partner_id, kind, storage_path) VALUES (v_on, 'gallery', 'zz-on/zz-1.jpg'), (v_off, 'gallery', 'zz-off/zz-1.jpg');

    -- anon, guest, normal user: 0 inactive rows; zz-on still visible.
    FOR r IN SELECT * FROM (VALUES
        ('anon', 'anon', ''),
        ('guest', 'authenticated', json_build_object('sub', gen_random_uuid(), 'role', 'authenticated', 'is_anonymous', true)::text),
        ('normal user', 'authenticated', json_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text)
      ) AS x(who, rl, claims) LOOP
      EXECUTE format('SET LOCAL ROLE %I', r.rl);
      PERFORM set_config('request.jwt.claims', r.claims, true);
      SELECT count(*) INTO v_p FROM public.eatery_partners WHERE NOT is_active;
      SELECT count(*) INTO v_i FROM public.eatery_menu_items WHERE partner_id IN (c_crunch, v_off);
      SELECT count(*) INTO v_ph FROM public.eatery_photos WHERE partner_id = v_off;
      SELECT count(*) INTO v_on_seen FROM public.eatery_partners WHERE id = v_on;
      SELECT count(*) INTO v_on_i FROM public.eatery_menu_items WHERE partner_id = v_on;
      SELECT count(*) INTO v_on_ph FROM public.eatery_photos WHERE partner_id = v_on;
      RESET ROLE;
      PERFORM set_config('request.jwt.claims', '', true);
      IF v_p <> 0 OR v_i <> 0 OR v_ph <> 0 THEN
        RAISE EXCEPTION '% sees inactive rows: partners % items % photos %', r.who, v_p, v_i, v_ph;
      END IF;
      IF v_on_seen <> 1 OR v_on_i <> 1 OR v_on_ph <> 1 THEN
        RAISE EXCEPTION 'CONTROL FAILED: % cannot see the ACTIVE probe partner/item/photo (%/%/%)', r.who, v_on_seen, v_on_i, v_on_ph;
      END IF;
      v_report := v_report || E'\n  ' || r.who || ': inactive 0/0/0, active probe 1/1/1';
    END LOOP;

    -- Previewer: Crunchy in full, zz-off's photo, writes denied.
    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', c_prev, 'role', 'authenticated')::text, true);
    SELECT count(*) INTO v_cr_p FROM public.eatery_partners WHERE id = c_crunch;
    SELECT count(*), count(*) FILTER (WHERE photo_path IS NOT NULL) INTO v_cr_i, v_cr_ph FROM public.eatery_menu_items WHERE partner_id = c_crunch;
    SELECT count(*) INTO v_off_f FROM public.eatery_photos WHERE partner_id = v_off;
    SELECT count(*) INTO v_on_seen FROM public.eatery_partners WHERE id = v_on;
    v_w := '';
    BEGIN INSERT INTO public.eatery_partners (slug, name, category) VALUES ('zz-prev', 'zz prev', 'cafe'); v_w := v_w || ' partners-INSERT';
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    BEGIN UPDATE public.eatery_partners SET name = 'zz' WHERE id = c_crunch; v_w := v_w || ' partners-UPDATE';
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    BEGIN DELETE FROM public.eatery_menu_items WHERE partner_id = c_crunch; v_w := v_w || ' items-DELETE';
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    BEGIN INSERT INTO public.eatery_photos (partner_id, kind, storage_path) VALUES (v_off, 'gallery', 'zz-off/zz-2.jpg'); v_w := v_w || ' photos-INSERT';
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    RESET ROLE;
    PERFORM set_config('request.jwt.claims', '', true);
    IF v_w <> '' THEN RAISE EXCEPTION 'previewer could write:%', v_w; END IF;
    IF v_cr_p <> 1 OR v_cr_i IS DISTINCT FROM v_owner_i OR v_cr_ph IS DISTINCT FROM v_owner_ph OR v_off_f <> 1 OR v_on_seen <> 1 THEN
      RAISE EXCEPTION 'previewer sees Crunchy %/% items/% with photo (owner %/%), zz-off photos %, active probe % — expected 1/owner/owner/1/1',
        v_cr_p, v_cr_i, v_cr_ph, v_owner_i, v_owner_ph, v_off_f, v_on_seen;
    END IF;
    v_report := v_report || format(E'\n  previewer: Crunchy 1 partner, %s items, %s with photo; inactive probe photo 1; active probe 1; writes denied', v_cr_i, v_cr_ph);

    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'zz-sentinel';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM IS DISTINCT FROM 'zz-sentinel' THEN RAISE; END IF;
  END;

  IF EXISTS (SELECT 1 FROM public.eatery_partners WHERE slug LIKE 'zz-%') THEN
    RAISE EXCEPTION 'probe rows survived the sentinel';
  END IF;
  RAISE NOTICE 'preview proof:%', v_report;
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
VALUES ('20261119_eatery_preview_read.sql', '463952d69f779262ecbaed821256525b1c499208b1651b15ba16ab6f91d78367')
ON CONFLICT (filename) DO UPDATE
  SET checksum = excluded.checksum, applied_at = now(), applied_by = current_user;
-- ─── ledger:stamp:end ────────────────────────────────────────────────
COMMIT;
RESET ROLE;

-- ─── Verification after applying (read-only, run alone) ─────────────────────
--   Run supabase/verify_schema.sql QUERY 1: every 1119_eatery_preview_read row must read OK.
--
-- ─── Rollback ──
--   DROP POLICY IF EXISTS eatery_partners_select_preview ON public.eatery_partners;
--   DROP POLICY IF EXISTS eatery_menu_items_select_preview ON public.eatery_menu_items;
--   DROP POLICY IF EXISTS eatery_photos_select_preview ON public.eatery_photos;
--   DROP FUNCTION IF EXISTS public.is_previewer();   -- only if no other module's policy uses it
