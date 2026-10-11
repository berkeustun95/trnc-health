-- Read-only: did sync-novest finish this morning even though pg_net timed out at 5 s?
-- The function stamps properties.last_seen_at LAST, on every feed row, only after all writes
-- succeed — so a stamp inside the run window = the run completed. pg_net only says the caller
-- stopped waiting. Also: the cron commands' timeout (absent = pg_net default 5000 ms).
select json_build_object(
  'now_utc', to_char(now() at time zone 'utc', 'Dy YYYY-MM-DD HH24:MI'),
  'jobs', (select json_agg(json_build_object('job', jobname, 'schedule', schedule, 'active', active,
             'has_timeout_ms', command ilike '%timeout_milliseconds%', 'vault_keyed', command like '%vault.decrypted_secrets%')
             order by jobname) from cron.job where jobname like 'sync-novest%'),
  'cron_runs_3d', (select json_agg(json_build_object('job', j.jobname, 'start', to_char(d.start_time at time zone 'utc', 'Dy DD HH24:MI:SS'),
                     'status', d.status) order by d.start_time)
                   from cron.job_run_details d join cron.job j on j.jobid = d.jobid
                  where j.jobname like 'sync-novest%' and d.start_time > now() - interval '3 days'),
  'novest_by_status', (select json_object_agg(status, n) from (select status, count(*) n from public.properties
                        where source = 'novest' group by status) s),
  'max_last_seen_at', (select to_char(max(last_seen_at) at time zone 'utc', 'Dy DD HH24:MI:SS') from public.properties where source = 'novest'),
  'stamped_by_window', (select json_object_agg(w, n) from (
      select to_char(date_trunc('hour', last_seen_at at time zone 'utc'), 'Dy DD HH24') || 'Z' w, count(*) n
        from public.properties where source = 'novest' and last_seen_at > now() - interval '3 days'
       group by 1) s),
  'http_responses_today_0500', (select json_agg(json_build_object('created', to_char(r.created at time zone 'utc', 'HH24:MI:SS'),
                       'status', r.status_code, 'timed_out', r.timed_out, 'body', left(r.content, 200)) order by r.created)
                     from net._http_response r where r.created >= '2026-10-11 04:59+00' and r.created < '2026-10-11 05:10+00')
) as novest_sync;
