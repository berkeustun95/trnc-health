-- Did the caller gate on send-duty-notification / send-weekend-digest let the cron through? (read-only, ONE SELECT, sealed)
-- Both jobs call with the Vault service key; a refused call would show here as 401 `{"ok":false,"error":"unauthorized"}`
-- while pg_cron still says "succeeded". Since the gate, a duty body starts `{"ok":true,"caller":"exact","date":"…`.
-- No command text, no counts of users / notifications / pushes, no ids. The first 48 characters of a response body are
-- the same exposure supabase/readonly/cron_auth_state.sql already has. Weekend run rows are in weekend_digest_runs_watch.sql.
select json_build_object(
  'now_utc', to_char(now() at time zone 'utc', 'Dy YYYY-MM-DD HH24:MI'),
  'jobs', (select coalesce(json_agg(json_build_object('job', j.jobname, 'active', j.active, 'schedule', j.schedule,
      'last_run', (select to_char(max(d.start_time) at time zone 'utc', 'Dy DD HH24:MI') from cron.job_run_details d where d.jobid = j.jobid)) order by j.jobname), '[]'::json)
    from cron.job j where j.jobname in ('duty-push', 'weekend-digest')),
  'responses_kept', (select coalesce(json_agg(x), '[]'::json) from (
      select to_char(date_trunc('hour', r.created at time zone 'utc'), 'Dy DD HH24') || 'Z' h, r.status_code s,
             left(coalesce(r.content, r.error_msg), 48) body, count(*) n
        from net._http_response r group by 1, 2, 3 order by 1, 2) x),
  'duty_push_recent', (select coalesce(json_agg(x), '[]'::json) from (
      select to_char(started_at at time zone 'utc', 'Dy DD HH24:MI') t, outcome from public.duty_push_runs order by started_at desc limit 8) x)
) as push_fn_gate_watch;
