-- Read-only. Duplicate-push Round 5 (2026-11-16): did a duty-push run RETRY a batch (sendBatch retries on Expo 503/429,
-- and a retried batch that Expo had already taken would reach every phone in it twice)? Per run, last 7 days, counts
-- only: no token, user id, e-mail or text. Plus today's in-app notification rows by type (a non-duty sender such as
-- the admin duty swap writes its own rows).
select json_build_object(
  'now_utc', to_char(now() at time zone 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  'duty_runs_7d', coalesce((select json_agg(json_build_object(
        'started_utc', to_char(started_at at time zone 'UTC', 'MM-DD HH24:MI:SS.MS'),
        'finished_utc', to_char(finished_at at time zone 'UTC', 'MM-DD HH24:MI:SS.MS'),
        'outcome', outcome, 'attempted', push_attempted, 'ok', push_ok, 'errors', push_errors,
        'retries', push_retries, 'error_kinds', error_kinds) order by started_at desc)
      from public.duty_push_runs where started_at > now() - interval '7 days'), '[]'::json),
  'notifs_today_by_type_minute', coalesce((select json_agg(json_build_object('minute_utc', m, 'type', ty, 'rows_n', n, 'users_n', u) order by m)
      from (select to_char(created_at at time zone 'UTC', 'HH24:MI') m, coalesce(type, '(null)') ty, count(*) n, count(distinct user_id) u
              from public.notifications
             where created_at >= date_trunc('day', now() at time zone 'Asia/Famagusta') at time zone 'Asia/Famagusta'
             group by 1, 2) x), '[]'::json)
) as duty_push_retries;
