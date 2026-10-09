-- Read-only. Check-ins launch watch (MODULE_FLAGS.checkins live 2026-10-09, OTA 27cdaa7d).
--   gh workflow run supabase-readonly -f file=supabase/readonly/checkins_launch_watch.sql
-- Google calls vs the caps in claim_google_places_call (per user / global per UTC day):
--   nearby 40 / 3000 · details 400 / 6000 · checkin 40 / 3000. A user at their cap is refused
--   with QUOTA (429) — the app shows "couldn't check in". Function ERRORS are not visible here
--   (Dashboard → Edge Functions → google-places → Logs).
SELECT 'google calls today (UTC)' AS what,
       format('%s: global %s · users %s · busiest user %s · users at cap %s', u.kind,
              coalesce(max(u.n) FILTER (WHERE u.user_id = '00000000-0000-0000-0000-000000000000'), 0),
              count(*) FILTER (WHERE u.user_id <> '00000000-0000-0000-0000-000000000000'),
              coalesce(max(u.n) FILTER (WHERE u.user_id <> '00000000-0000-0000-0000-000000000000'), 0),
              count(*) FILTER (WHERE u.user_id <> '00000000-0000-0000-0000-000000000000'
                                 AND u.n >= CASE u.kind WHEN 'nearby' THEN 40 WHEN 'details' THEN 400 WHEN 'checkin' THEN 40 ELSE 2000 END)) AS detail
  FROM google_places_usage u WHERE u.day = (now() AT TIME ZONE 'UTC')::date GROUP BY u.kind
UNION ALL
SELECT 'check-ins', format('total %s · today %s · at Google places %s · authors %s · last %s',
       count(*), count(*) FILTER (WHERE created_at >= date_trunc('day', now())),
       count(*) FILTER (WHERE google_place_id IS NOT NULL), count(DISTINCT user_id), max(created_at))
  FROM checkins
UNION ALL
SELECT 'pins', format('rows %s · fresh (< 29 d) %s', count(*), count(*) FILTER (WHERE fetched_at > now() - interval '29 days'))
  FROM google_place_pins
UNION ALL
SELECT 'notice accepted', format('%s accounts · public %s · hidden %s', count(*),
       count(*) FILTER (WHERE checkins_public IS TRUE), count(*) FILTER (WHERE checkins_public IS NOT TRUE))
  FROM profiles WHERE checkins_notice_at IS NOT NULL
UNION ALL
SELECT 'places submitted since launch', format('pending %s · active %s · rejected %s',
       count(*) FILTER (WHERE status = 'pending'), count(*) FILTER (WHERE status = 'active'), count(*) FILTER (WHERE status = 'rejected'))
  FROM places WHERE created_at >= '2026-10-09' AND submitted_by IS NOT NULL
UNION ALL
SELECT 'waitlist checkins', format('total %s · notified %s · last stamp %s', count(*), count(*) FILTER (WHERE notified_at IS NOT NULL), max(notified_at))
  FROM module_waitlist WHERE module = 'checkins'
UNION ALL
SELECT 'cron (last 24 h)', format('%s · %s · %s', j.jobname, d.status, d.start_time)
  FROM cron.job_run_details d JOIN cron.job j ON j.jobid = d.jobid
 WHERE j.jobname IN ('google-places-refresh', 'purge-google-places-cache') AND d.start_time > now() - interval '24 hours'
ORDER BY 1, 2;
