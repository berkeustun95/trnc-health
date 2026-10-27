-- Did the duty pushes go out? Last 14 days of duty_push_runs (20261141), counts only: no token, user id or text
-- is stored. Read-only. Before 20261141 is applied the table is absent and this fails with 42P01 (= not applied yet).
-- ⚠ push_ok = Expo ACCEPTED the message, not "the phone got it". A run still 'running' with finished_at NULL
-- and started more than 5 minutes ago was cut off (unfinished).
select json_build_object(
    'runs', count(*),
    'unfinished', count(*) filter (where finished_at is null and started_at < now() - interval '5 minutes'),
    'by_outcome', coalesce((select json_object_agg(o, n) from (select outcome o, count(*) n from public.duty_push_runs where started_at > now() - interval '14 days' group by outcome) x), '{}'::json),
    'sum_notified', coalesce(sum(notified), 0),
    'sum_push_attempted', coalesce(sum(push_attempted), 0),
    'sum_push_ok', coalesce(sum(push_ok), 0),
    'sum_push_errors', coalesce(sum(push_errors), 0),
    'per_day', coalesce((select json_agg(json_build_object('date', d, 'runs', r, 'attempted', a, 'ok', k, 'errors', e) order by d desc)
                          from (select to_char(started_at at time zone 'Asia/Famagusta', 'YYYY-MM-DD') d, count(*) r, sum(push_attempted) a, sum(push_ok) k, sum(push_errors) e
                                  from public.duty_push_runs where started_at > now() - interval '14 days' group by 1) y), '[]'::json),
    'error_kinds', coalesce((select json_object_agg(key, total) from (select key, sum(value::int) total
                               from public.duty_push_runs, jsonb_each_text(error_kinds)
                              where started_at > now() - interval '14 days' group by key) z), '{}'::json))
     as duty_push_runs
  from public.duty_push_runs where started_at > now() - interval '14 days';
