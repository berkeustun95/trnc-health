-- Last weekend digest runs (read-only, ONE SELECT, sealed): time, mode, outcome only. No counts, no ids.
-- Its own file on purpose: weekend_digest_runs (20261175) has RLS on, zero policies and only REVOKE FROM anon, authenticated
-- (no explicit GRANT as in 20261141), so a 42501 for supabase_read_only_user is possible here and must not take down
-- push_fn_gate_watch.sql. A 'testers' row or an 'all' row outside Friday 17:00 TRNC = an off-schedule call got through.
select json_build_object(
  'now_utc', to_char(now() at time zone 'utc', 'Dy YYYY-MM-DD HH24:MI'),
  'weekend_digest_recent', (select coalesce(json_agg(x), '[]'::json) from (
      select to_char(started_at at time zone 'utc', 'Dy DD HH24:MI') t, mode, outcome from public.weekend_digest_runs order by started_at desc limit 6) x)
) as weekend_digest_runs_watch;
