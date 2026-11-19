-- Duty push 3-minute shift (20261221): did every :27 / :57 tick run, and did it send once a day? Read-only, ONE SELECT, sealed.
-- gh workflow run supabase-readonly -f file=supabase/readonly/duty_push_shift_check.sql   (open: node scripts/readonly-results.mjs <run-id>)
-- Times and statuses only: no counts of users or tokens, no ids, no tokens, no return_message (it can hold response bodies),
-- and none of duty_push_runs' notified / push_* columns; error_kinds is read as KEYS only (jsonb_object_keys, never the values).
--
-- This probe reads BOTH states and judges neither: the shifted state (27,57, has_3min_shift true) is what 20261221 leaves; after the
-- rollback 20261222 the same fields read '0,30 * * * *' / false again and 'minutes_seen' shows {0,30}. Read the fields, not a verdict.
--
-- BEFORE the apply: 'ledger_20261221' is [] (no row), duty-push reads '0,30 * * * *', the gate has_3min_shift is false.
-- AFTER the apply: ledger_20261221 holds one row, duty-push reads '27,57 * * * *', has_3min_shift true, weekend-digest still '0,30 * * * 5,6'.
--
-- HOW TO READ "one run per day, none skipped, none twice":
--   cron_per_day      every local day with ticks: 'ticks' = cron starts that day, 'minutes_seen' must be {27,57} (a tick at :00 / :30
--                     is the OLD schedule), succeeded + failed (+ other) = ticks. Ticks that did not send are normal: the gate says no.
--   cron_last_24h     the raw list, newest first (start time Famagusta, status); every hour shows :27 and :57.
--   duty_push_runs    one row per Edge Function call. PER DAY expect exactly ONE row at the slot minus 3 min (Mon-Fri 16:57, Sat 12:57,
--                     Sun 07:57, Thursday = closing minus 33 min). "none skipped" = a day with cron ticks but no row (the gate or the
--                     call failed: look at cron_per_day failed); "none twice" = a second row on a day. started_at is the function's own
--                     clock, a few seconds after the tick; a row that stays 'running' long after started_at was cut off.
--   Before 20261221 the same rows sit at 17:00 / 13:00 / 08:00. Both halves of the comparison live in this one result.
-- NOTE: supabase_read_only_user may lack SELECT on cron.job_run_details or duty_push_runs (42501): then read the same two lists
-- from the admin screen / ask Berke; do not widen a grant for a probe.
select json_build_object(
  'now_famagusta', to_char(now() at time zone 'Asia/Famagusta', 'Dy YYYY-MM-DD HH24:MI:SS'),
  'cron_jobs', (select coalesce(json_agg(json_build_object('job', j.jobname, 'schedule', j.schedule, 'active', j.active) order by j.jobname), '[]'::json)
                  from cron.job j where j.jobname in ('duty-push', 'weekend-digest')),
  'gate', (select json_build_object(
              'exists', to_regprocedure('public.duty_push_due(timestamptz)') is not null,
              'has_3min_shift', coalesce(pg_get_functiondef(to_regprocedure('public.duty_push_due(timestamptz)')) like '%(p_at + interval ''3 minutes'') AT TIME ZONE ''Asia/Famagusta''%', false),
              'has_pause_clause', coalesce(pg_get_functiondef(to_regprocedure('public.duty_push_due(timestamptz)')) like '%AND NOT public.data_job_paused(''duty-push'')%', false),
              'reads_famagusta', coalesce(pg_get_functiondef(to_regprocedure('public.duty_push_due(timestamptz)')) like '%Asia/Famagusta%', false),
              'anon_can_execute', coalesce(has_function_privilege('anon', to_regprocedure('public.duty_push_due(timestamptz)'), 'EXECUTE'), false),
              'authenticated_can_execute', coalesce(has_function_privilege('authenticated', to_regprocedure('public.duty_push_due(timestamptz)'), 'EXECUTE'), false))),
  'ledger_20261221', (select coalesce(json_agg(json_build_object('filename', m.filename,
                                                               'applied_at', to_char(m.applied_at at time zone 'Asia/Famagusta', 'YYYY-MM-DD HH24:MI:SS'),
                                                               'checksum12', left(m.checksum, 12))), '[]'::json)
                        from public.schema_migrations_applied m where m.filename like '20261221%'),
  'cron_per_day', (select coalesce(json_agg(x order by x.day desc), '[]'::json) from (
      select d.day,
             count(*) as ticks,
             count(*) filter (where d.status = 'succeeded') as succeeded,
             count(*) filter (where d.status = 'failed') as failed,
             count(*) filter (where d.status not in ('succeeded', 'failed')) as other,
             json_agg(distinct d.mi order by d.mi) as minutes_seen,
             to_char(min(d.start_time) at time zone 'Asia/Famagusta', 'HH24:MI:SS') as first_start,
             to_char(max(d.start_time) at time zone 'Asia/Famagusta', 'HH24:MI:SS') as last_start
        from (select r.status, r.start_time,
                     to_char(r.start_time at time zone 'Asia/Famagusta', 'YYYY-MM-DD Dy') as day,
                     extract(minute from r.start_time at time zone 'Asia/Famagusta')::int as mi
                from cron.job_run_details r
               where r.jobid in (select j.jobid from cron.job j where j.jobname = 'duty-push')
                 and r.start_time > now() - interval '7 days') d
       group by d.day) x),
  'cron_last_24h', (select coalesce(json_agg(json_build_object('start', to_char(d.start_time at time zone 'Asia/Famagusta', 'Dy MM-DD HH24:MI:SS'), 'status', d.status) order by d.start_time desc), '[]'::json)
                      from cron.job_run_details d
                     where d.jobid in (select j.jobid from cron.job j where j.jobname = 'duty-push')
                       and d.start_time > now() - interval '24 hours'),
  'duty_push_runs_per_day', (select coalesce(json_agg(json_build_object('day', x.day, 'runs', x.runs) order by x.day desc), '[]'::json) from (
      select to_char(r.started_at at time zone 'Asia/Famagusta', 'YYYY-MM-DD Dy') as day,
             json_agg(json_build_object('started_at', to_char(r.started_at at time zone 'Asia/Famagusta', 'HH24:MI:SS'),
                                        'outcome', r.outcome,
                                        'error_kinds', (select coalesce(json_agg(k order by k), '[]'::json) from jsonb_object_keys(r.error_kinds) k))
                      order by r.started_at) as runs
        from public.duty_push_runs r
       where r.started_at > now() - interval '7 days'
       group by to_char(r.started_at at time zone 'Asia/Famagusta', 'YYYY-MM-DD Dy')) x)
) as duty_push_shift_check;
