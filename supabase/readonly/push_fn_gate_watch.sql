-- Did the caller gate on send-duty-notification / send-weekend-digest let the cron through? (read-only, ONE SELECT, sealed)
-- Both jobs call with the Vault service key; a refused call would show here as 401 `{"ok":false,"error":"unauthorized"}`
-- while pg_cron still says "succeeded". Since the gate, a duty body starts `{"ok":true,"caller":"exact","date":"…`.
-- No command text, no ids, no push volume. net._http_response also holds the trigger-sent Expo push responses, so a body
-- prefix (first 48 chars) is shown ONLY for a row whose content starts `{"ok":` (these two functions) or whose status is
-- 401/403 (a gateway or handler refusal). Every other row is a fixed label: (error/timeout) or (other). (other) rows with
-- status 200 (Expo OK tickets) are left out entirely, neither listed nor counted. Weekend run rows: weekend_digest_runs_watch.sql.
select json_build_object(
  'now_utc', to_char(now() at time zone 'utc', 'Dy YYYY-MM-DD HH24:MI'),
  'jobs', (select coalesce(json_agg(json_build_object('job', j.jobname, 'active', j.active, 'schedule', j.schedule,
      'last_run', (select to_char(max(d.start_time) at time zone 'utc', 'Dy DD HH24:MI') from cron.job_run_details d where d.jobid = j.jobid)) order by j.jobname), '[]'::json)
    from cron.job j where j.jobname in ('duty-push', 'weekend-digest')),
  'responses_kept', (select coalesce(json_agg(x), '[]'::json) from (
      select to_char(date_trunc('hour', r.created at time zone 'utc'), 'Dy DD HH24') || 'Z' h, r.status_code s, r.body, count(*) n
        from (select created, status_code,
                     case when content like '{"ok":%' or status_code in (401, 403) then left(coalesce(content, error_msg), 48)
                          when error_msg is not null or timed_out then '(error/timeout)'
                          else '(other)' end body
                from net._http_response) r
       where not (r.body = '(other)' and r.status_code is not distinct from 200)
       group by 1, 2, 3 order by 1, 2) x),
  'duty_push_recent', (select coalesce(json_agg(x), '[]'::json) from (
      select to_char(started_at at time zone 'utc', 'Dy DD HH24:MI') t, outcome from public.duty_push_runs order by started_at desc limit 8) x)
) as push_fn_gate_watch;
