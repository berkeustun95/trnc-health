-- ═══════════════════════════════════════════════════════════════════════════
-- 20261245 — Döveç: pause the dovec-sync cron job for about two hours, then it restarts by itself
-- ═══════════════════════════════════════════════════════════════════════════
--
-- WHY
-- To show the 20261241 watchdog working on the real system: with the sync paused, last_good_sync_at ages past 30 minutes and the
-- admins get "Döveç: 30 dakikadır başarılı eşitleme yok"; after the restart the next good sync gives "Döveç: düzeldi (eşitleme)".
-- dovec_settings.published stays as it is (false); nothing else changes. This is a demo pause, not a fix.
--
-- WHAT IT DOES, IN PLAIN ENGLISH
--   1. dovec-sync is switched OFF (cron.alter_job active := false). Its schedule ('*/10 * * * *') and its command are NOT touched,
--      so every check on that job still reads the same text.
--   2. A one-shot pg_cron job 'dovec-sync-resume' is scheduled for the first whole minute at or after now() + 2 hours, in the
--      time zone pg_cron really uses (the cron.timezone setting, GMT when unset), at a minute no other active job uses and never
--      :00. Its schedule names a day and a month, so it would fire again a year later unless it removes itself: its command is
--      ONE statement (a DO block, one implicit transaction) that switches dovec-sync back on, deletes its own registry rows
--      and unschedules itself. Nothing is left behind. If it never fires (or fires and fails), 20261246 is the backstop.
--   3. A temporary data_jobs row 'dovec-sync-resume' keeps 20261205's rule true while the job exists (every cron job has exactly
--      one registry row, every listed name exists). The resume job's command deletes it.
--
-- WHAT THE ADMINS WILL SEE: the Döveç watchdog lines above, AND the data-jobs watchdog (20261211) will say "dovec-sync: kapalı"
-- then "dovec-sync: düzeldi": data_jobs_overview reports an inactive cron job with an expected_every as 'inactive' + attention
-- (20261210). That is truthful and is not suppressed.
--
-- WHO CAN READ / WRITE WHAT: this file adds no table, policy, grant or function. It runs as postgres (the pg_cron owner); the
-- one-shot job runs as postgres too. No app role is involved; cron.* and data_jobs stay unreachable for anon / authenticated.
--
-- Public logs: NOTICEs print job names, booleans and the schedule string only. No counts of users, no ids.
-- Apply: supabase-migrate, one file (or with 20261246 in a list: do not; they are opposites). Undo: apply 20261246.
-- ═══════════════════════════════════════════════════════════════════════════

SET ROLE postgres;

BEGIN;

SET LOCAL lock_timeout = '5s';

DO $$
DECLARE
  v_jobid     bigint;
  v_pub       boolean;
  v_pub_after boolean;
  v_tz        text;
  v_target    timestamptz;
  v_fire      timestamptz;
  v_local     timestamp;
  v_min       int;
  v_sched     text;
  v_names     text;
  v_n         int;
  v_cmd       text;
  v_resume    text := $job$
  DO $resume$
  BEGIN
    PERFORM cron.alter_job(job_id := (SELECT jobid FROM cron.job WHERE jobname = 'dovec-sync'), active := true);
    DELETE FROM public.data_job_runs WHERE job_key = 'dovec-sync-resume';
    DELETE FROM public.data_jobs_alert_state WHERE job_key = 'dovec-sync-resume';
    DELETE FROM public.data_jobs WHERE key = 'dovec-sync-resume';
    PERFORM cron.unschedule('dovec-sync-resume');
  END $resume$;
$job$;
BEGIN
  -- ─── pre-flight ───
  IF to_regclass('cron.job') IS NULL OR to_regprocedure('cron.schedule(text,text,text)') IS NULL
     OR to_regprocedure('cron.alter_job(bigint,text,text,text,text,boolean)') IS NULL OR to_regprocedure('cron.unschedule(text)') IS NULL THEN
    RAISE EXCEPTION 'REFUSING: pg_cron (schedule / alter_job / unschedule) is missing. Nothing applied.';
  END IF;
  IF to_regclass('public.data_jobs') IS NULL OR to_regclass('public.data_job_runs') IS NULL OR to_regclass('public.data_jobs_alert_state') IS NULL
     OR to_regclass('public.dovec_settings') IS NULL THEN
    RAISE EXCEPTION 'REFUSING: data_jobs registry or dovec_settings is missing. Nothing applied.';
  END IF;
  IF (SELECT count(*) FROM cron.job WHERE jobname = 'dovec-sync') IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'REFUSING: expected exactly one dovec-sync cron job. Nothing applied.';
  END IF;
  IF (SELECT count(*) FROM public.data_jobs d WHERE 'dovec-sync' = ANY (d.cron_jobnames)) IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'REFUSING: dovec-sync is not covered by exactly one data_jobs row. Nothing applied.';
  END IF;
  SELECT published INTO v_pub FROM public.dovec_settings WHERE id = 1;

  -- ─── 1. switch dovec-sync off (schedule and command untouched) ───
  SELECT jobid INTO v_jobid FROM cron.job WHERE jobname = 'dovec-sync';
  PERFORM cron.alter_job(job_id := v_jobid, active := false);

  -- ─── 2. the fire time: first whole minute at or after now() + 2 h, in pg_cron's own time zone ───
  v_tz := coalesce(nullif(current_setting('cron.timezone', true), ''), 'GMT');
  v_target := now() + interval '2 hours';
  v_fire := date_trunc('minute', v_target) + CASE WHEN v_target > date_trunc('minute', v_target) THEN interval '1 minute' ELSE interval '0 minutes' END;

  SELECT string_agg(j.jobname || ' (' || j.schedule || ')', ', ' ORDER BY j.jobname) INTO v_names
    FROM cron.job j WHERE j.active AND j.jobname <> 'dovec-sync-resume'
     AND j.schedule !~ '^(\*|[0-9]+(-[0-9]+)?)(/[0-9]+)?(,(\*|[0-9]+(-[0-9]+)?)(/[0-9]+)?)* ' AND j.schedule !~* 'second';
  IF v_names IS NOT NULL THEN RAISE EXCEPTION 'an active cron job has a minute field this check cannot read: %', v_names; END IF;

  LOOP
    v_local := v_fire AT TIME ZONE v_tz;
    v_min := extract(minute FROM v_local)::int;
    EXIT WHEN v_min <> 0 AND NOT EXISTS (
      SELECT 1 FROM cron.job j
       WHERE j.active AND j.jobname NOT IN ('dovec-sync', 'dovec-sync-resume')
         AND (j.schedule ~* 'second'
              OR EXISTS (
                SELECT 1
                  FROM unnest(string_to_array(split_part(j.schedule, ' ', 1), ',')) it,
                       LATERAL generate_series(
                         CASE WHEN it ~ '^\*' THEN 0 ELSE substring(it from '^([0-9]+)')::int END,
                         CASE WHEN it ~ '^\*' THEN 59 WHEN it ~ '^[0-9]+-[0-9]+' THEN substring(it from '^[0-9]+-([0-9]+)')::int
                              WHEN it ~ '/' THEN 59 ELSE substring(it from '^([0-9]+)')::int END,
                         CASE WHEN it ~ '/[0-9]+$' THEN substring(it from '/([0-9]+)$')::int ELSE 1 END) m
                 WHERE m = v_min)));
    v_fire := v_fire + interval '1 minute';
    IF v_fire > v_target + interval '60 minutes' THEN RAISE EXCEPTION 'no free minute within an hour after the target time'; END IF;
  END LOOP;
  v_sched := format('%s %s %s %s *', v_min, extract(hour FROM v_local)::int, extract(day FROM v_local)::int, extract(month FROM v_local)::int);

  -- ─── 3. the one-shot resume job (idempotent: an earlier one is replaced) and its registry row ───
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'dovec-sync-resume') THEN PERFORM cron.unschedule('dovec-sync-resume'); END IF;
  PERFORM cron.schedule('dovec-sync-resume', v_sched, v_resume);

  INSERT INTO public.data_jobs (key, runner, kind, cron_jobnames, schedule_note, expected_every, switchable, sort)
  VALUES ('dovec-sync-resume', 'cron_sql', 'maintenance', ARRAY['dovec-sync-resume'], NULL, NULL, false, 62)
  ON CONFLICT (key) DO UPDATE SET runner = excluded.runner, kind = excluded.kind, cron_jobnames = excluded.cron_jobnames,
    schedule_note = excluded.schedule_note, expected_every = excluded.expected_every, switchable = excluded.switchable, sort = excluded.sort;

  -- ─── 4. assertions ───
  SELECT count(*) INTO v_n FROM cron.job WHERE jobname = 'dovec-sync' AND NOT active AND schedule = '*/10 * * * *'
     AND command LIKE '%/functions/v1/sync-dovec%'
     AND command LIKE '%vault.decrypted_secrets WHERE name = ''novest_sync_key''%'
     AND command LIKE '%timeout_milliseconds := 60000%'
     AND command NOT LIKE '%eyJ%' AND command NOT LIKE '%sb_secret%';
  IF v_n IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'dovec-sync is not exactly one INACTIVE job with its original schedule and command'; END IF;

  SELECT command INTO v_cmd FROM cron.job WHERE jobname = 'dovec-sync-resume' AND active AND schedule = v_sched;
  IF (SELECT count(*) FROM cron.job WHERE jobname = 'dovec-sync-resume') IS DISTINCT FROM 1 OR v_cmd IS NULL THEN
    RAISE EXCEPTION 'dovec-sync-resume is not exactly one active job with the computed schedule';
  END IF;
  IF v_cmd NOT LIKE '%cron.alter_job(job_id := (SELECT jobid FROM cron.job WHERE jobname = ''dovec-sync''), active := true)%'
     OR v_cmd NOT LIKE '%cron.unschedule(''dovec-sync-resume'')%'
     OR v_cmd NOT LIKE '%DELETE FROM public.data_jobs WHERE key = ''dovec-sync-resume''%'
     OR v_cmd NOT LIKE '%DELETE FROM public.data_job_runs WHERE job_key = ''dovec-sync-resume''%'
     OR v_cmd NOT LIKE '%DELETE FROM public.data_jobs_alert_state WHERE job_key = ''dovec-sync-resume''%' THEN
    RAISE EXCEPTION 'dovec-sync-resume has not the expected command shape';
  END IF;

  IF v_fire < now() + interval '2 hours' OR v_fire > now() + interval '2 hours' + interval '60 minutes' THEN
    RAISE EXCEPTION 'the fire time is not between 2 h and 3 h from now';
  END IF;
  IF v_min = 0 THEN RAISE EXCEPTION 'the resume minute is :00'; END IF;
  IF EXISTS (
      SELECT 1 FROM cron.job j
       WHERE j.active AND j.jobname NOT IN ('dovec-sync', 'dovec-sync-resume')
         AND EXISTS (
           SELECT 1
             FROM unnest(string_to_array(split_part(j.schedule, ' ', 1), ',')) it,
                  LATERAL generate_series(
                    CASE WHEN it ~ '^\*' THEN 0 ELSE substring(it from '^([0-9]+)')::int END,
                    CASE WHEN it ~ '^\*' THEN 59 WHEN it ~ '^[0-9]+-[0-9]+' THEN substring(it from '^[0-9]+-([0-9]+)')::int
                         WHEN it ~ '/' THEN 59 ELSE substring(it from '^([0-9]+)')::int END,
                    CASE WHEN it ~ '/[0-9]+$' THEN substring(it from '/([0-9]+)$')::int ELSE 1 END) m
            WHERE m = v_min)) THEN
    RAISE EXCEPTION 'another active cron job fires at the resume minute';
  END IF;

  SELECT string_agg(j.jobname, ', ' ORDER BY j.jobname) INTO v_names
    FROM cron.job j WHERE (SELECT count(*) FROM public.data_jobs d WHERE j.jobname = ANY (d.cron_jobnames)) IS DISTINCT FROM 1;
  IF v_names IS NOT NULL THEN RAISE EXCEPTION 'cron jobs not covered by exactly one data_jobs row: %', v_names; END IF;
  SELECT string_agg(DISTINCT n, ', ' ORDER BY n) INTO v_names
    FROM public.data_jobs d, unnest(d.cron_jobnames) AS n WHERE NOT EXISTS (SELECT 1 FROM cron.job j WHERE j.jobname = n);
  IF v_names IS NOT NULL THEN RAISE EXCEPTION 'data_jobs lists cron jobs that do not exist: %', v_names; END IF;

  SELECT published INTO v_pub_after FROM public.dovec_settings WHERE id = 1;
  IF v_pub_after IS DISTINCT FROM v_pub THEN RAISE EXCEPTION 'dovec_settings.published changed'; END IF;

  RAISE NOTICE '20261245 OK: dovec-sync inactive (schedule and command unchanged); dovec-sync-resume scheduled "%" in time zone %; published unchanged: true', v_sched, v_tz;
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
VALUES ('20261245_dovec_sync_pause.sql', 'e40fc394fca86a4eefbc0e84943b65c6603480d476a7e95e00bfc9e58e999aa6')
ON CONFLICT (filename) DO UPDATE
  SET checksum = excluded.checksum, applied_at = now(), applied_by = current_user;
-- ─── ledger:stamp:end ────────────────────────────────────────────────
COMMIT;

RESET ROLE;
