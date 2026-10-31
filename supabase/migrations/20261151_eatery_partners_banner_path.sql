-- ═══════════════════════════════════════════════════════════════════════════
-- 20261151 — Yeme-İçme: eatery_partners.banner_path (optional full-width header photo of the partner page)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- ONE nullable text column, same convention as logo_path: a path inside the public bucket eatery-images,
-- NULL = no banner. A banner is OPTIONAL, so eatery_partners_launch_complete_check is NOT touched (asserted).
-- No data is written: every existing row gets NULL.
--
-- ─── WHO CAN READ / WRITE ───────────────────────────────────────────────────
--   UNCHANGED by this file; no policy and no grant is created or altered.
--   • READ: anyone, guests included, sees banner_path exactly where they already see the rest of the row: the
--     table-level GRANT SELECT (20261115) covers the new column, and RLS still decides the ROWS: an inactive
--     partner stays invisible to anon and authenticated (a throwaway inactive partner is probed as both, postgres
--     is the positive control). Bidda Badadez stays is_active = false; the active-partner set is asserted unchanged.
--   • WRITE: service_role only (migrations / admin SQL / Edge Functions). anon and authenticated (guests included)
--     have no INSERT or UPDATE privilege on the table or on the column; asserted equal to logo_path and printed.
--   • A banner is a picture of a place, never of a person.
--
-- ─── RE-RUN ─────────────────────────────────────────────────────────────────
--   Idempotent. A second apply finds the column and the CHECK in place (asserted, not re-created) and changes nothing.
--
-- ⚠ ORDERING NOTE — APPLY THIS BEFORE ANY APP BUILD OR OTA THAT SELECTS banner_path.
--   screens/EateryScreen.js COLS must not name banner_path until this file is applied: a select naming a missing
--   column returns 42703 and EMPTIES the eatery list for every user. The app PR deliberately leaves it out of COLS.
--   Ends with NOTIFY pgrst (after COMMIT and RESET ROLE) so PostgREST sees the new column.
--
-- Apply: gh workflow run supabase-migrate -f file=20261151_eatery_partners_banner_path.sql (dry), then -f apply=true
-- (Berke approves production-db).
-- ═══════════════════════════════════════════════════════════════════════════

SET ROLE postgres;

BEGIN;

SET LOCAL lock_timeout = '5s';

-- Snapshot BEFORE any DDL: every row, minus the new column. Re-run safe (the key is simply absent on a first apply).
DO $$
BEGIN
  PERFORM set_config('ada.m1151_rows',
    (SELECT md5(COALESCE(string_agg((to_jsonb(p) - 'banner_path')::text, ',' ORDER BY p.id), '')) FROM public.eatery_partners p), true);
  PERFORM set_config('ada.m1151_active',
    (SELECT COALESCE(string_agg(p.slug, ',' ORDER BY p.slug), '') FROM public.eatery_partners p WHERE p.is_active), true);
  PERFORM set_config('ada.m1151_launch',
    (SELECT pg_get_constraintdef(c.oid) FROM pg_constraint c
      WHERE c.conrelid = 'public.eatery_partners'::regclass AND c.conname = 'eatery_partners_launch_complete_check'), true);
END $$;

ALTER TABLE public.eatery_partners ADD COLUMN IF NOT EXISTS banner_path text NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.eatery_partners'::regclass AND conname = 'eatery_partners_banner_path_check') THEN
    ALTER TABLE public.eatery_partners ADD CONSTRAINT eatery_partners_banner_path_check
      CHECK (banner_path IS NULL OR banner_path ~ '^[a-z0-9-]+(/[a-z0-9][a-z0-9_-]*)+\.(jpg|jpeg|png|webp)$');
  END IF;
END $$;

COMMENT ON COLUMN public.eatery_partners.banner_path IS
  'Optional full-width header photo of the partner page: a path inside the public bucket eatery-images, same convention and CHECK as logo_path. NULL = no banner. 20261151.';

DO $$
DECLARE
  v_ncol int; v_def text; v_ldef text; v_acl int; v_priv text; v_names text[];
  v_pos int; v_anon int; v_auth int; v_anon_ro int; v_auth_ro int;
  v_ok text; v_null text; v_dotdot text; v_http text; v_gif text; v_upper text; v_slash text;
  v_probe uuid;
BEGIN
  -- Column: text, nullable, no default.
  SELECT count(*) INTO v_ncol FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'eatery_partners' AND column_name = 'banner_path'
     AND data_type = 'text' AND is_nullable = 'YES' AND column_default IS NULL;
  IF v_ncol IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'banner_path is not a nullable no-default text column (% match)', v_ncol; END IF;

  -- CHECK: same expression as logo_path_check with the column renamed (no regex decoding), validated.
  SELECT pg_get_constraintdef(oid) INTO v_def FROM pg_constraint
   WHERE conrelid = 'public.eatery_partners'::regclass AND conname = 'eatery_partners_banner_path_check' AND convalidated;
  SELECT pg_get_constraintdef(oid) INTO v_ldef FROM pg_constraint
   WHERE conrelid = 'public.eatery_partners'::regclass AND conname = 'eatery_partners_logo_path_check';
  IF v_def IS NULL OR v_ldef IS NULL OR replace(v_ldef, 'logo_path', 'banner_path') IS DISTINCT FROM v_def THEN
    RAISE EXCEPTION 'banner_path CHECK differs from logo_path CHECK: banner=% logo=%', coalesce(v_def, '<missing>'), coalesce(v_ldef, '<missing>');
  END IF;
  RAISE NOTICE 'eatery_partners_banner_path_check: %', v_def;

  -- launch_complete_check untouched (a banner is optional).
  SELECT pg_get_constraintdef(c.oid) INTO v_def FROM pg_constraint c
   WHERE c.conrelid = 'public.eatery_partners'::regclass AND c.conname = 'eatery_partners_launch_complete_check';
  IF v_def IS DISTINCT FROM current_setting('ada.m1151_launch', true) OR v_def IS NULL OR v_def LIKE '%banner_path%' THEN
    RAISE EXCEPTION 'launch_complete_check changed or missing: before=% now=%', current_setting('ada.m1151_launch', true), v_def;
  END IF;

  -- Grants: no column-level ACL; same table-level privileges as logo_path.
  SELECT count(*) INTO v_acl FROM pg_attribute
   WHERE attrelid = 'public.eatery_partners'::regclass AND attname = 'banner_path' AND attacl IS NOT NULL;
  IF v_acl IS DISTINCT FROM 0 THEN RAISE EXCEPTION 'banner_path carries a column-level ACL (want none: the table-level grant covers it)'; END IF;
  SELECT string_agg(r || ':' || c || '=' || CASE WHEN has_column_privilege(r, 'public.eatery_partners', c, 'SELECT') THEN 'S' ELSE '-' END
                      || CASE WHEN has_column_privilege(r, 'public.eatery_partners', c, 'INSERT') THEN 'I' ELSE '-' END
                      || CASE WHEN has_column_privilege(r, 'public.eatery_partners', c, 'UPDATE') THEN 'U' ELSE '-' END, ' ' ORDER BY r, c)
    INTO v_priv
    FROM unnest(ARRAY['anon','authenticated','service_role']) r, unnest(ARRAY['logo_path','banner_path']) c;
  RAISE NOTICE 'column privileges (S select, I insert, U update): %', v_priv;
  IF EXISTS (SELECT 1 FROM unnest(ARRAY['anon','authenticated']) r
              WHERE NOT has_column_privilege(r, 'public.eatery_partners', 'banner_path', 'SELECT')
                 OR has_column_privilege(r, 'public.eatery_partners', 'banner_path', 'INSERT,UPDATE,REFERENCES')
                 OR has_column_privilege(r, 'public.eatery_partners', 'banner_path', 'SELECT') IS DISTINCT FROM has_column_privilege(r, 'public.eatery_partners', 'logo_path', 'SELECT')
                 OR has_column_privilege(r, 'public.eatery_partners', 'banner_path', 'INSERT') IS DISTINCT FROM has_column_privilege(r, 'public.eatery_partners', 'logo_path', 'INSERT')
                 OR has_column_privilege(r, 'public.eatery_partners', 'banner_path', 'UPDATE') IS DISTINCT FROM has_column_privilege(r, 'public.eatery_partners', 'logo_path', 'UPDATE'))
     OR NOT has_column_privilege('service_role', 'public.eatery_partners', 'banner_path', 'SELECT,INSERT,UPDATE') THEN
    RAISE EXCEPTION 'banner_path column privileges wrong: %', v_priv;
  END IF;

  -- BEHAVIOUR on a throwaway INACTIVE partner, rolled back by a sentinel (variables survive, rows do not).
  BEGIN
    -- order_method is NOT NULL with no default (20261144): the probe must state one, or the insert raises 23502 and the file never applies.
    INSERT INTO public.eatery_partners (slug, name, category, order_method) VALUES ('zz-banner-probe', 'zz banner probe', 'cafe', 'whatsapp') RETURNING id INTO v_probe;

    BEGIN UPDATE public.eatery_partners SET banner_path = 'bidda-badadez/banner.jpg' WHERE id = v_probe; v_ok := 'accepted';
    EXCEPTION WHEN check_violation THEN v_ok := 'REFUSED(valid path)'; END;
    BEGIN UPDATE public.eatery_partners SET banner_path = NULL WHERE id = v_probe; v_null := 'accepted';
    EXCEPTION WHEN check_violation THEN v_null := 'REFUSED(NULL)'; END;
    BEGIN UPDATE public.eatery_partners SET banner_path = '../x.jpg' WHERE id = v_probe; v_dotdot := 'ACCEPTED(path with ../)';
    EXCEPTION WHEN check_violation THEN v_dotdot := 'refused'; END;
    BEGIN UPDATE public.eatery_partners SET banner_path = 'http://x/y.jpg' WHERE id = v_probe; v_http := 'ACCEPTED(url)';
    EXCEPTION WHEN check_violation THEN v_http := 'refused'; END;
    BEGIN UPDATE public.eatery_partners SET banner_path = 'x/y.gif' WHERE id = v_probe; v_gif := 'ACCEPTED(gif)';
    EXCEPTION WHEN check_violation THEN v_gif := 'refused'; END;
    BEGIN UPDATE public.eatery_partners SET banner_path = 'X/Y.jpg' WHERE id = v_probe; v_upper := 'ACCEPTED(uppercase)';
    EXCEPTION WHEN check_violation THEN v_upper := 'refused'; END;
    BEGIN UPDATE public.eatery_partners SET banner_path = '/x/y.jpg' WHERE id = v_probe; v_slash := 'ACCEPTED(leading slash)';
    EXCEPTION WHEN check_violation THEN v_slash := 'refused'; END;

    -- Visibility: production roles WITHOUT a Preview key (headers cleared below, so is_previewer() is false; 20261119/20261120's
    -- preview policies stay shut) see no inactive partner (postgres = positive control; the test also proves a key header opens them).
    SELECT count(*) INTO v_pos FROM public.eatery_partners WHERE id = v_probe;
    SET LOCAL ROLE anon;
    PERFORM set_config('request.jwt.claims', '', true);
    PERFORM set_config('request.headers', '', true);
    SELECT count(*) INTO v_anon FROM public.eatery_partners WHERE id = v_probe;
    SELECT count(*) INTO v_anon_ro FROM public.eatery_partners WHERE NOT is_active;
    RESET ROLE;
    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', gen_random_uuid(), 'role', 'authenticated', 'is_anonymous', false)::text, true);
    SELECT count(*) INTO v_auth FROM public.eatery_partners WHERE id = v_probe;
    SELECT count(*) INTO v_auth_ro FROM public.eatery_partners WHERE NOT is_active;
    RESET ROLE;
    PERFORM set_config('request.jwt.claims', '', true);
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'banner-probe-sentinel';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM IS DISTINCT FROM 'banner-probe-sentinel' THEN RAISE; END IF;
  END;
  RESET ROLE;

  IF v_ok IS DISTINCT FROM 'accepted' OR v_null IS DISTINCT FROM 'accepted' THEN
    RAISE EXCEPTION 'positive controls failed: valid path %, NULL %', v_ok, v_null;
  END IF;
  IF v_dotdot <> 'refused' OR v_http <> 'refused' OR v_gif <> 'refused' OR v_upper <> 'refused' OR v_slash <> 'refused' THEN
    RAISE EXCEPTION 'banner_path CHECK too loose: ../ %, url %, gif %, uppercase %, leading slash %', v_dotdot, v_http, v_gif, v_upper, v_slash;
  END IF;
  IF v_pos IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'positive control failed: postgres sees % probe partners (want 1)', v_pos; END IF;
  IF v_anon <> 0 OR v_auth <> 0 OR v_anon_ro <> 0 OR v_auth_ro <> 0 THEN
    RAISE EXCEPTION 'inactive partner visible: anon % (any inactive: %), authenticated % (any inactive: %)', v_anon, v_anon_ro, v_auth, v_auth_ro;
  END IF;

  -- Existing rows: unchanged apart from the new NULL column; the active set unchanged (Bidda stays inactive);
  -- every existing banner_path is NULL (no data written).
  IF (SELECT COALESCE(string_agg(p.slug, ',' ORDER BY p.slug), '') FROM public.eatery_partners p WHERE p.is_active)
       IS DISTINCT FROM current_setting('ada.m1151_active', true) THEN
    RAISE EXCEPTION 'active partner set changed. Nothing applied.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.eatery_partners WHERE slug = 'bidda-badadez' AND is_active) THEN
    RAISE EXCEPTION 'bidda-badadez is active';
  END IF;
  IF (SELECT md5(COALESCE(string_agg((to_jsonb(p) - 'banner_path')::text, ',' ORDER BY p.id), '')) FROM public.eatery_partners p)
       IS DISTINCT FROM current_setting('ada.m1151_rows', true) THEN
    RAISE EXCEPTION 'existing eatery_partners rows changed. Nothing applied.';
  END IF;
  SELECT array_agg(slug ORDER BY slug) INTO v_names FROM public.eatery_partners WHERE banner_path IS NOT NULL;
  IF v_names IS NOT NULL THEN RAISE EXCEPTION 'banner_path is set on %: this file writes no data', v_names; END IF;

  RAISE NOTICE 'banner_path added; % partners unchanged; anon/authenticated read it where they read the row, cannot write it; inactive hidden (postgres sees %, anon %, authenticated %)',
    (SELECT count(*) FROM public.eatery_partners), v_pos, v_anon, v_auth;
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
VALUES ('20261151_eatery_partners_banner_path.sql', '1fbb4849b48c463041f0cb45dd200c0204e1745374da1a93d648c4fcc0816ea5')
ON CONFLICT (filename) DO UPDATE
  SET checksum = excluded.checksum, applied_at = now(), applied_by = current_user;
-- ─── ledger:stamp:end ────────────────────────────────────────────────
COMMIT;
RESET ROLE;
NOTIFY pgrst, 'reload schema';
