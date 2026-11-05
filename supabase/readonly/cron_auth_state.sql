-- Every cron job that calls over HTTP, and what pg_net got back (read-only, sealed). pg_cron says "succeeded" once a request
-- is queued, so only the responses show a refused call. Commands are masked; they name Vault secrets, never values.
select json_build_object(
  'now_utc', to_char(now() at time zone 'utc', 'Dy YYYY-MM-DD HH24:MI'),
  'jobs', (select json_agg(json_build_object('job', j.jobname, 'schedule', j.schedule, 'active', j.active,
      'url', substring(j.command from 'functions/v1/[a-z0-9-]+'),
      'vault_names', (select array_agg(distinct m[1]) from regexp_matches(j.command, 'name\s*=\s*''([^'']+)''', 'g') m),
      'auth_header', j.command ilike '%authorization%', 'apikey_header', j.command ilike '%apikey%',
      'last_run', (select to_char(max(d.start_time) at time zone 'utc', 'Dy DD HH24:MI') from cron.job_run_details d where d.jobid = j.jobid)) order by j.jobname)
    from cron.job j where j.command ilike '%net.http%' or j.command ilike '%functions/v1%'),
  'responses_kept', (select json_agg(x) from (
      select to_char(date_trunc('hour', r.created at time zone 'utc'), 'Dy DD HH24') || 'Z' h, r.status_code s, left(coalesce(r.content, r.error_msg), 60) body, count(*) n
        from net._http_response r group by 1, 2, 3 order by 1, 2) x),
  'vault_names', (select json_agg(json_build_object('name', name, 'updated', updated_at::date)) from vault.secrets),
  'duty_push_recent', (select json_agg(x) from (select to_char(started_at at time zone 'utc', 'Dy DD HH24:MI') t, outcome from public.duty_push_runs order by started_at desc limit 8) x)
) as cron_auth_state;
