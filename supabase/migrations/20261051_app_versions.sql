-- ═══════════════════════════════════════════════════════════════════════════
-- 20261051 — app_versions (popup thresholds) + app_update_events (was it shown?)
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

-- ═══════════════════════════════════════════════════════════════════════════
-- app_update_events — the BACKUP SIGNAL: did the popup actually appear?
-- ═══════════════════════════════════════════════════════════════════════════
--
-- One row each time a popup is SHOWN. Without it the only evidence the feature works is
-- somebody noticing an upgrade, and the failure mode is silent by construction: every path
-- in evaluateAppUpdate() fails OPEN, so "no popup" is both the healthy state on a current
-- binary and the broken state on every binary. Those are indistinguishable from the outside,
-- which is exactly the shape CLAUDE.md warns about. This table tells them apart.
--
-- Modelled on contact_events (20260910), including the two rules that file sets out:
--
--   RULE ONE — IT MUST NEVER COST THE USER ANYTHING. The client write is fire-and-forget,
--   never awaited, and cannot throw. A blocked user waiting on an analytics round-trip
--   before the [Update] button works would be this feature failing at its whole job.
--
--   RULE TWO — NO IDENTIFIER, EVER. No user id, no device id, no install id. The question is
--   "are popups being shown, and to which versions", which is a COUNT. Anything that lets two
--   rows be recognised as the same phone turns a counter into a behavioural log.
--
-- ─── ONE VERSION COLUMN, NOT TWO ───────────────────────────────────────────
--
-- An earlier draft stored installed_version (Application.nativeApplicationVersion) beside
-- runtime_version (Updates.runtimeVersion) to catch the two disagreeing. Both are gone bar
-- one: runtimeVersion.policy is 'appVersion', and check-ota-preflight.mjs:69 REFUSES the
-- publish unless that policy is exactly 'appVersion' — so on every build that can reach this
-- code the two strings are the same by construction, and a second column stored the same
-- value twice. utils/appUpdate.js now reads Updates.runtimeVersion only and does not touch
-- expo-application at all, which also removes a native module from the OTA-shipped path.
--
-- ─── THE VERSION COLUMNS ARE DELIBERATELY UNCONSTRAINED ─────────────────────
--
-- tier and platform get CHECKs: their value sets are closed and known. The version columns do
-- NOT, beyond a length cap. A CHECK there would reject exactly the anomalous values worth
-- catching — and because the insert is fire-and-forget, a rejection is SILENT, so a strict
-- constraint would quietly discard the only rows anyone would want to read.
CREATE TABLE IF NOT EXISTS public.app_update_events (
  id                bigint      GENERATED ALWAYS AS IDENTITY,
  tier              text        NOT NULL,
  platform          text        NOT NULL,
  runtime_version   text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT app_update_events_pkey           PRIMARY KEY (id),
  CONSTRAINT app_update_events_tier_check     CHECK (tier = ANY (ARRAY['soft','force']::text[])),
  CONSTRAINT app_update_events_platform_check CHECK (platform = ANY (ARRAY['ios','android']::text[])),
  CONSTRAINT app_update_events_runtime_len_check CHECK (runtime_version IS NULL OR length(runtime_version) <= 64)
);

COMMENT ON TABLE public.app_update_events IS
  'One row per store-update popup SHOWN. No identifiers of any kind — counts only. '
  'A row where installed_version and runtime_version disagree means appUpdate.js fell back.';

CREATE INDEX IF NOT EXISTS idx_app_update_events_created_at ON public.app_update_events (created_at DESC);

ALTER TABLE public.app_update_events ENABLE ROW LEVEL SECURITY;

-- GRANTS ARE LOAD-BEARING, NOT DECORATION: Supabase's default privileges hand anon and
-- authenticated ALL on a new table in `public`, so the REVOKE is what actually closes it.
-- The INSERT grant is COLUMN-LEVEL — the client cannot write id or created_at, so it cannot
-- backdate a row or collide an identity value.
--
-- ⚠ GRANTED TO anon AND authenticated, not anon alone. In this app a GUEST is an anonymous
-- auth session, which Postgres sees as `authenticated` — and most users are guests or signed
-- in. An "anon-insert-only" grant would drop nearly every event on the floor while looking
-- perfectly correct, which is the failure this table exists to detect.
REVOKE ALL ON public.app_update_events FROM anon, authenticated;
GRANT INSERT (tier, platform, runtime_version) ON public.app_update_events TO anon, authenticated;

DROP POLICY IF EXISTS aue_insert_public ON public.app_update_events;
CREATE POLICY aue_insert_public ON public.app_update_events
  FOR INSERT TO anon, authenticated
  WITH CHECK (true);

-- No SELECT policy and no SELECT grant for clients: a device may add to the counter and may
-- not read it back. Reporting is done as postgres in the SQL editor.
DROP POLICY IF EXISTS aue_no_update ON public.app_update_events;
CREATE POLICY aue_no_update ON public.app_update_events
  FOR UPDATE TO anon, authenticated
  USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS aue_no_delete ON public.app_update_events;
CREATE POLICY aue_no_delete ON public.app_update_events
  FOR DELETE TO anon, authenticated
  USING (false);

-- ─── RETENTION: 90 days, on pg_cron, the mechanism this repo already uses ──
--
-- This table answers a LAUNCH question — "are popups appearing, on which runtime" — not a
-- permanent one, so rows do not need to outlive the answer. Without a purge it grows forever
-- and quietly becomes a long-lived record of app usage, which is not what anybody agreed to
-- when the table was justified as a counter.
--
-- Same shape as purge_soft_deleted_ugc (20261050): a plain function plus a pg_cron job, not
-- a trigger and not an edge function. 03:33 UTC is chosen to clear the three purges already
-- in that cluster — purge-moderation-rejections 03:17, purge-conversation-attempts 03:23,
-- purge-soft-deleted-ugc 03:27 — following the convention 20261050's own comment sets.
--
-- Interval is a DEFAULTED PARAMETER rather than a literal so the retention can be exercised
-- by calling it with a different window, without editing the function.
--
-- SECURITY INVOKER (the default), like purge_soft_deleted_ugc: cron runs it as the job owner
-- (postgres), and EXECUTE is revoked from clients, so no app role can trigger a purge.
CREATE OR REPLACE FUNCTION public.purge_app_update_events(p_older_than interval DEFAULT interval '90 days')
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $function$
DECLARE
  v_cut timestamptz := now() - p_older_than;
  n int;
BEGIN
  DELETE FROM app_update_events WHERE created_at < v_cut;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN jsonb_build_object('deleted', n, 'cutoff', v_cut);
END;
$function$;

REVOKE ALL ON FUNCTION public.purge_app_update_events(interval) FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'purge-app-update-events') THEN
    PERFORM cron.unschedule('purge-app-update-events');
  END IF;
END $$;
-- 03:33 UTC: after purge-soft-deleted-ugc (03:27), so no two purges overlap.
SELECT cron.schedule('purge-app-update-events', '33 3 * * *', $$ SELECT public.purge_app_update_events() $$);

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
  v_e          regclass := to_regclass('public.app_update_events');
  v_e_insert   text := 'unset';
  v_e_read     text := 'unset';
  v_e_update   text := 'unset';
  v_e_ident    text := 'unset';
  v_purge_fn   regprocedure := to_regprocedure('public.purge_app_update_events(interval)');
  v_jobs       int;
  v_cmd        text;
  v_sched      text;
  v_kept       int := -1;
  v_purged     int := -1;
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

  -- ── app_update_events ────────────────────────────────────────────────────
  IF v_e IS NULL THEN
    RAISE EXCEPTION 'app_update_events is not visible to this DO block. Nothing committed; re-run the file as one paste.';
  END IF;
  IF (SELECT relrowsecurity FROM pg_class WHERE oid = v_e) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'RLS is not enabled on app_update_events';
  END IF;

  -- FULL policy set, derived and printed. Exactly three: one permissive INSERT, plus the
  -- two that pin UPDATE and DELETE shut. RLS is permissive-OR, so a fourth could only widen.
  SELECT count(*), coalesce(string_agg(policyname || ':' || cmd, ', ' ORDER BY policyname), '(none)')
    INTO v_n, v_names
    FROM pg_policies WHERE schemaname = 'public' AND tablename = 'app_update_events';
  IF v_n IS DISTINCT FROM 3 THEN
    RAISE EXCEPTION 'app_update_events must carry exactly 3 policies (INSERT + no-UPDATE + no-DELETE); found %: %', v_n, v_names;
  END IF;

  -- No client may ever SELECT: a device adds to the counter, it does not read it back.
  FOREACH v_role IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF has_table_privilege(v_role, v_e, 'SELECT') THEN
      RAISE EXCEPTION '% can SELECT app_update_events — the counter is readable by every device', v_role;
    END IF;
    FOREACH v_priv IN ARRAY ARRAY['UPDATE','DELETE','TRUNCATE'] LOOP
      IF has_table_privilege(v_role, v_e, v_priv) THEN
        RAISE EXCEPTION '% holds % on app_update_events', v_role, v_priv;
      END IF;
    END LOOP;
    -- The COLUMN grant, both directions: the four payload columns yes, the two server-owned
    -- ones no. has_column_privilege is the only thing that can see a column-level grant.
    IF NOT has_column_privilege(v_role, v_e, 'tier', 'INSERT')
       OR NOT has_column_privilege(v_role, v_e, 'platform', 'INSERT')
       OR NOT has_column_privilege(v_role, v_e, 'runtime_version', 'INSERT') THEN
      RAISE EXCEPTION '% cannot INSERT a payload column — every event would be dropped silently', v_role;
    END IF;
    IF has_column_privilege(v_role, v_e, 'id', 'INSERT') OR has_column_privilege(v_role, v_e, 'created_at', 'INSERT') THEN
      RAISE EXCEPTION '% can write id/created_at on app_update_events — a client could backdate a row', v_role;
    END IF;
  END LOOP;

  -- BEHAVIOUR as authenticated (the role a GUEST actually holds — the one that matters).
  BEGIN
    SET LOCAL ROLE authenticated;
    BEGIN
      INSERT INTO public.app_update_events (tier, platform, runtime_version)
      VALUES ('force', 'ios', '1.1.0');
      v_e_insert := 'allowed';
    EXCEPTION WHEN OTHERS THEN v_e_insert := 'DENIED: ' || SQLERRM;
    END;
    BEGIN
      PERFORM 1 FROM public.app_update_events LIMIT 1;
      v_e_read := 'READABLE';
    EXCEPTION WHEN insufficient_privilege THEN v_e_read := 'denied';
    END;
    BEGIN
      UPDATE public.app_update_events SET tier = 'soft' WHERE true;
      v_e_update := 'ALLOWED';
    EXCEPTION WHEN insufficient_privilege THEN v_e_update := 'denied';
    END;
    BEGIN
      INSERT INTO public.app_update_events (tier, platform) VALUES ('nonsense', 'ios');
      v_e_ident := 'ACCEPTED';
    EXCEPTION WHEN check_violation THEN v_e_ident := 'rejected';
    END;
    RESET ROLE;
    RAISE EXCEPTION 'ZZ_PROBE_ROLLBACK';
  EXCEPTION WHEN raise_exception THEN
    RESET ROLE;
    IF SQLERRM IS DISTINCT FROM 'ZZ_PROBE_ROLLBACK' THEN RAISE; END IF;
  END;

  -- POSITIVE CONTROL FIRST: a denial suite with no "the legitimate path still works" beside
  -- it is a one-way ratchet that scores full marks on a table nothing can write to — which
  -- here would mean a backup signal that is permanently, silently empty.
  IF v_e_insert IS DISTINCT FROM 'allowed'   THEN RAISE EXCEPTION 'a guest could not log an update event (%) — the backup signal would be silently empty', v_e_insert; END IF;
  IF v_e_read   IS DISTINCT FROM 'denied'    THEN RAISE EXCEPTION 'app_update_events was % by authenticated', v_e_read; END IF;
  IF v_e_update IS DISTINCT FROM 'denied'    THEN RAISE EXCEPTION 'UPDATE on app_update_events was % by authenticated', v_e_update; END IF;
  IF v_e_ident  IS DISTINCT FROM 'rejected'  THEN RAISE EXCEPTION 'an invalid tier was % — the tier CHECK is not in force', v_e_ident; END IF;
  IF EXISTS (SELECT 1 FROM public.app_update_events) THEN
    RAISE EXCEPTION 'app_update_events probe rows survived the rollback';
  END IF;

  -- ── retention ────────────────────────────────────────────────────────────
  IF v_purge_fn IS NULL THEN
    RAISE EXCEPTION 'purge_app_update_events(interval) does not exist — the 90-day retention would never run';
  END IF;
  FOREACH v_role IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF has_function_privilege(v_role, v_purge_fn, 'EXECUTE') THEN
      RAISE EXCEPTION '% can EXECUTE purge_app_update_events — a client could wipe the counter', v_role;
    END IF;
  END LOOP;

  -- The JOB, derived from cron.job and PRINTED. A function nothing schedules is a retention
  -- policy that exists only on paper — which is exactly how a table quietly grows forever.
  SELECT count(*), max(command), max(schedule) INTO v_jobs, v_cmd, v_sched
    FROM cron.job WHERE jobname = 'purge-app-update-events';
  IF v_jobs IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'expected exactly 1 cron job named purge-app-update-events; found %', v_jobs;
  END IF;
  IF v_cmd NOT LIKE '%purge_app_update_events%' THEN
    RAISE EXCEPTION 'the cron job does not call purge_app_update_events; command is: %', v_cmd;
  END IF;
  IF v_sched IS DISTINCT FROM '33 3 * * *' THEN
    RAISE EXCEPTION 'purge-app-update-events schedule is %, expected 33 3 * * * (clear of the 03:17/03:23/03:27 purges)', v_sched;
  END IF;

  -- BEHAVIOUR: it must delete what is OLD and keep what is NOT. A purge asserted only by
  -- "it deleted something" passes just as well when it deletes everything.
  BEGIN
    INSERT INTO public.app_update_events (tier, platform, runtime_version) VALUES ('soft','ios','1.1.0');
    UPDATE public.app_update_events SET created_at = now() - interval '91 days';
    INSERT INTO public.app_update_events (tier, platform, runtime_version) VALUES ('soft','android','1.2.0');
    PERFORM public.purge_app_update_events();
    SELECT count(*) INTO v_kept   FROM public.app_update_events WHERE created_at > now() - interval '1 day';
    SELECT count(*) INTO v_purged FROM public.app_update_events WHERE created_at < now() - interval '90 days';
    RAISE EXCEPTION 'ZZ_PROBE_ROLLBACK';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM IS DISTINCT FROM 'ZZ_PROBE_ROLLBACK' THEN RAISE; END IF;
  END;
  IF v_purged IS DISTINCT FROM 0 THEN RAISE EXCEPTION 'a 91-day-old row survived the purge (% left)', v_purged; END IF;
  IF v_kept   IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'the purge also deleted a FRESH row (% kept, expected 1) — retention is destroying live data', v_kept; END IF;
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
VALUES ('20261051_app_versions.sql', '79dbc33c76b785e0b9d1fd3d18333f9bc943fcb3b9e23f056e916750e9edb138')
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
