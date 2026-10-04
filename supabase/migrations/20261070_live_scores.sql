-- ═══════════════════════════════════════════════════════════════════════════
-- 20261070 — Live Scores: football, basketball, F1 (+ manual TRNC football), DARK
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Data sources (measured 2026-10-03, API-Sports FREE plan, one key, 100 req/day PER SPORT):
--   • football / basketball: API-Sports. `date=` works for yesterday/today/tomorrow only;
--     `season=`, `next=` and `ids=` are refused by the plan; basketball has no `live=`;
--     the `timezone=` param is ignored on date queries (responses stay UTC). So: no
--     standings, and every sync is keyed on UTC dates.
--   • KTFF (TRNC football) is NOT in API-Sports (`search=KTFF` → 0; `country=Cyprus` is the
--     Republic's CFA). TRNC football is entered by hand: source = 'manual'.
--   • F1: calendar/results/standings source is pending a licence question (see the PR);
--     the f1_* tables are source-agnostic.
-- Sync: supabase/functions/live-scores-* (service_role). Schedule: live-scores/schedule.sql.
-- The app reads these tables and Realtime only; it never calls a sports API.
--
-- ─── WHO CAN READ / WRITE ───────────────────────────────────────────────────
--   • READ (anon, signed-in, guest): leagues, teams, matches, match_events, f1_races,
--     f1_results, f1_standings — every row. Public sports facts; nothing personal.
--   • WRITE, sync: service_role only (BYPASSRLS) — every table.
--   • WRITE, score editors: a signed-in, NON-GUEST user who is an admin or has a row in
--     live_score_editors may
--       - INSERT/UPDATE football teams with source = 'manual';
--       - INSERT/UPDATE/DELETE matches with source = 'manual' whose LEAGUE is a manual
--         league and whose two teams are manual teams (so an editor can never place a row
--         among Premier League fixtures, nor rewrite an API row);
--       - INSERT/DELETE match_events on such a match.
--     Nothing else. No client writes leagues, f1_*, or any sync bookkeeping.
--   • live_score_editors: a user can read only their OWN row (so the app can show the
--     editor button); rows are added by an admin in the SQL editor. No client writes.
--   • api_quota_log, api_request_log, live_sync_state: no client access at all.
--
-- ─── WHY A TABLE, NOT profiles.role = 'score_editor' ────────────────────────
-- profiles.role is single-valued and drives App.js's role-first screen selector: a
-- 'score_editor' role would stop that user being a customer. An editor is a customer who
-- may also do one more thing, which is a membership, i.e. a row.
--
-- ─── THE QUOTA FENCE ────────────────────────────────────────────────────────
-- claim_api_request(sport) is the ONLY way the sync may spend a request: an atomic
-- upsert on (UTC day, sport) that refuses past 90. API-Sports resets at 00:00 UTC. Its
-- own /status counter read 0 after eight real calls on 2026-10-03, so it is not the
-- authority; this table is. The CHECK (requests_used <= 90) is the second fence.
--
-- Apply: gh workflow run supabase-migrate -f file=20261070_live_scores.sql (dry), then
-- -f apply=true. New tables ⇒ ends with NOTIFY pgrst (after COMMIT).
-- ═══════════════════════════════════════════════════════════════════════════

SET ROLE postgres;

BEGIN;

SET LOCAL lock_timeout = '5s';

-- ─── leagues ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.leagues (
  id           bigint      GENERATED ALWAYS AS IDENTITY,
  sport        text        NOT NULL,
  name         text        NOT NULL,
  country      text,
  logo_url     text,
  source       text        NOT NULL,
  external_id  text,
  sort_order   int         NOT NULL DEFAULT 100,
  enabled      boolean     NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT leagues_pkey PRIMARY KEY (id)
);
-- Add-if-missing, not drop-then-add: the matches composite FK depends on it, so a re-run
-- could not drop it.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'leagues_id_sport_key') THEN
    ALTER TABLE public.leagues ADD CONSTRAINT leagues_id_sport_key UNIQUE (id, sport);
  END IF;
END $$;
ALTER TABLE public.leagues DROP CONSTRAINT IF EXISTS leagues_external_key;
ALTER TABLE public.leagues ADD  CONSTRAINT leagues_external_key UNIQUE (sport, source, external_id);
ALTER TABLE public.leagues DROP CONSTRAINT IF EXISTS leagues_sport_check;
ALTER TABLE public.leagues ADD  CONSTRAINT leagues_sport_check CHECK (sport IN ('football','basketball','f1'));
ALTER TABLE public.leagues DROP CONSTRAINT IF EXISTS leagues_source_check;
ALTER TABLE public.leagues ADD  CONSTRAINT leagues_source_check
  CHECK ((source = 'api' AND external_id IS NOT NULL) OR (source = 'manual' AND external_id IS NULL));
ALTER TABLE public.leagues DROP CONSTRAINT IF EXISTS leagues_name_check;
ALTER TABLE public.leagues ADD  CONSTRAINT leagues_name_check CHECK (length(btrim(name)) BETWEEN 1 AND 80);

-- ─── teams ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.teams (
  id           bigint      GENERATED ALWAYS AS IDENTITY,
  sport        text        NOT NULL,
  name         text        NOT NULL,
  short_name   text,
  logo_url     text,
  source       text        NOT NULL,
  external_id  text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT teams_pkey PRIMARY KEY (id)
);
-- Add-if-missing, not drop-then-add: the matches composite FK depends on it, so a re-run
-- could not drop it.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'teams_id_sport_key') THEN
    ALTER TABLE public.teams ADD CONSTRAINT teams_id_sport_key UNIQUE (id, sport);
  END IF;
END $$;
ALTER TABLE public.teams DROP CONSTRAINT IF EXISTS teams_external_key;
ALTER TABLE public.teams ADD  CONSTRAINT teams_external_key UNIQUE (sport, source, external_id);
ALTER TABLE public.teams DROP CONSTRAINT IF EXISTS teams_sport_check;
ALTER TABLE public.teams ADD  CONSTRAINT teams_sport_check CHECK (sport IN ('football','basketball'));
ALTER TABLE public.teams DROP CONSTRAINT IF EXISTS teams_source_check;
ALTER TABLE public.teams ADD  CONSTRAINT teams_source_check
  CHECK ((source = 'api' AND external_id IS NOT NULL) OR (source = 'manual' AND external_id IS NULL));
ALTER TABLE public.teams DROP CONSTRAINT IF EXISTS teams_name_check;
ALTER TABLE public.teams ADD  CONSTRAINT teams_name_check
  CHECK (length(btrim(name)) BETWEEN 1 AND 80 AND (short_name IS NULL OR length(btrim(short_name)) BETWEEN 1 AND 12));
ALTER TABLE public.teams DROP CONSTRAINT IF EXISTS teams_logo_check;
ALTER TABLE public.teams ADD  CONSTRAINT teams_logo_check CHECK (logo_url IS NULL OR logo_url ~ '^https://');

-- ─── matches ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.matches (
  id              bigint      GENERATED ALWAYS AS IDENTITY,
  sport           text        NOT NULL,
  league_id       bigint      NOT NULL,
  home_team_id    bigint      NOT NULL,
  away_team_id    bigint      NOT NULL,
  home_score      int,
  away_score      int,
  period          text,
  minute          int,
  clock           text,
  status          text        NOT NULL DEFAULT 'scheduled',
  kickoff_at      timestamptz NOT NULL,
  source          text        NOT NULL,
  external_id     text,
  last_synced_at  timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT matches_pkey PRIMARY KEY (id)
);
-- Composite FKs: a match's sport must equal its league's and both teams' sport.
ALTER TABLE public.matches DROP CONSTRAINT IF EXISTS matches_league_fkey;
ALTER TABLE public.matches ADD  CONSTRAINT matches_league_fkey
  FOREIGN KEY (league_id, sport) REFERENCES public.leagues (id, sport) ON DELETE CASCADE;
ALTER TABLE public.matches DROP CONSTRAINT IF EXISTS matches_home_team_fkey;
ALTER TABLE public.matches ADD  CONSTRAINT matches_home_team_fkey
  FOREIGN KEY (home_team_id, sport) REFERENCES public.teams (id, sport) ON DELETE CASCADE;
ALTER TABLE public.matches DROP CONSTRAINT IF EXISTS matches_away_team_fkey;
ALTER TABLE public.matches ADD  CONSTRAINT matches_away_team_fkey
  FOREIGN KEY (away_team_id, sport) REFERENCES public.teams (id, sport) ON DELETE CASCADE;
ALTER TABLE public.matches DROP CONSTRAINT IF EXISTS matches_external_key;
ALTER TABLE public.matches ADD  CONSTRAINT matches_external_key UNIQUE (sport, source, external_id);
ALTER TABLE public.matches DROP CONSTRAINT IF EXISTS matches_sport_check;
ALTER TABLE public.matches ADD  CONSTRAINT matches_sport_check CHECK (sport IN ('football','basketball'));
ALTER TABLE public.matches DROP CONSTRAINT IF EXISTS matches_source_check;
ALTER TABLE public.matches ADD  CONSTRAINT matches_source_check
  CHECK ((source = 'api' AND external_id IS NOT NULL) OR (source = 'manual' AND external_id IS NULL));
-- 'ht' is football half-time AND basketball half-time (API-Sports uses HT for both).
ALTER TABLE public.matches DROP CONSTRAINT IF EXISTS matches_status_check;
ALTER TABLE public.matches ADD  CONSTRAINT matches_status_check
  CHECK (status IN ('scheduled','live','ht','ft','postponed','cancelled','suspended'));
ALTER TABLE public.matches DROP CONSTRAINT IF EXISTS matches_teams_check;
ALTER TABLE public.matches ADD  CONSTRAINT matches_teams_check CHECK (home_team_id <> away_team_id);
ALTER TABLE public.matches DROP CONSTRAINT IF EXISTS matches_score_check;
ALTER TABLE public.matches ADD  CONSTRAINT matches_score_check
  CHECK ((home_score IS NULL OR home_score BETWEEN 0 AND 300) AND (away_score IS NULL OR away_score BETWEEN 0 AND 300)
         AND (minute IS NULL OR minute BETWEEN 0 AND 200)
         AND (period IS NULL OR length(period) <= 8) AND (clock IS NULL OR length(clock) <= 8));

CREATE INDEX IF NOT EXISTS matches_kickoff_idx ON public.matches (sport, kickoff_at);
CREATE INDEX IF NOT EXISTS matches_league_idx  ON public.matches (league_id, kickoff_at);

-- ─── match_events (goals and cards) ─────────────────────────────────────────
-- API events carry no id, so the sync keys them on a content hash (dedupe_key) and upserts:
-- a delete-and-reinsert every poll would fire a Realtime storm. Manual rows get a uuid.
CREATE TABLE IF NOT EXISTS public.match_events (
  id            bigint      GENERATED ALWAYS AS IDENTITY,
  match_id      bigint      NOT NULL REFERENCES public.matches (id) ON DELETE CASCADE,
  type          text        NOT NULL,
  team_side     text        NOT NULL,
  player_name   text,
  minute        int,
  extra_minute  int,
  dedupe_key    text        NOT NULL DEFAULT gen_random_uuid()::text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT match_events_pkey PRIMARY KEY (id)
);
ALTER TABLE public.match_events DROP CONSTRAINT IF EXISTS match_events_dedupe_key;
ALTER TABLE public.match_events ADD  CONSTRAINT match_events_dedupe_key UNIQUE (match_id, dedupe_key);
ALTER TABLE public.match_events DROP CONSTRAINT IF EXISTS match_events_type_check;
ALTER TABLE public.match_events ADD  CONSTRAINT match_events_type_check
  CHECK (type IN ('goal','own_goal','penalty','missed_penalty','yellow','red'));
ALTER TABLE public.match_events DROP CONSTRAINT IF EXISTS match_events_side_check;
ALTER TABLE public.match_events ADD  CONSTRAINT match_events_side_check CHECK (team_side IN ('home','away'));
ALTER TABLE public.match_events DROP CONSTRAINT IF EXISTS match_events_values_check;
ALTER TABLE public.match_events ADD  CONSTRAINT match_events_values_check
  CHECK ((player_name IS NULL OR length(btrim(player_name)) BETWEEN 1 AND 80)
         AND (minute IS NULL OR minute BETWEEN 0 AND 200) AND (extra_minute IS NULL OR extra_minute BETWEEN 0 AND 30));

-- ─── F1 (source-agnostic) ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.f1_races (
  id              bigint      GENERATED ALWAYS AS IDENTITY,
  season          int         NOT NULL,
  round           int         NOT NULL,
  name            text        NOT NULL,
  circuit         text,
  locality        text,
  country         text,
  race_at         timestamptz NOT NULL,
  quali_at        timestamptz,
  sprint_at       timestamptz,
  status          text        NOT NULL DEFAULT 'scheduled',
  api_race_id     int,
  results_final   boolean     NOT NULL DEFAULT false,
  last_synced_at  timestamptz,
  CONSTRAINT f1_races_pkey PRIMARY KEY (id)
);
ALTER TABLE public.f1_races DROP CONSTRAINT IF EXISTS f1_races_season_round_key;
ALTER TABLE public.f1_races ADD  CONSTRAINT f1_races_season_round_key UNIQUE (season, round);
ALTER TABLE public.f1_races DROP CONSTRAINT IF EXISTS f1_races_status_check;
ALTER TABLE public.f1_races ADD  CONSTRAINT f1_races_status_check
  CHECK (status IN ('scheduled','live','finished','cancelled'));

CREATE TABLE IF NOT EXISTS public.f1_results (
  id            bigint      GENERATED ALWAYS AS IDENTITY,
  race_id       bigint      NOT NULL REFERENCES public.f1_races (id) ON DELETE CASCADE,
  position      int,
  driver_name   text        NOT NULL,
  driver_code   text,
  team          text,
  points        numeric(5,1),
  laps          int,
  time_text     text,
  status_text   text,
  grid          int,
  is_final      boolean     NOT NULL DEFAULT false,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT f1_results_pkey PRIMARY KEY (id)
);
ALTER TABLE public.f1_results DROP CONSTRAINT IF EXISTS f1_results_race_driver_key;
ALTER TABLE public.f1_results ADD  CONSTRAINT f1_results_race_driver_key UNIQUE (race_id, driver_name);

CREATE TABLE IF NOT EXISTS public.f1_standings (
  season       int          NOT NULL,
  kind         text         NOT NULL,
  name         text         NOT NULL,
  position     int          NOT NULL,
  code         text,
  team         text,
  points       numeric(6,1) NOT NULL DEFAULT 0,
  wins         int          NOT NULL DEFAULT 0,
  after_round  int,
  updated_at   timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT f1_standings_pkey PRIMARY KEY (season, kind, name)
);
ALTER TABLE public.f1_standings DROP CONSTRAINT IF EXISTS f1_standings_kind_check;
ALTER TABLE public.f1_standings ADD  CONSTRAINT f1_standings_kind_check CHECK (kind IN ('driver','constructor'));

-- ─── Sync bookkeeping ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.api_quota_log (
  day            date        NOT NULL,
  sport          text        NOT NULL,
  requests_used  int         NOT NULL DEFAULT 0,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT api_quota_log_pkey PRIMARY KEY (day, sport)
);
ALTER TABLE public.api_quota_log DROP CONSTRAINT IF EXISTS api_quota_log_sport_check;
ALTER TABLE public.api_quota_log ADD  CONSTRAINT api_quota_log_sport_check CHECK (sport IN ('football','basketball','f1'));
ALTER TABLE public.api_quota_log DROP CONSTRAINT IF EXISTS api_quota_log_cap_check;
ALTER TABLE public.api_quota_log ADD  CONSTRAINT api_quota_log_cap_check CHECK (requests_used BETWEEN 0 AND 90);

-- One row per outbound request, any provider. The daily run purges rows older than 30 days.
CREATE TABLE IF NOT EXISTS public.api_request_log (
  id           bigint      GENERATED ALWAYS AS IDENTITY,
  at           timestamptz NOT NULL DEFAULT now(),
  sport        text        NOT NULL,
  provider     text        NOT NULL,
  endpoint     text        NOT NULL,
  http_status  int,
  results      int,
  error        text,
  CONSTRAINT api_request_log_pkey PRIMARY KEY (id)
);
CREATE INDEX IF NOT EXISTS api_request_log_at_idx ON public.api_request_log (at);

-- next_poll_at is the cron's lease: the minute job advances it atomically before it POSTs.
CREATE TABLE IF NOT EXISTS public.live_sync_state (
  sport          text        NOT NULL,
  next_poll_at   timestamptz NOT NULL DEFAULT now(),
  last_run_at    timestamptz,
  last_daily_on  date,
  last_error     text,
  CONSTRAINT live_sync_state_pkey PRIMARY KEY (sport)
);
ALTER TABLE public.live_sync_state DROP CONSTRAINT IF EXISTS live_sync_state_sport_check;
ALTER TABLE public.live_sync_state ADD  CONSTRAINT live_sync_state_sport_check CHECK (sport IN ('football','basketball','f1'));

CREATE TABLE IF NOT EXISTS public.live_score_editors (
  user_id   uuid        NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  added_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT live_score_editors_pkey PRIMARY KEY (user_id)
);

-- ─── Functions ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.matches_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS matches_touch_updated_at ON public.matches;
CREATE TRIGGER matches_touch_updated_at
  BEFORE UPDATE ON public.matches
  FOR EACH ROW EXECUTE FUNCTION public.matches_touch_updated_at();

-- Guests are never editors, even if a row exists for them.
CREATE OR REPLACE FUNCTION public.is_score_editor()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT NOT public.is_anonymous_session()
     AND auth.uid() IS NOT NULL
     AND (public.is_admin()
          OR EXISTS (SELECT 1 FROM public.live_score_editors e WHERE e.user_id = auth.uid()))
$$;

CREATE OR REPLACE FUNCTION public.claim_api_request(p_sport text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_ok boolean;
BEGIN
  INSERT INTO public.api_quota_log AS q (day, sport, requests_used)
  VALUES ((now() AT TIME ZONE 'UTC')::date, p_sport, 1)
  ON CONFLICT (day, sport) DO UPDATE
    SET requests_used = q.requests_used + 1, updated_at = now()
    WHERE q.requests_used < 90
  RETURNING true INTO v_ok;
  RETURN coalesce(v_ok, false);
END $$;

-- ─── RLS, grants, policies ──────────────────────────────────────────────────
ALTER TABLE public.leagues            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.teams              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.matches            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.match_events       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.f1_races           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.f1_results         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.f1_standings       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.api_quota_log      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.api_request_log    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.live_sync_state    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.live_score_editors ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.leagues, public.teams, public.matches, public.match_events,
                    public.f1_races, public.f1_results, public.f1_standings,
                    public.api_quota_log, public.api_request_log, public.live_sync_state,
                    public.live_score_editors
  FROM anon, authenticated;
GRANT SELECT ON TABLE public.leagues, public.teams, public.matches, public.match_events,
                      public.f1_races, public.f1_results, public.f1_standings
  TO anon, authenticated;
GRANT INSERT, UPDATE         ON TABLE public.teams        TO authenticated;
GRANT INSERT, UPDATE, DELETE ON TABLE public.matches      TO authenticated;
GRANT INSERT, DELETE         ON TABLE public.match_events TO authenticated;
GRANT SELECT                 ON TABLE public.live_score_editors TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  public.leagues, public.teams, public.matches, public.match_events,
  public.f1_races, public.f1_results, public.f1_standings,
  public.api_quota_log, public.api_request_log, public.live_sync_state, public.live_score_editors
  TO service_role;

REVOKE ALL ON FUNCTION public.matches_touch_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.is_score_editor()          FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_score_editor()       TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.claim_api_request(text)    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_api_request(text) TO service_role;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['leagues','teams','matches','match_events','f1_races','f1_results','f1_standings'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_select_public', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO anon, authenticated USING (true)', t || '_select_public', t);
  END LOOP;
END $$;

DROP POLICY IF EXISTS teams_editor_insert ON public.teams;
CREATE POLICY teams_editor_insert ON public.teams
  FOR INSERT TO authenticated
  WITH CHECK (source = 'manual' AND sport = 'football' AND public.is_score_editor());
DROP POLICY IF EXISTS teams_editor_update ON public.teams;
CREATE POLICY teams_editor_update ON public.teams
  FOR UPDATE TO authenticated
  USING      (source = 'manual' AND public.is_score_editor())
  WITH CHECK (source = 'manual' AND sport = 'football' AND public.is_score_editor());

-- The manual-match predicate, written out in each policy (a policy cannot call a shared
-- expression, and a DEFINER helper would hide the subquery from the planner).
DROP POLICY IF EXISTS matches_editor_insert ON public.matches;
CREATE POLICY matches_editor_insert ON public.matches
  FOR INSERT TO authenticated
  WITH CHECK (source = 'manual' AND public.is_score_editor()
    AND EXISTS (SELECT 1 FROM public.leagues l WHERE l.id = league_id AND l.source = 'manual')
    AND EXISTS (SELECT 1 FROM public.teams h WHERE h.id = home_team_id AND h.source = 'manual')
    AND EXISTS (SELECT 1 FROM public.teams a WHERE a.id = away_team_id AND a.source = 'manual'));
DROP POLICY IF EXISTS matches_editor_update ON public.matches;
CREATE POLICY matches_editor_update ON public.matches
  FOR UPDATE TO authenticated
  USING (source = 'manual' AND public.is_score_editor())
  WITH CHECK (source = 'manual' AND public.is_score_editor()
    AND EXISTS (SELECT 1 FROM public.leagues l WHERE l.id = league_id AND l.source = 'manual')
    AND EXISTS (SELECT 1 FROM public.teams h WHERE h.id = home_team_id AND h.source = 'manual')
    AND EXISTS (SELECT 1 FROM public.teams a WHERE a.id = away_team_id AND a.source = 'manual'));
DROP POLICY IF EXISTS matches_editor_delete ON public.matches;
CREATE POLICY matches_editor_delete ON public.matches
  FOR DELETE TO authenticated
  USING (source = 'manual' AND public.is_score_editor());

DROP POLICY IF EXISTS match_events_editor_insert ON public.match_events;
CREATE POLICY match_events_editor_insert ON public.match_events
  FOR INSERT TO authenticated
  WITH CHECK (public.is_score_editor()
    AND EXISTS (SELECT 1 FROM public.matches m WHERE m.id = match_id AND m.source = 'manual'));
DROP POLICY IF EXISTS match_events_editor_delete ON public.match_events;
CREATE POLICY match_events_editor_delete ON public.match_events
  FOR DELETE TO authenticated
  USING (public.is_score_editor()
    AND EXISTS (SELECT 1 FROM public.matches m WHERE m.id = match_id AND m.source = 'manual'));

DROP POLICY IF EXISTS live_score_editors_select_own ON public.live_score_editors;
CREATE POLICY live_score_editors_select_own ON public.live_score_editors
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- ─── Realtime ───────────────────────────────────────────────────────────────
DO $$
DECLARE t text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    RAISE EXCEPTION 'publication supabase_realtime does not exist — Realtime is not set up on this database';
  END IF;
  FOREACH t IN ARRAY ARRAY['matches','match_events','f1_results'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables
                    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
END $$;

-- ─── Seed ───────────────────────────────────────────────────────────────────
-- IDs read from API-Sports /leagues on 2026-10-03; each listed a current season.
INSERT INTO public.leagues (sport, name, country, source, external_id, sort_order, enabled) VALUES
  ('football',   'Süper Lig',             'Turkey',  'api', '203', 10, true),
  ('football',   'UEFA Champions League', 'Europe',  'api', '2',   20, true),
  ('football',   'Premier League',        'England', 'api', '39',  30, true),
  ('football',   'La Liga',               'Spain',   'api', '140', 40, true),
  ('football',   'Serie A',               'Italy',   'api', '135', 50, true),
  ('football',   'Bundesliga',            'Germany', 'api', '78',  60, true),
  ('football',   'Ligue 1',               'France',  'api', '61',  70, true),
  ('basketball', 'Basketbol Süper Ligi',  'Turkey',  'api', '104', 10, true),
  ('basketball', 'EuroLeague',            'Europe',  'api', '120', 20, true),
  ('basketball', 'NBA',                   'USA',     'api', '12',  30, true)
ON CONFLICT (sport, source, external_id) DO NOTHING;

-- external_id is NULL for manual rows, so ON CONFLICT cannot see a duplicate: NOT EXISTS.
INSERT INTO public.leagues (sport, name, country, source, external_id, sort_order, enabled)
SELECT 'football', 'KTFF Süper Lig', 'TRNC', 'manual', NULL, 0, true
WHERE NOT EXISTS (SELECT 1 FROM public.leagues WHERE source = 'manual' AND name = 'KTFF Süper Lig');

INSERT INTO public.live_sync_state (sport) VALUES ('football'), ('basketball'), ('f1')
ON CONFLICT (sport) DO NOTHING;

COMMENT ON TABLE public.matches IS
  'Live Scores fixtures. source=api rows are written by the live-scores-* Edge Functions only; '
  'source=manual rows (KTFF) by score editors. Public read. See 20261070_live_scores.sql.';
COMMENT ON FUNCTION public.claim_api_request(text) IS
  'Spend one API-Sports request for (UTC day, sport). Returns false past 90 — the hard stop. service_role only.';

-- ─── Assertions. Each derives what it checks and prints what it read. ───────
DO $$
DECLARE
  v_t      text;
  v_n      int;
  v_names  text;
  v_role   text;
  v_priv   text;
  v_pub    text;
  v_editor uuid;
  v_kt     bigint;
  v_pl     bigint;
  v_h      bigint;
  v_a      bigint;
  v_ah     bigint;
  v_aa     bigint;
  v_m      bigint;
  v_i      int;
  v_claims int := 0;
  v_91st   boolean;
  v_anon_read     int := -1;
  v_anon_write    text := 'unset';
  v_guest_write   text := 'unset';
  v_plain_write   text := 'unset';
  v_editor_write  text := 'unset';
  v_editor_api    text := 'unset';
  v_editor_upd_api text := 'unset';
  v_editor_event  text := 'unset';
  v_editor_quota  text := 'unset';
  v_bad_status    text := 'unset';
  v_bad_sport     text := 'unset';
  v_service_api   text := 'unset';
BEGIN
  -- RLS on everywhere.
  SELECT string_agg(c.relname, ', ') INTO v_names
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND NOT c.relrowsecurity
     AND c.relname IN ('leagues','teams','matches','match_events','f1_races','f1_results','f1_standings',
                       'api_quota_log','api_request_log','live_sync_state','live_score_editors');
  IF v_names IS NOT NULL THEN RAISE EXCEPTION 'RLS is OFF on: %', v_names; END IF;

  -- The FULL policy set on the eleven tables, as one exact string. Permissive-OR: any
  -- policy beyond these, whoever wrote it, widens access.
  SELECT count(*), string_agg(tablename || '.' || policyname || ':' || cmd || ':' || permissive, ', '
                              ORDER BY tablename, policyname)
    INTO v_n, v_names
    FROM pg_policies
   WHERE schemaname = 'public'
     AND tablename IN ('leagues','teams','matches','match_events','f1_races','f1_results','f1_standings',
                       'api_quota_log','api_request_log','live_sync_state','live_score_editors');
  IF v_names IS DISTINCT FROM
       'f1_races.f1_races_select_public:SELECT:PERMISSIVE, '
    || 'f1_results.f1_results_select_public:SELECT:PERMISSIVE, '
    || 'f1_standings.f1_standings_select_public:SELECT:PERMISSIVE, '
    || 'leagues.leagues_select_public:SELECT:PERMISSIVE, '
    || 'live_score_editors.live_score_editors_select_own:SELECT:PERMISSIVE, '
    || 'match_events.match_events_editor_delete:DELETE:PERMISSIVE, '
    || 'match_events.match_events_editor_insert:INSERT:PERMISSIVE, '
    || 'match_events.match_events_select_public:SELECT:PERMISSIVE, '
    || 'matches.matches_editor_delete:DELETE:PERMISSIVE, '
    || 'matches.matches_editor_insert:INSERT:PERMISSIVE, '
    || 'matches.matches_editor_update:UPDATE:PERMISSIVE, '
    || 'matches.matches_select_public:SELECT:PERMISSIVE, '
    || 'teams.teams_editor_insert:INSERT:PERMISSIVE, '
    || 'teams.teams_editor_update:UPDATE:PERMISSIVE, '
    || 'teams.teams_select_public:SELECT:PERMISSIVE' THEN
    RAISE EXCEPTION 'live-scores policy set is not the expected 15. Found %: %', v_n, v_names;
  END IF;

  -- Privileges: anon reads the public seven and writes nothing; the bookkeeping tables are
  -- invisible to both client roles; service_role can write all eleven.
  FOREACH v_t IN ARRAY ARRAY['leagues','teams','matches','match_events','f1_races','f1_results','f1_standings'] LOOP
    FOREACH v_role IN ARRAY ARRAY['anon','authenticated'] LOOP
      IF NOT has_table_privilege(v_role, 'public.' || v_t, 'SELECT') THEN
        RAISE EXCEPTION '% cannot SELECT % — the public read would fail', v_role, v_t;
      END IF;
    END LOOP;
    FOREACH v_priv IN ARRAY ARRAY['INSERT','UPDATE','DELETE','TRUNCATE'] LOOP
      IF has_table_privilege('anon', 'public.' || v_t, v_priv) THEN
        RAISE EXCEPTION 'anon holds % on %', v_priv, v_t;
      END IF;
    END LOOP;
  END LOOP;
  FOREACH v_t IN ARRAY ARRAY['api_quota_log','api_request_log','live_sync_state'] LOOP
    FOREACH v_role IN ARRAY ARRAY['anon','authenticated'] LOOP
      FOREACH v_priv IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE'] LOOP
        IF has_table_privilege(v_role, 'public.' || v_t, v_priv) THEN
          RAISE EXCEPTION '% holds % on % (sync bookkeeping must be service_role only)', v_role, v_priv, v_t;
        END IF;
      END LOOP;
    END LOOP;
  END LOOP;
  FOREACH v_t IN ARRAY ARRAY['leagues','f1_races','f1_results','f1_standings','live_score_editors'] LOOP
    FOREACH v_priv IN ARRAY ARRAY['INSERT','UPDATE','DELETE'] LOOP
      IF has_table_privilege('authenticated', 'public.' || v_t, v_priv) THEN
        RAISE EXCEPTION 'authenticated holds % on % (no client writes there)', v_priv, v_t;
      END IF;
    END LOOP;
  END LOOP;
  FOREACH v_t IN ARRAY ARRAY['leagues','teams','matches','match_events','f1_races','f1_results','f1_standings',
                             'api_quota_log','api_request_log','live_sync_state','live_score_editors'] LOOP
    IF NOT has_table_privilege('service_role', 'public.' || v_t, 'INSERT')
       OR NOT has_table_privilege('service_role', 'public.' || v_t, 'UPDATE') THEN
      RAISE EXCEPTION 'service_role cannot write % — the sync would fail', v_t;
    END IF;
  END LOOP;
  IF has_function_privilege('anon', 'public.claim_api_request(text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.claim_api_request(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'a client role can EXECUTE claim_api_request — anyone could burn the quota';
  END IF;
  IF NOT has_function_privilege('service_role', 'public.claim_api_request(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'service_role cannot EXECUTE claim_api_request — every sync would stop';
  END IF;
  IF has_function_privilege('anon', 'public.is_score_editor()', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.is_score_editor()', 'EXECUTE') THEN
    RAISE EXCEPTION 'is_score_editor EXECUTE grants are wrong (want authenticated yes, anon no)';
  END IF;

  IF (SELECT column_default FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'leagues' AND column_name = 'enabled')
     IS DISTINCT FROM 'false' THEN
    RAISE EXCEPTION 'leagues.enabled must DEFAULT false (pre-launch rule)';
  END IF;

  SELECT string_agg(tablename, ',' ORDER BY tablename) INTO v_pub
    FROM pg_publication_tables
   WHERE pubname = 'supabase_realtime' AND schemaname = 'public'
     AND tablename IN ('matches','match_events','f1_results','leagues','teams','f1_races','f1_standings');
  IF v_pub IS DISTINCT FROM 'f1_results,match_events,matches' THEN
    RAISE EXCEPTION 'supabase_realtime should carry exactly f1_results,match_events,matches of this module; has %', v_pub;
  END IF;

  SELECT string_agg(sport || ':' || source || ':' || coalesce(external_id, '-'), ',' ORDER BY sport, sort_order)
    INTO v_names FROM public.leagues WHERE enabled;
  IF v_names IS DISTINCT FROM
     'basketball:api:104,basketball:api:120,basketball:api:12,'
     || 'football:manual:-,football:api:203,football:api:2,football:api:39,football:api:140,'
     || 'football:api:135,football:api:78,football:api:61' THEN
    RAISE EXCEPTION 'enabled leagues are not the 11 seeded: %', v_names;
  END IF;

  -- A real, non-admin account for the editor probe. Its live_score_editors row is rolled back.
  SELECT p.id INTO v_editor FROM public.profiles p
   WHERE p.role IS DISTINCT FROM 'admin' AND EXISTS (SELECT 1 FROM auth.users u WHERE u.id = p.id)
   ORDER BY p.id LIMIT 1;
  IF v_editor IS NULL THEN RAISE EXCEPTION 'probe: no non-admin profile to act as the editor'; END IF;

  -- ── BEHAVIOUR, rolled back by a sentinel. PL/pgSQL variables survive it; rows do not.
  BEGIN
    SELECT id INTO v_kt FROM public.leagues WHERE source = 'manual' AND name = 'KTFF Süper Lig';
    SELECT id INTO v_pl FROM public.leagues WHERE source = 'api' AND sport = 'football' AND external_id = '39';
    INSERT INTO public.teams (sport, name, source) VALUES ('football', 'zz home', 'manual') RETURNING id INTO v_h;
    INSERT INTO public.teams (sport, name, source) VALUES ('football', 'zz away', 'manual') RETURNING id INTO v_a;
    INSERT INTO public.teams (sport, name, source, external_id) VALUES ('football', 'zz api h', 'api', 'zz1') RETURNING id INTO v_ah;
    INSERT INTO public.teams (sport, name, source, external_id) VALUES ('football', 'zz api a', 'api', 'zz2') RETURNING id INTO v_aa;

    -- service_role positive control: the sync writes an API match.
    SET LOCAL ROLE service_role;
    BEGIN
      INSERT INTO public.matches (sport, league_id, home_team_id, away_team_id, kickoff_at, source, external_id)
      VALUES ('football', v_pl, v_ah, v_aa, now(), 'api', 'zz-api');
      v_service_api := 'landed';
    EXCEPTION WHEN OTHERS THEN v_service_api := 'refused: ' || SQLERRM;
    END;
    RESET ROLE;

    SET LOCAL ROLE anon;
    SELECT count(*) INTO v_anon_read FROM public.matches WHERE external_id = 'zz-api';
    BEGIN
      INSERT INTO public.matches (sport, league_id, home_team_id, away_team_id, kickoff_at, source)
      VALUES ('football', v_kt, v_h, v_a, now(), 'manual');
      v_anon_write := 'ALLOWED';
    EXCEPTION WHEN insufficient_privilege THEN v_anon_write := 'denied';
    END;
    RESET ROLE;

    INSERT INTO public.live_score_editors (user_id) VALUES (v_editor);

    -- The same editor as a GUEST session: denied.
    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', v_editor, 'role', 'authenticated', 'is_anonymous', true)::text, true);
    BEGIN
      INSERT INTO public.matches (sport, league_id, home_team_id, away_team_id, kickoff_at, source)
      VALUES ('football', v_kt, v_h, v_a, now(), 'manual');
      v_guest_write := 'ALLOWED';
    EXCEPTION WHEN insufficient_privilege THEN v_guest_write := 'denied';
    END;

    -- As a real session: a manual KTFF match lands (positive control) ...
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', v_editor, 'role', 'authenticated')::text, true);
    BEGIN
      INSERT INTO public.matches (sport, league_id, home_team_id, away_team_id, kickoff_at, source)
      VALUES ('football', v_kt, v_h, v_a, now(), 'manual') RETURNING id INTO v_m;
      UPDATE public.matches SET home_score = 1, away_score = 0, status = 'live', minute = 12 WHERE id = v_m;
      INSERT INTO public.match_events (match_id, type, team_side, player_name, minute)
      VALUES (v_m, 'goal', 'home', 'zz scorer', 12);
      v_editor_write := 'landed';
    EXCEPTION WHEN OTHERS THEN v_editor_write := 'refused: ' || SQLERRM;
    END;
    -- ... but not under the Premier League, even with manual teams ...
    BEGIN
      INSERT INTO public.matches (sport, league_id, home_team_id, away_team_id, kickoff_at, source)
      VALUES ('football', v_pl, v_h, v_a, now(), 'manual');
      v_editor_api := 'ALLOWED';
    EXCEPTION WHEN insufficient_privilege THEN v_editor_api := 'denied';
    END;
    -- ... and an API row cannot be touched (RLS USING hides it: 0 rows updated).
    UPDATE public.matches SET home_score = 9 WHERE external_id = 'zz-api';
    GET DIAGNOSTICS v_i = ROW_COUNT;
    v_editor_upd_api := CASE WHEN v_i = 0 THEN 'untouched' ELSE 'UPDATED ' || v_i END;
    BEGIN
      INSERT INTO public.match_events (match_id, type, team_side, minute)
      SELECT id, 'goal', 'home', 1 FROM public.matches WHERE external_id = 'zz-api';
      v_editor_event := 'ALLOWED';
    EXCEPTION WHEN insufficient_privilege THEN v_editor_event := 'denied';
    END;
    BEGIN
      PERFORM public.claim_api_request('football');
      v_editor_quota := 'ALLOWED';
    EXCEPTION WHEN insufficient_privilege THEN v_editor_quota := 'denied';
    END;
    PERFORM set_config('request.jwt.claims', '', true);
    RESET ROLE;

    -- A user with no editor row is denied (the account is real, the membership is not).
    DELETE FROM public.live_score_editors WHERE user_id = v_editor;
    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', v_editor, 'role', 'authenticated')::text, true);
    BEGIN
      INSERT INTO public.matches (sport, league_id, home_team_id, away_team_id, kickoff_at, source)
      VALUES ('football', v_kt, v_h, v_a, now(), 'manual');
      v_plain_write := CASE WHEN EXISTS (SELECT 1 FROM public.profiles WHERE id = v_editor AND role = 'admin')
                            THEN 'admin' ELSE 'ALLOWED' END;
    EXCEPTION WHEN insufficient_privilege THEN v_plain_write := 'denied';
    END;
    PERFORM set_config('request.jwt.claims', '', true);
    RESET ROLE;

    -- The quota fence: 90 claims succeed, the 91st does not. Starts from a clean row.
    DELETE FROM public.api_quota_log WHERE day = (now() AT TIME ZONE 'UTC')::date AND sport = 'f1';
    FOR v_i IN 1..90 LOOP
      IF public.claim_api_request('f1') THEN v_claims := v_claims + 1; END IF;
    END LOOP;
    v_91st := public.claim_api_request('f1');

    BEGIN
      INSERT INTO public.matches (sport, league_id, home_team_id, away_team_id, kickoff_at, source, status)
      VALUES ('football', v_kt, v_h, v_a, now(), 'manual', 'halftime');
      v_bad_status := 'ACCEPTED';
    EXCEPTION WHEN check_violation THEN v_bad_status := 'refused';
    END;
    BEGIN
      -- A basketball match under a football league: the composite FK must refuse it.
      INSERT INTO public.matches (sport, league_id, home_team_id, away_team_id, kickoff_at, source)
      VALUES ('basketball', v_kt, v_h, v_a, now(), 'manual');
      v_bad_sport := 'ACCEPTED';
    EXCEPTION WHEN foreign_key_violation OR check_violation THEN v_bad_sport := 'refused';
    END;

    RAISE EXCEPTION 'ZZ_PROBE_ROLLBACK';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM IS DISTINCT FROM 'ZZ_PROBE_ROLLBACK' THEN RAISE; END IF;
  END;

  IF v_service_api   IS DISTINCT FROM 'landed'    THEN RAISE EXCEPTION 'service_role API-match write: %', v_service_api; END IF;
  IF v_anon_read     IS DISTINCT FROM 1           THEN RAISE EXCEPTION 'anon reads % rows of a public match (want 1)', v_anon_read; END IF;
  IF v_anon_write    IS DISTINCT FROM 'denied'    THEN RAISE EXCEPTION 'anon match INSERT was %', v_anon_write; END IF;
  IF v_guest_write   IS DISTINCT FROM 'denied'    THEN RAISE EXCEPTION 'a GUEST editor match INSERT was %', v_guest_write; END IF;
  IF v_editor_write  IS DISTINCT FROM 'landed'    THEN RAISE EXCEPTION 'editor manual match/score/event write: %', v_editor_write; END IF;
  IF v_editor_api    IS DISTINCT FROM 'denied'    THEN RAISE EXCEPTION 'editor INSERT under the Premier League was %', v_editor_api; END IF;
  IF v_editor_upd_api IS DISTINCT FROM 'untouched' THEN RAISE EXCEPTION 'editor UPDATE of an API match: %', v_editor_upd_api; END IF;
  IF v_editor_event  IS DISTINCT FROM 'denied'    THEN RAISE EXCEPTION 'editor event INSERT on an API match was %', v_editor_event; END IF;
  IF v_editor_quota  IS DISTINCT FROM 'denied'    THEN RAISE EXCEPTION 'a client called claim_api_request: %', v_editor_quota; END IF;
  IF v_plain_write   IS DISTINCT FROM 'denied'    THEN RAISE EXCEPTION 'a NON-editor match INSERT was %', v_plain_write; END IF;
  IF v_claims        IS DISTINCT FROM 90          THEN RAISE EXCEPTION 'quota: % of 90 claims succeeded', v_claims; END IF;
  IF v_91st          IS DISTINCT FROM false       THEN RAISE EXCEPTION 'quota: the 91st claim returned % (want false)', v_91st; END IF;
  IF v_bad_status    IS DISTINCT FROM 'refused'   THEN RAISE EXCEPTION 'CONTROL FAILED: status halftime was %', v_bad_status; END IF;
  IF v_bad_sport     IS DISTINCT FROM 'refused'   THEN RAISE EXCEPTION 'CONTROL FAILED: cross-sport match was %', v_bad_sport; END IF;
  IF EXISTS (SELECT 1 FROM public.teams WHERE name LIKE 'zz %')
     OR EXISTS (SELECT 1 FROM public.live_score_editors WHERE user_id = v_editor)
     OR EXISTS (SELECT 1 FROM public.matches WHERE external_id = 'zz-api') THEN
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
VALUES ('20261070_live_scores.sql', '33f10448d4128f50df9f61461b510d610c69933d8900e32713b4340a808c57b5')
ON CONFLICT (filename) DO UPDATE
  SET checksum = excluded.checksum, applied_at = now(), applied_by = current_user;
-- ─── ledger:stamp:end ────────────────────────────────────────────────
COMMIT;
RESET ROLE;

NOTIFY pgrst, 'reload schema';

-- ─── Verification after applying (read-only, run alone) ─────────────────────
--   Run supabase/verify_schema.sql QUERY 1: every 1070_live_scores row must read OK.
--   SELECT tablename FROM pg_publication_tables WHERE pubname = 'supabase_realtime'
--    AND tablename IN ('matches','match_events','f1_results');   -- expect 3 rows
--
-- ─── Granting an editor (SQL editor, by an admin) ───────────────────────────
--   INSERT INTO public.live_score_editors (user_id) VALUES ('<profile uuid>');
--
-- ─── Rollback (only if the module is abandoned) ─────────────────────────────
--   ALTER PUBLICATION supabase_realtime DROP TABLE public.matches, public.match_events, public.f1_results;
--   DROP TABLE IF EXISTS public.match_events, public.matches, public.teams, public.leagues,
--     public.f1_results, public.f1_standings, public.f1_races, public.api_quota_log,
--     public.api_request_log, public.live_sync_state, public.live_score_editors;
--   DROP FUNCTION IF EXISTS public.is_score_editor(), public.claim_api_request(text),
--     public.matches_touch_updated_at();
