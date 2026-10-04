-- ═══════════════════════════════════════════════════════════════════════════
-- 20261072 — Live Scores cron: daily fetch + quota-gated minute poll, three sports
-- ═══════════════════════════════════════════════════════════════════════════
--
-- WHY A MIGRATION AND NOT A HAND-RUN SCRIPT. The draft was supabase/live_scores_schedule.sql,
-- to be pasted into the SQL editor. No Mac holds a production credential; the only write
-- path is the supabase-migrate workflow, which gives this the ledger, one transaction and
-- the assertions below. Precedent: 20261050 schedules its purge job the same way.
--
-- NO KEY IN THIS FILE, AND NONE IN cron.job. Every job reads the service_role key from
-- Vault at call time — the secret the sync-novest jobs already use ('novest_sync_key',
-- supabase/functions/sync-novest/rotate-cron-to-vault.sql), so there is one copy to rotate.
-- The DO block asserts the secret EXISTS (by name; it never reads the value) and that no
-- job command carries an inline JWT.
--
-- ─── THE JOBS (all times UTC; TRNC is UTC+3 in summer) ──────────────────────
--   live-scores-{football,basketball,f1}-daily   03:00 / 03:02 / 03:04 = 06:0x TRNC
--     football/basketball: today's + tomorrow's games (UTC dates; covers NBA overnight).
--     f1: yesterday/today/tomorrow sessions + any finished race's final classification.
--   live-scores-{football,basketball,f1}-poll    every minute, POSTS ONLY WHEN DUE
--     The CTE advances live_sync_state.next_poll_at by 7 minutes IN THE SAME STATEMENT,
--     before posting. net.http_post is fire-and-forget, so this lease is what stops a slow
--     or crashed function being re-fired every minute; claim_api_request (90/day/sport) is
--     the second fence. The function then writes the real next_poll_at. An idle minute is
--     one UPDATE matching nothing: no invocation, no API request.
--
-- ─── THE FIRST RUN ──────────────────────────────────────────────────────────
-- After scheduling, this file POSTs one daily run per sport so data lands now rather than
-- at 03:00 tomorrow. pg_net sends after COMMIT; a rolled-back apply sends nothing. The
-- ledger refuses a second apply, so this fires exactly once.
--
-- ─── HEALTH: READ THE DATA, NOT cron.job_run_details ────────────────────────
-- 'succeeded' there means the POST was QUEUED. What cannot lie:
--   select sport, next_poll_at, last_run_at, last_daily_on, last_error from live_sync_state;
--   select * from api_quota_log where day = (now() at time zone 'utc')::date;
--   select at, sport, endpoint, http_status, results, error from api_request_log order by at desc limit 20;
--
-- Apply: gh workflow run supabase-migrate -f file=20261072_live_scores_cron.sql
-- PRECONDITION: live-scores-football, -basketball, -f1 deployed; API_SPORTS_KEY set.
-- ═══════════════════════════════════════════════════════════════════════════

SET ROLE postgres;

BEGIN;

SET LOCAL lock_timeout = '5s';

DO $$
DECLARE j text;
BEGIN
  IF (SELECT count(*) FROM vault.secrets WHERE name = 'novest_sync_key') IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'Vault secret novest_sync_key is missing — every job would POST without a key';
  END IF;
  FOREACH j IN ARRAY ARRAY['live-scores-football-daily','live-scores-basketball-daily','live-scores-f1-daily',
                           'live-scores-football-poll','live-scores-basketball-poll','live-scores-f1-poll'] LOOP
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = j) THEN PERFORM cron.unschedule(j); END IF;
  END LOOP;
END $$;

SELECT cron.schedule('live-scores-football-daily', '0 3 * * *', $job$
  SELECT net.http_post(
    url     := 'https://jeihxnwqytnxtytgkzgf.supabase.co/functions/v1/live-scores-football',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' ||
                 (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'novest_sync_key')),
    body    := '{"mode":"daily"}'::jsonb);
$job$);

SELECT cron.schedule('live-scores-basketball-daily', '2 3 * * *', $job$
  SELECT net.http_post(
    url     := 'https://jeihxnwqytnxtytgkzgf.supabase.co/functions/v1/live-scores-basketball',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' ||
                 (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'novest_sync_key')),
    body    := '{"mode":"daily"}'::jsonb);
$job$);

SELECT cron.schedule('live-scores-f1-daily', '4 3 * * *', $job$
  SELECT net.http_post(
    url     := 'https://jeihxnwqytnxtytgkzgf.supabase.co/functions/v1/live-scores-f1',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' ||
                 (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'novest_sync_key')),
    body    := '{"mode":"daily"}'::jsonb);
$job$);

SELECT cron.schedule('live-scores-football-poll', '* * * * *', $job$
  WITH due AS (
    UPDATE public.live_sync_state SET next_poll_at = now() + interval '7 minutes'
     WHERE sport = 'football' AND next_poll_at <= now()
    RETURNING sport)
  SELECT net.http_post(
    url     := 'https://jeihxnwqytnxtytgkzgf.supabase.co/functions/v1/live-scores-football',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' ||
                 (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'novest_sync_key')),
    body    := '{"mode":"poll"}'::jsonb)
  FROM due;
$job$);

SELECT cron.schedule('live-scores-basketball-poll', '* * * * *', $job$
  WITH due AS (
    UPDATE public.live_sync_state SET next_poll_at = now() + interval '7 minutes'
     WHERE sport = 'basketball' AND next_poll_at <= now()
    RETURNING sport)
  SELECT net.http_post(
    url     := 'https://jeihxnwqytnxtytgkzgf.supabase.co/functions/v1/live-scores-basketball',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' ||
                 (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'novest_sync_key')),
    body    := '{"mode":"poll"}'::jsonb)
  FROM due;
$job$);

SELECT cron.schedule('live-scores-f1-poll', '* * * * *', $job$
  WITH due AS (
    UPDATE public.live_sync_state SET next_poll_at = now() + interval '7 minutes'
     WHERE sport = 'f1' AND next_poll_at <= now()
    RETURNING sport)
  SELECT net.http_post(
    url     := 'https://jeihxnwqytnxtytgkzgf.supabase.co/functions/v1/live-scores-f1',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' ||
                 (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'novest_sync_key')),
    body    := '{"mode":"poll"}'::jsonb)
  FROM due;
$job$);

-- The daily run will set the real next_poll_at; until it lands, keep the minute jobs quiet.
UPDATE public.live_sync_state SET next_poll_at = now() + interval '10 minutes';

-- ─── Assertions ─────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_n     int;
  v_names text;
  v_bad   text;
BEGIN
  SELECT count(*), string_agg(jobname || '@' || schedule, ', ' ORDER BY jobname) INTO v_n, v_names
    FROM cron.job WHERE jobname LIKE 'live-scores-%' AND active;
  IF v_names IS DISTINCT FROM
       'live-scores-basketball-daily@2 3 * * *, live-scores-basketball-poll@* * * * *, '
    || 'live-scores-f1-daily@4 3 * * *, live-scores-f1-poll@* * * * *, '
    || 'live-scores-football-daily@0 3 * * *, live-scores-football-poll@* * * * *' THEN
    RAISE EXCEPTION 'live-scores cron jobs are not the expected 6 active jobs: % — %', v_n, v_names;
  END IF;

  -- No inline key ('eyJ' starts every JWT); every job reads the Vault secret by name.
  SELECT string_agg(jobname, ', ') INTO v_bad FROM cron.job
   WHERE jobname LIKE 'live-scores-%'
     AND (command LIKE '%eyJ%' OR command NOT LIKE '%vault.decrypted_secrets WHERE name = ''novest_sync_key''%');
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'job(s) carry an inline key or do not read Vault: %', v_bad; END IF;

  -- Every poll job is gated by its own sport's lease.
  SELECT string_agg(jobname, ', ') INTO v_bad FROM cron.job
   WHERE jobname LIKE 'live-scores-%-poll'
     AND command NOT LIKE '%WHERE sport = ''' || split_part(jobname, '-', 3) || ''' AND next_poll_at <= now()%';
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'poll job(s) without their own lease: %', v_bad; END IF;
END $$;

-- ─── First run: one daily per sport (sent by pg_net after COMMIT) ───────────
SELECT net.http_post(
  url     := 'https://jeihxnwqytnxtytgkzgf.supabase.co/functions/v1/live-scores-' || s,
  headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' ||
               (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'novest_sync_key')),
  body    := '{"mode":"daily"}'::jsonb)
FROM unnest(ARRAY['football','basketball','f1']) AS s;

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
VALUES ('20261072_live_scores_cron.sql', '3ec89b1c36615d41dedcd0ab6511de29019e13b050564a2c1dc11269e02553e4')
ON CONFLICT (filename) DO UPDATE
  SET checksum = excluded.checksum, applied_at = now(), applied_by = current_user;
-- ─── ledger:stamp:end ────────────────────────────────────────────────
COMMIT;
RESET ROLE;

-- ─── Stop everything (the off switch) ───────────────────────────────────────
--   SELECT cron.unschedule(j) FROM unnest(ARRAY['live-scores-football-daily','live-scores-basketball-daily',
--     'live-scores-f1-daily','live-scores-football-poll','live-scores-basketball-poll','live-scores-f1-poll']) j;
