-- ═══════════════════════════════════════════════════════════════════════════
-- 20261230 — Döveç projects: the three scheduled jobs
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Applied LATER than 20261229, as its own go, AFTER the sync-dovec and dovec-lead functions are deployed and the
-- Vault secret `novest_sync_key` exists. It is the service key already used by the weekend-digest, duty-push and
-- marketplace jobs (20261177, 20261185); the cron jobs read it by name, never inline, and both functions accept it
-- through the same serviceCaller as those. No new Vault secret is needed. The file refuses to run if it is missing.
--
--   dovec-sync         every 10 minutes: POST sync-dovec (the function pulls the Döveç projects feed).
--   dovec-lead-retry   every 10 minutes: POST dovec-lead {"mode":"retry"}, ONLY when a lead is waiting (status 'retry'
--                      or an unsent 'pending' older than 10 minutes, none older than 7 days), so an idle system makes no calls.
--   dovec-leads-wipe   daily 03:30 UTC, pure SQL: dovec_leads_wipe_pii() (leads still retry/pending after 7 days become
--                      'failed'; 90-day PII retention).
--
-- WHO CAN READ / WRITE WHAT: this file adds no table, policy or grant. The jobs run as postgres inside the database
-- and reach the functions with the service key; no app role is involved. Each job has exactly one data_jobs row
-- (20261205), which is also what the admin Jobs screen shows.
--
-- Rollback: SELECT cron.unschedule('dovec-sync'); (and the other two). The projects then vanish from the app 24 hours
-- after the last good sync, by design (dovec_feed_is_fresh()).

SET ROLE postgres;

BEGIN;

SET LOCAL lock_timeout = '5s';

DO $$
BEGIN
  IF to_regclass('public.dovec_settings') IS NULL OR to_regprocedure('public.dovec_leads_wipe_pii()') IS NULL THEN
    RAISE EXCEPTION '20261229 is not applied: apply it before this file';
  END IF;
  IF (SELECT count(*) FROM vault.secrets WHERE name = 'novest_sync_key') IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'Vault secret novest_sync_key is missing or duplicated — the jobs would POST without a key';
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'dovec-sync') THEN PERFORM cron.unschedule('dovec-sync'); END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'dovec-lead-retry') THEN PERFORM cron.unschedule('dovec-lead-retry'); END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'dovec-leads-wipe') THEN PERFORM cron.unschedule('dovec-leads-wipe'); END IF;
END $$;

-- The function bounds its own run well under this 60 s pg_net timeout (one GET, one batch write).
SELECT cron.schedule('dovec-sync', '*/10 * * * *', $job$
  SELECT net.http_post(
    url     := 'https://jeihxnwqytnxtytgkzgf.supabase.co/functions/v1/sync-dovec',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' ||
                 (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'novest_sync_key')),
    body    := '{}'::jsonb,
    timeout_milliseconds := 60000);
$job$);

SELECT cron.schedule('dovec-lead-retry', '5,15,25,35,45,55 * * * *', $job$
  SELECT net.http_post(
    url     := 'https://jeihxnwqytnxtytgkzgf.supabase.co/functions/v1/dovec-lead',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' ||
                 (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'novest_sync_key')),
    body    := '{"mode":"retry"}'::jsonb,
    timeout_milliseconds := 60000)
  WHERE EXISTS (SELECT 1 FROM public.dovec_leads l
                 WHERE NOT l.is_test
                   AND l.status = ANY (ARRAY['retry','pending']::text[])
                   AND l.created_at > now() - interval '7 days'
                   AND COALESCE(l.next_attempt_at, l.created_at + interval '10 minutes') <= now());
$job$);

SELECT cron.schedule('dovec-leads-wipe', '30 3 * * *', $job$ SELECT public.dovec_leads_wipe_pii(); $job$);

-- Every cron job needs exactly one data_jobs row (20261205). dovec-lead-retry is silent by design when nothing waits.
INSERT INTO public.data_jobs (key, runner, kind, cron_jobnames, schedule_note, expected_every, sort) VALUES
  ('dovec-sync',       'cron_http', 'feed',      ARRAY['dovec-sync'],       NULL, interval '1 hour',   27),
  ('dovec-lead-retry', 'cron_http', 'push',      ARRAY['dovec-lead-retry'], NULL, NULL,                28),
  ('dovec-leads-wipe', 'cron_sql',  'retention', ARRAY['dovec-leads-wipe'], NULL, interval '36 hours', 29)
ON CONFLICT (key) DO NOTHING;

DO $$
DECLARE
  v_n     int;
  v_names text;
  v_cmd   text;
BEGIN
  -- Parameter names we call must exist on the installed net.http_post (a wrong name only fails at 03:00).
  SELECT count(DISTINCT n) INTO v_n FROM (
    SELECT unnest(p.proargnames) AS n FROM pg_proc p JOIN pg_namespace s ON s.oid = p.pronamespace
     WHERE s.nspname = 'net' AND p.proname = 'http_post') x
   WHERE n IN ('url','headers','body','timeout_milliseconds');
  IF v_n IS DISTINCT FROM 4 THEN RAISE EXCEPTION 'net.http_post lacks one of url/headers/body/timeout_milliseconds (found %)', v_n; END IF;

  SELECT count(*) INTO v_n FROM cron.job WHERE jobname = 'dovec-sync' AND active AND schedule = '*/10 * * * *'
     AND command LIKE '%/functions/v1/sync-dovec%'
     AND command LIKE '%vault.decrypted_secrets WHERE name = ''novest_sync_key''%'
     AND command LIKE '%timeout_milliseconds := 60000%'
     AND command NOT LIKE '%eyJ%' AND command NOT LIKE '%sb_secret%';
  IF v_n IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'dovec-sync is not exactly one active, Vault-keyed job'; END IF;

  SELECT count(*) INTO v_n FROM cron.job WHERE jobname = 'dovec-lead-retry' AND active AND schedule = '5,15,25,35,45,55 * * * *'
     AND command LIKE '%/functions/v1/dovec-lead%' AND command LIKE '%"mode":"retry"%'
     AND command LIKE '%vault.decrypted_secrets WHERE name = ''novest_sync_key''%'
     AND command LIKE '%WHERE EXISTS (SELECT 1 FROM public.dovec_leads l%'
     AND command LIKE '%WHERE NOT l.is_test%'
     AND command NOT LIKE '%eyJ%' AND command NOT LIKE '%sb_secret%';
  IF v_n IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'dovec-lead-retry is not exactly one active, gated, Vault-keyed job'; END IF;

  SELECT command INTO v_cmd FROM cron.job WHERE jobname = 'dovec-leads-wipe' AND active AND schedule = '30 3 * * *';
  IF v_cmd IS NULL OR v_cmd NOT LIKE '%public.dovec_leads_wipe_pii()%' THEN RAISE EXCEPTION 'dovec-leads-wipe is not the one active daily wipe job'; END IF;

  SELECT count(*), string_agg(jobname || '@' || schedule || CASE WHEN active THEN '' ELSE ' (inactive)' END, ', ' ORDER BY jobname)
    INTO v_n, v_names FROM cron.job WHERE jobname LIKE 'dovec-%';
  RAISE NOTICE 'dovec cron jobs: % (%)', v_n, v_names;
  IF v_n IS DISTINCT FROM 3 THEN RAISE EXCEPTION 'expected exactly 3 dovec-* cron jobs, found %', v_n; END IF;

  FOREACH v_names IN ARRAY ARRAY['dovec-sync','dovec-lead-retry','dovec-leads-wipe'] LOOP
    IF (SELECT count(*) FROM public.data_jobs d WHERE v_names = ANY (d.cron_jobnames)) IS DISTINCT FROM 1 THEN
      RAISE EXCEPTION '% is not covered by exactly one data_jobs row', v_names;
    END IF;
  END LOOP;
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
VALUES ('20261230_dovec_cron.sql', 'a366baec74c667392ada9613e38c34d0e16b61d462cbc9a4135eb967028a934d')
ON CONFLICT (filename) DO UPDATE
  SET checksum = excluded.checksum, applied_at = now(), applied_by = current_user;
-- ─── ledger:stamp:end ────────────────────────────────────────────────
COMMIT;

RESET ROLE;

NOTIFY pgrst, 'reload schema';
