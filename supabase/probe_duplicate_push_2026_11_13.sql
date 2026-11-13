-- Duplicate push report, 2026-11-13: which send doubled, and why. READ-ONLY: one SELECT, aggregates only.
-- Prints no push token, no substring of one, no user id, no notification text. The result is sealed
-- (scripts/supabase-readonly.mjs → seal) and opened into the vault; the public log shows ciphertext only.
--   double_rows:   same user, same type, same title, same body within 72 h more than once = the SEND ran twice
--                  (an in-app row is written per profile, so a shared token cannot cause it).
--   shared_tokens: one token on more than one profile = one phone gets one push per profile (the row count is right,
--                  the phone still gets two).
--   control:       profiles with a token must be > 0, or this role cannot see profiles and every 0 here means nothing.
select json_build_object(
  'now_utc', to_char(now() at time zone 'utc', 'YYYY-MM-DD HH24:MI:SS'),
  'control_profiles_with_token', (select count(*) from public.profiles where push_token is not null),

  'notifs_72h_by_type_hour', (select coalesce(json_agg(x order by x.hour_utc, x.type), '[]'::json) from (
      select to_char(date_trunc('hour', created_at at time zone 'utc'), 'MM-DD HH24:00') hour_utc, type,
             count(*) rows_n, count(distinct user_id) users_n
        from public.notifications where created_at > now() - interval '72 hours' group by 1, 2) x),

  'double_rows_72h_by_type', (select coalesce(json_agg(x order by x.type), '[]'::json) from (
      select type, count(*) users_with_dupes, sum(n - 1) extra_rows, max(n) max_per_user,
             to_char(min(first_at) at time zone 'utc', 'MM-DD HH24:MI:SS') first_utc,
             to_char(max(last_at)  at time zone 'utc', 'MM-DD HH24:MI:SS') last_utc,
             max(extract(epoch from last_at - first_at))::int max_gap_s
        from (select user_id, type, title, body, count(*) n, min(created_at) first_at, max(created_at) last_at
                from public.notifications where created_at > now() - interval '72 hours'
               group by 1, 2, 3, 4 having count(*) > 1) d
       group by type) x),

  'weekend_digest_runs_7d', (select coalesce(json_agg(json_build_object(
      'mode', mode, 'outcome', outcome,
      'started_utc', to_char(started_at at time zone 'utc', 'MM-DD HH24:MI:SS.MS'),
      'finished_utc', to_char(finished_at at time zone 'utc', 'MM-DD HH24:MI:SS.MS'),
      'events', events, 'notified', notified, 'push_attempted', push_attempted, 'push_ok', push_ok,
      'push_errors', push_errors, 'error_kinds', error_kinds) order by started_at), '[]'::json)
    from public.weekend_digest_runs where started_at > now() - interval '7 days'),

  'duty_push_runs_3d', (select coalesce(json_agg(json_build_object(
      'outcome', outcome, 'started_utc', to_char(started_at at time zone 'utc', 'MM-DD HH24:MI:SS.MS'),
      'notified', notified, 'push_attempted', push_attempted, 'push_ok', push_ok) order by started_at), '[]'::json)
    from public.duty_push_runs where started_at > now() - interval '3 days'),

  'push_jobs', (select coalesce(json_agg(json_build_object(
      'jobid', j.jobid, 'job', j.jobname, 'schedule', j.schedule, 'active', j.active,
      'target', substring(j.command from '/functions/v1/[a-z0-9-]+'),
      'gated_digest', j.command like '%weekend_digest_due()%', 'gated_duty', j.command like '%duty_push_due()%')
      order by j.jobid), '[]'::json)
    from cron.job j
    where j.command ilike '%send-weekend-digest%' or j.command ilike '%send-duty-notification%'
       or j.command ilike '%exp.host%' or j.command ilike '%notify_module_waitlist%'),

  'push_job_runs_today', (select coalesce(json_agg(json_build_object(
      'jobid', d.jobid, 'job', j.jobname, 'status', d.status,
      'ret', left(regexp_replace(d.return_message, 'https?://\S+', '<url>', 'g'), 80),
      'start_utc', to_char(d.start_time at time zone 'utc', 'MM-DD HH24:MI:SS.MS')) order by d.start_time), '[]'::json)
    from cron.job_run_details d join cron.job j on j.jobid = d.jobid
    where d.start_time > now() - interval '24 hours'
      and (j.command ilike '%send-weekend-digest%' or j.command ilike '%send-duty-notification%')),

  'net_responses_today', (select coalesce(json_agg(json_build_object(
      'status_code', r.status_code, 'timed_out', r.timed_out,
      'created_utc', to_char(r.created at time zone 'utc', 'MM-DD HH24:MI:SS.MS')) order by r.id), '[]'::json)
    from net._http_response r where r.created > now() - interval '24 hours'
      and (r.created at time zone 'utc')::time between '14:50' and '15:20'),

  'shared_tokens', (select json_build_object(
      'tokens_on_2plus_profiles', count(*), 'extra_profiles', coalesce(sum(n - 1), 0), 'max_profiles_per_token', max(n),
      'tokens_on_2plus_digest_on', count(*) filter (where n_digest > 1),
      'extra_digest_pushes', coalesce(sum(greatest(n_digest - 1, 0)), 0),
      'extra_duty_pushes_customers', coalesce(sum(greatest(n_customer - 1, 0)), 0),
      'by_role_mix', (select coalesce(json_object_agg(mix, k), '{}'::json) from (
          select roles mix, count(*) k from (
            select string_agg(distinct coalesce(role, 'null'), '+' order by coalesce(role, 'null')) roles
              from public.profiles where push_token is not null group by push_token having count(*) > 1) r
          group by roles) m))
    from (select push_token, count(*) n,
                 count(*) filter (where weekend_digest) n_digest,
                 count(*) filter (where role = 'customer') n_customer
            from public.profiles where push_token is not null group by push_token having count(*) > 1) s),

  'module_waitlist', (select coalesce(json_agg(x order by x.module), '[]'::json) from (
      select module, count(*) filter (where notified_at is not null) notified, count(*) total,
             to_char(min(notified_at) at time zone 'utc', 'MM-DD HH24:MI') first_stamp,
             to_char(max(notified_at) at time zone 'utc', 'MM-DD HH24:MI') last_stamp
        from public.module_waitlist group by module) x)
) as duplicate_push;
