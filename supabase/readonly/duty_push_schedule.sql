-- When does the duty push fire next? Read-only. pg_cron's cron.job is RLS-filtered by user on
-- some setups — an empty result is "cannot see", not "no job"; the role line printed above says
-- whether this role bypasses RLS.
select json_build_object(
  'now_utc', to_char(now() at time zone 'utc', 'Dy YYYY-MM-DD HH24:MI'),
  'jobs', (select coalesce(json_agg(json_build_object('job', j.jobname, 'schedule', j.schedule, 'active', j.active) order by j.jobname), '[]'::json)
             from cron.job j where j.jobname ilike '%duty%' or j.command ilike '%send-duty-notification%'),
  'last_runs', (select coalesce(json_agg(x order by x.start_time desc), '[]'::json) from (
                  select d.jobid, d.status, to_char(d.start_time at time zone 'utc', 'Dy YYYY-MM-DD HH24:MI') as start_time
                    from cron.job_run_details d
                   where d.jobid in (select j.jobid from cron.job j where j.jobname ilike '%duty%')
                   order by d.start_time desc limit 5) x)
) as duty_push;
