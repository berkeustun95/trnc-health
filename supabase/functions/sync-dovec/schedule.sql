-- ─── sync-dovec cron — READY, NOT APPLIED ───────────────────────────────────
--
-- This is NOT a migration and nothing runs it. It becomes one on plug-in day (PLUG-IN.md step 5):
-- copy it to `npm run migration:next`, stamp, and apply through supabase-migrate like every other
-- file. It is kept out of supabase/migrations/ on purpose: its pre-flight needs the deployed
-- function and the Vault secret, neither of which exists before the API does.
--
-- Same mechanism and safety rules as Novest (20261106_sync_novest_cron_timeout.sql):
--   • key from Vault, never inline (cron.job.command is readable);
--   • timeout_milliseconds 60000;
--   • 10 min after sync-novest (05:10 / 15:10 UTC = 08:10 / 18:10 TRNC), so the two never share a minute.
--
-- The jobs are created INACTIVE (cron.alter_job … active := false) and switched on by a separate,
-- deliberate statement once a manual run has come back ok. The function also no-ops until its
-- DOVEC_SYNC_ENABLED secret is "true" — two independent switches.

SET ROLE postgres;
BEGIN;
SET LOCAL lock_timeout = '5s';

DO $$
BEGIN
  IF (SELECT count(*) FROM vault.secrets WHERE name = 'dovec_sync_key') IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'Vault secret dovec_sync_key is missing. Nothing applied.';
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname LIKE 'sync-dovec%') THEN
    RAISE EXCEPTION 'sync-dovec jobs already exist — read them before replacing. Nothing applied.';
  END IF;
END $$;

SELECT cron.schedule('sync-dovec-morning', '10 5 * * *', $job$
  SELECT net.http_post(
    url     := 'https://jeihxnwqytnxtytgkzgf.supabase.co/functions/v1/sync-dovec',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' ||
                 (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'dovec_sync_key')),
    body    := '{}'::jsonb,
    timeout_milliseconds := 60000);
$job$);

SELECT cron.schedule('sync-dovec-evening', '10 15 * * *', $job$
  SELECT net.http_post(
    url     := 'https://jeihxnwqytnxtytgkzgf.supabase.co/functions/v1/sync-dovec',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' ||
                 (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'dovec_sync_key')),
    body    := '{}'::jsonb,
    timeout_milliseconds := 60000);
$job$);

-- DISABLED until switched on deliberately (PLUG-IN.md step 5c).
SELECT cron.alter_job(jobid, active := false) FROM cron.job WHERE jobname IN ('sync-dovec-morning', 'sync-dovec-evening');

DO $$
BEGIN
  IF (SELECT count(*) FROM cron.job WHERE jobname IN ('sync-dovec-morning','sync-dovec-evening') AND NOT active
        AND command LIKE '%vault.decrypted_secrets%' AND command NOT LIKE '%eyJ%' AND command NOT LIKE '%sb_secret_%') IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION 'sync-dovec jobs are not both present, inactive and Vault-keyed';
  END IF;
END $$;

COMMIT;
RESET ROLE;
