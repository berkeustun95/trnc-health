-- ═══════════════════════════════════════════════════════════════════════════
-- 20261231 — Döveç projects: the read gate (nothing is readable by users until Döveç approves)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Döveç asked (Berke, 2026-11-23) that NOTHING of theirs is public before their approval, and that the data is used only
-- in ADA. 20261229 let anyone read listed projects while the feed was fresh, whatever dovec_settings.published said. This file
-- closes that: until `published` is true, only an admin can read project data.
--
-- THIS SUPERSEDES the 20261229 header section "WHY `published` IS NOT IN THE dovec_projects READ POLICY". That decision (rows
-- are public marketing data, so seeing them early is no privacy question) is withdrawn on Döveç's request: `published` is
-- now part of the read rule. The dev-bundle mockup can no longer read real rows while published = false; use an admin.
--
-- WHAT THIS FILE CHANGES
--   dovec_projects_visible()   NEW. STABLE SECURITY DEFINER boolean: is_admin() OR (published AND the feed is fresh). Never NULL.
--   dovec_projects_read        REPLACED. USING (listed AND (SELECT dovec_projects_visible())). Same roles (anon + authenticated).
--   dovec_coord_report()       NEW, private. The old body of dovec_coord_status() (seed names, project names and ids, a status word).
--                              No app role and no service_role may execute it; only the two DEFINER functions below call it.
--   dovec_sync_coords()        REPLACED (same body, same service_role-only grant) but it now returns dovec_coord_report(), so the
--                              sync never meets the gate.
--   dovec_coord_status()       REPLACED. Same name and return shape, but admin-or-service only in EVERY state: it refuses (SQLSTATE
--                              42501, message DOVEC_NOT_PUBLIC) unless the caller is the service role or an admin. EXECUTE is
--                              revoked from anon (it has no app caller; it is a diagnostic); authenticated and service_role keep it.
--   Nothing else: no table, column, grant on a table, or cron job changes. dovec_settings stays readable by app roles
--   (the app reads `published` and `whatsapp_e164` from it as a non-admin; there is no project data in that row).
--
-- WHO CAN READ / WRITE WHAT, IN PLAIN ENGLISH
--   Listed projects are the only rows any app user can ever see; an unlisted (delisted) project is never readable through the API.
--   STATE 1: published = false (today, and until Döveç approves)
--     Read projects:   admins only (signed-in role 'admin'). Anonymous visitors, guests (anonymous sign-ins) and every
--                      ordinary signed-in customer or provider read ZERO rows, however fresh the feed is.
--     dovec_coord_status():  admins and the service role only (in every state); anon cannot execute it; signed-in non-admins
--                      and guests get DOVEC_NOT_PUBLIC (42501).
--     Write projects:  nobody from the app. The sync function (service role) inserts and updates, and it is NOT affected by
--                      the gate (the service role bypasses row security), so syncing may run before go-live.
--   STATE 2: published = true, feed fresh (last good sync under 24 h) and not suspended
--     Read projects:   everyone, guests included (listed rows only). dovec_coord_status() stays admin / service role only.
--   STATE 3: published = true but the feed is suspended (401 kill switch) or the last good sync is 24 h old or older
--     Read projects:   admins only again. Nobody else sees a stale or suspended feed, as before.
--     An admin sees listed rows even when the feed is suspended or stale, so they can check the data; that is deliberate.
--   dovec_settings:    unchanged (everyone reads id, published, suspended, whatsapp_e164, last_good_sync_at; nobody from the app writes).
--   dovec_leads:       unchanged: no policy and no grant for any app role; only the edge functions (service role) reach it.
--   dovec_lead_counts(): unchanged: raises ADMIN_ONLY for non-admins; anon cannot execute it.
--   dovec_project_coords: unchanged: no grant to any app role.
--   Flipping `published` stays a migration (nobody can write it from the app).
--
-- WHY A DEFINER HELPER INSTEAD OF is_admin() IN THE POLICY
--   The policy must work for anon too, which cannot be trusted to hold EXECUTE on is_admin() or SELECT on profiles; the
--   helper runs as its owner and answers one boolean, so a role without those privileges still gets a clean true/false.
--   It is wrapped in (SELECT ...) in the policy so it is evaluated once per statement, not once per row.
--
-- WHY dovec_coord_status() IS SPLIT
--   It was executable by anon and returns project names and ids from dovec_projects, including delisted ones that RLS hides,
--   so it would have leaked the project list. It has no app caller (a diagnostic), so it is now admin / service role only in
--   every state and anon loses EXECUTE. The report body lives in dovec_coord_report() (private) and the
--   gated function is the gate in front of it. dovec_sync_coords() (called by sync-dovec with the service key, and by SQL)
--   calls the report directly. The service role is recognised by the JWT role claim (auth.role()), the same call 20260904
--   and 20261039 use for 'authenticated'; the health script calls dovec_coord_status through PostgREST with the service key,
--   which carries role = service_role.
--
-- Apply: supabase-migrate, BEFORE 20261232_dovec_cron.sql (which refuses to run without this file). Ends with NOTIFY pgrst
-- after RESET ROLE. Re-runnable.

SET ROLE postgres;

BEGIN;

SET LOCAL lock_timeout = '5s';

-- ─── 0. Precondition: the 20261229 objects exist ─────────────────────────────
DO $$
BEGIN
  IF to_regclass('public.dovec_settings') IS NULL OR to_regclass('public.dovec_projects') IS NULL
     OR to_regclass('public.dovec_project_coords') IS NULL
     OR to_regprocedure('public.dovec_feed_is_fresh()') IS NULL
     OR to_regprocedure('public.dovec_coord_status()') IS NULL
     OR to_regprocedure('public.dovec_sync_coords()') IS NULL THEN
    RAISE EXCEPTION '20261229 is not applied: apply it before this file';
  END IF;
END $$;

-- ─── 1. The visibility helper ────────────────────────────────────────────────
-- true for an admin; for everyone else only while the go-live gate is open AND the feed is fresh and not suspended.
-- COALESCE: a missing settings row reads as closed, never NULL.
CREATE OR REPLACE FUNCTION public.dovec_projects_visible()
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT public.is_admin()
      OR (COALESCE((SELECT s.published FROM public.dovec_settings s WHERE s.id = 1), false)
          AND public.dovec_feed_is_fresh());
$function$;

REVOKE ALL ON FUNCTION public.dovec_projects_visible() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dovec_projects_visible() TO anon, authenticated, service_role;

-- ─── 2. The read policy ──────────────────────────────────────────────────────
-- Anyone reads a LISTED project while dovec_projects_visible(): admins always, everyone else only once published and fresh.
DROP POLICY IF EXISTS dovec_projects_read ON public.dovec_projects;
CREATE POLICY dovec_projects_read ON public.dovec_projects FOR SELECT TO anon, authenticated
  USING (listed AND (SELECT public.dovec_projects_visible()));

COMMENT ON TABLE public.dovec_projects IS
  'Mirror of the Döveç partner feed (GET /api/partner/projects), written by sync-dovec only. Never deleted: a project that leaves the feed is delisted (listed = false). RLS read: listed AND dovec_projects_visible() = an admin, or published = true AND the feed fresh (not suspended, last good sync under 24 h). Until Döveç approves (published = false) only admins read it. description and gallery are empty on purpose until Döveç supplies them. latitude / longitude are NULL until dovec_sync_coords() attaches a seeded pin by exact name (the feed has none). 20261229, read gate 20261231.';

-- ─── 3. The pin report: private body, gated public face ──────────────────────
-- The body is the 20261229 dovec_coord_status(), verbatim. Nobody from the app, and not the service role, may run it directly.
CREATE OR REPLACE FUNCTION public.dovec_coord_report()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT jsonb_build_object(
    'unmatched', COALESCE((SELECT jsonb_agg(jsonb_build_object('seed', c.seed_name, 'reason', c.last_status) ORDER BY c.seed_name)
                             FROM public.dovec_project_coords c WHERE c.project_id IS NULL), '[]'::jsonb),
    'renamed', COALESCE((SELECT jsonb_agg(jsonb_build_object('seed', c.seed_name, 'project_id', p.id, 'name', p.name) ORDER BY c.seed_name)
                           FROM public.dovec_project_coords c JOIN public.dovec_projects p ON p.id = c.project_id
                          WHERE p.name COLLATE "C" <> c.seed_name COLLATE "C"), '[]'::jsonb),
    'live_without_coords', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name) ORDER BY p.name, p.id)
                                       FROM public.dovec_projects p
                                      WHERE p.listed AND (p.latitude IS NULL OR p.longitude IS NULL)), '[]'::jsonb));
$function$;

REVOKE ALL ON FUNCTION public.dovec_coord_report() FROM PUBLIC, anon, authenticated, service_role;

-- Called by sync-dovec after a good sync. Idempotent. Same body as 20261229 except the last line, which returns the private report.
CREATE OR REPLACE FUNCTION public.dovec_sync_coords()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  s    record;
  v_n  int;
  v_id text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('dovec_coords:sync', 0));
  FOR s IN SELECT * FROM public.dovec_project_coords ORDER BY seed_name LOOP
    IF s.project_id IS NOT NULL THEN
      UPDATE public.dovec_project_coords c
         SET last_status = CASE WHEN EXISTS (SELECT 1 FROM public.dovec_projects p
                                              WHERE p.id = s.project_id AND p.name COLLATE "C" = s.seed_name COLLATE "C")
                                THEN 'matched' ELSE 'renamed' END
       WHERE c.seed_name = s.seed_name;
    ELSE
      SELECT count(*), min(p.id) INTO v_n, v_id
        FROM public.dovec_projects p WHERE p.listed AND p.name COLLATE "C" = s.seed_name COLLATE "C";
      IF v_n = 0 THEN
        UPDATE public.dovec_project_coords c SET last_status = 'no_match' WHERE c.seed_name = s.seed_name;
      ELSIF v_n > 1 THEN
        UPDATE public.dovec_project_coords c SET last_status = 'ambiguous' WHERE c.seed_name = s.seed_name;
      ELSIF EXISTS (SELECT 1 FROM public.dovec_project_coords c WHERE c.project_id = v_id) THEN
        UPDATE public.dovec_project_coords c SET last_status = 'claimed' WHERE c.seed_name = s.seed_name;
      ELSE
        UPDATE public.dovec_project_coords c SET project_id = v_id, matched_at = now(), last_status = 'matched' WHERE c.seed_name = s.seed_name;
      END IF;
    END IF;
  END LOOP;

  UPDATE public.dovec_projects p SET latitude = c.latitude, longitude = c.longitude
    FROM public.dovec_project_coords c
   WHERE c.project_id = p.id AND (p.latitude IS DISTINCT FROM c.latitude OR p.longitude IS DISTINCT FROM c.longitude);

  RETURN public.dovec_coord_report();
END;
$function$;

-- The gated face: the service role (the health script, with the service key) or an admin, in every state.
CREATE OR REPLACE FUNCTION public.dovec_coord_status()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT (COALESCE(auth.role(), '') = 'service_role' OR public.is_admin()) THEN
    RAISE EXCEPTION 'DOVEC_NOT_PUBLIC' USING ERRCODE = '42501';
  END IF;
  RETURN public.dovec_coord_report();
END;
$function$;

REVOKE ALL ON FUNCTION public.dovec_sync_coords() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dovec_sync_coords() TO service_role;
REVOKE ALL ON FUNCTION public.dovec_coord_status() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dovec_coord_status() TO authenticated, service_role;

-- ─── 4. Structural assertions (they print what they read; no counts of users or leads) ───
DO $$
DECLARE
  v_n     int;
  v_names text;
  v_t     text;
  v_f     text;
  v_pol   record;
BEGIN
  -- 4a. The FULL policy set of every dovec table (permissive policies OR together), printed.
  FOREACH v_t IN ARRAY ARRAY['dovec_settings','dovec_projects','dovec_leads','dovec_project_coords'] LOOP
    SELECT count(*), coalesce(string_agg(policyname || ':' || cmd || ':' || permissive || ':' || array_to_string(roles, '+'), ', ' ORDER BY policyname), '(none)')
      INTO v_n, v_names FROM pg_policies WHERE schemaname = 'public' AND tablename = v_t;
    RAISE NOTICE '% policies: % (%)', v_t, v_n, v_names;
    IF v_n IS DISTINCT FROM (CASE WHEN v_t IN ('dovec_leads','dovec_project_coords') THEN 0 ELSE 1 END) THEN
      RAISE EXCEPTION '% carries % policies (%)', v_t, v_n, v_names;
    END IF;
    IF (SELECT relrowsecurity FROM pg_class WHERE oid = to_regclass('public.' || v_t)) IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'RLS is not enabled on %', v_t;
    END IF;
  END LOOP;

  SELECT * INTO v_pol FROM pg_policies WHERE schemaname = 'public' AND tablename = 'dovec_projects';
  RAISE NOTICE 'dovec_projects policy qual as rendered: %', v_pol.qual;
  IF v_pol.policyname IS DISTINCT FROM 'dovec_projects_read' OR v_pol.cmd IS DISTINCT FROM 'SELECT' OR v_pol.permissive IS DISTINCT FROM 'PERMISSIVE'
     OR cardinality(v_pol.roles) IS DISTINCT FROM 2 OR NOT (v_pol.roles::text[] @> ARRAY['anon','authenticated']::text[]) THEN
    RAISE EXCEPTION 'dovec_projects_read is not the one permissive SELECT policy for anon + authenticated';
  END IF;
  IF strpos(v_pol.qual, 'dovec_projects_visible') = 0 OR strpos(v_pol.qual, 'listed') = 0 THEN
    RAISE EXCEPTION 'dovec_projects_read does not read listed AND dovec_projects_visible(): %', v_pol.qual;
  END IF;
  IF strpos(v_pol.qual, 'dovec_feed_is_fresh') > 0 THEN
    RAISE EXCEPTION 'dovec_projects_read still carries the 20261229 expression: %', v_pol.qual;
  END IF;

  -- 4b. Function grants, derived from the ACL (aclexplode: a missing grant reads as absent). grantee 0 = PUBLIC.
  FOREACH v_f IN ARRAY ARRAY['public.dovec_projects_visible()','public.dovec_coord_status()','public.dovec_coord_report()','public.dovec_sync_coords()'] LOOP
    IF to_regprocedure(v_f) IS NULL THEN RAISE EXCEPTION '% is missing', v_f; END IF;
    SELECT coalesce(string_agg(DISTINCT coalesce(r.rolname, 'PUBLIC'), ',' ORDER BY coalesce(r.rolname, 'PUBLIC')), '(none)') INTO v_names
      FROM pg_proc p, aclexplode(p.proacl) a LEFT JOIN pg_roles r ON r.oid = a.grantee
     WHERE p.oid = to_regprocedure(v_f) AND a.privilege_type = 'EXECUTE' AND a.grantee <> p.proowner;
    RAISE NOTICE '% EXECUTE grantees besides the owner: %', v_f, v_names;
    IF EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) a WHERE p.oid = to_regprocedure(v_f) AND a.grantee = 0) THEN
      RAISE EXCEPTION '% carries a PUBLIC grant', v_f;
    END IF;
    IF (SELECT prosecdef FROM pg_proc WHERE oid = to_regprocedure(v_f)) IS DISTINCT FROM true
       OR NOT EXISTS (SELECT 1 FROM pg_proc p, unnest(p.proconfig) cfg WHERE p.oid = to_regprocedure(v_f) AND cfg LIKE 'search_path=%') THEN
      RAISE EXCEPTION '% is not SECURITY DEFINER with a pinned search_path', v_f;
    END IF;
  END LOOP;
  IF NOT (has_function_privilege('anon', 'public.dovec_projects_visible()', 'EXECUTE') AND has_function_privilege('authenticated', 'public.dovec_projects_visible()', 'EXECUTE')
          AND has_function_privilege('service_role', 'public.dovec_projects_visible()', 'EXECUTE')) THEN
    RAISE EXCEPTION 'dovec_projects_visible() must be executable by anon, authenticated and service_role';
  END IF;
  IF has_function_privilege('anon', 'public.dovec_coord_status()', 'EXECUTE')
     OR NOT (has_function_privilege('authenticated', 'public.dovec_coord_status()', 'EXECUTE') AND has_function_privilege('service_role', 'public.dovec_coord_status()', 'EXECUTE')) THEN
    RAISE EXCEPTION 'dovec_coord_status() must be executable by authenticated and service_role and NOT by anon';
  END IF;
  IF has_function_privilege('anon', 'public.dovec_coord_report()', 'EXECUTE') OR has_function_privilege('authenticated', 'public.dovec_coord_report()', 'EXECUTE')
     OR has_function_privilege('service_role', 'public.dovec_coord_report()', 'EXECUTE') THEN
    RAISE EXCEPTION 'dovec_coord_report() is executable by an app role or the service role';
  END IF;
  IF has_function_privilege('anon', 'public.dovec_sync_coords()', 'EXECUTE') OR has_function_privilege('authenticated', 'public.dovec_sync_coords()', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.dovec_sync_coords()', 'EXECUTE') THEN
    RAISE EXCEPTION 'dovec_sync_coords() must stay service_role only';
  END IF;
  IF (SELECT provolatile FROM pg_proc WHERE oid = to_regprocedure('public.dovec_projects_visible()')) IS DISTINCT FROM 's'
     OR (SELECT provolatile FROM pg_proc WHERE oid = to_regprocedure('public.dovec_coord_status()')) IS DISTINCT FROM 's' THEN
    RAISE EXCEPTION 'dovec_projects_visible() and dovec_coord_status() must be STABLE';
  END IF;

  -- 4c. The bodies are what this file says (anchored to code shapes).
  IF pg_get_functiondef(to_regprocedure('public.dovec_sync_coords()')) NOT LIKE '%RETURN public.dovec_coord_report();%'
     OR pg_get_functiondef(to_regprocedure('public.dovec_sync_coords()')) LIKE '%RETURN public.dovec_coord_status()%' THEN
    RAISE EXCEPTION 'dovec_sync_coords() does not return the private report';
  END IF;
  IF pg_get_functiondef(to_regprocedure('public.dovec_coord_status()')) NOT LIKE '%DOVEC_NOT_PUBLIC%'
     OR pg_get_functiondef(to_regprocedure('public.dovec_coord_status()')) NOT LIKE '%public.is_admin()%'
     OR pg_get_functiondef(to_regprocedure('public.dovec_coord_status()')) LIKE '%dovec_projects_visible%'
     OR pg_get_functiondef(to_regprocedure('public.dovec_coord_status()')) NOT LIKE '%RETURN public.dovec_coord_report();%' THEN
    RAISE EXCEPTION 'dovec_coord_status() is not the gate in front of the report';
  END IF;

  -- 4d. The go-live gate is still closed and its DEFAULT is still false; the settings row is unique.
  IF (SELECT count(*) FROM public.dovec_settings) IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'dovec_settings must hold exactly one row'; END IF;
  IF (SELECT published FROM public.dovec_settings WHERE id = 1) IS DISTINCT FROM false THEN RAISE EXCEPTION 'dovec_settings.published is not false'; END IF;
  IF (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
       WHERE d.adrelid = 'public.dovec_settings'::regclass AND a.attname = 'published') IS DISTINCT FROM 'false' THEN
    RAISE EXCEPTION 'dovec_settings.published DEFAULT is not false';
  END IF;

  -- 4e. Table grants for the app roles are exactly what they were (SELECT only; the policy is the gate).
  IF NOT (has_table_privilege('anon', 'public.dovec_projects', 'SELECT') AND has_table_privilege('authenticated', 'public.dovec_projects', 'SELECT'))
     OR has_table_privilege('anon', 'public.dovec_projects', 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
     OR has_table_privilege('authenticated', 'public.dovec_projects', 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') THEN
    RAISE EXCEPTION 'the app roles'' table grants on dovec_projects changed';
  END IF;
END $$;

-- ─── 5. Behaviour, measured as the roles that matter ─────────────────────────
-- Probe rows are made inside a block that ends in a deliberate exception, so nothing it writes survives; the settings row and
-- the pin table are captured first and compared after. Per-case results are counts of PROBE rows only (no real data is counted).
-- Identities: admin = an existing admin profile (id never printed); customer = a synthetic authenticated uuid with no profile;
-- guest = a synthetic authenticated uuid with is_anonymous = true (is_anonymous_session() is asserted true inside that context,
-- false for the customer); anon = role anon, no claims; service = role service_role with a service_role claim.
DO $$
DECLARE
  v_admin   uuid;
  v_cust    uuid := '00000000-0000-4000-8000-0000000000c1';
  v_guest   uuid := '00000000-0000-4000-8000-0000000000c2';
  v_pl      text := 'zz-gate-listed';
  v_pu      text := 'zz-gate-unlisted';
  v_px      text := 'zz-gate-exact';
  v_set0    jsonb;
  v_coords0 jsonb;
  v_case    text;
  v_i       int;
  v_ident   text;
  v_role    text;
  v_claims  text;
  v_cu      text;
  v_nl      int;
  v_nu      int;
  v_st      text;
  v_j       jsonb;
  v_ctx     text;
  v_res     jsonb := '{}'::jsonb;
  v_want    jsonb;
  v_ins     int := -1;
  v_upd     int := -1;
  v_sync1   text := 'unset';
  v_sync2   text := 'unset';
  v_pre     int;
  v_att     int := -1;
  v_lat     numeric;
  v_den     jsonb := '{}'::jsonb;
  v_owner   text := 'unset';
BEGIN
  SELECT id INTO v_admin FROM public.profiles WHERE role = 'admin' LIMIT 1;
  IF v_admin IS NULL THEN RAISE EXCEPTION 'no admin profile to run the positive control with'; END IF;
  IF EXISTS (SELECT 1 FROM public.profiles WHERE id IN (v_cust, v_guest)) THEN RAISE EXCEPTION 'a synthetic probe identity has a profile'; END IF;
  IF EXISTS (SELECT 1 FROM public.dovec_projects WHERE id LIKE 'zz-gate-%') THEN RAISE EXCEPTION 'probe rows already exist before the test'; END IF;

  SELECT to_jsonb(s) INTO v_set0 FROM public.dovec_settings s WHERE s.id = 1;
  SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY c.seed_name), '[]'::jsonb) INTO v_coords0 FROM public.dovec_project_coords c;
  SELECT count(*) INTO v_pre FROM public.dovec_projects WHERE listed AND name COLLATE "C" = 'D-Point' COLLATE "C";
  v_pre := v_pre + (SELECT count(*) FROM public.dovec_project_coords WHERE seed_name = 'D-Point' AND project_id IS NOT NULL)::int;

  BEGIN
    INSERT INTO public.dovec_projects (id, name, city, status, website_url) VALUES (v_pl, 'Probe', 'Probe city', 'on_sale', 'https://example.com/gl');
    INSERT INTO public.dovec_projects (id, name, city, status, website_url, listed, delisted_at) VALUES (v_pu, 'Probe two', 'Probe city', 'on_sale', 'https://example.com/gu', false, now());

    FOREACH v_case IN ARRAY ARRAY['a','b','c','d'] LOOP
      IF v_case = 'a' THEN
        UPDATE public.dovec_settings SET published = false, suspended = false, last_good_sync_at = now() WHERE id = 1;
      ELSIF v_case = 'b' THEN
        UPDATE public.dovec_settings SET published = true, suspended = false, last_good_sync_at = now() WHERE id = 1;
      ELSIF v_case = 'c' THEN
        UPDATE public.dovec_settings SET published = true, suspended = true, last_good_sync_at = now() WHERE id = 1;
      ELSE
        UPDATE public.dovec_settings SET published = true, suspended = false, last_good_sync_at = now() - interval '25 hours' WHERE id = 1;
      END IF;

      FOR v_i IN 1..5 LOOP
        v_ident  := (ARRAY['admin','anon','customer','guest','service'])[v_i];
        v_role   := (ARRAY['authenticated','anon','authenticated','authenticated','service_role'])[v_i];
        v_claims := CASE v_ident
          WHEN 'admin'   THEN json_build_object('sub', v_admin, 'role', 'authenticated')::text
          WHEN 'customer' THEN json_build_object('sub', v_cust, 'role', 'authenticated')::text
          WHEN 'guest'   THEN json_build_object('sub', v_guest, 'role', 'authenticated', 'is_anonymous', true)::text
          WHEN 'service' THEN '{"role":"service_role"}'
          ELSE '' END;
        PERFORM set_config('request.jwt.claims', v_claims, true);
        EXECUTE format('SET LOCAL ROLE %I', v_role);
        v_cu := current_user;
        IF v_cu IS DISTINCT FROM v_role THEN RAISE EXCEPTION 'the % context did not switch role (running as %)', v_ident, v_cu; END IF;

        SELECT count(*) FILTER (WHERE id = v_pl), count(*) FILTER (WHERE id = v_pu) INTO v_nl, v_nu
          FROM public.dovec_projects WHERE id IN (v_pl, v_pu);
        BEGIN
          EXECUTE 'SELECT public.dovec_coord_status()' INTO v_j;
          v_st := CASE WHEN jsonb_typeof(v_j -> 'unmatched') = 'array' THEN 'ok' ELSE 'badshape' END;
        EXCEPTION WHEN insufficient_privilege THEN
          v_st := CASE WHEN SQLERRM = 'DOVEC_NOT_PUBLIC' THEN 'gate' ELSE 'privdenied' END;
        END;
        IF v_role = 'authenticated' THEN
          v_ctx := 'admin=' || public.is_admin()::text || ',anonymous=' || public.is_anonymous_session()::text;
          v_res := v_res || jsonb_build_object('ctx_' || v_ident, v_ctx);
        END IF;
        RESET ROLE;
        PERFORM set_config('request.jwt.claims', '', true);
        v_res := v_res || jsonb_build_object(v_case || '_' || v_ident, v_nl::text || '/' || v_nu::text || '/' || v_st);
      END LOOP;
    END LOOP;

    -- e. The sync path, with the gate closed: service_role inserts and updates, the pin attaches, and with no claims it still runs.
    UPDATE public.dovec_settings SET published = false, suspended = false, last_good_sync_at = now() WHERE id = 1;
    PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
    SET LOCAL ROLE service_role;
    IF current_user IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'the service context did not switch role'; END IF;
    INSERT INTO public.dovec_projects (id, name, city, status, website_url) VALUES (v_px, 'D-Point', 'Probe city', 'on_sale', 'https://example.com/gx');
    GET DIAGNOSTICS v_ins = ROW_COUNT;
    UPDATE public.dovec_projects SET city = 'Probe city 2' WHERE id = v_px;
    GET DIAGNOSTICS v_upd = ROW_COUNT;
    v_j := public.dovec_sync_coords();
    v_sync1 := CASE WHEN jsonb_typeof(v_j -> 'unmatched') = 'array' THEN 'ok' ELSE 'badshape' END;
    PERFORM set_config('request.jwt.claims', '', true);
    v_j := public.dovec_sync_coords();
    v_sync2 := CASE WHEN jsonb_typeof(v_j -> 'unmatched') = 'array' THEN 'ok' ELSE 'badshape' END;
    RESET ROLE;
    SELECT count(*) INTO v_att FROM public.dovec_project_coords WHERE seed_name = 'D-Point' AND project_id = v_px AND last_status = 'matched';
    SELECT latitude INTO v_lat FROM public.dovec_projects WHERE id = v_px;

    -- Calls in the role loops use EXECUTE: a plpgsql expression's EXECUTE-privilege check is cached per transaction, so a call
    -- compiled while one role ran can be reused for the next role without a fresh check.
    -- f. The private report and the sync are closed to app roles; the report is closed to the service role too.
    FOREACH v_role IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
      EXECUTE format('SET LOCAL ROLE %I', v_role);
      BEGIN EXECUTE 'SELECT public.dovec_sync_coords()'; v_den := v_den || jsonb_build_object('sync_' || v_role, 'ALLOWED');
      EXCEPTION WHEN insufficient_privilege THEN v_den := v_den || jsonb_build_object('sync_' || v_role, 'denied'); END;
      BEGIN EXECUTE 'SELECT public.dovec_coord_report()'; v_den := v_den || jsonb_build_object('report_' || v_role, 'ALLOWED');
      EXCEPTION WHEN insufficient_privilege THEN v_den := v_den || jsonb_build_object('report_' || v_role, 'denied'); END;
      RESET ROLE;
    END LOOP;
    BEGIN v_j := public.dovec_coord_report(); v_owner := CASE WHEN jsonb_typeof(v_j -> 'unmatched') = 'array' THEN 'ok' ELSE 'badshape' END;
    EXCEPTION WHEN insufficient_privilege THEN v_owner := 'denied'; END;

    RAISE EXCEPTION 'probe_rollback';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM IS DISTINCT FROM 'probe_rollback' THEN RAISE; END IF;
  END;

  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);

  RAISE NOTICE 'gate probe, per case and identity (listed/unlisted probe rows seen / coord_status): %', v_res;
  RAISE NOTICE 'sync path with the gate closed: insert rows=%, update rows=%, sync with claims=%, sync without claims=%, D-Point pinned=% (exact-name positive control: %)',
    v_ins, v_upd, v_sync1, v_sync2, v_att, CASE WHEN v_pre = 0 THEN 'ran' ELSE 'skipped' END;
  RAISE NOTICE 'denials: %, report as owner=%', v_den, v_owner;

  v_want := jsonb_build_object(
    'ctx_admin', 'admin=true,anonymous=false', 'ctx_customer', 'admin=false,anonymous=false', 'ctx_guest', 'admin=false,anonymous=true',
    'a_admin', '1/0/ok', 'a_anon', '0/0/privdenied', 'a_customer', '0/0/gate', 'a_guest', '0/0/gate', 'a_service', '1/1/ok',
    'b_admin', '1/0/ok', 'b_anon', '1/0/privdenied', 'b_customer', '1/0/gate', 'b_guest', '1/0/gate', 'b_service', '1/1/ok',
    'c_admin', '1/0/ok', 'c_anon', '0/0/privdenied', 'c_customer', '0/0/gate', 'c_guest', '0/0/gate', 'c_service', '1/1/ok',
    'd_admin', '1/0/ok', 'd_anon', '0/0/privdenied', 'd_customer', '0/0/gate', 'd_guest', '0/0/gate', 'd_service', '1/1/ok');
  IF v_res IS DISTINCT FROM v_want THEN
    RAISE EXCEPTION 'read gate behaviour is not what was intended. got % want %', v_res, v_want;
  END IF;
  IF v_ins IS DISTINCT FROM 1 OR v_upd IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'service_role could not insert / update a project with the gate closed (ins=%, upd=%)', v_ins, v_upd; END IF;
  IF v_sync1 IS DISTINCT FROM 'ok' OR v_sync2 IS DISTINCT FROM 'ok' THEN RAISE EXCEPTION 'dovec_sync_coords() failed as service_role (claims=%, no claims=%)', v_sync1, v_sync2; END IF;
  IF v_pre = 0 AND (v_att IS DISTINCT FROM 1 OR v_lat IS DISTINCT FROM 35.2695453) THEN
    RAISE EXCEPTION 'positive control failed: an exact-name project was not pinned by the sync (att=%, lat=%)', v_att, v_lat;
  END IF;
  IF v_den IS DISTINCT FROM jsonb_build_object('sync_anon', 'denied', 'report_anon', 'denied', 'sync_authenticated', 'denied', 'report_authenticated', 'denied',
                                               'sync_service_role', 'ALLOWED', 'report_service_role', 'denied') THEN
    RAISE EXCEPTION 'sync / report execute rights are not as intended: %', v_den;
  END IF;
  IF v_owner IS DISTINCT FROM 'ok' THEN RAISE EXCEPTION 'positive control failed: the report did not run for its owner (%)', v_owner; END IF;
  IF (SELECT count(*) FROM public.dovec_projects WHERE id LIKE 'zz-gate-%') IS DISTINCT FROM 0
     OR (SELECT to_jsonb(s) FROM public.dovec_settings s WHERE s.id = 1) IS DISTINCT FROM v_set0
     OR (SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY c.seed_name), '[]'::jsonb) FROM public.dovec_project_coords c) IS DISTINCT FROM v_coords0 THEN
    RAISE EXCEPTION 'the probe left rows, a pin or a settings change behind';
  END IF;
  RAISE NOTICE 'dovec read gate: admins only while unpublished, public once published and fresh, sync unaffected, report private, probe rolled back';
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
VALUES ('20261231_dovec_read_gate.sql', '1e6ecdd3dc61ec793a23026e560fa43ab70a373c06695770b2dabbbfa91a937b')
ON CONFLICT (filename) DO UPDATE
  SET checksum = excluded.checksum, applied_at = now(), applied_by = current_user;
-- ─── ledger:stamp:end ────────────────────────────────────────────────
COMMIT;

RESET ROLE;

NOTIFY pgrst, 'reload schema';
