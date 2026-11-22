-- ═══════════════════════════════════════════════════════════════════════════
-- ad_house_daily — anonymous DAILY counters for the app's own ("house") banners.
--
-- ▶ ONE BLOCK: BEGIN … COMMIT with every assertion inside. A failing assertion applies
--   nothing, and the file is re-runnable.
--
-- ─── WHAT IT DOES, IN PLAIN ENGLISH ─────────────────────────────────────────
--   • One new table, ad_house_daily: one row per (calendar day in Asia/Famagusta,
--     position, module) holding two whole numbers, view_count and tap_count.
--   • No user, device, session or IP column of any kind, and no way to tell two
--     increments apart. Same anonymity contract as ad_banners (20261008) and
--     contact_events: the counters are attached to nobody.
--   • One function, bump_house_ad_counter(p_position, p_module, p_kind), which anyone
--     (signed out, guest, customer) may call. It adds 1 to today's row, and ONLY for the
--     two house placements the app has: ('list_bottom','home') and ('list_top','events').
--     Anything else (NULLs, an unknown kind, any other pair) does nothing and raises nothing.
--   • Nobody but an admin can read the table, and nobody at all can write it directly.
--
-- ─── RLS IN PLAIN ENGLISH ───────────────────────────────────────────────────
--   READ   Admins only (public.is_admin()). Exactly ONE policy: SELECT, TO authenticated,
--          USING is_admin(). `TO authenticated` includes guest sessions, but a guest is
--          never an admin, so a guest, a customer and a provider read ZERO rows. A signed-out
--          (anon) caller has no SELECT privilege at all.
--   WRITE  Nobody. INSERT / UPDATE / DELETE / TRUNCATE are not granted to anon or
--          authenticated, and no write policy exists. The only write path a client has is
--          bump_house_ad_counter(), a SECURITY DEFINER function that can add 1 to one of
--          two columns of one allow-listed row and cannot set a value, decrement, touch
--          another table or see who called it.
--   DATA   Nothing in this table belongs to a person, so no customer can read another
--          customer's data through it.
--
-- ─── WHY DAILY BUCKETS ──────────────────────────────────────────────────────
-- ad_banners keeps one running total per ad, so spam on it cannot be purged or even seen
-- (see its header). A row per day makes a burst visible as one odd day and fixable by an
-- UPDATE on that day. The anon key ships in the app bundle, so a public increment endpoint
-- stays spammable by construction; this makes that detectable, not impossible.
-- The day is the Asia/Famagusta calendar day, the same frame the admin screen reads in.
--
-- ─── THE PLACEMENT ALLOW-LIST ───────────────────────────────────────────────
-- Mirrors AD_HOUSE_PLACEMENTS in the app. Adding a house placement is a new migration
-- (CREATE OR REPLACE of the function) on purpose: the function is callable by anyone, so
-- its reach is kept to exactly what ships.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

SET ROLE postgres;

CREATE TABLE IF NOT EXISTS public.ad_house_daily (
  day        date   NOT NULL,
  position   text   NOT NULL,
  module     text   NOT NULL,
  view_count bigint NOT NULL DEFAULT 0,
  tap_count  bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (day, position, module),
  CONSTRAINT ad_house_daily_position_check
    CHECK (position IN ('list_top','list_inline','list_bottom','detail_bottom')),
  CONSTRAINT ad_house_daily_module_fkey
    FOREIGN KEY (module) REFERENCES public.ad_modules(module),
  CONSTRAINT ad_house_daily_counts_check
    CHECK (view_count >= 0 AND tap_count >= 0)
);

COMMENT ON TABLE public.ad_house_daily IS
  'Anonymous daily counters for the app''s own house banners: one row per Asia/Famagusta '
  'calendar day x position x module. NO user, device, session or IP column and no dedup key. '
  'Written only by bump_house_ad_counter(); read only by admins. Counts are served-impression '
  'floors, not people. See 20261227_ad_house_daily.sql.';

ALTER TABLE public.ad_house_daily ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ad_house_daily_select_admin" ON public.ad_house_daily;
CREATE POLICY "ad_house_daily_select_admin" ON public.ad_house_daily
  FOR SELECT TO authenticated
  USING ((select public.is_admin()));

-- Supabase default privileges hand ALL on a new table to anon and authenticated by name,
-- so REVOKE FROM PUBLIC alone would change nothing for them.
REVOKE ALL ON public.ad_house_daily FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.ad_house_daily TO authenticated;

-- SECURITY DEFINER: callers have no write privilege on the table and must not get one.
-- search_path is pinned (a DEFINER function without it can be shadowed by an earlier
-- schema). auth.uid() is deliberately never called: nothing here may attach to a person.
-- Every unknown input is a silent no-op: the caller is fire-and-forget and would swallow
-- an error anyway; the verification block below asserts the no-op instead of trusting it.
CREATE OR REPLACE FUNCTION public.bump_house_ad_counter(p_position text, p_module text, p_kind text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_day date := (now() AT TIME ZONE 'Asia/Famagusta')::date;
BEGIN
  IF p_position IS NULL OR p_module IS NULL OR p_kind IS NULL THEN
    RETURN;
  END IF;
  IF NOT ((p_position = 'list_bottom' AND p_module = 'home')
       OR (p_position = 'list_top' AND p_module = 'events')) THEN
    RETURN;
  END IF;

  IF p_kind = 'view' THEN
    INSERT INTO public.ad_house_daily (day, position, module, view_count, tap_count)
    VALUES (v_day, p_position, p_module, 1, 0)
    ON CONFLICT (day, position, module)
    DO UPDATE SET view_count = public.ad_house_daily.view_count + 1;
  ELSIF p_kind = 'tap' THEN
    INSERT INTO public.ad_house_daily (day, position, module, view_count, tap_count)
    VALUES (v_day, p_position, p_module, 0, 1)
    ON CONFLICT (day, position, module)
    DO UPDATE SET tap_count = public.ad_house_daily.tap_count + 1;
  END IF;
END;
$fn$;

COMMENT ON FUNCTION public.bump_house_ad_counter(text, text, text) IS
  'Adds 1 to today''s (Asia/Famagusta) view_count or tap_count of ad_house_daily for the two '
  'house placements only. Records no user, device or session. Unknown input is a no-op. '
  'See 20261227_ad_house_daily.sql.';

REVOKE ALL ON FUNCTION public.bump_house_ad_counter(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bump_house_ad_counter(text, text, text) TO anon, authenticated;

-- ═══ VERIFICATION — inside the transaction ══════════════════════════════════
-- Nothing printed here is a user total or id. Every write the checks make happens in a
-- subtransaction that is rolled back by a sentinel error (SQLSTATE AD001); a fingerprint
-- of the whole table taken before and after proves nothing survived.
DO $$
DECLARE
  v_rls       boolean;
  v_pol       int;
  v_pol_names text;
  v_cols      text;
  v_cfg       text[];
  v_def       text;
  v_admin     uuid;
  v_fp0       text;
  v_fp1       text;
  v_fp        text;
  v_fp_other  text;
  v_day       date;
  v_v0 bigint; v_t0 bigint; v_v1 bigint; v_t1 bigint;
  v_n0 bigint; v_n1 bigint;
  v_cases     jsonb;
  v_case      jsonb;
  v_i         int := 0;
  v_denied    boolean;
  v_priv      text;
  v_rolled    boolean := false;
  v_guest     constant text :=
    '{"sub":"00000000-0000-4000-8000-0000000000e1","role":"authenticated","is_anonymous":true}';
BEGIN
  -- ── RLS and the FULL policy set ──────────────────────────────────────────
  SELECT c.relrowsecurity INTO v_rls
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relname = 'ad_house_daily';
  IF v_rls IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'RLS is not enabled on ad_house_daily (relrowsecurity = %)', v_rls;
  END IF;

  SELECT count(*), string_agg(policyname || '(' || cmd || ',' || permissive || ',' || roles::text || ')', ', ' ORDER BY policyname)
    INTO v_pol, v_pol_names
    FROM pg_policies WHERE schemaname = 'public' AND tablename = 'ad_house_daily';
  RAISE NOTICE 'ad_house_daily policies (%): %', v_pol, coalesce(v_pol_names, '<none>');
  IF v_pol IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'expected exactly 1 policy on ad_house_daily, found %: %', v_pol, coalesce(v_pol_names, '<none>');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'ad_house_daily'
       AND policyname = 'ad_house_daily_select_admin'
       AND cmd = 'SELECT' AND permissive = 'PERMISSIVE'
       AND roles = ARRAY['authenticated']::name[]
       AND position('is_admin' IN qual) > 0
       AND with_check IS NULL
  ) THEN
    RAISE EXCEPTION 'the one policy on ad_house_daily is not SELECT / authenticated / is_admin(): %', v_pol_names;
  END IF;

  -- ── Columns: the set IS the fact (no user / device / session / IP column) ─
  SELECT string_agg(column_name || ':' || data_type, ', ' ORDER BY column_name) INTO v_cols
    FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ad_house_daily';
  RAISE NOTICE 'ad_house_daily columns: %', v_cols;
  IF v_cols IS DISTINCT FROM 'day:date, module:text, position:text, tap_count:bigint, view_count:bigint' THEN
    RAISE EXCEPTION 'ad_house_daily columns are not exactly the five anonymous ones: %', v_cols;
  END IF;

  -- ── Constraints, read from the catalog; position vocabulary has a control ─
  SELECT pg_get_constraintdef(oid) INTO v_def FROM pg_constraint
   WHERE conrelid = 'public.ad_house_daily'::regclass AND conname = 'ad_house_daily_position_check';
  IF v_def IS NULL OR position('''list_top''' IN v_def) = 0 OR position('''list_inline''' IN v_def) = 0
     OR position('''list_bottom''' IN v_def) = 0 OR position('''detail_bottom''' IN v_def) = 0 THEN
    RAISE EXCEPTION 'ad_house_daily_position_check missing or not the four positions: %', coalesce(v_def, '<absent>');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.ad_house_daily'::regclass
                  AND conname = 'ad_house_daily_module_fkey' AND contype = 'f'
                  AND confrelid = 'public.ad_modules'::regclass)
     OR NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.ad_house_daily'::regclass
                  AND conname = 'ad_house_daily_counts_check' AND contype = 'c')
     OR NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.ad_house_daily'::regclass
                  AND contype = 'p') THEN
    RAISE EXCEPTION 'ad_house_daily is missing its primary key, module FK or counts check';
  END IF;
  IF (SELECT count(*) FROM public.ad_modules WHERE module IN ('home', 'events')) IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION 'ad_modules lacks home and/or events, the two house modules';
  END IF;

  -- ── Table grants, asked of the catalog per role (not trusted from the file) ─
  FOREACH v_priv IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] LOOP
    IF has_table_privilege('anon', 'public.ad_house_daily', v_priv) THEN
      RAISE EXCEPTION 'anon holds % on ad_house_daily', v_priv;
    END IF;
    IF has_table_privilege('authenticated', 'public.ad_house_daily', v_priv) IS DISTINCT FROM (v_priv = 'SELECT') THEN
      RAISE EXCEPTION 'authenticated privilege % on ad_house_daily is not as designed (SELECT only)', v_priv;
    END IF;
  END LOOP;
  IF has_any_column_privilege('anon', 'public.ad_house_daily', 'SELECT,INSERT,UPDATE,REFERENCES')
     OR has_any_column_privilege('authenticated', 'public.ad_house_daily', 'INSERT,UPDATE,REFERENCES') THEN
    RAISE EXCEPTION 'a column-level grant on ad_house_daily reaches anon or authenticated';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_class c, aclexplode(c.relacl) a
              WHERE c.oid = 'public.ad_house_daily'::regclass AND a.grantee = 0) THEN
    RAISE EXCEPTION 'PUBLIC holds a privilege on ad_house_daily';
  END IF;
  -- positive control for the denial loop: the SELECT it allowed is the one that exists
  IF NOT has_table_privilege('authenticated', 'public.ad_house_daily', 'SELECT') THEN
    RAISE EXCEPTION 'CONTROL FAILED: authenticated cannot SELECT, so the admin read path is dead';
  END IF;

  -- ── The function: one overload, DEFINER, pinned path, EXECUTE as designed ─
  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname = 'bump_house_ad_counter') IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'bump_house_ad_counter must exist exactly once (no overloads)';
  END IF;
  SELECT p.proconfig INTO v_cfg FROM pg_proc p
   WHERE p.oid = 'public.bump_house_ad_counter(text, text, text)'::regprocedure AND p.prosecdef;
  IF v_cfg IS NULL OR NOT EXISTS (SELECT 1 FROM unnest(v_cfg) x WHERE x LIKE 'search_path=%') THEN
    RAISE EXCEPTION 'bump_house_ad_counter is not SECURITY DEFINER with a pinned search_path (proconfig = %)',
      coalesce(array_to_string(v_cfg, ', '), '<null / not definer>');
  END IF;
  IF NOT has_function_privilege('anon', 'public.bump_house_ad_counter(text, text, text)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.bump_house_ad_counter(text, text, text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'bump_house_ad_counter EXECUTE does not reach both anon and authenticated';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) a
              WHERE p.oid = 'public.bump_house_ad_counter(text, text, text)'::regprocedure AND a.grantee = 0)
     OR (SELECT proacl IS NULL FROM pg_proc WHERE oid = 'public.bump_house_ad_counter(text, text, text)'::regprocedure) THEN
    RAISE EXCEPTION 'PUBLIC still holds EXECUTE on bump_house_ad_counter (or the ACL is the default)';
  END IF;

  -- ── Behaviour, in a subtransaction that is always rolled back ────────────
  SELECT id INTO v_admin FROM public.profiles WHERE role = 'admin' ORDER BY id LIMIT 1;
  IF v_admin IS NULL THEN
    RAISE EXCEPTION 'no admin profile to run the positive control with';
  END IF;

  SELECT md5(coalesce(string_agg(t::text, '|' ORDER BY t.day, t.position, t.module), '')) INTO v_fp0
    FROM public.ad_house_daily t;

  v_cases := jsonb_build_array(
    jsonb_build_array('list_bottom','home','view',1,0),
    jsonb_build_array('list_bottom','home','tap',0,1),
    jsonb_build_array('list_top','events','view',1,0),
    jsonb_build_array('list_top','events','tap',0,1),
    jsonb_build_array('list_inline','events','view',0,0),
    jsonb_build_array('list_bottom','events','view',0,0),
    jsonb_build_array('list_top','home','tap',0,0),
    jsonb_build_array('detail_bottom','home','view',0,0),
    jsonb_build_array('list_bottom','accommodation','view',0,0),
    jsonb_build_array('list_bottom','home','sideways',0,0),
    jsonb_build_array('list_bottom','home','VIEW',0,0),
    jsonb_build_array(NULL,'home','view',0,0),
    jsonb_build_array('list_bottom',NULL,'view',0,0),
    jsonb_build_array('list_bottom','home',NULL,0,0),
    jsonb_build_array(NULL,NULL,NULL,0,0)
  );
  -- every other (position, module, kind) the vocabulary allows must be a no-op too
  v_cases := v_cases || coalesce((
    SELECT jsonb_agg(jsonb_build_array(p.pos, m.module, k.kind, 0, 0))
      FROM (VALUES ('list_top'),('list_inline'),('list_bottom'),('detail_bottom')) p(pos)
      CROSS JOIN public.ad_modules m
      CROSS JOIN (VALUES ('view'),('tap')) k(kind)
     WHERE (p.pos, m.module) NOT IN (('list_bottom','home'), ('list_top','events'))
  ), '[]'::jsonb);

  BEGIN
    v_day := (now() AT TIME ZONE 'Asia/Famagusta')::date;

    FOR v_case IN SELECT value FROM jsonb_array_elements(v_cases) LOOP
      v_i := v_i + 1;
      SELECT coalesce(max(view_count), 0), coalesce(max(tap_count), 0) INTO v_v0, v_t0
        FROM public.ad_house_daily
       WHERE day = v_day AND position = v_case->>0 AND module = v_case->>1;
      SELECT count(*), md5(coalesce(string_agg(t::text, '|' ORDER BY t.day, t.position, t.module), ''))
        INTO v_n0, v_fp
        FROM public.ad_house_daily t;
      SELECT md5(coalesce(string_agg(t::text, '|' ORDER BY t.day, t.position, t.module), ''))
        INTO v_fp_other
        FROM public.ad_house_daily t
       WHERE NOT (t.day = v_day AND t.position IS NOT DISTINCT FROM (v_case->>0) AND t.module IS NOT DISTINCT FROM (v_case->>1));

      PERFORM public.bump_house_ad_counter(v_case->>0, v_case->>1, v_case->>2);

      SELECT coalesce(max(view_count), 0), coalesce(max(tap_count), 0) INTO v_v1, v_t1
        FROM public.ad_house_daily
       WHERE day = v_day AND position = v_case->>0 AND module = v_case->>1;
      SELECT count(*) INTO v_n1 FROM public.ad_house_daily;
      IF (now() AT TIME ZONE 'Asia/Famagusta')::date IS DISTINCT FROM v_day THEN
        RAISE EXCEPTION 'the Famagusta day rolled over during the checks; re-run the file';
      END IF;

      IF (v_v1 - v_v0) IS DISTINCT FROM (v_case->>3)::bigint OR (v_t1 - v_t0) IS DISTINCT FROM (v_case->>4)::bigint THEN
        RAISE EXCEPTION 'bump case % moved the counters by view % / tap % (expected % / %)',
          v_i, v_v1 - v_v0, v_t1 - v_t0, v_case->>3, v_case->>4;
      END IF;
      IF (v_case->>3)::int + (v_case->>4)::int = 0 THEN
        IF v_n1 IS DISTINCT FROM v_n0 OR (SELECT md5(coalesce(string_agg(t::text, '|' ORDER BY t.day, t.position, t.module), ''))
                                            FROM public.ad_house_daily t) IS DISTINCT FROM v_fp THEN
          RAISE EXCEPTION 'bump case % was meant to be a no-op but changed the table', v_i;
        END IF;
      ELSE
        IF v_n1 - v_n0 NOT IN (0, 1)
           OR (SELECT md5(coalesce(string_agg(t::text, '|' ORDER BY t.day, t.position, t.module), ''))
                 FROM public.ad_house_daily t
                WHERE NOT (t.day = v_day AND t.position IS NOT DISTINCT FROM (v_case->>0) AND t.module IS NOT DISTINCT FROM (v_case->>1)))
              IS DISTINCT FROM v_fp_other THEN
          RAISE EXCEPTION 'bump case % moved a row other than its own', v_i;
        END IF;
      END IF;
    END LOOP;

    -- The legitimate path works for the real callers: signed-out anon, and a guest.
    SELECT view_count INTO v_v0 FROM public.ad_house_daily
     WHERE day = v_day AND position = 'list_bottom' AND module = 'home';
    SET LOCAL ROLE anon;
    PERFORM set_config('request.jwt.claims', '', true);
    PERFORM public.bump_house_ad_counter('list_bottom', 'home', 'view');
    RESET ROLE;
    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claims', v_guest, true);
    PERFORM public.bump_house_ad_counter('list_bottom', 'home', 'view');
    RESET ROLE;
    SELECT view_count INTO v_v1 FROM public.ad_house_daily
     WHERE day = v_day AND position = 'list_bottom' AND module = 'home';
    IF v_v1 - v_v0 IS DISTINCT FROM 2 THEN
      RAISE EXCEPTION 'anon + guest bump did not add 2 (added %)', v_v1 - v_v0;
    END IF;

    -- Direct writes are refused to a guest and to anon (the bump above is the control).
    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claims', v_guest, true);
    FOREACH v_priv IN ARRAY ARRAY['INSERT','UPDATE','DELETE'] LOOP
      v_denied := false;
      BEGIN
        IF v_priv = 'INSERT' THEN
          INSERT INTO public.ad_house_daily (day, position, module, view_count)
          VALUES (v_day - 1, 'list_top', 'home', 5);
        ELSIF v_priv = 'UPDATE' THEN
          UPDATE public.ad_house_daily SET view_count = 999999;
        ELSE
          DELETE FROM public.ad_house_daily;
        END IF;
      EXCEPTION WHEN insufficient_privilege THEN v_denied := true;
      END;
      IF NOT v_denied THEN
        RAISE EXCEPTION 'a guest session could % ad_house_daily directly', v_priv;
      END IF;
    END LOOP;
    RESET ROLE;
    SET LOCAL ROLE anon;
    PERFORM set_config('request.jwt.claims', '', true);
    v_denied := false;
    BEGIN
      PERFORM 1 FROM public.ad_house_daily LIMIT 1;
    EXCEPTION WHEN insufficient_privilege THEN v_denied := true;
    END;
    RESET ROLE;
    IF NOT v_denied THEN
      RAISE EXCEPTION 'signed-out anon could read ad_house_daily';
    END IF;

    -- Guest denial with a positive admin control, while a row demonstrably exists.
    SELECT count(*) INTO v_n0 FROM public.ad_house_daily;
    IF v_n0 < 1 THEN
      RAISE EXCEPTION 'CONTROL FAILED: no row exists for the read checks';
    END IF;
    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claims', v_guest, true);
    SELECT count(*) INTO v_n1 FROM public.ad_house_daily;
    IF v_n1 IS DISTINCT FROM 0 THEN
      RAISE EXCEPTION 'a guest session can read ad_house_daily rows';
    END IF;
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', v_admin, 'role', 'authenticated', 'is_anonymous', false)::text, true);
    SELECT count(*) INTO v_n1 FROM public.ad_house_daily;
    RESET ROLE;
    IF v_n1 IS DISTINCT FROM v_n0 THEN
      RAISE EXCEPTION 'CONTROL FAILED: an admin does not see every row (saw %, table has %)', v_n1, v_n0;
    END IF;

    RAISE EXCEPTION 'rollback checks' USING ERRCODE = 'AD001';
  EXCEPTION WHEN SQLSTATE 'AD001' THEN
    v_rolled := true;
  END;

  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);
  IF NOT v_rolled THEN
    RAISE EXCEPTION 'the verification subtransaction did not end in its rollback';
  END IF;
  SELECT md5(coalesce(string_agg(t::text, '|' ORDER BY t.day, t.position, t.module), '')) INTO v_fp1
    FROM public.ad_house_daily t;
  IF v_fp1 IS DISTINCT FROM v_fp0 THEN
    RAISE EXCEPTION 'the verification writes survived their rollback';
  END IF;

  RAISE NOTICE 'ad_house_daily verified: RLS on, 1 admin-read policy, no write grants, % bump cases ok, guest read denied, admin read ok, test writes rolled back (table fingerprint unchanged)', v_i;
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
VALUES ('20261227_ad_house_daily.sql', '0b6d763ccf4e782cf4c9bfeec6da00583eb0f2c982d61bc6c9ad1288d3d8610e')
ON CONFLICT (filename) DO UPDATE
  SET checksum = excluded.checksum, applied_at = now(), applied_by = current_user;
-- ─── ledger:stamp:end ────────────────────────────────────────────────
COMMIT;
RESET ROLE;

NOTIFY pgrst, 'reload schema';

-- ─── REVERT ────────────────────────────────────────────────────────────────
--   BEGIN;
--     SET ROLE postgres;
--     DROP FUNCTION IF EXISTS public.bump_house_ad_counter(text, text, text);
--     DROP TABLE IF EXISTS public.ad_house_daily;   -- policy goes with it
--   COMMIT;
--   RESET ROLE;
--   NOTIFY pgrst, 'reload schema';
