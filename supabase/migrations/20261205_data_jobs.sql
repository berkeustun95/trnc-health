-- ═══════════════════════════════════════════════════════════════════════════
-- 20261205 — Data jobs: the job registry, the run log and the admin read RPC (slice 1)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- One place that knows every automatic job (6 scheduled GitHub workflows, every pg_cron job) and
-- what its OWN records say about its last run. This file only READS and records; nothing pauses
-- anything yet: every row is switchable = false and paused = false. The switches come in a later
-- release together with their gates. No app code, workflow or edge function changes here, and
-- nothing calls record_data_job_run yet (slices 2 and 4 will).
--
-- ─── THE CORE RULE: "succeeded" IS NOT A RESULT ─────────────────────────────
--   For a pg_cron job that only queues an HTTP request (cron_http), cron's "succeeded" means
--   "request queued", not "the function worked". So for runner cron_http and github the status
--   comes ONLY from the job's own run records: data_job_runs, plus the two existing logs reused
--   as they are (duty_push_runs for duty-push, weekend_digest_runs for weekend-digest). Never
--   cron.job_run_details, never net._http_response. A job with no own record reads "no_record".
--   Only runner cron_sql (the statement runs inside the database) reads cron.job_run_details,
--   status + start/end times only. return_message and cron.job.command are NEVER read or returned
--   (commands carry auth headers).
--   KNOWN LIMIT, two cron_sql jobs: 'featured-expiry-reminder' (process_featured_expiring(), read in
--   20261066_notification_type.sql, its latest definition) and 'marketplace-photo-review-reminder'
--   (marketplace_photo_review_reminder(), read in 20261196_marketplace_photo_review_reminder.sql) write
--   their rows and then queue the Expo push with net.http_post from inside the SQL function. For
--   them cron's "succeeded" proves only the in-database half (rows written, push request queued),
--   NOT that the push was delivered: pg_net answers later and nothing here reads net._http_response.
--
-- ─── WHO CAN READ / WRITE WHAT ──────────────────────────────────────────────
--   data_jobs, data_job_runs: RLS ON, ZERO policies, every privilege revoked from PUBLIC, anon and
--     authenticated. Only service_role (and the owner postgres) can touch them. No customer,
--     provider, guest or admin-in-the-app can read or write them directly.
--   admin_data_jobs(): the ONLY way the app reads the registry. SECURITY DEFINER, refuses unless
--     the session has a user, is NOT an anonymous (guest) session, and is an admin. is_admin() alone
--     is not enough: it only checks profiles.role and guests are `authenticated` too. EXECUTE is held by authenticated
--     (by grant), and by service_role and postgres (service_role through Supabase's default function
--     privileges, postgres as owner); revoked from PUBLIC and anon. service_role and postgres are still
--     refused inside by the uid gate (no uid in their session). It writes nothing. It returns
--     job names, schedules and run outcomes: no user rows, no ids, no counts of people.
--   record_data_job_run(): inserts one finished run row. EXECUTE for service_role ONLY. An
--     unknown job key raises UNKNOWN_JOB; outcome 'running' is not accepted here (a finished row).
--   data_jobs_overview(): the single place the state logic lives (slice 5's watchdog reuses it).
--     INVOKER, EXECUTE held by nobody but the owner; reached only through admin_data_jobs().
--   Retention: pg_cron 'purge-data-job-runs', 03:43 UTC daily, deletes runs older than 90 days.
--     It has its own registry row like every other cron job.
--
-- ─── OUTCOME MAPPINGS (explicit; anything unknown maps to 'failed', never to ok) ───
--   data_job_runs.outcome       ok→ok  running→running  skipped_paused→skipped_paused  failed→failed
--   duty_push_runs.outcome      sent→ok  no_duties→ok (nothing due)  no_profiles→ok (nobody to tell)
--                               running→running  partial→failed (a batch was never accepted)
--                               push_failed / duty_query_failed / profiles_query_failed→failed
--                               anything else→failed
--   weekend_digest_runs.outcome sent→ok  no_events→ok  no_profiles→ok  running→running
--                               partial→failed  push_failed / events_query_failed /
--                               profiles_query_failed→failed  anything else→failed
--                               Only mode = 'all' rows count: a 'testers' send is not the weekly job.
--   cron.job_run_details.status succeeded→ok  failed→failed  starting/connecting/sending/running→
--                               running  anything else→failed. error_class = 'sql_failed' on failure.
--   A 'running' record older than 15 minutes is a run cut off: state 'failed', error_class 'cut_off'.
--
-- ─── STATE (first match wins) ───────────────────────────────────────────────
--   inactive (a covered cron job is missing or inactive) → paused → stale-for-silent-cron_sql →
--   no_record → failed → stale (expected_every set and last_ok_at older than it, or none) → ok.
--   The alarm must not silence itself: a cron_sql job WITH expected_every and no run row in the
--   30-day cron.job_run_details window reads 'stale' (attention true), never 'no_record'. Otherwise a
--   job that stopped running would read stale until its last row aged out, then turn neutral.
--   Its last_run and record_source stay null (there is nothing to show). A run row's time is
--   coalesce(start_time, end_time), so a pre-start failure (start_time NULL) still counts; a row with
--   both NULL is left out, and the job then reads stale by the rule above.
--   NOT changed in this release (known limit): github and cron_http jobs keep 'no_record' (neutral,
--   attention false) when they have no own record, because their writers do not exist yet; a later
--   release tightens it. Known limit: a github / cron_http job whose own records were ALL purged
--   (data_job_runs keeps 90 days) reads 'no_record', not 'stale'.
--   Rescheduling: any cron.unschedule + cron.schedule of a job (a re-apply of this file, or any future
--   reschedule migration) gives it a NEW jobid, and the new jobid has no cron.job_run_details rows. So a
--   cron_sql job with expected_every reads 'stale' with attention true until its next run lands. Slice
--   5's watchdog must allow for that (e.g. a grace period after a reschedule), not page on it.
--   First apply: 'purge-data-job-runs' is scheduled by this very file and has no run yet, so it
--   legitimately reads 'stale' (attention true) until its first 03:43 UTC run: the screen shows it
--   as stale for up to a day after the apply. That is expected, not a fault.
--   attention (boolean, never null, one more key on every element, derived from state): true when
--   state is failed or stale, or inactive on a job that HAS an expected_every. An inactive job with
--   expected_every NULL (live-scores: six cron jobs paused on purpose since 20261090) is deliberately
--   off: attention false. paused, no_record and ok never need attention. The screen and slice 5's
--   watchdog count `attention`, not a list of states, so a deliberate pause cannot sit red forever.
--
-- ─── expected_every: HOW IT WAS CHOSEN ──────────────────────────────────────
--   GitHub schedules start about 7 h late (measured: 4.2–8.7 h on the four daily workflows), and
--   GitHub may skip a run, so every daily GitHub job gets 36 h (a delayed run plus one skipped
--   day does not alarm; two missed days do). duyurular-fetch ticks every ~30 min but is only
--   expected to have succeeded within 12 h. duyurular-paused-recheck is weekly (Mon 06:00 UTC):
--   9 days. Daily cron jobs: 36 h. Hourly SQL jobs: 3 h; the 5-minute reminder: 1 h.
--   duty-push and weekend-digest tick every 30 min but their *_due() gates let only one tick a day
--   (weekend: one a week, Fridays 17:00 Famagusta) write a run row, so they follow their own
--   records: duty-push 36 h, weekend-digest 8 days. live-scores is paused since 20261090: NULL
--   (no freshness expectation; it reads 'inactive').
--
-- Public logs: this file prints no user totals and no ids; job names are fine and may print.
-- Apply: supabase-migrate. New functions, so it ends with NOTIFY pgrst after COMMIT.
-- ═══════════════════════════════════════════════════════════════════════════

SET ROLE postgres;

BEGIN;

SET LOCAL lock_timeout = '5s';

-- ─── 1. data_jobs: the registry ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.data_jobs (
  key            text        NOT NULL,
  runner         text        NOT NULL,
  kind           text        NOT NULL,
  cron_jobnames  text[]      NOT NULL DEFAULT '{}',
  schedule_note  text,
  switchable     boolean     NOT NULL DEFAULT false,
  paused         boolean     NOT NULL DEFAULT false,
  paused_note    text,
  paused_by      uuid,
  paused_at      timestamptz,
  expected_every interval,
  sort           int         NOT NULL DEFAULT 0,
  CONSTRAINT data_jobs_pkey PRIMARY KEY (key),
  CONSTRAINT data_jobs_key_check CHECK (key ~ '^[a-z0-9-]{1,64}$'),
  CONSTRAINT data_jobs_runner_check CHECK (runner IN ('github', 'cron_http', 'cron_sql')),
  CONSTRAINT data_jobs_kind_check CHECK (kind IN ('feed', 'push', 'maintenance', 'retention', 'expiry', 'reminder', 'health')),
  CONSTRAINT data_jobs_cron_jobnames_check CHECK ((runner = 'github') = (cardinality(cron_jobnames) = 0)),
  CONSTRAINT data_jobs_schedule_note_check CHECK (runner = 'github' OR schedule_note IS NULL),
  CONSTRAINT data_jobs_paused_switchable_check CHECK (NOT paused OR switchable),
  CONSTRAINT data_jobs_no_switch_retention_check CHECK (NOT switchable OR kind NOT IN ('retention', 'expiry')),
  CONSTRAINT data_jobs_expected_every_check CHECK (expected_every IS NULL OR expected_every > interval '0')
);

COMMENT ON TABLE public.data_jobs IS
  'Registry of every automatic job (GitHub scheduled workflows + pg_cron). RLS on, zero policies: service_role only; the app reads it through admin_data_jobs(). paused_by has NO foreign key on purpose (an FK to users broke account deletion before). 20261205.';

ALTER TABLE public.data_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.data_jobs FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.data_jobs TO service_role;

-- ─── 2. data_job_runs: one row per finished run, class only, never a message ─
CREATE TABLE IF NOT EXISTS public.data_job_runs (
  id          bigint      GENERATED ALWAYS AS IDENTITY,
  job_key     text        NOT NULL REFERENCES public.data_jobs (key),
  started_at  timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  outcome     text        NOT NULL,
  error_class text,
  source      text        NOT NULL,
  run_ref     text,
  CONSTRAINT data_job_runs_pkey PRIMARY KEY (id),
  CONSTRAINT data_job_runs_finished_check CHECK (finished_at IS NULL OR finished_at >= started_at),
  CONSTRAINT data_job_runs_outcome_check CHECK (outcome IN ('running', 'ok', 'failed', 'skipped_paused')),
  CONSTRAINT data_job_runs_error_class_check CHECK (error_class IS NULL OR error_class ~ '^[A-Za-z0-9_]{1,64}$'),
  CONSTRAINT data_job_runs_source_check CHECK (source IN ('github', 'edge')),
  CONSTRAINT data_job_runs_run_ref_check CHECK (run_ref IS NULL OR run_ref ~ '^[0-9]{1,20}$')
);

COMMENT ON TABLE public.data_job_runs IS
  'One row per job run (outcome + error CLASS only, never a message, no user data). RLS on, zero policies: service_role only. 90-day purge-data-job-runs. 20261205.';

CREATE INDEX IF NOT EXISTS idx_data_job_runs_job_started ON public.data_job_runs (job_key, started_at DESC);

ALTER TABLE public.data_job_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.data_job_runs FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.data_job_runs TO service_role;
DO $$
DECLARE v_seq text := pg_get_serial_sequence('public.data_job_runs', 'id');
BEGIN
  -- Supabase default privileges name anon and authenticated on new sequences too.
  EXECUTE format('REVOKE ALL ON SEQUENCE %s FROM PUBLIC, anon, authenticated', v_seq);
END $$;

-- ─── 3. 90-day purge, own cron job ──────────────────────────────────────────
-- Existing purges sit at 03:17 / :23 / :27 / :33 / :37 / :41 / :47 / :51 / :53 / :57 and the hourly
-- eatery job at :40; 03:43 is free and not a multiple of 5 (the */5 reminder).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'purge-data-job-runs') THEN
    PERFORM cron.unschedule('purge-data-job-runs');
  END IF;
END $$;
SELECT cron.schedule('purge-data-job-runs', '43 3 * * *',
  $$ DELETE FROM public.data_job_runs WHERE started_at < now() - interval '90 days' $$);

-- ─── 4. Seed: every job (switchable = false, paused = false everywhere in this release) ─
-- GitHub rows: schedule_note = the cron exactly as written in the workflow file (UTC).
-- Cron rows derive their schedule from cron.job; cron_jobnames lists the pg_cron jobnames covered.
INSERT INTO public.data_jobs (key, runner, kind, cron_jobnames, schedule_note, expected_every, sort) VALUES
  ('gisekibris-feed',                   'github',    'feed',        '{}', '15 4 * * *',  interval '36 hours', 10),
  ('duyurular-fetch',                   'github',    'feed',        '{}', '7,37 * * * *', interval '12 hours', 11),
  ('novest-images',                     'github',    'feed',        '{}', '20 5,15 * * *', interval '36 hours', 12),
  ('araclar-photo-cleanup',             'github',    'maintenance', '{}', '10 3 * * *',  interval '36 hours', 13),
  ('duyurular-paused-recheck',          'github',    'health',      '{}', '0 6 * * 1',   interval '9 days',   14),
  ('daily-health',                      'github',    'health',      '{}', '0 5 * * *',   interval '36 hours', 15),
  ('sync-novest',                       'cron_http', 'feed',        ARRAY['sync-novest-morning', 'sync-novest-evening'], NULL, interval '36 hours', 20),
  ('google-places-refresh',             'cron_http', 'feed',        ARRAY['google-places-refresh'], NULL, interval '36 hours', 21),
  ('duty-push',                         'cron_http', 'push',        ARRAY['duty-push'], NULL, interval '36 hours', 22),
  ('weekend-digest',                    'cron_http', 'push',        ARRAY['weekend-digest'], NULL, interval '8 days', 23),
  ('marketplace-maintenance',           'cron_http', 'maintenance', ARRAY['marketplace-maintenance'], NULL, interval '36 hours', 24),
  ('live-scores',                       'cron_http', 'feed',
     ARRAY['live-scores-football-daily', 'live-scores-basketball-daily', 'live-scores-f1-daily',
           'live-scores-football-poll', 'live-scores-basketball-poll', 'live-scores-f1-poll'], NULL, NULL, 25),
  ('marketplace-photo-review-reminder', 'cron_sql',  'reminder',    ARRAY['marketplace-photo-review-reminder'], NULL, interval '1 hour', 30),
  ('featured-expiry-reminder',          'cron_sql',  'reminder',    ARRAY['featured-expiry-reminder'], NULL, interval '36 hours', 31),
  ('expire-job-postings',               'cron_sql',  'expiry',      ARRAY['expire-job-postings'], NULL, interval '3 hours', 32),
  ('expire-vehicles',                   'cron_sql',  'expiry',      ARRAY['expire-vehicles'], NULL, interval '36 hours', 33),
  ('eatery-orders-retention',           'cron_sql',  'retention',   ARRAY['eatery-orders-retention'], NULL, interval '3 hours', 34),
  ('purge-moderation-rejections',       'cron_sql',  'retention',   ARRAY['purge-moderation-rejections'], NULL, interval '36 hours', 40),
  ('purge-conversation-attempts',       'cron_sql',  'retention',   ARRAY['purge-conversation-attempts'], NULL, interval '36 hours', 41),
  ('purge-soft-deleted-ugc',            'cron_sql',  'retention',   ARRAY['purge-soft-deleted-ugc'], NULL, interval '36 hours', 42),
  ('purge-app-update-events',           'cron_sql',  'retention',   ARRAY['purge-app-update-events'], NULL, interval '36 hours', 43),
  ('purge-google-places-cache',         'cron_sql',  'retention',   ARRAY['purge-google-places-cache'], NULL, interval '36 hours', 44),
  ('purge-onboarding-events',           'cron_sql',  'retention',   ARRAY['purge-onboarding-events'], NULL, interval '36 hours', 45),
  ('purge-duty-push-runs',              'cron_sql',  'retention',   ARRAY['purge-duty-push-runs'], NULL, interval '36 hours', 46),
  ('purge-partner-booking-requests',    'cron_sql',  'retention',   ARRAY['purge-partner-booking-requests'], NULL, interval '36 hours', 47),
  ('purge-oli-messages',                'cron_sql',  'retention',   ARRAY['purge-oli-messages'], NULL, interval '36 hours', 48),
  ('purge-weekend-digest-runs',         'cron_sql',  'retention',   ARRAY['purge-weekend-digest-runs'], NULL, interval '36 hours', 49),
  ('purge-data-job-runs',               'cron_sql',  'retention',   ARRAY['purge-data-job-runs'], NULL, interval '36 hours', 50)
ON CONFLICT (key) DO NOTHING;

-- ─── 5. data_jobs_overview(): the ONE place the state logic lives ───────────
-- INVOKER (runs as whoever calls it; only admin_data_jobs() does, as the owner). No gate here on
-- purpose: it is not reachable by any client role (EXECUTE revoked below).
CREATE OR REPLACE FUNCTION public.data_jobs_overview(p_now timestamptz DEFAULT now())
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  WITH runs AS (
    -- own records: data_job_runs (github + cron_http jobs only)
    SELECT r.job_key, r.started_at, r.finished_at,
           CASE r.outcome WHEN 'ok' THEN 'ok' WHEN 'running' THEN 'running'
                          WHEN 'skipped_paused' THEN 'skipped_paused' ELSE 'failed' END AS outcome,
           r.error_class, r.source, 'own'::text AS rec
      FROM public.data_job_runs r
      JOIN public.data_jobs dj ON dj.key = r.job_key AND dj.runner IN ('github', 'cron_http')
    UNION ALL
    -- own records: the existing duty-push log
    SELECT 'duty-push', p.started_at, p.finished_at,
           CASE p.outcome WHEN 'sent' THEN 'ok' WHEN 'no_duties' THEN 'ok' WHEN 'no_profiles' THEN 'ok'
                          WHEN 'running' THEN 'running' ELSE 'failed' END,
           CASE WHEN p.outcome IN ('sent', 'no_duties', 'no_profiles', 'running') THEN NULL
                WHEN p.outcome IN ('partial', 'push_failed', 'duty_query_failed', 'profiles_query_failed') THEN p.outcome
                ELSE 'unknown_outcome' END,
           'edge', 'own'
      FROM public.duty_push_runs p
    UNION ALL
    -- own records: the existing weekend-digest log; testers sends are not the weekly job
    SELECT 'weekend-digest', w.started_at, w.finished_at,
           CASE w.outcome WHEN 'sent' THEN 'ok' WHEN 'no_events' THEN 'ok' WHEN 'no_profiles' THEN 'ok'
                          WHEN 'running' THEN 'running' ELSE 'failed' END,
           CASE WHEN w.outcome IN ('sent', 'no_events', 'no_profiles', 'running') THEN NULL
                WHEN w.outcome IN ('partial', 'push_failed', 'events_query_failed', 'profiles_query_failed') THEN w.outcome
                ELSE 'unknown_outcome' END,
           'edge', 'own'
      FROM public.weekend_digest_runs w
     WHERE w.mode = 'all'
    UNION ALL
    -- cron_sql jobs ONLY: the statement runs inside the database, so cron's status is the result.
    -- Reads status + start/end times, nothing else (never return_message, never the command).
    -- Last 30 days only (the 5-minute job's history is large); older = no run row (reads stale when
    -- the job has expected_every). The row's time is coalesce(start_time, end_time): a pre-start
    -- failure has no start_time; a row with neither time is left out.
    SELECT dj.key, coalesce(d.start_time, d.end_time), d.end_time,
           CASE d.status WHEN 'succeeded' THEN 'ok'
                         WHEN 'starting' THEN 'running' WHEN 'connecting' THEN 'running'
                         WHEN 'sending' THEN 'running' WHEN 'running' THEN 'running' ELSE 'failed' END,
           CASE WHEN d.status IN ('succeeded', 'starting', 'connecting', 'sending', 'running') THEN NULL ELSE 'sql_failed' END,
           'cron_sql', 'cron_sql'
      FROM public.data_jobs dj
      JOIN cron.job j ON j.jobname = ANY (dj.cron_jobnames)
      JOIN cron.job_run_details d ON d.jobid = j.jobid
     WHERE dj.runner = 'cron_sql' AND coalesce(d.start_time, d.end_time) > p_now - interval '30 days'
  ), last_run AS (
    SELECT DISTINCT ON (job_key) job_key, started_at, finished_at, outcome, error_class, source, rec,
           (outcome = 'running' AND started_at < p_now - interval '15 minutes') AS cut_off
      FROM runs ORDER BY job_key, started_at DESC
  ), last_ok AS (
    SELECT job_key, max(coalesce(finished_at, started_at)) AS last_ok_at
      FROM runs WHERE outcome = 'ok' GROUP BY job_key
  ), job AS (
    SELECT d.*,
           CASE WHEN d.runner = 'github' THEN NULL
                ELSE (SELECT count(*) FROM cron.job j WHERE j.jobname = ANY (d.cron_jobnames) AND j.active) = cardinality(d.cron_jobnames)
           END AS cron_active,
           CASE WHEN d.runner = 'github' THEN d.schedule_note
                ELSE (SELECT string_agg(j.schedule, ' | ' ORDER BY j.jobname) FROM cron.job j WHERE j.jobname = ANY (d.cron_jobnames))
           END AS schedule,
           l.job_key AS l_key, l.started_at AS l_started, l.finished_at AS l_finished, l.outcome AS l_outcome,
           l.error_class AS l_class, l.source AS l_source, l.rec AS l_rec, l.cut_off AS l_cut,
           o.last_ok_at
      FROM public.data_jobs d
      LEFT JOIN last_run l ON l.job_key = d.key
      LEFT JOIN last_ok o ON o.job_key = d.key
  ), judged AS (
    SELECT j.*,
           CASE
             WHEN j.cron_active IS NOT DISTINCT FROM false THEN 'inactive'
             WHEN j.paused THEN 'paused'
             WHEN j.runner = 'cron_sql' AND j.expected_every IS NOT NULL AND j.l_key IS NULL THEN 'stale'
             WHEN j.l_key IS NULL THEN 'no_record'
             WHEN j.l_outcome = 'failed' OR j.l_cut THEN 'failed'
             WHEN j.expected_every IS NOT NULL AND (j.last_ok_at IS NULL OR j.last_ok_at < p_now - j.expected_every) THEN 'stale'
             ELSE 'ok' END AS state
      FROM job j
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'key', j.key,
    'runner', j.runner,
    'kind', j.kind,
    'switchable', j.switchable,
    'paused', j.paused,
    'paused_note', j.paused_note,
    'paused_at', j.paused_at,
    'expected_every_seconds', extract(epoch FROM j.expected_every)::bigint,
    'schedule', j.schedule,
    'cron_active', j.cron_active,
    'last_run', CASE WHEN j.l_key IS NULL THEN NULL ELSE jsonb_build_object(
                  'started_at', j.l_started, 'finished_at', j.l_finished, 'outcome', j.l_outcome,
                  'error_class', CASE WHEN j.l_cut THEN 'cut_off' ELSE j.l_class END,
                  'source', j.l_source) END,
    'last_ok_at', j.last_ok_at,
    'record_source', CASE WHEN j.l_key IS NULL THEN NULL ELSE j.l_rec END,
    'state', j.state,
    'attention', (j.state IN ('failed', 'stale') OR (j.state = 'inactive' AND j.expected_every IS NOT NULL))
  ) ORDER BY j.sort, j.key), '[]'::jsonb)
  FROM judged j
$function$;

REVOKE ALL ON FUNCTION public.data_jobs_overview(timestamptz) FROM PUBLIC, anon, authenticated, service_role;

-- ─── 6. admin_data_jobs(): the admin screen's read ──────────────────────────
CREATE OR REPLACE FUNCTION public.admin_data_jobs()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR public.is_anonymous_session() OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'ADMIN_ONLY';
  END IF;
  RETURN public.data_jobs_overview(now());
END;
$function$;

-- Both anon lines matter: on Supabase a new function is born with anon in its ACL (see 20261033).
REVOKE ALL ON FUNCTION public.admin_data_jobs() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_data_jobs() FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_data_jobs() TO authenticated;

-- ─── 7. record_data_job_run(): service_role writes one finished run ─────────
CREATE OR REPLACE FUNCTION public.record_data_job_run(
  p_job         text,
  p_outcome     text,
  p_error_class text        DEFAULT NULL,
  p_run_ref     text        DEFAULT NULL,
  p_source      text        DEFAULT 'github',
  p_started_at  timestamptz DEFAULT NULL)
 RETURNS bigint
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_id bigint;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.data_jobs WHERE key = p_job) THEN
    RAISE EXCEPTION 'UNKNOWN_JOB';
  END IF;
  IF p_outcome IS NULL OR p_outcome NOT IN ('ok', 'failed', 'skipped_paused') THEN
    RAISE EXCEPTION 'BAD_OUTCOME';
  END IF;
  -- Clamp: a runner clock ahead of the database must not trip finished_at >= started_at.
  INSERT INTO public.data_job_runs (job_key, started_at, finished_at, outcome, error_class, source, run_ref)
  VALUES (p_job, least(coalesce(p_started_at, now()), now()), now(), p_outcome, p_error_class, p_source, p_run_ref)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.record_data_job_run(text, text, text, text, text, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_data_job_run(text, text, text, text, text, timestamptz) TO service_role;

-- ─── Assertions + probes (inside the transaction; a failure rolls the file back) ─
DO $$
DECLARE
  v_t        text;
  v_oid      regclass;
  v_n        int;
  v_names    text;
  v_role     text;
  v_priv     text;
  v_fn       text;
  v_arr      jsonb;
  v_rows     int;
  v_admin    uuid;
  v_r        text;
BEGIN
  -- tables: owner, RLS, the FULL policy set (count + print), no client privilege, service_role keeps its own
  FOREACH v_t IN ARRAY ARRAY['data_jobs', 'data_job_runs'] LOOP
    v_oid := to_regclass('public.' || v_t);
    IF v_oid IS NULL THEN RAISE EXCEPTION '% is not visible to this block', v_t; END IF;
    IF (SELECT relowner::regrole::text FROM pg_class WHERE oid = v_oid) IS DISTINCT FROM 'postgres' THEN
      RAISE EXCEPTION '% is owned by %, expected postgres (SET ROLE postgres missing?)', v_t, (SELECT relowner::regrole::text FROM pg_class WHERE oid = v_oid);
    END IF;
    IF (SELECT relrowsecurity FROM pg_class WHERE oid = v_oid) IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'RLS is not enabled on %', v_t;
    END IF;
    SELECT count(*), coalesce(string_agg(policyname || ':' || cmd, ', ' ORDER BY policyname), '(none)')
      INTO v_n, v_names FROM pg_policies WHERE schemaname = 'public' AND tablename = v_t;
    IF v_n IS DISTINCT FROM 0 THEN
      RAISE EXCEPTION '% must carry ZERO policies; found %: %', v_t, v_n, v_names;
    END IF;
    RAISE NOTICE '% policies: % (%)', v_t, v_n, v_names;
    FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
      FOREACH v_priv IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] LOOP
        IF has_table_privilege(v_role, v_oid, v_priv) THEN
          RAISE EXCEPTION '% holds % on %', v_role, v_priv, v_t;
        END IF;
      END LOOP;
    END LOOP;
    FOREACH v_priv IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE'] LOOP
      IF NOT has_table_privilege('service_role', v_oid, v_priv) THEN
        RAISE EXCEPTION 'service_role lost % on %', v_priv, v_t;
      END IF;
    END LOOP;
  END LOOP;
  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF has_sequence_privilege(v_role, pg_get_serial_sequence('public.data_job_runs', 'id'), 'USAGE, SELECT, UPDATE') THEN
      RAISE EXCEPTION '% holds a privilege on the data_job_runs sequence', v_role;
    END IF;
  END LOOP;

  -- functions: owner postgres; the helper is held by nobody but the owner; the two grants
  FOREACH v_fn IN ARRAY ARRAY['public.data_jobs_overview(timestamptz)', 'public.admin_data_jobs()',
                             'public.record_data_job_run(text,text,text,text,text,timestamptz)'] LOOP
    IF to_regprocedure(v_fn) IS NULL THEN RAISE EXCEPTION '% is missing', v_fn; END IF;
    IF (SELECT pg_get_userbyid(p.proowner) FROM pg_proc p WHERE p.oid = to_regprocedure(v_fn)) IS DISTINCT FROM 'postgres' THEN
      RAISE EXCEPTION '% is not owned by postgres', v_fn;
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_proc p, LATERAL aclexplode(p.proacl) a
              WHERE p.oid = to_regprocedure('public.data_jobs_overview(timestamptz)')
                AND a.privilege_type = 'EXECUTE' AND a.grantee <> p.proowner) THEN
    RAISE EXCEPTION 'data_jobs_overview is EXECUTE-able by a role other than its owner';
  END IF;
  IF (SELECT p.proacl IS NULL FROM pg_proc p WHERE p.oid = to_regprocedure('public.data_jobs_overview(timestamptz)')) THEN
    RAISE EXCEPTION 'data_jobs_overview carries the default ACL (NULL), which grants PUBLIC';
  END IF;
  IF has_function_privilege('anon', 'public.admin_data_jobs()', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon can EXECUTE admin_data_jobs';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.admin_data_jobs()', 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated lost EXECUTE on admin_data_jobs';
  END IF;
  IF has_function_privilege('anon', 'public.record_data_job_run(text,text,text,text,text,timestamptz)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.record_data_job_run(text,text,text,text,text,timestamptz)', 'EXECUTE') THEN
    RAISE EXCEPTION 'a client role can EXECUTE record_data_job_run';
  END IF;
  IF NOT has_function_privilege('service_role', 'public.record_data_job_run(text,text,text,text,text,timestamptz)', 'EXECUTE') THEN
    RAISE EXCEPTION 'service_role lost EXECUTE on record_data_job_run';
  END IF;
  IF (SELECT prosecdef FROM pg_proc WHERE oid = to_regprocedure('public.data_jobs_overview(timestamptz)')) THEN
    RAISE EXCEPTION 'data_jobs_overview must be INVOKER';
  END IF;

  -- coverage: every cron job is covered by exactly one registry row, every listed name exists
  SELECT string_agg(j.jobname, ', ' ORDER BY j.jobname) INTO v_names
    FROM cron.job j
   WHERE (SELECT count(*) FROM public.data_jobs d WHERE j.jobname = ANY (d.cron_jobnames)) IS DISTINCT FROM 1;
  IF v_names IS NOT NULL THEN
    RAISE EXCEPTION 'cron jobs not covered by exactly one data_jobs row: %', v_names;
  END IF;
  SELECT string_agg(DISTINCT n, ', ' ORDER BY n) INTO v_names
    FROM public.data_jobs d, unnest(d.cron_jobnames) AS n
   WHERE NOT EXISTS (SELECT 1 FROM cron.job j WHERE j.jobname = n);
  IF v_names IS NOT NULL THEN
    RAISE EXCEPTION 'data_jobs lists cron jobs that do not exist: %', v_names;
  END IF;

  SELECT count(*), coalesce(max(schedule), '(none)') INTO v_n, v_names
    FROM cron.job WHERE jobname = 'purge-data-job-runs' AND active;
  IF v_n IS DISTINCT FROM 1 OR v_names IS DISTINCT FROM '43 3 * * *' THEN
    RAISE EXCEPTION 'purge-data-job-runs: % active rows, schedule %', v_n, v_names;
  END IF;

  -- seed: nothing is switchable or paused in this release
  IF EXISTS (SELECT 1 FROM public.data_jobs WHERE switchable OR paused OR paused_by IS NOT NULL OR paused_at IS NOT NULL) THEN
    RAISE EXCEPTION 'a data_jobs row is switchable or paused in this release';
  END IF;

  -- behaviour probes. Everything inside the sub-block is rolled back (ZZ_PROBE_ROLLBACK).
  DECLARE
    v_anon_ins text := 'unset';
    v_auth_sel text := 'unset';
    v_anon_fn  text := 'unset';
    v_auth_fn  text := 'unset';
    v_unknown  text := 'unset';
    v_badout   text := 'unset';
    v_chk_pause text := 'unset';
    v_chk_ret  text := 'unset';
    v_chk_gh   text := 'unset';
    v_svc_id   bigint;
    v_svc_n    int := -1;
    v_before   int;
    v_st       text[] := ARRAY[]::text[];
    v_own      text;
    v_att      text;
    v_at       text[] := ARRAY[]::text[];
    v_ls       jsonb;
    v_ls_cron  int;
    v_ina      text[] := ARRAY[]::text[];
  BEGIN
    SELECT count(*) INTO v_before FROM public.data_job_runs;
    BEGIN
      -- service_role records a run through the function (positive control for the denials below)
      SET LOCAL ROLE service_role;
      v_svc_id := public.record_data_job_run('gisekibris-feed', 'ok', NULL, '123', 'github', now() - interval '1 minute');
      SELECT count(*) INTO v_svc_n FROM public.data_job_runs WHERE id = v_svc_id AND job_key = 'gisekibris-feed' AND outcome = 'ok';
      BEGIN
        PERFORM public.record_data_job_run('no-such-job', 'ok');
        v_unknown := 'ACCEPTED';
      EXCEPTION WHEN raise_exception THEN v_unknown := SQLERRM;
      END;
      BEGIN
        PERFORM public.record_data_job_run('gisekibris-feed', 'running');
        v_badout := 'ACCEPTED';
      EXCEPTION WHEN raise_exception THEN v_badout := SQLERRM;
      END;
      SET LOCAL ROLE postgres;

      SET LOCAL ROLE anon;
      BEGIN
        INSERT INTO public.data_job_runs (job_key, outcome, source) VALUES ('gisekibris-feed', 'ok', 'github');
        v_anon_ins := 'ALLOWED';
      EXCEPTION WHEN insufficient_privilege THEN v_anon_ins := 'denied';
      END;
      BEGIN
        PERFORM public.record_data_job_run('gisekibris-feed', 'ok');
        v_anon_fn := 'ALLOWED';
      EXCEPTION WHEN insufficient_privilege THEN v_anon_fn := 'denied';
      END;
      SET LOCAL ROLE postgres;

      SET LOCAL ROLE authenticated;
      BEGIN
        PERFORM 1 FROM public.data_jobs LIMIT 1;
        v_auth_sel := 'ALLOWED';
      EXCEPTION WHEN insufficient_privilege THEN v_auth_sel := 'denied';
      END;
      BEGIN
        PERFORM public.record_data_job_run('gisekibris-feed', 'ok');
        v_auth_fn := 'ALLOWED';
      EXCEPTION WHEN insufficient_privilege THEN v_auth_fn := 'denied';
      END;
      SET LOCAL ROLE postgres;

      -- the table CHECKs hold
      BEGIN
        UPDATE public.data_jobs SET paused = true WHERE key = 'gisekibris-feed';
        v_chk_pause := 'ACCEPTED';
      EXCEPTION WHEN check_violation THEN v_chk_pause := 'rejected';
      END;
      BEGIN
        UPDATE public.data_jobs SET switchable = true WHERE key = 'purge-oli-messages';
        v_chk_ret := 'ACCEPTED';
      EXCEPTION WHEN check_violation THEN v_chk_ret := 'rejected';
      END;
      BEGIN
        INSERT INTO public.data_jobs (key, runner, kind) VALUES ('probe-github-with-cron', 'github', 'feed');
        UPDATE public.data_jobs SET cron_jobnames = ARRAY['x'] WHERE key = 'probe-github-with-cron';
        v_chk_gh := 'ACCEPTED';
      EXCEPTION WHEN check_violation THEN v_chk_gh := 'rejected';
      END;

      -- the state logic, on one job nothing has recorded for yet (github: no cron involved)
      DELETE FROM public.data_job_runs WHERE job_key = 'araclar-photo-cleanup';
      INSERT INTO public.data_job_runs (job_key, started_at, finished_at, outcome, source) VALUES
        ('araclar-photo-cleanup', now() - interval '1 hour', now() - interval '59 minutes', 'ok', 'github');
      SELECT e->>'state', e->>'attention' INTO v_own, v_att FROM jsonb_array_elements(public.data_jobs_overview()) e WHERE e->>'key' = 'araclar-photo-cleanup';
      v_st := v_st || ('ok_run:' || v_own);
      v_at := v_at || (v_att);
      INSERT INTO public.data_job_runs (job_key, started_at, finished_at, outcome, error_class, source) VALUES
        ('araclar-photo-cleanup', now() - interval '30 minutes', now() - interval '29 minutes', 'failed', 'http_500', 'github');
      SELECT e->>'state', e->>'attention' INTO v_own, v_att FROM jsonb_array_elements(public.data_jobs_overview()) e WHERE e->>'key' = 'araclar-photo-cleanup';
      v_st := v_st || ('failed_run:' || v_own);
      v_at := v_at || (v_att);
      DELETE FROM public.data_job_runs WHERE job_key = 'araclar-photo-cleanup';
      INSERT INTO public.data_job_runs (job_key, started_at, finished_at, outcome, source) VALUES
        ('araclar-photo-cleanup', now() - interval '40 hours', now() - interval '40 hours', 'ok', 'github');
      SELECT e->>'state', e->>'attention' INTO v_own, v_att FROM jsonb_array_elements(public.data_jobs_overview()) e WHERE e->>'key' = 'araclar-photo-cleanup';
      v_st := v_st || ('old_ok:' || v_own);
      v_at := v_at || (v_att);
      INSERT INTO public.data_job_runs (job_key, started_at, outcome, source) VALUES
        ('araclar-photo-cleanup', now() - interval '20 minutes', 'running', 'github');
      SELECT e->>'state', e->>'attention' INTO v_own, v_att FROM jsonb_array_elements(public.data_jobs_overview()) e WHERE e->>'key' = 'araclar-photo-cleanup';
      v_st := v_st || ('cut_off:' || v_own);
      v_at := v_at || (v_att);
      DELETE FROM public.data_job_runs WHERE job_key = 'araclar-photo-cleanup';
      SELECT e->>'state', e->>'attention' INTO v_own, v_att FROM jsonb_array_elements(public.data_jobs_overview()) e WHERE e->>'key' = 'araclar-photo-cleanup';
      v_st := v_st || ('none:' || v_own);
      v_at := v_at || (v_att);
      UPDATE public.data_jobs SET switchable = true, paused = true WHERE key = 'araclar-photo-cleanup';
      SELECT e->>'state', e->>'attention' INTO v_own, v_att FROM jsonb_array_elements(public.data_jobs_overview()) e WHERE e->>'key' = 'araclar-photo-cleanup';
      v_st := v_st || ('paused:' || v_own);
      v_at := v_at || (v_att);

      -- inactive WITH expected_every needs attention; WITHOUT it, none. A probe row naming a cron job that does
      -- not exist reads 'inactive' (a covered job is missing), so no cron.* row is touched.
      INSERT INTO public.data_jobs (key, runner, kind, cron_jobnames, expected_every, sort)
        VALUES ('probe-inactive-cron', 'cron_sql', 'maintenance', ARRAY['zz-probe-no-such-cron-job'], interval '1 hour', 9999);
      SELECT e->>'state', e->>'attention' INTO v_own, v_att FROM jsonb_array_elements(public.data_jobs_overview()) e WHERE e->>'key' = 'probe-inactive-cron';
      v_ina := v_ina || ('with_expected:' || v_own || ':' || v_att);
      UPDATE public.data_jobs SET expected_every = NULL WHERE key = 'probe-inactive-cron';
      SELECT e->>'state', e->>'attention' INTO v_own, v_att FROM jsonb_array_elements(public.data_jobs_overview()) e WHERE e->>'key' = 'probe-inactive-cron';
      v_ina := v_ina || ('without_expected:' || v_own || ':' || v_att);

      SELECT e INTO v_ls FROM jsonb_array_elements(public.data_jobs_overview()) e WHERE e->>'key' = 'live-scores';
      SELECT count(*) INTO v_ls_cron FROM cron.job j JOIN public.data_jobs dj ON j.jobname = ANY (dj.cron_jobnames)
       WHERE dj.key = 'live-scores' AND j.active;

      RAISE EXCEPTION 'ZZ_PROBE_ROLLBACK';
    EXCEPTION WHEN raise_exception THEN
      IF SQLERRM IS DISTINCT FROM 'ZZ_PROBE_ROLLBACK' THEN RAISE; END IF;
    END;
    SET LOCAL ROLE postgres;

    IF v_svc_n     IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'service_role record_data_job_run wrote % rows, expected 1', v_svc_n; END IF;
    IF v_unknown   IS DISTINCT FROM 'UNKNOWN_JOB' THEN RAISE EXCEPTION 'unknown job key was %', v_unknown; END IF;
    IF v_badout    IS DISTINCT FROM 'BAD_OUTCOME' THEN RAISE EXCEPTION 'outcome running was %', v_badout; END IF;
    IF v_anon_ins  IS DISTINCT FROM 'denied' THEN RAISE EXCEPTION 'anon INSERT into data_job_runs was %', v_anon_ins; END IF;
    IF v_anon_fn   IS DISTINCT FROM 'denied' THEN RAISE EXCEPTION 'anon record_data_job_run was %', v_anon_fn; END IF;
    IF v_auth_sel  IS DISTINCT FROM 'denied' THEN RAISE EXCEPTION 'authenticated SELECT on data_jobs was %', v_auth_sel; END IF;
    IF v_auth_fn   IS DISTINCT FROM 'denied' THEN RAISE EXCEPTION 'authenticated record_data_job_run was %', v_auth_fn; END IF;
    IF v_chk_pause IS DISTINCT FROM 'rejected' THEN RAISE EXCEPTION 'paused on a non-switchable row was %', v_chk_pause; END IF;
    IF v_chk_ret   IS DISTINCT FROM 'rejected' THEN RAISE EXCEPTION 'switchable on a retention row was %', v_chk_ret; END IF;
    IF v_chk_gh    IS DISTINCT FROM 'rejected' THEN RAISE EXCEPTION 'cron_jobnames on a github row was %', v_chk_gh; END IF;
    IF v_st IS DISTINCT FROM ARRAY['ok_run:ok', 'failed_run:failed', 'old_ok:stale', 'cut_off:failed', 'none:no_record', 'paused:paused'] THEN
      RAISE EXCEPTION 'state logic probe: %', v_st;
    END IF;
    IF v_at IS DISTINCT FROM ARRAY['false', 'true', 'true', 'true', 'false', 'false'] THEN
      RAISE EXCEPTION 'attention probe (ok, failed, stale, cut_off, no_record, paused): %', v_at;
    END IF;
    IF v_ina IS DISTINCT FROM ARRAY['with_expected:inactive:true', 'without_expected:inactive:false'] THEN
      RAISE EXCEPTION 'inactive attention probe: %', v_ina;
    END IF;
    -- live-scores: judged against what cron.job says; deliberately off (expected_every NULL) = no attention
    IF v_ls IS NULL THEN RAISE EXCEPTION 'live-scores missing from the overview'; END IF;
    IF v_ls_cron = 0 THEN
      IF v_ls->>'state' IS DISTINCT FROM 'inactive' OR v_ls->'attention' IS DISTINCT FROM 'false'::jsonb THEN
        RAISE EXCEPTION 'live-scores (all cron jobs inactive) read state %, attention %', v_ls->>'state', v_ls->>'attention';
      END IF;
    ELSE
      RAISE NOTICE 'live-scores has active cron jobs here; the inactive-and-deliberate assertion is skipped';
    END IF;
    IF (SELECT count(*) FROM public.data_job_runs) IS DISTINCT FROM v_before OR EXISTS (SELECT 1 FROM public.data_jobs WHERE paused OR switchable OR key IN ('probe-github-with-cron', 'probe-inactive-cron')) THEN
      RAISE EXCEPTION 'probe rows leaked';
    END IF;
  END;

  -- the alarm must not silence itself: with every cron run row out of the 30-day window (a clock far in
  -- the future, nothing written), each active, unpaused cron_sql job WITH expected_every reads stale +
  -- attention, with no last_run and no record_source. The count is the positive control (not vacuous).
  IF (SELECT count(*) FROM jsonb_array_elements(public.data_jobs_overview(now() + interval '100 years')) e
       WHERE e->>'runner' = 'cron_sql' AND e->>'expected_every_seconds' IS NOT NULL
         AND e->'cron_active' = 'true'::jsonb AND e->>'paused' = 'false') = 0 THEN
    RAISE EXCEPTION 'no active cron_sql job with expected_every to check the silent-job rule on';
  END IF;
  SELECT string_agg(e->>'key', ', ') INTO v_names
    FROM jsonb_array_elements(public.data_jobs_overview(now() + interval '100 years')) e
   WHERE e->>'runner' = 'cron_sql' AND e->>'expected_every_seconds' IS NOT NULL
     AND e->'cron_active' = 'true'::jsonb AND e->>'paused' = 'false'
     AND (e->>'state' IS DISTINCT FROM 'stale' OR e->'attention' IS DISTINCT FROM 'true'::jsonb
          OR e->'last_run' IS DISTINCT FROM 'null'::jsonb OR e->>'record_source' IS NOT NULL);
  IF v_names IS NOT NULL THEN
    RAISE EXCEPTION 'cron_sql jobs with no run rows that did not read stale + attention: %', v_names;
  END IF;

  -- admin_data_jobs, measured as the role the app uses
  SELECT id INTO v_admin FROM public.profiles WHERE role = 'admin' LIMIT 1;
  IF v_admin IS NULL THEN
    RAISE EXCEPTION 'no admin profile to run the positive control with';
  END IF;
  SELECT count(*) INTO v_rows FROM public.data_jobs;

  SET LOCAL ROLE authenticated;

  -- (a) a real admin session gets one element per registry row
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  v_arr := public.admin_data_jobs();

  -- (b) the same admin sub flagged as an anonymous session is refused
  v_r := 'unset';
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated', 'is_anonymous', true)::text, true);
  BEGIN
    PERFORM public.admin_data_jobs();
    v_r := 'ALLOWED';
  EXCEPTION WHEN raise_exception THEN v_r := SQLERRM;
  END;
  IF v_r IS DISTINCT FROM 'ADMIN_ONLY' THEN
    SET LOCAL ROLE postgres; PERFORM set_config('request.jwt.claims', '', true);
    RAISE EXCEPTION 'an anonymous-flagged admin session got: %', v_r;
  END IF;

  -- (c) a random sub (no profile) is refused
  v_r := 'unset';
  PERFORM set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text, true);
  BEGIN
    PERFORM public.admin_data_jobs();
    v_r := 'ALLOWED';
  EXCEPTION WHEN raise_exception THEN v_r := SQLERRM;
  END;
  IF v_r IS DISTINCT FROM 'ADMIN_ONLY' THEN
    SET LOCAL ROLE postgres; PERFORM set_config('request.jwt.claims', '', true);
    RAISE EXCEPTION 'a random non-admin session got: %', v_r;
  END IF;

  -- (c2) no claims at all (no uid) is refused
  v_r := 'unset';
  PERFORM set_config('request.jwt.claims', '', true);
  BEGIN
    PERFORM public.admin_data_jobs();
    v_r := 'ALLOWED';
  EXCEPTION WHEN raise_exception THEN v_r := SQLERRM;
  END;
  SET LOCAL ROLE postgres;
  PERFORM set_config('request.jwt.claims', '', true);
  IF v_r IS DISTINCT FROM 'ADMIN_ONLY' THEN
    RAISE EXCEPTION 'a session with no uid got: %', v_r;
  END IF;

  IF jsonb_typeof(v_arr) IS DISTINCT FROM 'array' OR jsonb_array_length(v_arr) IS DISTINCT FROM v_rows THEN
    RAISE EXCEPTION 'admin_data_jobs returned % elements for % registry rows', jsonb_array_length(v_arr), v_rows;
  END IF;
  -- shape: every element carries exactly the contract keys
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_arr) e
              WHERE (SELECT array_agg(k ORDER BY k COLLATE "C") FROM jsonb_object_keys(e) k)
                    IS DISTINCT FROM ARRAY['attention', 'cron_active', 'expected_every_seconds', 'key', 'kind', 'last_ok_at', 'last_run', 'paused',
                                           'paused_at', 'paused_note', 'record_source', 'runner', 'schedule', 'state', 'switchable']) THEN
    RAISE EXCEPTION 'admin_data_jobs element keys differ from the contract';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_arr) e WHERE jsonb_typeof(e->'attention') IS DISTINCT FROM 'boolean') THEN
    RAISE EXCEPTION 'an admin_data_jobs element has a non-boolean attention';
  END IF;
  -- the core rule, on the live output: a cron_http / github job with no own record has NO last run,
  -- whatever cron says; and nothing but a cron_sql job may carry record_source cron_sql
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_arr) e
              WHERE e->>'runner' IN ('github', 'cron_http') AND e->>'record_source' IS NOT DISTINCT FROM 'cron_sql') THEN
    RAISE EXCEPTION 'a github / cron_http row carries record_source cron_sql';
  END IF;
  SELECT string_agg(e->>'key', ', ') INTO v_names
    FROM jsonb_array_elements(v_arr) e
   WHERE e->>'runner' IN ('github', 'cron_http')
     AND e->'last_run' IS DISTINCT FROM 'null'::jsonb
     AND NOT EXISTS (SELECT 1 FROM public.data_job_runs r WHERE r.job_key = e->>'key')
     AND NOT (e->>'key' = 'duty-push' AND EXISTS (SELECT 1 FROM public.duty_push_runs))
     AND NOT (e->>'key' = 'weekend-digest' AND EXISTS (SELECT 1 FROM public.weekend_digest_runs WHERE mode = 'all'));
  IF v_names IS NOT NULL THEN
    RAISE EXCEPTION 'jobs with no own record but a last_run: %', v_names;
  END IF;
  -- positive control for the line above: the cron_sql jobs DO read cron's own result when it has one
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_arr) e WHERE e->>'runner' = 'cron_sql' AND e->'last_run' IS DISTINCT FROM 'null'::jsonb) THEN
    RAISE NOTICE 'no cron_sql job has a run in the last 30 days yet (not an error on a fresh pg_cron)';
  END IF;
  RAISE NOTICE 'admin_data_jobs: admin gets the array, anonymous-flagged / random / no-uid sessions refused';
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
VALUES ('20261205_data_jobs.sql', '0192ca097272de0ba8b7eaf058da7e91a14cf849ac9b76b3991507a07306077a')
ON CONFLICT (filename) DO UPDATE
  SET checksum = excluded.checksum, applied_at = now(), applied_by = current_user;
-- ─── ledger:stamp:end ────────────────────────────────────────────────
COMMIT;

RESET ROLE;

NOTIFY pgrst, 'reload schema';

-- ─── Verification after applying (read-only) ────────────────────────────────
--   verify_schema QUERY 1: the 20261205_data_jobs rows must read OK; QUERY 2: the coverage row and purge-data-job-runs.
--
-- ─── Rollback ───────────────────────────────────────────────────────────────
--   SELECT cron.unschedule('purge-data-job-runs');
--   DROP FUNCTION public.admin_data_jobs(); DROP FUNCTION public.record_data_job_run(text,text,text,text,text,timestamptz);
--   DROP FUNCTION public.data_jobs_overview(timestamptz); DROP TABLE public.data_job_runs; DROP TABLE public.data_jobs;
