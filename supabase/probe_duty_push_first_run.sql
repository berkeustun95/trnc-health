-- Read-only: did duty-push's first real run (Sun 11 Oct 2026 08:00 TRNC = 05:00Z) work?
-- Perfect system: cron run 05:00Z succeeded; one pg_net response ~05:00Z with status 200 and
-- {"ok":true,"date":"2026-10-11",...}; duty notifications ≈ profiles. A 401 = the Vault key
-- failed verify_jwt. pg_net keeps responses ~6 h (pg_net.ttl): read before ~11:00Z.
select json_build_object(
  'now_utc', to_char(now() at time zone 'utc', 'Dy YYYY-MM-DD HH24:MI'),
  'pg_net_ttl', (select setting from pg_settings where name = 'pg_net.ttl'),
  'cron_runs', (select json_agg(json_build_object('start', to_char(d.start_time at time zone 'utc', 'HH24:MI:SS'),
                  'status', d.status, 'msg', left(d.return_message, 120)) order by d.start_time)
                from cron.job_run_details d join cron.job j on j.jobid = d.jobid
               where j.jobname = 'duty-push'
                 and d.start_time >= '2026-10-11 04:55+00' and d.start_time < '2026-10-11 05:10+00'),
  'http_responses', (select json_agg(json_build_object('created', to_char(r.created at time zone 'utc', 'HH24:MI:SS'),
                       'status', r.status_code, 'timed_out', r.timed_out, 'error', r.error_msg,
                       'body', left(r.content, 300)) order by r.created)
                     from net._http_response r
                    where r.created >= '2026-10-11 04:59+00' and r.created < '2026-10-11 05:10+00'),
  'duty_notifications_0500_0505', (select count(*) from public.notifications
                                    where type = 'duty' and created_at >= '2026-10-11 05:00+00' and created_at < '2026-10-11 05:05+00'),
  'profiles', (select count(*) from public.profiles),
  'duty_rows_for_2026_10_11', (select count(*) from public.duty_list where duty_date = '2026-10-11')
) as first_run;
