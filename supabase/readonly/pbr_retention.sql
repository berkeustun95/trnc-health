-- 20261148 post-apply probe (read-only): the purge job, the function, the table comment, row count.
-- An empty jobs list may mean "this role cannot see cron.job", not "no job" (see the role line).
select json_build_object(
  'jobs', (select coalesce(json_agg(json_build_object('job', j.jobname, 'schedule', j.schedule, 'command', j.command, 'active', j.active)), '[]'::json)
             from cron.job j where j.jobname = 'purge-partner-booking-requests'),
  'jobs_any_name_with_this_command', (select count(*) from cron.job j where j.command ilike '%purge_partner_booking_requests%'),
  'function', to_regprocedure('public.purge_partner_booking_requests()')::text,
  'execute_authenticated', case when to_regprocedure('public.purge_partner_booking_requests()') is null then null
                                else has_function_privilege('authenticated', 'public.purge_partner_booking_requests()', 'EXECUTE') end,
  'table_comment_has_12_months', coalesce(obj_description(to_regclass('public.partner_booking_requests'), 'pg_class'), '') ilike '%12 months%',
  'rows', (select count(*) from public.partner_booking_requests),
  'oldest_row', (select min(created_at) from public.partner_booking_requests)
) as pbr_retention;
