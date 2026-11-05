-- Do functions that write with the platform's service key still reach the database? (read-only, sealed) Latest writes by day.
select json_build_object(
  'now_utc', to_char(now() at time zone 'utc', 'Dy YYYY-MM-DD HH24:MI'),
  'google_usage_by_day', (select json_agg(x) from (select day, kind, sum(n) n from public.google_places_usage where user_id = '00000000-0000-0000-0000-000000000000' and day > current_date - 8 group by 1, 2 order by 1 desc, 2) x),
  'google_pins_last', (select max(fetched_at) from public.google_place_pins),
  'apple_tokens_last', (select max(greatest(created_at, updated_at)) from public.apple_refresh_tokens),
  'apple_signups_7d', (select count(*) from auth.identities where provider = 'apple' and created_at > now() - interval '7 days'),
  'duty_runs_14d', (select json_agg(x) from (select to_char(started_at at time zone 'utc', 'Dy DD HH24:MI') t, outcome from public.duty_push_runs where started_at > now() - interval '14 days' order by started_at desc) x)
) as function_key_impact;
