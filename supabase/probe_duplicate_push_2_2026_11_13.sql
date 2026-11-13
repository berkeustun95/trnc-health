-- Duplicate push report 2, 2026-11-13. READ-ONLY: one SELECT, aggregates and catalog names only. Sealed result.
-- No token, no substring of one, no user id, no notification text, no URL (masked to the function path).
-- Question: users show the SAME text twice (digest, duty, digest, duty). The run logs say each sender ran once with one
-- message per profile. Is there a second sender the run logs cannot see (trigger, webhook, other cron), and which
-- token shapes exist?
select json_build_object(
  'now_utc', to_char(now() at time zone 'utc', 'YYYY-MM-DD HH24:MI:SS'),

  -- every user trigger on the two tables a push hangs off, and whether its function can reach the network
  'triggers', (select coalesce(json_agg(json_build_object(
      'table', c.relname, 'trigger', t.tgname, 'enabled', t.tgenabled,
      'fn', pn.nspname || '.' || p.proname,
      'fn_http', p.prosrc ilike '%http_post%' or p.prosrc ilike '%http_request%' or pn.nspname = 'supabase_functions',
      'fn_push_words', p.prosrc ilike '%exp.host%' or p.prosrc ilike '%push_token%' or p.prosrc ilike '%functions/v1%')
      order by c.relname, t.tgname), '[]'::json)
    from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
    join pg_proc p on p.oid = t.tgfoid join pg_namespace pn on pn.oid = p.pronamespace
    where not t.tgisinternal and n.nspname = 'public' and c.relname in ('notifications', 'profiles')),

  -- dashboard "Database Webhooks" anywhere (they never appear in migrations)
  'webhook_triggers', (select coalesce(json_agg(n.nspname || '.' || c.relname || ':' || t.tgname), '[]'::json)
    from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
    join pg_proc p on p.oid = t.tgfoid join pg_namespace pn on pn.oid = p.pronamespace
    where not t.tgisinternal and pn.nspname = 'supabase_functions'),

  -- every cron run that started 14:55-15:05 UTC today, any job
  'cron_runs_1500', (select coalesce(json_agg(json_build_object(
      'job', j.jobname, 'status', d.status, 'ret', left(regexp_replace(d.return_message, 'https?://\S+', '<url>', 'g'), 60),
      'target', coalesce(substring(j.command from '/functions/v1/[a-z0-9-]+'),
                         case when j.command ilike '%exp.host%' then 'exp.host' when j.command ilike '%http%' then 'other http' else 'sql' end),
      'start_utc', to_char(d.start_time at time zone 'utc', 'HH24:MI:SS.MS')) order by d.start_time), '[]'::json)
    from cron.job_run_details d join cron.job j on j.jobid = d.jobid
    where d.start_time >= date_trunc('day', now()) + interval '14 hours 55 minutes'
      and d.start_time <  date_trunc('day', now()) + interval '15 hours 5 minutes'),

  -- every pg_net reply today, by minute: a per-row push trigger would show hundreds around 15:00
  'net_replies_today_by_minute', (select coalesce(json_agg(x order by x.m), '[]'::json) from (
      select to_char(date_trunc('minute', created at time zone 'utc'), 'HH24:MI') m, count(*) n,
             count(*) filter (where timed_out) timed_out
        from net._http_response where created >= date_trunc('day', now()) group by 1) x),

  -- 14 days, per TRNC day: duty runs, in-app rows, users, users with more than one duty row that day
  'duty_14d', (select coalesce(json_agg(x order by x.dlocal), '[]'::json) from (
      select r.dlocal, r.runs, r.attempted, r.ok, n.rows_n, n.users_n, n.users_2plus
        from (select to_char(started_at at time zone 'Asia/Famagusta', 'MM-DD') as dlocal, count(*) runs,
                     sum(push_attempted) attempted, sum(push_ok) ok
                from public.duty_push_runs where started_at > now() - interval '14 days' group by 1) r
        left join (select dlocal, sum(k) rows_n, count(*) users_n, count(*) filter (where k > 1) users_2plus
                     from (select to_char(created_at at time zone 'Asia/Famagusta', 'MM-DD') as dlocal, user_id, count(*) k
                             from public.notifications where type = 'duty' and created_at > now() - interval '14 days'
                            group by 1, 2) u group by dlocal) n on n.dlocal = r.dlocal) x),

  'weekend_today', (select json_build_object('rows_n', count(*), 'users_n', count(distinct user_id))
    from public.notifications where type = 'weekend' and created_at >= date_trunc('day', now())),

  -- token shapes: Expo tokens vs raw FCM/APNs device tokens (a raw token would reach the phone by another route)
  'token_shapes', (select json_build_object(
      'rows', count(*), 'distinct', count(distinct push_token),
      'expo_exponent', count(*) filter (where push_token like 'ExponentPushToken[%]'),
      'expo_expo', count(*) filter (where push_token like 'ExpoPushToken[%]'),
      'other', count(*) filter (where push_token not like 'ExponentPushToken[%]' and push_token not like 'ExpoPushToken[%]'),
      'with_whitespace', count(*) filter (where push_token ~ '\s'),
      'distinct_after_trim', count(distinct btrim(push_token)))
    from public.profiles where push_token is not null),

  -- the shared-token pairs: language of each row, and how many pairs repeat the same language (= identical text)
  'shared_pairs', (select json_build_object(
      'pairs', count(*), 'same_language', count(*) filter (where langs_distinct = 1),
      'languages', (select coalesce(json_object_agg(l, k), '{}'::json) from (
          select coalesce(preferred_language, 'null') l, count(*) k from public.profiles
           where push_token in (select push_token from public.profiles where push_token is not null
                                 group by push_token having count(*) > 1) group by 1) z))
    from (select count(distinct coalesce(preferred_language, 'null')) langs_distinct
            from public.profiles where push_token is not null group by push_token having count(*) > 1) s),

  -- any other column that could hold a push/device token (names only)
  'token_columns', (select coalesce(json_agg(table_schema || '.' || table_name || '.' || column_name order by 1), '[]'::json)
    from information_schema.columns
    where table_schema = 'public' and column_name ilike '%token%')
) as duplicate_push_2;
