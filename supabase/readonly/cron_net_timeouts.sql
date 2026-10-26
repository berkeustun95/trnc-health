-- Which pg_cron job's pg_net request timed out around 15:00 UTC? Read-only.
-- Prints per job: schedule, active, target (allowlisted: edge-function name only, else masked), timeout_milliseconds if set.
-- NEVER prints the command text, headers, keys or bodies.
select json_build_object(
  'now_utc', to_char(now() at time zone 'utc', 'YYYY-MM-DD HH24:MI:SS'),
  'jobs', (select coalesce(json_agg(json_build_object(
      'jobid', j.jobid, 'job', j.jobname, 'schedule', j.schedule, 'active', j.active,
      'uses_pg_net', j.command ilike '%net.http_%',
      'target', case when j.command ~ 'https://[a-z0-9]+\.supabase\.co/functions/v1/[a-z0-9-]+' then substring(j.command from '/functions/v1/[a-z0-9-]+')
                     when j.command ilike '%exp.host/--/api/v2/push/send%' then 'exp.host push'
                     when j.command ~ 'https://' then 'other (masked)' end,
      'timeout_ms', substring(j.command from 'timeout_milliseconds\s*:=\s*([0-9]+)')
    ) order by j.jobid), '[]'::json) from cron.job j),
  'runs_window', (select coalesce(json_agg(json_build_object(
      'jobid', d.jobid, 'job', j.jobname, 'status', d.status, 'ret', left(regexp_replace(d.return_message, 'https?://\S+', '<url>', 'g'), 120),
      'start', to_char(d.start_time at time zone 'utc', 'MM-DD HH24:MI:SS.US'),
      'end', to_char(d.end_time at time zone 'utc', 'MM-DD HH24:MI:SS.US')
    ) order by d.start_time), '[]'::json)
    from cron.job_run_details d left join cron.job j on j.jobid = d.jobid
    where d.start_time >= timestamptz '2026-10-26 14:55+00' and d.start_time < timestamptz '2026-10-26 15:10+00'),
  'responses_window', (select coalesce(json_agg(json_build_object(
      'id', r.id, 'status_code', r.status_code, 'timed_out', r.timed_out, 'error_msg', left(regexp_replace(r.error_msg, 'https?://\S+', '<url>', 'g'), 120),
      'created', to_char(r.created at time zone 'utc', 'MM-DD HH24:MI:SS.US')
    ) order by r.id), '[]'::json)
    from net._http_response r
    where r.created >= timestamptz '2026-10-26 14:55+00' and r.created < timestamptz '2026-10-26 15:10+00'),
  'pg_net_callers_in_functions', (select coalesce(json_agg(json_build_object(
      'schema', n.nspname, 'fn', p.proname, 'sets_timeout', p.prosrc ~* 'timeout_milliseconds') order by n.nspname, p.proname), '[]'::json)
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where p.prosrc ilike '%net.http_%' and n.nspname not in ('net','pg_catalog','information_schema')),
  'duty_notifications', (select coalesce(json_agg(json_build_object('slot_start_utc', x.m, 'n', x.n) order by x.m), '[]'::json) from (
      select to_char(date_trunc('minute', n.created_at at time zone 'utc'), 'MM-DD HH24:MI') as m, count(*) as n
        from public.notifications n
       where n.type = 'duty' and n.created_at >= now() - interval '8 days'
       group by 1) x),
  'queue_now', (select count(*) from net.http_request_queue),
  'timeouts_7d_by_minute', (select coalesce(json_agg(x order by x.m), '[]'::json) from (
      select to_char(date_trunc('minute', r.created at time zone 'utc'), 'MM-DD HH24:MI') as m,
             count(*) filter (where r.timed_out) as timed_out, count(*) as total,
             min(r.id) as min_id, max(r.id) as max_id
        from net._http_response r
       where r.created >= now() - interval '8 days' and (r.timed_out or r.error_msg is not null)
       group by 1) x),
  'responses_1500_0500_7d', (select coalesce(json_agg(json_build_object(
      'id', r.id, 'status_code', r.status_code, 'timed_out', r.timed_out, 'error_msg', left(regexp_replace(r.error_msg, 'https?://\S+', '<url>', 'g'), 120),
      'created', to_char(r.created at time zone 'utc', 'MM-DD HH24:MI:SS')) order by r.id), '[]'::json)
    from net._http_response r
    where r.created >= now() - interval '8 days'
      and to_char(r.created at time zone 'utc', 'HH24:MI') in ('05:00','05:01','15:00','15:01')),
  'net_retention_oldest', (select to_char(min(created) at time zone 'utc','YYYY-MM-DD HH24:MI') from net._http_response)
) as cron_net_timeouts;
