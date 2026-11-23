-- ═══════════════════════════════════════════════════════════════════════════
-- 20261228 — Live Scores relaunch as TRNC football, from KTFF's official "Sitene Ekle" API
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Four NEW tables (ktff_leagues, ktff_standings, ktff_fixtures, ktff_sync_state), one gate function
-- (ktff_sync_due) and one cron job (live-scores-ktff). The old API-Sports tables, the six
-- live-scores-* jobs (paused by 20261090) and is_score_editor() are untouched.
--
-- ─── WHO CAN READ / WRITE ───────────────────────────────────────────────────
--   ktff_leagues, ktff_standings, ktff_fixtures
--     READ   anyone with the app: the anon role and every signed-in role, guests included. League tables and
--            fixtures are public sport data with no person in them. One policy each: SELECT ... USING (true).
--     WRITE  nobody through the API. There is no INSERT/UPDATE/DELETE policy, and the privileges are revoked
--            from anon and authenticated as well (a second lock). Only the live-scores-ktff Edge Function
--            writes, as service_role, which bypasses RLS.
--   ktff_sync_state
--     READ / WRITE  service_role only. RLS is on, there is NO policy, and every privilege is revoked from anon
--            and authenticated. It holds the ETag and back-off clock of the KTFF calls: nothing the app needs.
--   ktff_sync_due()
--     EXECUTE  the table owner (the cron job runs as postgres) and service_role only; revoked from PUBLIC,
--            anon and authenticated. SECURITY INVOKER on purpose: even if a grant ever slipped, a caller
--            would still need SELECT on ktff_sync_state, which no client role has.
--
-- ─── WHEN THE JOB CALLS THE FUNCTION (ktff_sync_due) ────────────────────────
--   The job wakes every 15 minutes (minutes 7,22,37,52, off the :00 peak) and POSTs ONLY WHEN DUE:
--     not backing off (no 'standings' state row, or now() >= its next_allowed_at)
--     AND (never succeeded, OR the last success is older than 6 hours, OR a match window is open).
--   A match window = a fixture whose kickoff_at is from 30 minutes before kickoff until 150 minutes after it.
--   So: a quiet day is 4 calls, a match day polls every 15 minutes only around the games. A 403 (the
--   approval of our Origin is pending) or a 429 moves next_allowed_at forward and the job goes silent.
--   The function ALSO obeys that clock, so a hand-made call cannot hammer KTFF either.
--
-- ─── KICKOFF TIME ZONE ──────────────────────────────────────────────────────
--   match_local is KTFF's wall-clock text ('YYYY-MM-DD HH:mm', TRNC time). kickoff_at is that instant, computed
--   by the Edge Function with the tz name Asia/Famagusta (EET/EEST: UTC+2 in winter, UTC+3 in summer). It is NOT a
--   fixed +03:00: northern Cyprus did not stay on UTC+3 in winter.
--
-- ─── PRECONDITION ───────────────────────────────────────────────────────────
--   Edge Function live-scores-ktff should be deployed before or right after this apply; until it is, the job's
--   POSTs fail (logged by pg_net, harmless). The Vault secret 'novest_sync_key' (the service key the other
--   jobs use) must exist: the DO block below asserts it BY NAME and never reads the value.
--
-- Apply: gh workflow run supabase-migrate -f file=20261228_live_scores_ktff.sql
-- ═══════════════════════════════════════════════════════════════════════════

SET ROLE postgres;

BEGIN;

SET LOCAL lock_timeout = '5s';

-- ─── 1. Tables ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ktff_leagues (
  league_id        int         NOT NULL,
  name_tr          text,
  name_en          text,
  logo_url         text,
  source_logo_url  text,
  available_weeks  int[]       NOT NULL DEFAULT '{}',
  current_week     int,
  legend           jsonb       NOT NULL DEFAULT '[]',
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ktff_leagues_pkey PRIMARY KEY (league_id),
  CONSTRAINT ktff_leagues_id_check CHECK (league_id IN (1, 2)),
  CONSTRAINT ktff_leagues_legend_check CHECK (jsonb_typeof(legend) = 'array'),
  CONSTRAINT ktff_leagues_logo_check CHECK (logo_url IS NULL
    OR logo_url ~ '^https://[a-z0-9]+\.supabase\.co/storage/v1/object/public/team-logos/[a-z0-9/_.-]+$'),
  CONSTRAINT ktff_leagues_source_logo_check CHECK (source_logo_url IS NULL OR source_logo_url ~ '^https://')
);

CREATE TABLE IF NOT EXISTS public.ktff_standings (
  league_id         int         NOT NULL,
  team_id           int         NOT NULL,
  rank              int,
  team_tr           text,
  team_en           text,
  logo_url          text,
  source_logo_url   text,
  played            int,
  won               int,
  drawn             int,
  lost              int,
  goals_for         int,
  goals_against     int,
  goal_difference   int,
  points            int,
  marker_id         int,
  marker_color      text,
  marker_text_color text,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ktff_standings_pkey PRIMARY KEY (league_id, team_id),
  CONSTRAINT ktff_standings_league_fkey FOREIGN KEY (league_id) REFERENCES public.ktff_leagues (league_id) ON DELETE CASCADE,
  CONSTRAINT ktff_standings_logo_check CHECK (logo_url IS NULL
    OR logo_url ~ '^https://[a-z0-9]+\.supabase\.co/storage/v1/object/public/team-logos/[a-z0-9/_.-]+$'),
  CONSTRAINT ktff_standings_source_logo_check CHECK (source_logo_url IS NULL OR source_logo_url ~ '^https://'),
  CONSTRAINT ktff_standings_marker_color_check CHECK (marker_color IS NULL OR marker_color ~ '^#[0-9A-Fa-f]{6}$'),
  CONSTRAINT ktff_standings_marker_text_color_check CHECK (marker_text_color IS NULL OR marker_text_color ~ '^#[0-9A-Fa-f]{6}$')
);

CREATE TABLE IF NOT EXISTS public.ktff_fixtures (
  match_id              int         NOT NULL,
  league_id             int         NOT NULL,
  week                  int         NOT NULL,
  home_team_tr          text,
  home_team_en          text,
  away_team_tr          text,
  away_team_en          text,
  home_logo_url         text,
  away_logo_url         text,
  home_source_logo_url  text,
  away_source_logo_url  text,
  home_score            text,
  away_score            text,
  match_local           text,
  kickoff_at            timestamptz,
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ktff_fixtures_pkey PRIMARY KEY (match_id),
  CONSTRAINT ktff_fixtures_league_fkey FOREIGN KEY (league_id) REFERENCES public.ktff_leagues (league_id) ON DELETE CASCADE,
  CONSTRAINT ktff_fixtures_home_logo_check CHECK (home_logo_url IS NULL
    OR home_logo_url ~ '^https://[a-z0-9]+\.supabase\.co/storage/v1/object/public/team-logos/[a-z0-9/_.-]+$'),
  CONSTRAINT ktff_fixtures_away_logo_check CHECK (away_logo_url IS NULL
    OR away_logo_url ~ '^https://[a-z0-9]+\.supabase\.co/storage/v1/object/public/team-logos/[a-z0-9/_.-]+$'),
  CONSTRAINT ktff_fixtures_home_source_logo_check CHECK (home_source_logo_url IS NULL OR home_source_logo_url ~ '^https://'),
  CONSTRAINT ktff_fixtures_away_source_logo_check CHECK (away_source_logo_url IS NULL OR away_source_logo_url ~ '^https://')
);

CREATE INDEX IF NOT EXISTS ktff_fixtures_league_week_idx ON public.ktff_fixtures (league_id, week);
CREATE INDEX IF NOT EXISTS ktff_fixtures_kickoff_idx     ON public.ktff_fixtures (kickoff_at);

CREATE TABLE IF NOT EXISTS public.ktff_sync_state (
  endpoint         text        NOT NULL,
  etag             text,
  last_status      int,
  last_attempt_at  timestamptz,
  last_success_at  timestamptz,
  next_allowed_at  timestamptz,
  fail_count       int         NOT NULL DEFAULT 0,
  CONSTRAINT ktff_sync_state_pkey PRIMARY KEY (endpoint),
  CONSTRAINT ktff_sync_state_endpoint_check CHECK (endpoint ~ '^(standings|fixtures:[12](:[0-9]{1,3})?)$'),
  CONSTRAINT ktff_sync_state_fail_count_check CHECK (fail_count >= 0)
);

COMMENT ON TABLE public.ktff_leagues IS
  'KTFF leagues 1 and 2 (20261228). Public read; written only by the live-scores-ktff Edge Function (service_role). logo_url = our copy in the public team-logos bucket (ktff/ prefix); source_logo_url = KTFF''s URL, read only by the sync.';
COMMENT ON TABLE public.ktff_standings IS
  'KTFF league table, one row per team (20261228). Public read; service_role writes. Rows for a league are replaced only when KTFF returns a non-empty table.';
COMMENT ON TABLE public.ktff_fixtures IS
  'KTFF fixtures and results by week (20261228). Public read; service_role writes. Empty score = not played (stored NULL). kickoff_at = match_local in Asia/Famagusta. Never deleted by the sync.';
COMMENT ON TABLE public.ktff_sync_state IS
  'ETag and back-off clock per KTFF endpoint (20261228). RLS on, NO policy, no client privilege: service_role only. The standings row is the global gate read by ktff_sync_due().';

-- ─── 2. RLS and privileges ──────────────────────────────────────────────────
ALTER TABLE public.ktff_leagues     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ktff_standings   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ktff_fixtures    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ktff_sync_state  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.ktff_leagues, public.ktff_standings, public.ktff_fixtures, public.ktff_sync_state
  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.ktff_leagues, public.ktff_standings, public.ktff_fixtures TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  public.ktff_leagues, public.ktff_standings, public.ktff_fixtures, public.ktff_sync_state TO service_role;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['ktff_leagues','ktff_standings','ktff_fixtures'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_select_public', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO anon, authenticated USING (true)', t || '_select_public', t);
  END LOOP;
END $$;

-- ─── 3. The gate ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ktff_sync_due()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  SELECT
    coalesce((SELECT now() >= coalesce(s.next_allowed_at, '-infinity'::timestamptz)
                FROM public.ktff_sync_state s WHERE s.endpoint = 'standings'), true)
    AND (
      coalesce((SELECT s.last_success_at IS NULL OR s.last_success_at < now() - interval '6 hours'
                  FROM public.ktff_sync_state s WHERE s.endpoint = 'standings'), true)
      OR EXISTS (SELECT 1 FROM public.ktff_fixtures f
                  WHERE f.kickoff_at >= now() - interval '150 minutes'
                    AND f.kickoff_at <= now() + interval '30 minutes')
    );
$$;

REVOKE ALL ON FUNCTION public.ktff_sync_due() FROM PUBLIC, anon, authenticated;

-- ─── 4. The job (every 15 minutes, POSTs only when due) and its registry row ─
DO $$
BEGIN
  IF (SELECT count(*) FROM vault.secrets WHERE name = 'novest_sync_key') IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'Vault secret novest_sync_key is missing — the job would POST without a key';
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'live-scores-ktff') THEN PERFORM cron.unschedule('live-scores-ktff'); END IF;
END $$;

SELECT cron.schedule('live-scores-ktff', '7,22,37,52 * * * *', $job$
  SELECT net.http_post(
    url     := 'https://jeihxnwqytnxtytgkzgf.supabase.co/functions/v1/live-scores-ktff',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' ||
                 (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'novest_sync_key')),
    body    := '{}'::jsonb,
    timeout_milliseconds := 120000)
  WHERE public.ktff_sync_due();
$job$);

-- Every cron job needs exactly one data_jobs row (20261205). expected_every NULL: the job is silent by design
-- while KTFF's approval is pending (403 back-off) and between match windows, so "stale" would be a false alarm.
INSERT INTO public.data_jobs (key, runner, kind, cron_jobnames, schedule_note, expected_every, sort) VALUES
  ('live-scores-ktff', 'cron_http', 'feed', ARRAY['live-scores-ktff'], NULL, NULL, 26)
ON CONFLICT (key) DO NOTHING;

-- ─── 5. Assertions. Each derives what it checks and prints what it read. ────
DO $$
DECLARE
  t        text;
  v_n      int;
  v_names  text;
  v_bad    text;
BEGIN
  -- RLS on, all four.
  SELECT count(*), string_agg(c.relname, ', ' ORDER BY c.relname) INTO v_n, v_names
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relrowsecurity
     AND c.relname IN ('ktff_leagues','ktff_standings','ktff_fixtures','ktff_sync_state');
  IF v_n IS DISTINCT FROM 4 THEN RAISE EXCEPTION 'RLS is on for % of 4 ktff tables: %', v_n, v_names; END IF;
  RAISE NOTICE 'RLS on: %', v_names;

  -- The FULL policy set reaching these tables (RLS is permissive-OR: mine proves nothing about theirs).
  SELECT count(*), string_agg(tablename || '.' || policyname || '[' || cmd || ' ' || roles::text || ' ' || coalesce(qual, '-') || ']', '; ' ORDER BY tablename)
    INTO v_n, v_names
    FROM pg_policies WHERE schemaname = 'public'
     AND tablename IN ('ktff_leagues','ktff_standings','ktff_fixtures','ktff_sync_state');
  IF v_n IS DISTINCT FROM 3 THEN RAISE EXCEPTION 'ktff tables carry % policies, expected exactly 3: %', v_n, v_names; END IF;
  RAISE NOTICE 'policies (%): %', v_n, v_names;

  FOREACH t IN ARRAY ARRAY['ktff_leagues','ktff_standings','ktff_fixtures'] LOOP
    IF (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = t
          AND policyname = t || '_select_public' AND cmd = 'SELECT' AND permissive = 'PERMISSIVE'
          AND roles::text[] @> ARRAY['anon','authenticated'] AND cardinality(roles) = 2 AND qual = 'true') IS DISTINCT FROM 1 THEN
      RAISE EXCEPTION '% is not exactly one permissive SELECT policy for anon + authenticated USING (true)', t;
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'ktff_sync_state') THEN
    RAISE EXCEPTION 'ktff_sync_state must have no policy';
  END IF;

  -- Grants. Denials are asserted beside their positive control (the legitimate path still works).
  FOREACH t IN ARRAY ARRAY['ktff_leagues','ktff_standings','ktff_fixtures'] LOOP
    IF NOT (has_table_privilege('anon', 'public.' || t, 'SELECT') AND has_table_privilege('authenticated', 'public.' || t, 'SELECT')) THEN
      RAISE EXCEPTION 'positive control: anon/authenticated cannot SELECT %', t;
    END IF;
  END LOOP;
  SELECT string_agg(gr.n || ':' || tb.n || ':' || pr.n, ', ') INTO v_bad
    FROM unnest(ARRAY['anon','authenticated']) gr(n),
         unnest(ARRAY['ktff_leagues','ktff_standings','ktff_fixtures','ktff_sync_state']) tb(n),
         unnest(ARRAY['INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) pr(n)
   WHERE has_table_privilege(gr.n, 'public.' || tb.n, pr.n);
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'client role holds a write-class privilege: %', v_bad; END IF;
  SELECT string_agg(gr.n, ', ') INTO v_bad FROM unnest(ARRAY['anon','authenticated']) gr(n)
   WHERE has_table_privilege(gr.n, 'public.ktff_sync_state', 'SELECT')
      OR EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.ktff_sync_state'::regclass AND a.attnum > 0
                   AND NOT a.attisdropped AND has_column_privilege(gr.n, a.attrelid, a.attnum, 'SELECT,INSERT,UPDATE,REFERENCES'));
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'ktff_sync_state readable or writable by: %', v_bad; END IF;
  FOREACH t IN ARRAY ARRAY['ktff_leagues','ktff_standings','ktff_fixtures','ktff_sync_state'] LOOP
    IF NOT has_table_privilege('service_role', 'public.' || t, 'SELECT,INSERT,UPDATE,DELETE') THEN
      RAISE EXCEPTION 'positive control: service_role cannot write %', t;
    END IF;
  END LOOP;

  -- ktff_sync_due(): invoker, pinned search_path, no client EXECUTE.
  IF NOT COALESCE((SELECT NOT p.prosecdef AND p.proconfig IS NOT NULL
                     FROM pg_proc p WHERE p.oid = to_regprocedure('public.ktff_sync_due()')), false) THEN
    RAISE EXCEPTION 'ktff_sync_due is missing, DEFINER, or has no pinned search_path';
  END IF;
  IF has_function_privilege('anon', 'public.ktff_sync_due()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.ktff_sync_due()', 'EXECUTE') THEN
    RAISE EXCEPTION 'ktff_sync_due is executable by a client role';
  END IF;
  IF NOT has_function_privilege('service_role', 'public.ktff_sync_due()', 'EXECUTE') THEN
    RAISE EXCEPTION 'positive control: service_role cannot execute ktff_sync_due';
  END IF;

  -- The job: one active job, exact schedule, Vault key by name, no inline JWT, gated by the function.
  SELECT count(*) INTO v_n FROM cron.job WHERE jobname = 'live-scores-ktff' AND active
     AND schedule = '7,22,37,52 * * * *'
     AND command LIKE '%/functions/v1/live-scores-ktff%'
     AND command LIKE '%vault.decrypted_secrets WHERE name = ''novest_sync_key''%'
     AND command LIKE '%WHERE public.ktff_sync_due()%'
     AND command NOT LIKE '%eyJ%' AND command NOT LIKE '%sb_secret%';
  IF v_n IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'live-scores-ktff is not exactly one active, gated, Vault-keyed job'; END IF;
  SELECT string_agg(jobname || '@' || schedule || CASE WHEN active THEN '' ELSE ' (inactive)' END, ', ' ORDER BY jobname) INTO v_names
    FROM cron.job WHERE jobname LIKE 'live-scores-%';
  RAISE NOTICE 'live-scores cron jobs: %', v_names;

  -- Registry: exactly one data_jobs row covers it (QUERY 2 of verify_schema asserts this for every job).
  IF (SELECT count(*) FROM public.data_jobs d WHERE 'live-scores-ktff' = ANY (d.cron_jobnames)) IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'live-scores-ktff is not covered by exactly one data_jobs row';
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
VALUES ('20261228_live_scores_ktff.sql', '6d01a562430e9528e12acefdf9b424438806371303cbf0facbb3760fb136b403')
ON CONFLICT (filename) DO UPDATE
  SET checksum = excluded.checksum, applied_at = now(), applied_by = current_user;
-- ─── ledger:stamp:end ────────────────────────────────────────────────
COMMIT;
RESET ROLE;
NOTIFY pgrst, 'reload schema';
