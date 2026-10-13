-- Did the 2026-10-13 duty push name UMUT ÖKSÜZ? (read-only), 2026-10-13.
-- Counts and bodies only (public Action logs): no user ids. 'duty' rows are the in-app copy of
-- each push (send-duty-notification inserts one per profile with the same body it pushes).
select json_build_object(
  'now_utc', to_char(now() at time zone 'utc', 'YYYY-MM-DD HH24:MI'),
  'duty_rows_today', (select json_agg(x) from (
      select title, body, count(*) n, to_char(min(created_at) at time zone 'utc', 'HH24:MI:SS') first_utc,
             to_char(max(created_at) at time zone 'utc', 'HH24:MI:SS') last_utc
        from public.notifications
       where type = 'duty' and (created_at at time zone 'Asia/Famagusta')::date = '2026-10-13'
       group by 1, 2 order by 3 desc) x),
  'any_body_names_umut_today', exists (select 1 from public.notifications
       where type = 'duty' and (created_at at time zone 'Asia/Famagusta')::date = '2026-10-13'
         and body ~* 'ÖKSÜZ|OKSUZ'),
  'cron_runs', (select json_agg(x) from (
      select d.status, to_char(d.start_time at time zone 'utc', 'YYYY-MM-DD HH24:MI') start_utc, left(d.return_message, 80) msg
        from cron.job_run_details d join cron.job j on j.jobid = d.jobid
       where j.jobname = 'duty-push' order by d.start_time desc limit 4) x)
) as report;
