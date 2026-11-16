-- ═══════════════════════════════════════════════════════════════════════════
-- 20261208_data_jobs_switches — Data jobs, release 2 part 1: the switches (slice 3) and the grace/no-record state fixes
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Applied in ONE supabase-migrate run with its sibling 20261209_data_jobs_watchdog.sql (the watchdog). This file is the part that
-- lets an admin PAUSE seven jobs and makes the "nothing has recorded anything" state honest. It does not
-- unschedule or reschedule any pg_cron job (a new jobid reads stale), and nothing is paused by it.
--
-- ─── WHAT CHANGES ───────────────────────────────────────────────────────────
--  1. data_jobs.records_expected_from (timestamptz, default now()): the start of a job's grace. A job is only
--     judged "stale" (silent, or no success inside expected_every) once p_now is later than
--     records_expected_from + expected_every. Applying this file stamps every row with the apply time, so the
--     release alone pages nobody; resuming a paused job restamps it, so a resume after a long pause does not
--     page at once.
--  2. switchable = true on exactly seven jobs: gisekibris-feed, duyurular-fetch, novest-images, sync-novest,
--     google-places-refresh, duty-push, weekend-digest. Derived and printed by an assertion. Deleters and
--     retention/expiry jobs stay un-switchable (the table CHECKs already forbid retention/expiry).
--  3. data_jobs_overview(): same 15 keys per element, same state order, mappings, 30-day window, cut-off and
--     attention formula as 20261205. Only two things differ:
--       a. a github / cron_http job WITH expected_every and NO record of its own reads 'stale' (attention) once
--          the grace is over, else 'no_record'. This closes 20261205's known limit, including the case where
--          every one of its records was purged (the 90-day delete) or the writer never existed.
--       b. the older stale rules (a cron_sql job with no run row in the window; last success older than
--          expected_every) fire only once the grace is over. Inside the grace they read 'no_record' / 'ok'.
--          failed, cut_off, inactive and paused are unchanged and are never held back by the grace.
--  4. admin_set_data_job_paused(job, paused, note): the admin's switch.
--  5. data_job_gate(job, source, run_ref): the check a runner asks before it starts ('run' or 'paused').
--  6. data_job_paused(job): the helper the two cron gates use.
--  7. duty_push_due() and weekend_digest_due() gain "AND NOT data_job_paused('<job>')". So duty-push and
--     weekend-digest are paused IN SQL: their cron job only POSTs when the due() function says yes. No edge
--     function changes. Their own logs (duty_push_runs, weekend_digest_runs) already are the run records.
--
-- ─── WHO CAN DO WHAT ────────────────────────────────────────────────────────
--   admin_set_data_job_paused: an ADMIN, in the app, signed in and NOT a guest (guests are `authenticated`
--     too, so the gate is the three-part check admin_data_jobs() uses: a user is present, the session is not
--     anonymous, is_admin()). Anyone else gets ADMIN_ONLY. It can only touch rows that are switchable; a
--     non-switchable or unknown job is refused (NOT_SWITCHABLE / UNKNOWN_JOB). To pause, a note of 1 to 200
--     characters (after trimming) is required (NOTE_REQUIRED) and the admin's own id is recorded in paused_by
--     (no foreign key on purpose, as 20261205). Pausing a paused job keeps the original paused_at / paused_by
--     and only updates the note. Resuming clears note / by / at and restamps records_expected_from; resuming a
--     job that is not paused changes nothing. The row is locked (FOR UPDATE) so two admins cannot interleave.
--     Returns that job's element of data_jobs_overview(): job names, states, times, the admin's note. No
--     customer data. SECURITY DEFINER. EXECUTE: authenticated (grant), revoked from PUBLIC and anon (both
--     lines: a new Supabase function is born with anon in its ACL).
--   data_job_gate: service_role ONLY (the server key of GitHub Actions / Edge Functions). Reads the job row;
--     if the job is switchable AND paused it records ONE skipped_paused run (source github|edge, a numeric
--     run_ref) unless one exists for that job in the last 6 hours, and answers 'paused'; otherwise it answers
--     'run' and writes nothing. INVOKER (service_role already has the table rights). A bad job / source /
--     run_ref raises (UNKNOWN_JOB / BAD_SOURCE / BAD_RUN_REF); callers are written to fail OPEN.
--   data_job_paused: a plain read of one boolean (false for an unknown job). EXECUTE: the owner postgres
--     (pg_cron runs the due() jobs as postgres: asserted below from cron.job.username) and service_role.
--     service_role is added to the "owner only" idea on purpose: the two due() functions are still EXECUTE-able
--     by service_role (their migrations revoked only PUBLIC / anon / authenticated), and an INVOKER due()
--     called by service_role would otherwise start failing with a permission error. Nothing calls them as
--     service_role today (checked in the repo: only the two cron jobs). anon / authenticated / PUBLIC: no.
--   data_jobs / data_job_runs stay as 20261205 made them: RLS on, zero policies, no client privilege.
--
-- ─── WHY THE TWO due() FUNCTIONS ARE CHANGED THIS WAY ───────────────────────
--   duty_push_due is from 20261103 (STABLE sql, search_path ''), weekend_digest_due from 20261177 (STABLE sql,
--   search_path public, pg_catalog); no later migration redefines either (20261139/20261180/20261187 only
--   touch the cron commands). The new text keeps the old expression unchanged and adds the pause clause.
--   Volatility, security, search_path and the ACL are asserted unchanged around the replace.
--
-- Public logs: no user totals and no ids are printed; job names are fine.
-- Apply: supabase-migrate (with its sibling in ONE run). Adds a column, so it ends with NOTIFY pgrst.
-- ═══════════════════════════════════════════════════════════════════════════

SET ROLE postgres;

BEGIN;

SET LOCAL lock_timeout = '5s';

-- ─── 0. Pre-flight ──────────────────────────────────────────────────────────
DO $$
BEGIN
  IF to_regclass('public.data_jobs') IS NULL OR to_regclass('public.data_job_runs') IS NULL THEN
    RAISE EXCEPTION 'REFUSING: 20261205 (data_jobs / data_job_runs) is not applied. Nothing applied.';
  END IF;
  IF to_regprocedure('public.duty_push_due(timestamptz)') IS NULL OR to_regprocedure('public.weekend_digest_due(timestamptz)') IS NULL THEN
    RAISE EXCEPTION 'REFUSING: duty_push_due / weekend_digest_due are missing. Nothing applied.';
  END IF;
  IF to_regclass('public.duty_push_runs') IS NULL OR to_regclass('public.weekend_digest_runs') IS NULL THEN
    RAISE EXCEPTION 'REFUSING: duty_push_runs / weekend_digest_runs are missing. Nothing applied.';
  END IF;
  -- what the due() functions look like BEFORE (compared after the replace)
  PERFORM set_config('r2.duty_before', (SELECT concat_ws('|', provolatile, prosecdef::text, proconfig::text, proacl::text, pg_get_userbyid(proowner))
                                          FROM pg_proc WHERE oid = to_regprocedure('public.duty_push_due(timestamptz)')), true);
  PERFORM set_config('r2.weekend_before', (SELECT concat_ws('|', provolatile, prosecdef::text, proconfig::text, proacl::text, pg_get_userbyid(proowner))
                                             FROM pg_proc WHERE oid = to_regprocedure('public.weekend_digest_due(timestamptz)')), true);
END $$;

-- ─── 1. Grace start ─────────────────────────────────────────────────────────
ALTER TABLE public.data_jobs ADD COLUMN IF NOT EXISTS records_expected_from timestamptz NOT NULL DEFAULT now();
COMMENT ON COLUMN public.data_jobs.records_expected_from IS
  'Start of the job''s grace: stale / no-record only count after records_expected_from + expected_every. Set at the 20261208 apply and at every resume. 20261208.';

-- ─── 2. The seven switches ──────────────────────────────────────────────────
UPDATE public.data_jobs SET switchable = true
 WHERE key IN ('gisekibris-feed', 'duyurular-fetch', 'novest-images', 'sync-novest', 'google-places-refresh', 'duty-push', 'weekend-digest');

-- ─── 3. data_jobs_overview(): grace + the github / cron_http no-record tightening ───
-- Same contract (15 keys), same ACL (owner only; reached through admin_data_jobs() and the new set function).
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
           (p_now > d.records_expected_from + d.expected_every) AS grace_over,
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
             WHEN j.expected_every IS NOT NULL AND j.l_key IS NULL AND j.grace_over THEN 'stale'
             WHEN j.l_key IS NULL THEN 'no_record'
             WHEN j.l_outcome = 'failed' OR j.l_cut THEN 'failed'
             WHEN j.expected_every IS NOT NULL AND j.grace_over AND (j.last_ok_at IS NULL OR j.last_ok_at < p_now - j.expected_every) THEN 'stale'
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

-- ─── 4. admin_set_data_job_paused(): the admin's switch ─────────────────────
CREATE OR REPLACE FUNCTION public.admin_set_data_job_paused(p_job text, p_paused boolean, p_note text DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_row  public.data_jobs;
  v_note text;
  v_el   jsonb;
BEGIN
  IF auth.uid() IS NULL OR public.is_anonymous_session() OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'ADMIN_ONLY';
  END IF;
  IF p_job IS NULL OR p_paused IS NULL THEN
    RAISE EXCEPTION 'BAD_ARGS';
  END IF;
  SELECT * INTO v_row FROM public.data_jobs WHERE key = p_job FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'UNKNOWN_JOB';
  END IF;
  IF NOT v_row.switchable THEN
    RAISE EXCEPTION 'NOT_SWITCHABLE';
  END IF;
  IF p_paused THEN
    v_note := regexp_replace(p_note, '^[[:space:]]+|[[:space:]]+$', '', 'g');
    IF v_note IS NULL OR char_length(v_note) NOT BETWEEN 1 AND 200 THEN
      RAISE EXCEPTION 'NOTE_REQUIRED';
    END IF;
    IF v_row.paused THEN
      UPDATE public.data_jobs SET paused_note = v_note WHERE key = p_job;
    ELSE
      UPDATE public.data_jobs SET paused = true, paused_note = v_note, paused_by = auth.uid(), paused_at = now() WHERE key = p_job;
    END IF;
  ELSIF v_row.paused THEN
    UPDATE public.data_jobs
       SET paused = false, paused_note = NULL, paused_by = NULL, paused_at = NULL, records_expected_from = now()
     WHERE key = p_job;
  END IF;
  SELECT e INTO v_el FROM jsonb_array_elements(public.data_jobs_overview(now())) e WHERE e->>'key' = p_job;
  RETURN v_el;
END;
$function$;

-- Both anon lines matter: on Supabase a new function is born with anon in its ACL (see 20261033).
REVOKE ALL ON FUNCTION public.admin_set_data_job_paused(text, boolean, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_set_data_job_paused(text, boolean, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_set_data_job_paused(text, boolean, text) TO authenticated;

-- ─── 5. data_job_gate(): what a runner asks before it starts ────────────────
CREATE OR REPLACE FUNCTION public.data_job_gate(p_job text, p_source text, p_run_ref text DEFAULT NULL)
 RETURNS text
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_sw boolean;
  v_p  boolean;
BEGIN
  SELECT switchable, paused INTO v_sw, v_p FROM public.data_jobs WHERE key = p_job;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'UNKNOWN_JOB';
  END IF;
  IF p_source IS NULL OR p_source NOT IN ('github', 'edge') THEN
    RAISE EXCEPTION 'BAD_SOURCE';
  END IF;
  IF p_run_ref IS NOT NULL AND p_run_ref !~ '^[0-9]{1,20}$' THEN
    RAISE EXCEPTION 'BAD_RUN_REF';
  END IF;
  IF NOT (v_sw AND v_p) THEN
    RETURN 'run';
  END IF;
  -- Serialise concurrent gates for this job, then re-read: the dedupe below must see the other gate's row.
  SELECT paused INTO v_p FROM public.data_jobs WHERE key = p_job FOR UPDATE;
  IF NOT v_p THEN
    RETURN 'run';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.data_job_runs
                  WHERE job_key = p_job AND outcome = 'skipped_paused' AND started_at > now() - interval '6 hours') THEN
    INSERT INTO public.data_job_runs (job_key, started_at, finished_at, outcome, source, run_ref)
    VALUES (p_job, now(), now(), 'skipped_paused', p_source, p_run_ref);
  END IF;
  RETURN 'paused';
END;
$function$;

REVOKE ALL ON FUNCTION public.data_job_gate(text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.data_job_gate(text, text, text) TO service_role;

-- ─── 6. data_job_paused(): the helper the two due() gates use ───────────────
CREATE OR REPLACE FUNCTION public.data_job_paused(p_job text)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  SELECT coalesce((SELECT d.paused FROM public.data_jobs d WHERE d.key = p_job), false)
$function$;

REVOKE ALL ON FUNCTION public.data_job_paused(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.data_job_paused(text) TO service_role;

-- ─── 7. The two due() gates ─────────────────────────────────────────────────
-- Bodies: the latest definitions (20261103 / 20261177), expression unchanged, pause clause added.
CREATE OR REPLACE FUNCTION public.duty_push_due(p_at timestamptz DEFAULT now())
RETURNS boolean LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT (date_trunc('hour', l.t)
           + CASE WHEN extract(minute FROM l.t) >= 30 THEN interval '30 minutes' ELSE interval '0' END
         = l.t::date + CASE extract(isodow FROM l.t)::int
             WHEN 7 THEN time '08:00'
             WHEN 6 THEN time '13:30' - interval '30 minutes'
             WHEN 4 THEN public.duty_thursday_closing_local() - interval '30 minutes'
             ELSE        time '17:30' - interval '30 minutes'
           END)
         AND NOT public.data_job_paused('duty-push')
  FROM (SELECT p_at AT TIME ZONE 'Asia/Famagusta' AS t) l
$$;

CREATE OR REPLACE FUNCTION public.weekend_digest_due(p_at timestamptz DEFAULT now())
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path = public, pg_catalog
AS $fn$
  SELECT extract(isodow FROM (p_at AT TIME ZONE 'Asia/Famagusta')) = 5
     AND to_char(p_at AT TIME ZONE 'Asia/Famagusta', 'HH24') = '17'
     AND extract(minute FROM (p_at AT TIME ZONE 'Asia/Famagusta')) < 30
     AND NOT EXISTS (SELECT 1 FROM public.weekend_digest_runs r
                      WHERE r.mode = 'all'
                        AND (r.started_at AT TIME ZONE 'Asia/Famagusta')::date = (p_at AT TIME ZONE 'Asia/Famagusta')::date)
     AND NOT public.data_job_paused('weekend-digest')
$fn$;

-- ─── Assertions + probes (inside the transaction; a failure rolls the file back) ─
DO $$
DECLARE
  v_names  text;
  v_n      int;
  v_fn     text;
  v_def    text;
  v_admin  uuid;
  v_duty_slot timestamptz;
  v_wk_slot   timestamptz;
BEGIN
  -- the switchable set is EXACTLY the seven (derived, printed), and nothing is paused
  SELECT count(*), string_agg(key, ', ' ORDER BY key) INTO v_n, v_names FROM public.data_jobs WHERE switchable;
  RAISE NOTICE 'switchable jobs (%): %', v_n, v_names;
  IF v_n IS DISTINCT FROM 7 OR v_names IS DISTINCT FROM 'duty-push, duyurular-fetch, gisekibris-feed, google-places-refresh, novest-images, sync-novest, weekend-digest' THEN
    RAISE EXCEPTION 'switchable set is not the seven expected jobs: %', v_names;
  END IF;
  IF EXISTS (SELECT 1 FROM public.data_jobs WHERE paused OR paused_by IS NOT NULL OR paused_at IS NOT NULL OR paused_note IS NOT NULL) THEN
    RAISE EXCEPTION 'a data_jobs row is paused after this migration';
  END IF;
  IF EXISTS (SELECT 1 FROM public.data_jobs WHERE records_expected_from IS NULL OR records_expected_from > now()) THEN
    RAISE EXCEPTION 'records_expected_from is NULL or in the future';
  END IF;

  -- functions: owners, DEFINER / INVOKER, EXECUTE sets (from the ACL, derived)
  FOREACH v_fn IN ARRAY ARRAY['public.data_jobs_overview(timestamptz)', 'public.admin_set_data_job_paused(text,boolean,text)',
                             'public.data_job_gate(text,text,text)', 'public.data_job_paused(text)'] LOOP
    IF to_regprocedure(v_fn) IS NULL THEN RAISE EXCEPTION '% is missing', v_fn; END IF;
    IF (SELECT pg_get_userbyid(p.proowner) FROM pg_proc p WHERE p.oid = to_regprocedure(v_fn)) IS DISTINCT FROM 'postgres' THEN
      RAISE EXCEPTION '% is not owned by postgres', v_fn;
    END IF;
    IF (SELECT p.proacl IS NULL FROM pg_proc p WHERE p.oid = to_regprocedure(v_fn)) THEN
      RAISE EXCEPTION '% carries the default ACL (NULL), which grants PUBLIC', v_fn;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_proc p, LATERAL aclexplode(p.proacl) a
                WHERE p.oid = to_regprocedure(v_fn) AND a.privilege_type = 'EXECUTE' AND a.grantee = 0) THEN
      RAISE EXCEPTION '% is EXECUTE-able by PUBLIC', v_fn;
    END IF;
    RAISE NOTICE '% EXECUTE held by: %', v_fn,
      (SELECT coalesce(string_agg(DISTINCT CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END, ', ' ORDER BY CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END), '(none)')
         FROM pg_proc p, LATERAL aclexplode(p.proacl) a WHERE p.oid = to_regprocedure(v_fn) AND a.privilege_type = 'EXECUTE');
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_proc p, LATERAL aclexplode(p.proacl) a
              WHERE p.oid = to_regprocedure('public.data_jobs_overview(timestamptz)') AND a.privilege_type = 'EXECUTE' AND a.grantee <> p.proowner) THEN
    RAISE EXCEPTION 'data_jobs_overview is EXECUTE-able by a role other than its owner';
  END IF;
  IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = to_regprocedure('public.admin_set_data_job_paused(text,boolean,text)')) THEN
    RAISE EXCEPTION 'admin_set_data_job_paused must be SECURITY DEFINER';
  END IF;
  IF (SELECT prosecdef FROM pg_proc WHERE oid = to_regprocedure('public.data_job_gate(text,text,text)'))
     OR (SELECT prosecdef FROM pg_proc WHERE oid = to_regprocedure('public.data_job_paused(text)'))
     OR (SELECT prosecdef FROM pg_proc WHERE oid = to_regprocedure('public.data_jobs_overview(timestamptz)')) THEN
    RAISE EXCEPTION 'data_job_gate / data_job_paused / data_jobs_overview must be INVOKER';
  END IF;
  IF has_function_privilege('anon', 'public.admin_set_data_job_paused(text,boolean,text)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.admin_set_data_job_paused(text,boolean,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'admin_set_data_job_paused grants are wrong (anon must not, authenticated must)';
  END IF;
  IF has_function_privilege('anon', 'public.data_job_gate(text,text,text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.data_job_gate(text,text,text)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.data_job_gate(text,text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'data_job_gate must be EXECUTE for service_role only';
  END IF;
  IF has_function_privilege('anon', 'public.data_job_paused(text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.data_job_paused(text)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.data_job_paused(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'data_job_paused grants are wrong';
  END IF;

  -- who calls the due() functions: every pg_cron job that does must run as a role holding EXECUTE on the helper
  SELECT string_agg(j.jobname || ' as ' || j.username, ', ' ORDER BY j.jobname) INTO v_names
    FROM cron.job j
   WHERE (j.command LIKE '%public.duty_push_due()%' OR j.command LIKE '%public.weekend_digest_due()%')
     AND NOT has_function_privilege(j.username, 'public.data_job_paused(text)', 'EXECUTE');
  IF v_names IS NOT NULL THEN
    RAISE EXCEPTION 'a cron job calling a due() gate runs as a role without EXECUTE on data_job_paused: %', v_names;
  END IF;
  SELECT string_agg(j.jobname || ' as ' || j.username, ', ' ORDER BY j.jobname), count(*) INTO v_names, v_n
    FROM cron.job j WHERE j.command LIKE '%public.duty_push_due()%' OR j.command LIKE '%public.weekend_digest_due()%';
  RAISE NOTICE 'cron jobs calling a due() gate (%): %', v_n, v_names;
  IF v_n IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION 'expected exactly two cron jobs calling a due() gate, found %: %', v_n, v_names;
  END IF;

  -- the due() functions: same volatility / security / search_path / ACL / owner as before; old body kept, pause added
  IF (SELECT concat_ws('|', provolatile, prosecdef::text, proconfig::text, proacl::text, pg_get_userbyid(proowner))
        FROM pg_proc WHERE oid = to_regprocedure('public.duty_push_due(timestamptz)')) IS DISTINCT FROM current_setting('r2.duty_before') THEN
    RAISE EXCEPTION 'duty_push_due changed volatility / security / search_path / ACL / owner: before %, after %', current_setting('r2.duty_before'),
      (SELECT concat_ws('|', provolatile, prosecdef::text, proconfig::text, proacl::text, pg_get_userbyid(proowner)) FROM pg_proc WHERE oid = to_regprocedure('public.duty_push_due(timestamptz)'));
  END IF;
  IF (SELECT concat_ws('|', provolatile, prosecdef::text, proconfig::text, proacl::text, pg_get_userbyid(proowner))
        FROM pg_proc WHERE oid = to_regprocedure('public.weekend_digest_due(timestamptz)')) IS DISTINCT FROM current_setting('r2.weekend_before') THEN
    RAISE EXCEPTION 'weekend_digest_due changed volatility / security / search_path / ACL / owner: before %, after %', current_setting('r2.weekend_before'),
      (SELECT concat_ws('|', provolatile, prosecdef::text, proconfig::text, proacl::text, pg_get_userbyid(proowner)) FROM pg_proc WHERE oid = to_regprocedure('public.weekend_digest_due(timestamptz)'));
  END IF;
  v_def := pg_get_functiondef(to_regprocedure('public.duty_push_due(timestamptz)'));
  IF v_def NOT LIKE '%AND NOT public.data_job_paused(''duty-push'')%'
     OR v_def NOT LIKE '%WHEN 7 THEN time ''08:00''%'
     OR v_def NOT LIKE '%WHEN 4 THEN public.duty_thursday_closing_local() - interval ''30 minutes''%'
     OR v_def NOT LIKE '%FROM (SELECT p_at AT TIME ZONE ''Asia/Famagusta'' AS t) l%' THEN
    RAISE EXCEPTION 'duty_push_due: pause clause or an anchor of the old body is missing';
  END IF;
  v_def := pg_get_functiondef(to_regprocedure('public.weekend_digest_due(timestamptz)'));
  IF v_def NOT LIKE '%AND NOT public.data_job_paused(''weekend-digest'')%'
     OR v_def NOT LIKE '%extract(isodow FROM (p_at AT TIME ZONE ''Asia/Famagusta'')) = 5%'
     OR v_def NOT LIKE '%AND NOT EXISTS (SELECT 1 FROM public.weekend_digest_runs r%' THEN
    RAISE EXCEPTION 'weekend_digest_due: pause clause or an anchor of the old body is missing';
  END IF;

  -- the existing slot logic still answers (fixed instants; 20261103 / 20261177 assertions, minus the live-run date)
  IF NOT public.duty_push_due('2026-10-15 14:00:04+00') OR public.duty_push_due('2026-10-15 10:00:04+00') THEN
    RAISE EXCEPTION 'duty_push_due slot logic changed';
  END IF;

  -- coverage is unchanged by this file; counted again so a stray edit shows
  SELECT string_agg(j.jobname, ', ' ORDER BY j.jobname) INTO v_names
    FROM cron.job j WHERE (SELECT count(*) FROM public.data_jobs d WHERE j.jobname = ANY (d.cron_jobnames)) IS DISTINCT FROM 1;
  IF v_names IS NOT NULL THEN RAISE EXCEPTION 'cron jobs not covered by exactly one data_jobs row: %', v_names; END IF;

  SELECT id INTO v_admin FROM public.profiles WHERE role = 'admin' LIMIT 1;
  IF v_admin IS NULL THEN RAISE EXCEPTION 'no admin profile to run the positive control with'; END IF;

  -- behaviour probes. Everything inside the sub-block is rolled back (ZZ_PROBE_ROLLBACK).
  DECLARE
    v_res    text[] := ARRAY[]::text[];
    v_r      text;
    v_el     jsonb;
    v_pa     timestamptz;
    v_pb     uuid;
    v_before int;
    v_rows   int;
    v_far    timestamptz := now() + interval '100 years';
    v_expect text[];
  BEGIN
    SELECT count(*) INTO v_before FROM public.data_job_runs;
    BEGIN
      ---------------------------------------------------------------- grace + the github / cron_http tightening
      -- github job, expected 1 hour, nothing recorded: inside the grace no_record, after it stale (attention)
      UPDATE public.data_jobs SET records_expected_from = now() WHERE key = 'araclar-photo-cleanup';
      UPDATE public.data_jobs SET expected_every = interval '1 hour' WHERE key = 'araclar-photo-cleanup';
      DELETE FROM public.data_job_runs WHERE job_key = 'araclar-photo-cleanup';
      SELECT e->>'state' || ':' || (e->>'attention') INTO v_r FROM jsonb_array_elements(public.data_jobs_overview(now())) e WHERE e->>'key' = 'araclar-photo-cleanup';
      v_res := v_res || ('gh_no_record_in_grace=' || v_r);
      SELECT e->>'state' || ':' || (e->>'attention') INTO v_r FROM jsonb_array_elements(public.data_jobs_overview(now() + interval '59 minutes')) e WHERE e->>'key' = 'araclar-photo-cleanup';
      v_res := v_res || ('gh_just_inside=' || v_r);
      SELECT e->>'state' || ':' || (e->>'attention') INTO v_r FROM jsonb_array_elements(public.data_jobs_overview(now() + interval '61 minutes')) e WHERE e->>'key' = 'araclar-photo-cleanup';
      v_res := v_res || ('gh_no_record_after_grace=' || v_r);
      -- all records purged but a grace long over: stale, not neutral
      UPDATE public.data_jobs SET records_expected_from = now() - interval '10 days' WHERE key = 'araclar-photo-cleanup';
      SELECT e->>'state' || ':' || (e->>'attention') INTO v_r FROM jsonb_array_elements(public.data_jobs_overview(now())) e WHERE e->>'key' = 'araclar-photo-cleanup';
      v_res := v_res || ('gh_purged=' || v_r);
      -- an old success, grace over: stale; the same old success inside a fresh grace: ok (not held back falsely)
      INSERT INTO public.data_job_runs (job_key, started_at, finished_at, outcome, source) VALUES
        ('araclar-photo-cleanup', now() - interval '40 hours', now() - interval '40 hours', 'ok', 'github');
      SELECT e->>'state' INTO v_r FROM jsonb_array_elements(public.data_jobs_overview(now())) e WHERE e->>'key' = 'araclar-photo-cleanup';
      v_res := v_res || ('gh_old_ok_grace_over=' || v_r);
      UPDATE public.data_jobs SET records_expected_from = now() WHERE key = 'araclar-photo-cleanup';
      SELECT e->>'state' INTO v_r FROM jsonb_array_elements(public.data_jobs_overview(now())) e WHERE e->>'key' = 'araclar-photo-cleanup';
      v_res := v_res || ('gh_old_ok_in_grace=' || v_r);
      -- a failed run is never held back by the grace
      INSERT INTO public.data_job_runs (job_key, started_at, finished_at, outcome, error_class, source) VALUES
        ('araclar-photo-cleanup', now() - interval '5 minutes', now() - interval '4 minutes', 'failed', 'http_500', 'github');
      SELECT e->>'state' || ':' || (e->>'attention') INTO v_r FROM jsonb_array_elements(public.data_jobs_overview(now())) e WHERE e->>'key' = 'araclar-photo-cleanup';
      v_res := v_res || ('gh_failed_in_grace=' || v_r);
      DELETE FROM public.data_job_runs WHERE job_key = 'araclar-photo-cleanup';

      -- a silent cron_sql job (no run row in the 30-day window: the clock is 100 years ahead): grace decides
      UPDATE public.data_jobs SET records_expected_from = v_far - interval '1 hour' WHERE key = 'purge-oli-messages';
      SELECT e->>'state' || ':' || (e->>'attention') INTO v_r FROM jsonb_array_elements(public.data_jobs_overview(v_far)) e WHERE e->>'key' = 'purge-oli-messages';
      v_res := v_res || ('sql_silent_in_grace=' || v_r);
      UPDATE public.data_jobs SET records_expected_from = v_far - interval '40 hours' WHERE key = 'purge-oli-messages';
      SELECT e->>'state' || ':' || (e->>'attention') INTO v_r FROM jsonb_array_elements(public.data_jobs_overview(v_far)) e WHERE e->>'key' = 'purge-oli-messages';
      v_res := v_res || ('sql_silent_grace_over=' || v_r);

      ---------------------------------------------------------------- admin_set_data_job_paused, as the role the app uses
      SET LOCAL ROLE authenticated;
      PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
      BEGIN PERFORM public.admin_set_data_job_paused('no-such-job', true, 'x');   v_r := 'ALLOWED'; EXCEPTION WHEN OTHERS THEN v_r := SQLERRM; END; v_res := v_res || ('unknown=' || v_r);
      BEGIN PERFORM public.admin_set_data_job_paused('araclar-photo-cleanup', true, 'x'); v_r := 'ALLOWED'; EXCEPTION WHEN OTHERS THEN v_r := SQLERRM; END; v_res := v_res || ('not_switchable=' || v_r);
      BEGIN PERFORM public.admin_set_data_job_paused('novest-images', NULL, 'x'); v_r := 'ALLOWED'; EXCEPTION WHEN OTHERS THEN v_r := SQLERRM; END; v_res := v_res || ('null_paused=' || v_r);
      BEGIN PERFORM public.admin_set_data_job_paused('novest-images', true, NULL); v_r := 'ALLOWED'; EXCEPTION WHEN OTHERS THEN v_r := SQLERRM; END; v_res := v_res || ('note_null=' || v_r);
      BEGIN PERFORM public.admin_set_data_job_paused('novest-images', true, E'  \t '); v_r := 'ALLOWED'; EXCEPTION WHEN OTHERS THEN v_r := SQLERRM; END; v_res := v_res || ('note_blank=' || v_r);
      BEGIN PERFORM public.admin_set_data_job_paused('novest-images', true, repeat('x', 201)); v_r := 'ALLOWED'; EXCEPTION WHEN OTHERS THEN v_r := SQLERRM; END; v_res := v_res || ('note_201=' || v_r);
      -- pause (200 characters is the limit and is accepted; trimmed first)
      v_el := public.admin_set_data_job_paused('novest-images', true, '  ' || repeat('x', 200) || '  ');
      v_res := v_res || ('pause=' || (v_el->>'state') || ':' || (v_el->>'paused') || ':' || char_length(v_el->>'paused_note'));
      SET LOCAL ROLE postgres;
      SELECT paused_at, paused_by INTO v_pa, v_pb FROM public.data_jobs WHERE key = 'novest-images';
      v_res := v_res || ('paused_by_is_admin=' || (v_pb IS NOT DISTINCT FROM v_admin)::text || ' paused_at_set=' || (v_pa IS NOT NULL)::text);
      -- pause again later with a new note: the original paused_at / paused_by stay
      UPDATE public.data_jobs SET paused_at = paused_at - interval '1 day' WHERE key = 'novest-images';
      SELECT paused_at INTO v_pa FROM public.data_jobs WHERE key = 'novest-images';
      SET LOCAL ROLE authenticated;
      v_el := public.admin_set_data_job_paused('novest-images', true, 'second note');
      SET LOCAL ROLE postgres;
      v_res := v_res || ('repause=' || (v_el->>'paused_note') || ':' || ((SELECT paused_at FROM public.data_jobs WHERE key = 'novest-images') IS NOT DISTINCT FROM v_pa)::text
                         || ':' || ((SELECT paused_by FROM public.data_jobs WHERE key = 'novest-images') IS NOT DISTINCT FROM v_admin)::text);
      -- resume: cleared, grace restamped; the app sends a NULL note on resume
      UPDATE public.data_jobs SET records_expected_from = now() - interval '10 days' WHERE key = 'novest-images';
      SET LOCAL ROLE authenticated;
      v_el := public.admin_set_data_job_paused('novest-images', false, NULL);
      SET LOCAL ROLE postgres;
      v_res := v_res || ('resume=' || (v_el->>'paused') || ':' || coalesce(v_el->>'paused_note', 'null') || ':' || coalesce(v_el->>'paused_at', 'null'));
      v_res := v_res || ('resume_row=' || (SELECT (paused_by IS NULL AND paused_note IS NULL AND paused_at IS NULL AND records_expected_from = now())::text FROM public.data_jobs WHERE key = 'novest-images'));
      -- resuming a job that is not paused changes nothing (the grace is not restamped)
      UPDATE public.data_jobs SET records_expected_from = now() - interval '10 days' WHERE key = 'novest-images';
      SET LOCAL ROLE authenticated;
      PERFORM public.admin_set_data_job_paused('novest-images', false, NULL);
      SET LOCAL ROLE postgres;
      v_res := v_res || ('resume_noop=' || (SELECT (records_expected_from < now() - interval '9 days')::text FROM public.data_jobs WHERE key = 'novest-images'));
      -- who is refused: an admin sub flagged anonymous, a random sub, no claims, and the anon role itself
      SET LOCAL ROLE authenticated;
      PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated', 'is_anonymous', true)::text, true);
      BEGIN PERFORM public.admin_set_data_job_paused('novest-images', true, 'x'); v_r := 'ALLOWED'; EXCEPTION WHEN OTHERS THEN v_r := SQLERRM; END; v_res := v_res || ('guest_admin=' || v_r);
      PERFORM set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text, true);
      BEGIN PERFORM public.admin_set_data_job_paused('novest-images', true, 'x'); v_r := 'ALLOWED'; EXCEPTION WHEN OTHERS THEN v_r := SQLERRM; END; v_res := v_res || ('random_sub=' || v_r);
      PERFORM set_config('request.jwt.claims', '', true);
      BEGIN PERFORM public.admin_set_data_job_paused('novest-images', true, 'x'); v_r := 'ALLOWED'; EXCEPTION WHEN OTHERS THEN v_r := SQLERRM; END; v_res := v_res || ('no_uid=' || v_r);
      SET LOCAL ROLE postgres;
      SET LOCAL ROLE anon;
      BEGIN PERFORM public.admin_set_data_job_paused('novest-images', true, 'x'); v_r := 'ALLOWED'; EXCEPTION WHEN insufficient_privilege THEN v_r := 'denied'; WHEN OTHERS THEN v_r := SQLERRM; END; v_res := v_res || ('anon_role=' || v_r);
      BEGIN PERFORM public.data_job_gate('novest-images', 'github'); v_r := 'ALLOWED'; EXCEPTION WHEN insufficient_privilege THEN v_r := 'denied'; WHEN OTHERS THEN v_r := SQLERRM; END; v_res := v_res || ('anon_gate=' || v_r);
      BEGIN PERFORM public.data_job_paused('novest-images'); v_r := 'ALLOWED'; EXCEPTION WHEN insufficient_privilege THEN v_r := 'denied'; WHEN OTHERS THEN v_r := SQLERRM; END; v_res := v_res || ('anon_helper=' || v_r);
      SET LOCAL ROLE authenticated;
      PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
      BEGIN PERFORM public.data_job_gate('novest-images', 'github'); v_r := 'ALLOWED'; EXCEPTION WHEN insufficient_privilege THEN v_r := 'denied'; WHEN OTHERS THEN v_r := SQLERRM; END; v_res := v_res || ('auth_gate=' || v_r);
      BEGIN PERFORM public.data_job_paused('novest-images'); v_r := 'ALLOWED'; EXCEPTION WHEN insufficient_privilege THEN v_r := 'denied'; WHEN OTHERS THEN v_r := SQLERRM; END; v_res := v_res || ('auth_helper=' || v_r);
      SET LOCAL ROLE postgres;
      PERFORM set_config('request.jwt.claims', '', true);

      ---------------------------------------------------------------- data_job_gate, as service_role
      SET LOCAL ROLE service_role;
      v_res := v_res || ('gate_running=' || public.data_job_gate('novest-images', 'github', '123'));
      v_res := v_res || ('gate_not_switchable=' || public.data_job_gate('araclar-photo-cleanup', 'github'));
      SET LOCAL ROLE postgres;
      v_res := v_res || ('gate_rows_when_running=' || (SELECT count(*) FROM public.data_job_runs WHERE outcome = 'skipped_paused' AND job_key IN ('novest-images', 'araclar-photo-cleanup'))::text);
      UPDATE public.data_jobs SET paused = true, paused_note = 'probe', paused_by = v_admin, paused_at = now() WHERE key = 'novest-images';
      SET LOCAL ROLE service_role;
      v_res := v_res || ('gate_paused_1=' || public.data_job_gate('novest-images', 'edge', '123456'));
      v_res := v_res || ('gate_paused_2=' || public.data_job_gate('novest-images', 'github', '999'));
      SET LOCAL ROLE postgres;
      v_res := v_res || ('gate_rows_deduped=' || (SELECT count(*) || ':' || min(source) || ':' || min(run_ref) FROM public.data_job_runs WHERE job_key = 'novest-images' AND outcome = 'skipped_paused'));
      UPDATE public.data_job_runs SET started_at = now() - interval '7 hours', finished_at = now() - interval '7 hours' WHERE job_key = 'novest-images' AND outcome = 'skipped_paused';
      SET LOCAL ROLE service_role;
      v_res := v_res || ('gate_paused_after_6h=' || public.data_job_gate('novest-images', 'github'));
      BEGIN PERFORM public.data_job_gate('no-such-job', 'github');       v_r := 'ALLOWED'; EXCEPTION WHEN OTHERS THEN v_r := SQLERRM; END; v_res := v_res || ('gate_unknown=' || v_r);
      BEGIN PERFORM public.data_job_gate('novest-images', 'cron');       v_r := 'ALLOWED'; EXCEPTION WHEN OTHERS THEN v_r := SQLERRM; END; v_res := v_res || ('gate_bad_source=' || v_r);
      BEGIN PERFORM public.data_job_gate('novest-images', 'github', 'abc'); v_r := 'ALLOWED'; EXCEPTION WHEN OTHERS THEN v_r := SQLERRM; END; v_res := v_res || ('gate_bad_ref=' || v_r);
      v_res := v_res || ('helper_service_role=' || public.data_job_paused('novest-images')::text || ':' || public.data_job_paused('no-such-job')::text);
      SET LOCAL ROLE postgres;
      v_res := v_res || ('gate_rows_after_6h=' || (SELECT count(*) FROM public.data_job_runs WHERE job_key = 'novest-images' AND outcome = 'skipped_paused')::text);
      -- the gate row reads as paused, not as a failure, in the overview
      SELECT e->>'state' || ':' || (e->>'attention') INTO v_r FROM jsonb_array_elements(public.data_jobs_overview(now())) e WHERE e->>'key' = 'novest-images';
      v_res := v_res || ('overview_paused=' || v_r);
      UPDATE public.data_jobs SET paused = false, paused_note = NULL, paused_by = NULL, paused_at = NULL WHERE key = 'novest-images';

      ---------------------------------------------------------------- the two due() gates flip with the pause
      SELECT min(t) INTO v_duty_slot FROM generate_series(timestamptz '2030-01-07 00:00+00', timestamptz '2030-01-14 00:00+00', interval '30 minutes') t
       WHERE public.duty_push_due(t);
      SELECT min(t) INTO v_wk_slot FROM generate_series(timestamptz '2030-01-07 00:00+00', timestamptz '2030-01-14 00:00+00', interval '30 minutes') t
       WHERE public.weekend_digest_due(t);
      IF v_duty_slot IS NULL OR v_wk_slot IS NULL THEN
        RAISE EXCEPTION 'no due slot found to probe the pause on (duty %, weekend %)', v_duty_slot, v_wk_slot;
      END IF;
      v_res := v_res || ('due_before=' || public.duty_push_due(v_duty_slot)::text || ':' || public.weekend_digest_due(v_wk_slot)::text);
      UPDATE public.data_jobs SET paused = true, paused_note = 'probe', paused_by = v_admin, paused_at = now() WHERE key IN ('duty-push', 'weekend-digest');
      v_res := v_res || ('due_paused=' || public.duty_push_due(v_duty_slot)::text || ':' || public.weekend_digest_due(v_wk_slot)::text);
      UPDATE public.data_jobs SET paused = false, paused_note = NULL, paused_by = NULL, paused_at = NULL WHERE key = 'duty-push';
      v_res := v_res || ('due_duty_resumed_only=' || public.duty_push_due(v_duty_slot)::text || ':' || public.weekend_digest_due(v_wk_slot)::text);
      UPDATE public.data_jobs SET paused = false, paused_note = NULL, paused_by = NULL, paused_at = NULL WHERE key = 'weekend-digest';
      v_res := v_res || ('due_resumed=' || public.duty_push_due(v_duty_slot)::text || ':' || public.weekend_digest_due(v_wk_slot)::text);
      -- the helper is read as service_role too (the role that could still call a due() gate over RPC)
      UPDATE public.data_jobs SET paused = true, paused_note = 'probe', paused_by = v_admin, paused_at = now() WHERE key = 'duty-push';
      SET LOCAL ROLE service_role;
      v_res := v_res || ('due_as_service_role=' || public.duty_push_due(v_duty_slot)::text);
      SET LOCAL ROLE postgres;

      RAISE EXCEPTION 'ZZ_PROBE_ROLLBACK';
    EXCEPTION WHEN raise_exception THEN
      IF SQLERRM IS DISTINCT FROM 'ZZ_PROBE_ROLLBACK' THEN RAISE; END IF;
    END;
    SET LOCAL ROLE postgres;

    v_expect := ARRAY[
      'gh_no_record_in_grace=no_record:false', 'gh_just_inside=no_record:false', 'gh_no_record_after_grace=stale:true', 'gh_purged=stale:true',
      'gh_old_ok_grace_over=stale', 'gh_old_ok_in_grace=ok', 'gh_failed_in_grace=failed:true',
      'sql_silent_in_grace=no_record:false', 'sql_silent_grace_over=stale:true',
      'unknown=UNKNOWN_JOB', 'not_switchable=NOT_SWITCHABLE', 'null_paused=BAD_ARGS', 'note_null=NOTE_REQUIRED', 'note_blank=NOTE_REQUIRED', 'note_201=NOTE_REQUIRED',
      'pause=paused:true:200', 'paused_by_is_admin=true paused_at_set=true',
      'repause=second note:true:true',
      'resume=false:null:null', 'resume_row=true', 'resume_noop=true',
      'guest_admin=ADMIN_ONLY', 'random_sub=ADMIN_ONLY', 'no_uid=ADMIN_ONLY', 'anon_role=denied', 'anon_gate=denied', 'anon_helper=denied', 'auth_gate=denied', 'auth_helper=denied',
      'gate_running=run', 'gate_not_switchable=run', 'gate_rows_when_running=0',
      'gate_paused_1=paused', 'gate_paused_2=paused', 'gate_rows_deduped=1:edge:123456',
      'gate_paused_after_6h=paused', 'gate_unknown=UNKNOWN_JOB', 'gate_bad_source=BAD_SOURCE', 'gate_bad_ref=BAD_RUN_REF',
      'helper_service_role=true:false', 'gate_rows_after_6h=2', 'overview_paused=paused:false',
      'due_before=true:true', 'due_paused=false:false', 'due_duty_resumed_only=true:false', 'due_resumed=true:true', 'due_as_service_role=false'];
    IF v_res IS DISTINCT FROM v_expect THEN
      RAISE EXCEPTION 'probe results differ. got: % | expected: %', v_res, v_expect;
    END IF;
    RAISE NOTICE 'probes (% checks): %', cardinality(v_res), v_res;

    IF (SELECT count(*) FROM public.data_job_runs) IS DISTINCT FROM v_before
       OR EXISTS (SELECT 1 FROM public.data_jobs WHERE paused OR paused_by IS NOT NULL OR paused_note IS NOT NULL)
       OR (SELECT count(*) FROM public.data_jobs WHERE switchable) IS DISTINCT FROM 7
       OR EXISTS (SELECT 1 FROM public.data_jobs WHERE records_expected_from < now() - interval '1 day') THEN
      RAISE EXCEPTION 'probe rows leaked';
    END IF;
  END;

  -- the alarm still cannot silence itself: a clock far in the future (grace over everywhere, no cron run rows in
  -- the window), every active unpaused cron_sql job WITH expected_every reads stale + attention. The count is the control.
  IF (SELECT count(*) FROM jsonb_array_elements(public.data_jobs_overview(now() + interval '100 years')) e
       WHERE e->>'runner' = 'cron_sql' AND e->>'expected_every_seconds' IS NOT NULL AND e->'cron_active' = 'true'::jsonb AND e->>'paused' = 'false') = 0 THEN
    RAISE EXCEPTION 'no active cron_sql job with expected_every to check the silent-job rule on';
  END IF;
  SELECT string_agg(e->>'key', ', ') INTO v_names
    FROM jsonb_array_elements(public.data_jobs_overview(now() + interval '100 years')) e
   WHERE e->>'runner' IN ('cron_sql', 'github', 'cron_http') AND e->>'expected_every_seconds' IS NOT NULL
     AND (e->>'runner' = 'cron_sql' OR NOT EXISTS (SELECT 1 FROM public.data_job_runs r WHERE r.job_key = e->>'key'))
     AND e->'cron_active' IS DISTINCT FROM 'false'::jsonb AND e->>'paused' = 'false'
     AND e->>'record_source' IS NULL
     AND (e->>'state' IS DISTINCT FROM 'stale' OR e->'attention' IS DISTINCT FROM 'true'::jsonb);
  IF v_names IS NOT NULL THEN
    RAISE EXCEPTION 'jobs with no records of their own that did not read stale + attention after the grace: %', v_names;
  END IF;
  -- the contract: the same 15 keys on every element
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(public.data_jobs_overview(now())) e
              WHERE (SELECT array_agg(k ORDER BY k COLLATE "C") FROM jsonb_object_keys(e) k)
                    IS DISTINCT FROM ARRAY['attention', 'cron_active', 'expected_every_seconds', 'key', 'kind', 'last_ok_at', 'last_run', 'paused',
                                           'paused_at', 'paused_note', 'record_source', 'runner', 'schedule', 'state', 'switchable']) THEN
    RAISE EXCEPTION 'data_jobs_overview element keys differ from the contract';
  END IF;
  -- at the moment of the apply every grace has just started, so no job may read 'stale' (a row whose grace is older is judged on its merits)
  SELECT string_agg(e->>'key', ', ') INTO v_names FROM jsonb_array_elements(public.data_jobs_overview(now())) e
   WHERE e->>'state' = 'stale' AND (SELECT d.records_expected_from FROM public.data_jobs d WHERE d.key = e->>'key') >= now() - interval '1 minute';
  RAISE NOTICE 'jobs reading stale at apply time (should be none): %', coalesce(v_names, '(none)');
  IF v_names IS NOT NULL THEN
    RAISE EXCEPTION 'jobs read stale at the moment of the apply, the grace did not hold: %', v_names;
  END IF;
  RAISE NOTICE '20261208_data_jobs_switches OK: seven switches, grace, admin switch, gate, due() pause';
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
VALUES ('20261208_data_jobs_switches.sql', 'bff22912a99439937b83aed016c793fd4a1d31c98012ef829eece826c5c3341b')
ON CONFLICT (filename) DO UPDATE
  SET checksum = excluded.checksum, applied_at = now(), applied_by = current_user;
-- ─── ledger:stamp:end ────────────────────────────────────────────────
COMMIT;

RESET ROLE;

NOTIFY pgrst, 'reload schema';

-- ─── Rollback (by hand, as a new migration, only if ever needed) ────────────
--   CREATE OR REPLACE both due() functions from 20261103 / 20261177 again; DROP FUNCTION data_job_paused(text),
--   data_job_gate(text,text,text), admin_set_data_job_paused(text,boolean,text); UPDATE data_jobs SET switchable = false;
--   ALTER TABLE data_jobs DROP COLUMN records_expected_from (after restoring data_jobs_overview from 20261205).
