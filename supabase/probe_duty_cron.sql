-- Read-only: duty push cron command shape (JWTs redacted) and Asia/Famagusta conversion in prod's tzdata.
select json_build_object(
  'pg', version(),
  'cron_tz', (select setting from pg_settings where name = 'cron.timezone'),
  'famagusta_known', exists (select 1 from pg_timezone_names where name = 'Asia/Famagusta'),
  'thu_15oct_1400utc_local', to_char(('2026-10-15 14:00+00'::timestamptz) at time zone 'Asia/Famagusta', 'Dy YYYY-MM-DD HH24:MI'),
  'thu_29oct_1500utc_local', to_char(('2026-10-29 15:00+00'::timestamptz) at time zone 'Asia/Famagusta', 'Dy YYYY-MM-DD HH24:MI'),
  'novest_key_in_vault', (select count(*) from vault.secrets where name = 'novest_sync_key'),
  'jobs', (select json_agg(json_build_object('job', j.jobname, 'jobid', j.jobid, 'db', j.database, 'user', j.username,
             'command', regexp_replace(j.command, 'eyJ[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+', '<JWT>', 'g'))
             order by j.jobname)
           from cron.job j where j.jobname ilike '%duty%' or j.command ilike '%send-duty-notification%')
) as probe;
