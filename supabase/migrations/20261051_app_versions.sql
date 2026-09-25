-- ═══════════════════════════════════════════════════════════════════════════
-- 20261051 — app_versions: the store-update popup's two thresholds, per platform
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Big native updates shipped and nothing told users to update, so many never did. The app
-- reads ONE row for its own platform on cold start (and on foreground after >30 min) and
-- compares it against the INSTALLED NATIVE version:
--
--   installed < latest_version          → soft: dismissible "New version available"
--   installed < min_supported_version   → force: blocking, [Update] only
--
-- Two columns, not a tier enum, because the comparison belongs in the client: the app knows
-- its own installed version and the server does not.
--
-- ─── WHO CAN READ / WRITE ───────────────────────────────────────────────────
--   • READ: everyone — anon, signed-in and guest alike. There is no is_active gate and no
--     admin branch, deliberately: this table holds two version strings and a timestamp, it
--     describes the SHIPPED STORE BUILD, and the force tier must work for a user who is not
--     signed in (the popup is evaluated before, and independently of, any session).
--   • WRITE: nobody through the client. No INSERT/UPDATE/DELETE policy exists, and the
--     privileges are REVOKEd from anon and authenticated as well — RLS with no write policy
--     already denies them; the revoke makes the table's own grants say the same thing, and
--     `has_table_privilege` can then prove it for a named role without a JWT.
--     Rows are written by hand in the SQL editor when a store build goes live.
--
-- ─── WHY THE FORMAT CHECKS ARE NOT DECORATION ───────────────────────────────
-- The client's compareVersions() returns NULL for anything it cannot parse, and EVERY caller
-- treats NULL as "show no popup" (fail open — a version check must never block the app). That
-- is the right behaviour at runtime and a TRAP at seed time: a typo'd '1.2' or '1.2.0 ' would
-- not error anywhere, it would silently disable the feature, and nobody would notice because
-- the healthy state and the broken state look identical — no popup either way. This repo has
-- a name for that shape ("a check that passes hardest when the feature is broken"), so the
-- typo is made to fail HERE, at the SQL editor, where it is still free.
--   • both columns must be exactly N.N.N
--   • min_supported_version must be <= latest_version, compared as INTEGER ARRAYS, not as
--     text — '1.10.0' < '1.9.0' is true in text and false in every sense that matters here.
--
-- ─── updated_at ─────────────────────────────────────────────────────────────
-- Plain DEFAULT now(), no trigger. One hand-edited row per platform; a BEFORE UPDATE trigger
-- to maintain a column the writer can set in the same statement is machinery for nobody.
-- Set it in the UPDATE.
--
-- Apply: SQL Editor, Role = postgres, whole file ONCE, copied from disk. Idempotent.
-- New table ⇒ ends with NOTIFY pgrst (after COMMIT).
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS public.app_versions (
  platform              text        NOT NULL,
  latest_version        text        NOT NULL,
  min_supported_version text        NOT NULL,
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT app_versions_pkey           PRIMARY KEY (platform),
  CONSTRAINT app_versions_platform_check CHECK (platform = ANY (ARRAY['ios','android']::text[])),
  CONSTRAINT app_versions_latest_format_check CHECK (latest_version        ~ '^[0-9]+\.[0-9]+\.[0-9]+$'),
  CONSTRAINT app_versions_min_format_check    CHECK (min_supported_version ~ '^[0-9]+\.[0-9]+\.[0-9]+$'),
  -- Integer-array compare, never text. Both operands are already pinned to N.N.N by the two
  -- format checks above, so string_to_array(...)::int[] cannot raise here.
  CONSTRAINT app_versions_order_check CHECK (
    string_to_array(min_supported_version, '.')::int[] <= string_to_array(latest_version, '.')::int[]
  )
);

COMMENT ON TABLE public.app_versions IS
  'Store-update popup thresholds, one row per platform. Public read; no client writes. '
  'Rows are hand-edited in the SQL editor when a store build goes live.';
COMMENT ON COLUMN public.app_versions.latest_version IS
  'Current STORE version. Installed < this ⇒ soft, dismissible popup.';
COMMENT ON COLUMN public.app_versions.min_supported_version IS
  'Oldest still-supported native version. Installed < this ⇒ blocking popup. '
  'Raising this locks every older binary out of the app — emergency numbers and the duty '
  'roster stay reachable behind the block, nothing else does.';

ALTER TABLE public.app_versions ENABLE ROW LEVEL SECURITY;

REVOKE ALL    ON TABLE public.app_versions FROM anon, authenticated;
GRANT  SELECT ON TABLE public.app_versions TO   anon, authenticated;
GRANT  SELECT, INSERT, UPDATE, DELETE ON TABLE public.app_versions TO service_role;

DROP POLICY IF EXISTS app_versions_select ON public.app_versions;
CREATE POLICY app_versions_select ON public.app_versions
  FOR SELECT TO anon, authenticated
  USING (true);

-- ─── Assertions. Each derives what it checks and prints what it read. ───────
DO $$
DECLARE
  v_t          regclass := to_regclass('public.app_versions');
  v_n          int;
  v_names      text;
  v_role       text;
  v_priv       text;
  v_cons       text;
  n_anon_read  int  := -1;
  v_anon_write text := 'unset';
  v_bad_format text := 'unset';
  v_bad_order  text := 'unset';
BEGIN
  IF v_t IS NULL THEN
    RAISE EXCEPTION 'app_versions is not visible to this DO block. Nothing committed; re-run the file as one paste.';
  END IF;

  IF (SELECT relrowsecurity FROM pg_class WHERE oid = v_t) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'RLS is not enabled on app_versions';
  END IF;

  -- The FULL policy set, derived and printed. RLS is permissive-OR, so a second policy —
  -- whoever wrote it, including through the dashboard — could only widen this.
  SELECT count(*), coalesce(string_agg(policyname || ':' || cmd || ':' || permissive, ', ' ORDER BY policyname), '(none)')
    INTO v_n, v_names
    FROM pg_policies WHERE schemaname = 'public' AND tablename = 'app_versions';
  IF v_n IS DISTINCT FROM 1 OR v_names NOT LIKE '%:SELECT:PERMISSIVE' THEN
    RAISE EXCEPTION 'app_versions must carry exactly ONE permissive SELECT policy; found %: %', v_n, v_names;
  END IF;

  -- The FULL constraint set, derived and printed, for the same reason.
  --
  -- contype IS FILTERED TO 'p','c' ON PURPOSE. From PG 17 a NOT NULL constraint gets its
  -- OWN pg_constraint row (contype 'n'); on 15 and 16 it does not. An unfiltered count of
  -- this table is 9 on the PGlite harness (PG 18.3), which is how the filter was found.
  --
  -- ⚠ The first version of this comment said prod would answer 5 to the same query. That
  -- was wrong: prod is **PostgreSQL 17.6** (supabase/.temp/postgres-version, cached by the
  -- CLI at link time — confirm with SELECT version() when you have a session), so prod
  -- counts the NOT NULL rows too and would also have said 9. The filter is still the right
  -- shape, for a better reason than the one first written: it counts exactly what THIS FILE
  -- declares — one primary key and four CHECKs — so it neither drifts with the server
  -- version nor moves if somebody later adds or drops a NOT NULL.
  SELECT count(*), coalesce(string_agg(conname || ':' || contype::text, ', ' ORDER BY conname), '(none)')
    INTO v_n, v_cons
    FROM pg_constraint WHERE conrelid = v_t AND contype IN ('p','c');
  IF v_n IS DISTINCT FROM 5 THEN
    RAISE EXCEPTION 'app_versions must carry exactly 5 pkey/check constraints; found %: %', v_n, v_cons;
  END IF;

  -- Privileges, BOTH directions. has_table_privilege resolves inherited grants, which a
  -- grantee-filtered count of information_schema cannot see.
  FOREACH v_role IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF NOT has_table_privilege(v_role, v_t, 'SELECT') THEN
      RAISE EXCEPTION '% lost SELECT on app_versions — the popup would never evaluate', v_role;
    END IF;
    FOREACH v_priv IN ARRAY ARRAY['INSERT','UPDATE','DELETE','TRUNCATE'] LOOP
      IF has_table_privilege(v_role, v_t, v_priv) THEN
        RAISE EXCEPTION '% still holds % on app_versions', v_role, v_priv;
      END IF;
    END LOOP;
  END LOOP;

  -- ── BEHAVIOUR, rolled back by a sentinel. PL/pgSQL variables survive it; rows do not.
  -- ON CONFLICT DO NOTHING so this is correct on a RE-APPLY, once the rows are seeded:
  -- the probe then measures the real row instead of colliding with it.
  BEGIN
    INSERT INTO public.app_versions (platform, latest_version, min_supported_version)
    VALUES ('ios', '1.2.0', '1.1.0') ON CONFLICT (platform) DO NOTHING;

    -- POSITIVE CONTROL. A denial suite with no "and the legitimate path still works" beside
    -- it is a one-way ratchet that scores full marks on a table nobody can read.
    SET LOCAL ROLE anon;
    SELECT count(*) INTO n_anon_read FROM public.app_versions WHERE platform = 'ios';

    BEGIN
      INSERT INTO public.app_versions (platform, latest_version, min_supported_version)
      VALUES ('android', '9.9.9', '9.9.9');
      v_anon_write := 'ALLOWED';
    EXCEPTION WHEN insufficient_privilege THEN v_anon_write := 'denied';
    END;
    RESET ROLE;

    -- The format and ordering checks, exercised rather than assumed present.
    BEGIN
      INSERT INTO public.app_versions (platform, latest_version, min_supported_version)
      VALUES ('android', '1.2', '1.1.0');
      v_bad_format := 'ACCEPTED';
    EXCEPTION WHEN check_violation THEN v_bad_format := 'rejected';
    END;

    BEGIN
      INSERT INTO public.app_versions (platform, latest_version, min_supported_version)
      VALUES ('android', '1.9.0', '1.10.0');
      v_bad_order := 'ACCEPTED';
    EXCEPTION WHEN check_violation THEN v_bad_order := 'rejected';
    END;

    RAISE EXCEPTION 'ZZ_PROBE_ROLLBACK';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM IS DISTINCT FROM 'ZZ_PROBE_ROLLBACK' THEN RAISE; END IF;
  END;

  IF n_anon_read  IS DISTINCT FROM 1        THEN RAISE EXCEPTION 'anon read of the ios row returned % rows, expected 1 — the public read is broken', n_anon_read; END IF;
  IF v_anon_write IS DISTINCT FROM 'denied' THEN RAISE EXCEPTION 'anon INSERT into app_versions was %', v_anon_write; END IF;
  IF v_bad_format IS DISTINCT FROM 'rejected' THEN RAISE EXCEPTION 'a malformed version (''1.2'') was % — the format check is not in force, and a seed typo would silently disable the popup', v_bad_format; END IF;
  IF v_bad_order  IS DISTINCT FROM 'rejected' THEN RAISE EXCEPTION 'min_supported_version ABOVE latest_version (1.10.0 > 1.9.0) was % — the ordering check is not in force', v_bad_order; END IF;
  IF EXISTS (SELECT 1 FROM public.app_versions WHERE platform = 'android' AND latest_version = '9.9.9') THEN
    RAISE EXCEPTION 'probe rows survived the rollback';
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
VALUES ('20261051_app_versions.sql', '8025902ebb578e4d5df239033e56d3ba02637c9d89576312f070f42f4f30161b')
ON CONFLICT (filename) DO UPDATE
  SET checksum = excluded.checksum, applied_at = now(), applied_by = current_user;
-- ─── ledger:stamp:end ────────────────────────────────────────────────
COMMIT;

NOTIFY pgrst, 'reload schema';

-- ─── Verification after applying (read-only, run alone) ─────────────────────
--   SELECT relname, relrowsecurity FROM pg_class WHERE oid = to_regclass('public.app_versions');
--     -- expect 1 row, true
--   SELECT policyname, cmd, roles, qual FROM pg_policies WHERE tablename = 'app_versions';
--     -- expect 1 row: app_versions_select, SELECT, {anon,authenticated}, true
--
-- ─── SEEDING (NOT done by this file — see the note below) ───────────────────
-- latest_version is the CURRENT STORE version per platform. min_supported_version must be
-- agreed with Berke before it is set: raising it locks every older binary out of everything
-- except emergency numbers and the duty roster.
--   INSERT INTO public.app_versions (platform, latest_version, min_supported_version)
--   VALUES ('ios', '<store>', '<agreed>'), ('android', '<store>', '<agreed>')
--   ON CONFLICT (platform) DO UPDATE
--     SET latest_version = excluded.latest_version,
--         min_supported_version = excluded.min_supported_version,
--         updated_at = now();
--
-- ─── Rollback (only if the popup is abandoned) ──────────────────────────────
--   DROP TABLE IF EXISTS public.app_versions;
