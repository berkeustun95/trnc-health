-- What the sync-novest cron actually got back (read-only). cron.job_run_details says "succeeded" once the request is
-- queued, so only the response tells a failed sync. Results are sealed, so the body may be selected. pg_net keeps rows ~6 h:
-- run within 6 h of the 05:00 or 15:00 UTC cron. pg_net has no job column, so this takes every response from those minutes. Open with: node scripts/readonly-results.mjs <run-id>
select json_build_object(
  'now_utc', to_char(now() at time zone 'utc', 'Dy YYYY-MM-DD HH24:MI'),
  'oldest_kept', (select to_char(min(created) at time zone 'utc', 'Dy DD HH24:MI') from net._http_response),
  'responses', (select coalesce(json_agg(json_build_object(
      'created_utc', to_char(r.created at time zone 'utc', 'Dy DD HH24:MI:SS'),
      'status', r.status_code, 'timed_out', r.timed_out, 'error_msg', r.error_msg, 'body', left(r.content, 2500)) order by r.created), '[]'::json)
    from net._http_response r
    where extract(hour from r.created at time zone 'utc') in (5, 15) and extract(minute from r.created at time zone 'utc') < 3),
  'stamped_last', (select to_char(max(last_seen_at) at time zone 'utc', 'Dy DD HH24:MI') from public.properties where source = 'novest')
) as novest_sync_failures;
