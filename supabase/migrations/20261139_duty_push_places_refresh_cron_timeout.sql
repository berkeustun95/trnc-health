-- ═══════════════════════════════════════════════════════════════════════════
-- 20261139 — duty-push and google-places-refresh crons: wait 60 s for the response, not pg_net's 5 s
-- ═══════════════════════════════════════════════════════════════════════════
--
-- THE SYMPTOM. supabase/readonly/cron_net_timeouts.sql (readonly run 40378844797) found that cron
-- job duty-push (0,30 * * * *, POST /functions/v1/send-duty-notification) has no
-- timeout_milliseconds, so pg_net uses its 5 s default. At 2026-10-26 15:00 UTC its response
-- (id 789) timed out after 5017 ms ("Timeout of 5000 ms reached"). The function does not stop
-- working because pg_net stops waiting: 520 duty notification rows were still written in that
-- slot (491-512 on the prior 7 days). The cost is that a timed-out run logs the same way a real
-- failure would, and the response body ({"ok":true,"pushed":N,"pushErrors":[…]}) is never
-- recorded. Same cause and same fix as 20261106 (sync-novest).
--
-- THE FIX. Same two jobs, same schedules, same Vault key ('novest_sync_key'), same URL, same body,
-- same WHERE public.duty_push_due() gate; the ONLY change is timeout_milliseconds := 60000. The
-- edge function's own wall-clock limit is unchanged; this is only how long pg_net waits to record
-- the reply. google-places-refresh (03:21 UTC, POST {"action":"refresh"}) has the identical
-- shape and no timeout either, so it gets the same line.
--
-- Each job gets a NEW jobid (unschedule + schedule, as in 20261106); cron.job_run_details history
-- stays under the old jobid.
--
-- Before replacing, each job's CURRENT command is compared, whole, with the exact text 20261103 /
-- 20261093 wrote, so ANY hand edit is read, not overwritten blind.
--
-- Apply: gh workflow run supabase-migrate -f file=20261139_duty_push_places_refresh_cron_timeout.sql
-- ═══════════════════════════════════════════════════════════════════════════

SET ROLE postgres;

BEGIN;

SET LOCAL lock_timeout = '5s';

DO $$
DECLARE r record;
BEGIN
  IF (SELECT count(*) FROM vault.secrets WHERE name = 'novest_sync_key') IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'Vault secret novest_sync_key is missing. Nothing applied.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                  WHERE n.nspname = 'net' AND p.proname = 'http_post'
                    AND 'timeout_milliseconds' = ANY (p.proargnames)) THEN
    RAISE EXCEPTION 'net.http_post has no timeout_milliseconds parameter on this pg_net. Nothing applied.';
  END IF;
  IF to_regprocedure('public.duty_push_due(timestamp with time zone)') IS NULL THEN
    RAISE EXCEPTION 'public.duty_push_due(timestamptz) is missing (20261103). Nothing applied.';
  END IF;

  -- The EXACT text 20261103 / 20261093 wrote (cron stores the command verbatim). Anything else
  -- — an edited host, body, gate or key lookup — means the job was changed by hand: read first.
  FOR r IN SELECT * FROM (VALUES
      ('duty-push', '0,30 * * * *', $c$
  SELECT net.http_post(
    url     := 'https://jeihxnwqytnxtytgkzgf.supabase.co/functions/v1/send-duty-notification',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' ||
                 (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'novest_sync_key')),
    body    := '{}'::jsonb)
  WHERE public.duty_push_due();
$c$),
      ('google-places-refresh', '21 3 * * *', $c$
  SELECT net.http_post(
    url     := 'https://jeihxnwqytnxtytgkzgf.supabase.co/functions/v1/google-places',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' ||
                 (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'novest_sync_key')),
    body    := '{"action":"refresh"}'::jsonb);
$c$)
    ) v(jobname, sched, old_cmd)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM cron.job j
                    WHERE j.jobname = r.jobname AND j.active AND j.schedule = r.sched
                      AND btrim(j.command) = btrim(r.old_cmd)) THEN
      RAISE EXCEPTION '% is not the active job with the exact command this file replaces (hand-edited?) — read before replacing. Nothing applied.', r.jobname;
    END IF;
    PERFORM cron.unschedule(r.jobname);
  END LOOP;
END $$;

SELECT cron.schedule('duty-push', '0,30 * * * *', $job$
  SELECT net.http_post(
    url     := 'https://jeihxnwqytnxtytgkzgf.supabase.co/functions/v1/send-duty-notification',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' ||
                 (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'novest_sync_key')),
    body    := '{}'::jsonb,
    timeout_milliseconds := 60000)
  WHERE public.duty_push_due();
$job$);

SELECT cron.schedule('google-places-refresh', '21 3 * * *', $job$
  SELECT net.http_post(
    url     := 'https://jeihxnwqytnxtytgkzgf.supabase.co/functions/v1/google-places',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' ||
                 (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'novest_sync_key')),
    body    := '{"action":"refresh"}'::jsonb,
    timeout_milliseconds := 60000);
$job$);

DO $$
DECLARE v_jobs text;
BEGIN
  -- Exactly one duty job and exactly one google-places refresh job after the swap (no duplicate left behind).
  SELECT string_agg(jobname, ',' ORDER BY jobname) INTO v_jobs
    FROM cron.job WHERE jobname ILIKE '%duty%' OR command ILIKE '%send-duty-notification%';
  IF v_jobs IS DISTINCT FROM 'duty-push' THEN
    RAISE EXCEPTION 'duty jobs after the swap: % (expected exactly duty-push)', coalesce(v_jobs, 'NONE');
  END IF;
  SELECT string_agg(jobname, ',' ORDER BY jobname) INTO v_jobs
    FROM cron.job WHERE command ILIKE '%functions/v1/google-places%';
  IF v_jobs IS DISTINCT FROM 'google-places-refresh' THEN
    RAISE EXCEPTION 'google-places cron jobs after the swap: % (expected exactly google-places-refresh)', coalesce(v_jobs, 'NONE');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'duty-push' AND active AND schedule = '0,30 * * * *'
                   AND command LIKE '%timeout_milliseconds := 60000%'
                   AND command LIKE '%vault.decrypted_secrets%' AND command LIKE '%public.duty_push_due()%'
                   AND command NOT LIKE '%eyJ%' AND command NOT LIKE '%sb_secret%') THEN
    RAISE EXCEPTION 'duty-push is not active / not every 30 min / not 60 s timeout / not Vault-keyed / not gated by duty_push_due()';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'google-places-refresh' AND active AND schedule = '21 3 * * *'
                   AND command LIKE '%timeout_milliseconds := 60000%'
                   AND command LIKE '%vault.decrypted_secrets%' AND command LIKE '%"action":"refresh"%'
                   AND command NOT LIKE '%eyJ%' AND command NOT LIKE '%sb_secret%') THEN
    RAISE EXCEPTION 'google-places-refresh is not active / not 03:21 / not 60 s timeout / not Vault-keyed / lost its refresh body';
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
VALUES ('20261139_duty_push_places_refresh_cron_timeout.sql', '578f05a7c013dc9a02c35281d518f6138c717c3d0cf2a56b56019f2c24fcb4ca')
ON CONFLICT (filename) DO UPDATE
  SET checksum = excluded.checksum, applied_at = now(), applied_by = current_user;
-- ─── ledger:stamp:end ────────────────────────────────────────────────
COMMIT;
RESET ROLE;
