-- ═══════════════════════════════════════════════════════════════════════════
-- 20261120 — is_previewer() = the ADA Preview app's key header (replaces the hard-coded account)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Berke (2026-10-20): ANY session in the ADA Preview app (logged out, guest or signed in) sees
-- unpublished eatery partners; the production app never does. Google sign-in on the Preview APK has no
-- Android OAuth client, and Berke is the only Preview user, so the account no longer matters.
--
-- ─── HOW ────────────────────────────────────────────────────────────────────
-- The Preview build sends a random 256-bit key as the request header `x-ada-preview-key` (lib/supabase.js,
-- only when extra.appVariant === 'preview' AND EXPO_PUBLIC_ADA_PREVIEW_KEY is set; that variable exists only
-- in the EAS `preview` environment). PostgREST exposes request headers as the GUC request.headers (names
-- lowercased). public.is_previewer() hashes that header (built-in sha256) and looks it up in
-- private.preview_key_hashes. Only the SHA-256 is stored, here and in git: a hash of a 256-bit random key
-- cannot be turned back into the key. The 412cad91… account check is gone.
--   is_previewer(): SQL, STABLE, SECURITY DEFINER (it must read the private table), search_path '', owner
--   postgres, EXECUTE anon + authenticated + service_role. Missing / empty / wrong header ⇒ false.
--   private.preview_key_hashes: no privilege for anon / authenticated (revoked BY NAME; Supabase's default
--   privileges grant them by name and 20261068 granted USAGE on schema private). Not reachable through the
--   API (schema private is not exposed) and not readable even if it were.
--
-- ─── WHO CAN READ / WRITE AFTER THIS FILE ───────────────────────────────────
--   • Every request WITHOUT the right key (anon, guests, every signed-in user, the production app): exactly as
--     before 20261119 — active partners and their items / photos; 0 inactive rows.
--   • Any request WITH the key (the ADA Preview app, whoever is signed in or not): also inactive partners and
--     their items and photos. Read only.
--   • WRITE: unchanged, service_role only.
--   • The three *_select_preview policies keep their expressions (NOT is_active / parent NOT is_active, AND
--     (SELECT is_previewer())) and now apply TO anon, authenticated.
--   • search_content still has no eatery arm (asserted).
--
-- ─── HOW SAFE THE KEY IS (honest) ───────────────────────────────────────────
-- It is compiled into the Preview JS bundle. Anyone holding the Preview APK, or who fetches the Preview
-- channel's update (the EAS project id is in the production APK), can pull it out with `strings`. Treat it
-- as a speed bump, not a secret. What it opens: read-only access to rows behind is_previewer() policies —
-- today Crunchy Express's inactive row (address, hours, pin, maps_url), its 41 menu items and the paths of
-- 16 dish photos (the bucket is public anyway). Nothing personal, no writes, no other table. The reuse
-- contract stays: is_previewer() only in SELECT policies, always paired with an unpublished restriction.
-- Rotation: new key in EAS preview env → new hash via a migration (delete the old row) → republish Preview.
--
-- ─── PROOF (inside, rolled back by a sentinel) ──────────────────────────────
-- A probe hash for a literal test key is inserted inside the sentinel block. For anon, guest and a normal
-- user: no header → 0 inactive rows; wrong header → 0; test-key header → Crunchy 1 partner / all items /
-- all photo items + the inactive probe's photo; active probe always 1/1/1; writes with the header denied.
-- After the rollback exactly one hash row (the real key's) remains.
-- RE-RUNNABLE: the hash row is inserted ON CONFLICT DO NOTHING; the policy set must be the 1119 one.
--
-- Apply: gh workflow run supabase-migrate -f file=20261120_eatery_preview_key.sql (dry), then -f apply=true.
-- ═══════════════════════════════════════════════════════════════════════════

SET ROLE postgres;

BEGIN;

SET LOCAL lock_timeout = '5s';

DO $$
DECLARE t text; v_names text[];
BEGIN
  IF to_regprocedure('public.is_previewer()') IS NULL OR to_regnamespace('private') IS NULL THEN
    RAISE EXCEPTION 'pre-state: is_previewer() (20261119) or schema private (20261068) missing. Nothing applied.';
  END IF;
  FOREACH t IN ARRAY ARRAY['eatery_partners','eatery_menu_items','eatery_photos'] LOOP
    SELECT array_agg(policyname::text ORDER BY policyname) INTO v_names FROM pg_policies WHERE schemaname = 'public' AND tablename = t;
    IF v_names IS DISTINCT FROM ARRAY[t || '_select_active', t || '_select_preview'] THEN
      RAISE EXCEPTION 'pre-state: % has policies % — expected the 1119 pair. Nothing applied.', t, v_names;
    END IF;
  END LOOP;
END $$;

-- ─── Key hash store ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS private.preview_key_hashes (
  hash       text        NOT NULL,
  label      text        NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT preview_key_hashes_pkey PRIMARY KEY (hash),
  CONSTRAINT preview_key_hashes_hash_check CHECK (hash ~ '^[0-9a-f]{64}$')
);
REVOKE ALL ON TABLE private.preview_key_hashes FROM PUBLIC, anon, authenticated;
COMMENT ON TABLE private.preview_key_hashes IS
  'SHA-256 (hex) of the ADA Preview app key sent as x-ada-preview-key. Hashes only; the key lives in the EAS preview environment. 20261120.';
INSERT INTO private.preview_key_hashes (hash, label)
VALUES ('ea265c840064eb2eafbe881d0a009746c94f0c8f0414e55f486c972e949cf698', 'ADA Preview app, 2026-10-20')
ON CONFLICT (hash) DO NOTHING;

-- ─── Function ───────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.is_previewer()
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = ''
AS $fn$
  SELECT COALESCE((
    SELECT EXISTS (
      SELECT 1 FROM private.preview_key_hashes h
      WHERE h.hash = encode(pg_catalog.sha256(pg_catalog.convert_to(k.key, 'UTF8')), 'hex'))
    FROM (SELECT NULLIF(COALESCE(NULLIF(pg_catalog.current_setting('request.headers', true), ''), '{}')::json ->> 'x-ada-preview-key', '') AS key) k
    WHERE k.key IS NOT NULL
  ), false)
$fn$;
ALTER FUNCTION public.is_previewer() OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION public.is_previewer() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_previewer() TO anon, authenticated, service_role;
COMMENT ON FUNCTION public.is_previewer() IS
  'true when the request carries the ADA Preview app key (x-ada-preview-key, SHA-256 in private.preview_key_hashes). Use ONLY in SELECT policies, ALWAYS paired with an unpublished restriction (NOT is_active); never in a write policy, never alone. 20261120.';

-- ─── Policies: same expressions, now anon too ───────────────────────────────
DROP POLICY IF EXISTS eatery_partners_select_preview ON public.eatery_partners;
CREATE POLICY eatery_partners_select_preview ON public.eatery_partners
  FOR SELECT TO anon, authenticated
  USING (NOT is_active AND (SELECT public.is_previewer()));

DROP POLICY IF EXISTS eatery_menu_items_select_preview ON public.eatery_menu_items;
CREATE POLICY eatery_menu_items_select_preview ON public.eatery_menu_items
  FOR SELECT TO anon, authenticated
  USING ((SELECT public.is_previewer())
         AND EXISTS (SELECT 1 FROM public.eatery_partners p WHERE p.id = eatery_menu_items.partner_id AND NOT p.is_active));

DROP POLICY IF EXISTS eatery_photos_select_preview ON public.eatery_photos;
CREATE POLICY eatery_photos_select_preview ON public.eatery_photos
  FOR SELECT TO anon, authenticated
  USING ((SELECT public.is_previewer())
         AND EXISTS (SELECT 1 FROM public.eatery_partners p WHERE p.id = eatery_photos.partner_id AND NOT p.is_active));

-- ─── Post-state + proof ─────────────────────────────────────────────────────
DO $$
DECLARE
  c_crunch  constant uuid := 'bb9dad05-6bb0-4c1c-90fb-cb0a4ad68434';
  c_testkey constant text := 'zz-20261120-probe-key-not-a-secret';
  c_real    constant text := 'ea265c840064eb2eafbe881d0a009746c94f0c8f0414e55f486c972e949cf698';
  t text; v_n int; v_fn record; v_sc_def text; v_report text := '';
  v_on uuid; v_off uuid; r record; h record;
  v_p int; v_i int; v_ph int; v_off_f int; v_on_p int; v_on_i int; v_on_ph int;
  v_owner_i int; v_owner_ph int; v_w text;
BEGIN
  -- Function, table, grants.
  SELECT p.provolatile, p.prosecdef, p.prosrc, pg_get_userbyid(p.proowner) AS owner, p.proconfig INTO v_fn
    FROM pg_proc p WHERE p.oid = to_regprocedure('public.is_previewer()');
  IF v_fn.provolatile IS DISTINCT FROM 's' OR v_fn.prosecdef IS DISTINCT FROM true OR v_fn.owner IS DISTINCT FROM 'postgres'
     OR v_fn.prosrc NOT LIKE '%request.headers%' OR v_fn.prosrc NOT LIKE '%preview_key_hashes%' OR v_fn.prosrc LIKE '%412cad91%'
     OR NOT (v_fn.proconfig @> ARRAY['search_path=""']) THEN
    RAISE EXCEPTION 'is_previewer(): volatile=% definer=% owner=% config=% or body wrong', v_fn.provolatile, v_fn.prosecdef, v_fn.owner, v_fn.proconfig;
  END IF;
  IF NOT has_function_privilege('anon', 'public.is_previewer()', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.is_previewer()', 'EXECUTE') THEN
    RAISE EXCEPTION 'is_previewer() EXECUTE missing for anon or authenticated';
  END IF;
  IF has_table_privilege('anon', 'private.preview_key_hashes', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
     OR has_table_privilege('authenticated', 'private.preview_key_hashes', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') THEN
    RAISE EXCEPTION 'private.preview_key_hashes is reachable by anon or authenticated';
  END IF;
  SELECT count(*) INTO v_n FROM private.preview_key_hashes;
  IF v_n IS DISTINCT FROM 1 OR NOT EXISTS (SELECT 1 FROM private.preview_key_hashes WHERE hash = c_real) THEN
    RAISE EXCEPTION 'expected exactly the one real key hash, found % rows', v_n;
  END IF;

  -- Policy set: 2 per table, preview policy TO anon, authenticated.
  FOREACH t IN ARRAY ARRAY['eatery_partners','eatery_menu_items','eatery_photos'] LOOP
    SELECT count(*) INTO v_n FROM pg_policies WHERE schemaname = 'public' AND tablename = t;
    IF v_n IS DISTINCT FROM 2 THEN RAISE EXCEPTION '% has % policies, expected 2', t, v_n; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = t AND policyname = t || '_select_preview'
                   AND cmd = 'SELECT' AND permissive = 'PERMISSIVE' AND roles::text[] = ARRAY['anon','authenticated']::text[]
                   AND qual LIKE '%is_previewer()%' AND qual LIKE '%is_active%' AND with_check IS NULL) THEN
      RAISE EXCEPTION '%_select_preview missing or wrong shape', t;
    END IF;
  END LOOP;

  -- search_content: no eatery arm (positive control: places arm).
  v_sc_def := pg_get_functiondef(to_regprocedure('public.search_content(text,double precision,double precision)'));
  IF v_sc_def IS NULL OR v_sc_def NOT ILIKE '%FROM places p%' THEN RAISE EXCEPTION 'CONTROL FAILED: search_content not read'; END IF;
  IF v_sc_def ILIKE '%FROM eatery_partners%' OR v_sc_def ILIKE '%FROM public.eatery_partners%'
     OR v_sc_def ILIKE '%JOIN eatery_partners%' OR v_sc_def ILIKE '%JOIN public.eatery_partners%' THEN
    RAISE EXCEPTION 'search_content has an eatery arm';
  END IF;

  SELECT count(*), count(*) FILTER (WHERE photo_path IS NOT NULL) INTO v_owner_i, v_owner_ph FROM public.eatery_menu_items WHERE partner_id = c_crunch;
  IF v_owner_i < 1 OR NOT EXISTS (SELECT 1 FROM public.eatery_partners WHERE id = c_crunch AND NOT is_active) THEN
    RAISE EXCEPTION 'CONTROL FAILED: Crunchy missing, active, or without items (%)', v_owner_i;
  END IF;

  BEGIN
    INSERT INTO private.preview_key_hashes (hash, label) VALUES (encode(sha256(convert_to(c_testkey, 'UTF8')), 'hex'), 'zz probe');
    INSERT INTO public.eatery_partners (slug, name, category, lat, lng, geocode_source, logo_path, menu_verified_on, is_active)
      VALUES ('zz-on', 'zz on', 'cafe', 35.1, 33.3, 'partner', 'zz-on/logo.png', current_date, true) RETURNING id INTO v_on;
    INSERT INTO public.eatery_partners (slug, name, category, is_active) VALUES ('zz-off', 'zz off', 'cafe', false) RETURNING id INTO v_off;
    INSERT INTO public.eatery_menu_items (partner_id, section, name) VALUES (v_on, 'zz', 'zz on'), (v_off, 'zz', 'zz off');
    INSERT INTO public.eatery_photos (partner_id, kind, storage_path) VALUES (v_on, 'gallery', 'zz-on/zz-1.jpg'), (v_off, 'gallery', 'zz-off/zz-1.jpg');

    FOR r IN SELECT * FROM (VALUES
        ('anon', 'anon', ''),
        ('guest', 'authenticated', json_build_object('sub', gen_random_uuid(), 'role', 'authenticated', 'is_anonymous', true)::text),
        ('normal user', 'authenticated', json_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text)
      ) AS x(who, rl, claims) LOOP
      FOR h IN SELECT * FROM (VALUES
          ('no header', ''),
          ('empty header', json_build_object('x-ada-preview-key', '')::text),
          ('wrong header', json_build_object('x-ada-preview-key', 'zz-wrong-key')::text),
          ('real hash as header', json_build_object('x-ada-preview-key', c_real)::text),
          ('key header', json_build_object('x-ada-preview-key', c_testkey)::text)
        ) AS y(what, hdr) LOOP
        EXECUTE format('SET LOCAL ROLE %I', r.rl);
        PERFORM set_config('request.jwt.claims', r.claims, true);
        PERFORM set_config('request.headers', h.hdr, true);
        SELECT count(*) INTO v_p FROM public.eatery_partners WHERE id = c_crunch;
        SELECT count(*), count(*) FILTER (WHERE photo_path IS NOT NULL) INTO v_i, v_ph FROM public.eatery_menu_items WHERE partner_id = c_crunch;
        SELECT count(*) INTO v_off_f FROM public.eatery_photos WHERE partner_id = v_off;
        SELECT count(*) INTO v_on_p FROM public.eatery_partners WHERE id = v_on;
        SELECT count(*) INTO v_on_i FROM public.eatery_menu_items WHERE partner_id = v_on;
        SELECT count(*) INTO v_on_ph FROM public.eatery_photos WHERE partner_id = v_on;
        v_w := '';
        IF h.what = 'key header' THEN
          BEGIN INSERT INTO public.eatery_photos (partner_id, kind, storage_path) VALUES (v_off, 'gallery', 'zz-off/zz-2.jpg'); v_w := v_w || ' photos-INSERT';
          EXCEPTION WHEN insufficient_privilege THEN NULL; END;
          BEGIN UPDATE public.eatery_partners SET name = 'zz' WHERE id = c_crunch; v_w := v_w || ' partners-UPDATE';
          EXCEPTION WHEN insufficient_privilege THEN NULL; END;
          BEGIN DELETE FROM public.eatery_menu_items WHERE partner_id = c_crunch; v_w := v_w || ' items-DELETE';
          EXCEPTION WHEN insufficient_privilege THEN NULL; END;
        END IF;
        RESET ROLE;
        PERFORM set_config('request.jwt.claims', '', true);
        PERFORM set_config('request.headers', '', true);
        IF v_on_p <> 1 OR v_on_i <> 1 OR v_on_ph <> 1 THEN
          RAISE EXCEPTION 'CONTROL FAILED: % / % cannot see the ACTIVE probe (%/%/%)', r.who, h.what, v_on_p, v_on_i, v_on_ph;
        END IF;
        IF v_w <> '' THEN RAISE EXCEPTION '% / % could write:%', r.who, h.what, v_w; END IF;
        IF h.what = 'key header' THEN
          IF v_p <> 1 OR v_i IS DISTINCT FROM v_owner_i OR v_ph IS DISTINCT FROM v_owner_ph OR v_off_f <> 1 THEN
            RAISE EXCEPTION '% / key header sees Crunchy %/%/% (owner 1/%/%), inactive probe photo % — expected all', r.who, v_p, v_i, v_ph, v_owner_i, v_owner_ph, v_off_f;
          END IF;
        ELSIF v_p <> 0 OR v_i <> 0 OR v_ph <> 0 OR v_off_f <> 0 THEN
          RAISE EXCEPTION '% / % sees inactive rows: partner % items % photo-items % probe photo %', r.who, h.what, v_p, v_i, v_ph, v_off_f;
        END IF;
      END LOOP;
      v_report := v_report || format(E'\n  %s: no/empty/wrong/hash-as-key header 0 inactive; key header Crunchy 1/%s/%s + probe photo; active 1/1/1; writes denied', r.who, v_owner_i, v_owner_ph);
    END LOOP;

    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'zz-sentinel';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM IS DISTINCT FROM 'zz-sentinel' THEN RAISE; END IF;
  END;

  IF EXISTS (SELECT 1 FROM public.eatery_partners WHERE slug LIKE 'zz-%')
     OR (SELECT count(*) FROM private.preview_key_hashes) IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'probe rows survived the sentinel';
  END IF;
  RAISE NOTICE 'preview key proof:%', v_report;
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
VALUES ('20261120_eatery_preview_key.sql', 'ac0098999d5b0ddb96c5aea74745c70f4f9bd17babbd9fc2d37ce55e0c7d6f93')
ON CONFLICT (filename) DO UPDATE
  SET checksum = excluded.checksum, applied_at = now(), applied_by = current_user;
-- ─── ledger:stamp:end ────────────────────────────────────────────────
COMMIT;
RESET ROLE;

-- ─── Verification after applying (read-only, run alone) ─────────────────────
--   Run supabase/verify_schema.sql QUERY 1: every 1120_eatery_preview_key row must read OK.
--   Live API: anon key + header x-ada-preview-key: <key> → crunchy-express; no / wrong header → [].
--
-- ─── Rollback ──
--   Policies back to TO authenticated and is_previewer() back to 20261119's body, or simply:
--   DELETE FROM private.preview_key_hashes;   -- every request is then a non-previewer
