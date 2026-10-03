-- ─── Live Scores cron (football + basketball) ────────────────────────────────
--
-- ⚠ NOT A MIGRATION, NOT APPLIED AUTOMATICALLY. Run by hand in the SQL editor (Role =
--   postgres), ONE STATEMENT AT A TIME, only after ALL of:
--     1. 20261070_live_scores.sql is applied and verify_schema QUERY 1 is green;
--     2. API_SPORTS_KEY is set in Edge Function secrets;
--     3. both functions are deployed (gh workflow run supabase-functions-deploy -f function=…).
--
-- ⚠ NO KEY IN THIS FILE, AND NONE IN cron.job. The jobs read the service_role key from
--   Vault at call time — the SAME secret the sync-novest jobs use ('novest_sync_key', see
--   supabase/functions/sync-novest/rotate-cron-to-vault.sql), so there is one copy of the
--   key to rotate, not two. scripts/check-secrets.mjs blocks a push carrying a key.
--
-- All times UTC (pg_cron). TRNC is UTC+3 in summer.
--
-- ─── HOW THE POLL IS GATED ──────────────────────────────────────────────────
-- The poll job runs EVERY MINUTE but POSTs only when live_sync_state.next_poll_at is due,
-- and it advances next_poll_at by 7 minutes IN THE SAME STATEMENT before posting (the CTE).
-- net.http_post is fire-and-forget, so this lease is what stops a slow or crashed function
-- from being re-fired every minute. The function then writes the real next_poll_at: the
-- quota-spread interval while games are live, the next kick-off when idle. Idle minutes
-- cost one UPDATE that matches nothing — no Edge Function invocation, no API request.
--
-- ─── HEALTH: READ THE DATA, NOT cron.job_run_details ────────────────────────
-- 'succeeded' there means the POST was QUEUED. The signals that cannot lie:
--   select sport, next_poll_at, last_run_at, last_daily_on, last_error from live_sync_state;
--   select sport, max(last_synced_at) from matches where source = 'api' group by sport;
--   select * from api_quota_log where day = (now() at time zone 'utc')::date;
--   select at, sport, endpoint, http_status, results, error from api_request_log order by at desc limit 20;

-- ─── 1. Daily: today's + tomorrow's games, 03:00 UTC = 06:00 TRNC ───────────
select cron.schedule('live-scores-football-daily', '0 3 * * *', $$
  select net.http_post(
    url     := 'https://jeihxnwqytnxtytgkzgf.supabase.co/functions/v1/live-scores-football',
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets
                                                 where name = 'novest_sync_key')),
    body    := '{"mode":"daily"}'::jsonb);
$$);

select cron.schedule('live-scores-basketball-daily', '2 3 * * *', $$
  select net.http_post(
    url     := 'https://jeihxnwqytnxtytgkzgf.supabase.co/functions/v1/live-scores-basketball',
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets
                                                 where name = 'novest_sync_key')),
    body    := '{"mode":"daily"}'::jsonb);
$$);

-- ─── 2. Poll: every minute, posts only when due ─────────────────────────────
select cron.schedule('live-scores-football-poll', '* * * * *', $$
  with due as (
    update public.live_sync_state set next_poll_at = now() + interval '7 minutes'
     where sport = 'football' and next_poll_at <= now()
    returning sport)
  select net.http_post(
    url     := 'https://jeihxnwqytnxtytgkzgf.supabase.co/functions/v1/live-scores-football',
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets
                                                 where name = 'novest_sync_key')),
    body    := '{"mode":"poll"}'::jsonb)
  from due;
$$);

select cron.schedule('live-scores-basketball-poll', '* * * * *', $$
  with due as (
    update public.live_sync_state set next_poll_at = now() + interval '7 minutes'
     where sport = 'basketball' and next_poll_at <= now()
    returning sport)
  select net.http_post(
    url     := 'https://jeihxnwqytnxtytgkzgf.supabase.co/functions/v1/live-scores-basketball',
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets
                                                 where name = 'novest_sync_key')),
    body    := '{"mode":"poll"}'::jsonb)
  from due;
$$);

-- ─── 3. Verify ──────────────────────────────────────────────────────────────
--   select jobname, schedule, active, command like '%eyJ%' as has_inline_key
--     from cron.job where jobname like 'live-scores-%';   -- 4 rows, has_inline_key false
--
-- First run without waiting for 03:00: trigger the daily by hand, then read the data.
--   select net.http_post(url := 'https://jeihxnwqytnxtytgkzgf.supabase.co/functions/v1/live-scores-football',
--     headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' ||
--       (select decrypted_secret from vault.decrypted_secrets where name = 'novest_sync_key')),
--     body := '{"mode":"daily"}'::jsonb);
--
-- ─── Stop everything (the off switch) ───────────────────────────────────────
--   select cron.unschedule(j) from unnest(array['live-scores-football-daily','live-scores-basketball-daily',
--     'live-scores-football-poll','live-scores-basketball-poll']) j;
