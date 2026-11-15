-- Every live pg_cron job: schedule, active, what it calls, last run and its status, failures over 7 days.
-- READ-ONLY: SELECTs only. Results are sealed. Prints NO command text, NO return_message (it carries row
-- counts such as "DELETE 12"), no headers, no keys, no user ids: job names, run statuses, timestamps, run counts.
-- pg_cron marks an HTTP job "succeeded" once pg_net queues the request; 'http_7d' shows what came back.
select json_build_object(
  'now_utc', to_char(now() at time zone 'utc', 'Dy YYYY-MM-DD HH24:MI'),
  'run_details_oldest', (select to_char(min(start_time) at time zone 'utc', 'YYYY-MM-DD HH24:MI') from cron.job_run_details),
  'jobs', (select coalesce(json_agg(json_build_object(
      'job', j.jobname, 'schedule', j.schedule, 'active', j.active,
      'kind', case when j.command ~ '/functions/v1/[a-z0-9-]+' then 'edge:' || substring(j.command from '/functions/v1/([a-z0-9-]+)')
                   when j.command ilike '%net.http_%' then 'http (other, masked)'
                   else 'sql' end,
      'last_start', (select to_char(max(d.start_time) at time zone 'utc', 'MM-DD HH24:MI') from cron.job_run_details d where d.jobid = j.jobid),
      'last_status', (select d.status from cron.job_run_details d where d.jobid = j.jobid order by d.start_time desc limit 1),
      'runs_7d', (select count(*) from cron.job_run_details d where d.jobid = j.jobid and d.start_time > now() - interval '7 days'),
      'failed_7d', (select count(*) from cron.job_run_details d where d.jobid = j.jobid and d.start_time > now() - interval '7 days' and d.status <> 'succeeded'),
      'last_failed', (select to_char(max(d.start_time) at time zone 'utc', 'MM-DD HH24:MI') from cron.job_run_details d where d.jobid = j.jobid and d.status <> 'succeeded')
    ) order by j.jobname), '[]'::json) from cron.job j),
  'http_7d', (select coalesce(json_agg(x order by x.code), '[]'::json) from (
      select coalesce(r.status_code::text, case when r.timed_out then 'timeout' else 'error' end) as code, count(*) as n
        from net._http_response r where r.created > now() - interval '7 days' group by 1) x)
) as cron_jobs_inventory;
