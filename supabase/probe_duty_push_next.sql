-- Read-only, post-20261103: the live duty jobs, and the send instants the LIVE duty_push_due()
-- yields for 12 Oct – 1 Nov 2026 (every 30-min UTC tick), printed in TRNC local time and UTC.
select json_build_object(
  'jobs', (select json_agg(json_build_object('job', jobname, 'schedule', schedule, 'active', active,
             'vault_keyed', command like '%vault.decrypted_secrets%', 'gated', command like '%duty_push_due()%',
             'inline_jwt', command like '%eyJ%') order by jobname)
           from cron.job where jobname ilike '%duty%' or command ilike '%send-duty-notification%'),
  'can_execute', has_function_privilege('public.duty_push_due(timestamptz)', 'EXECUTE'),
  'thursday_closing', (select pg_get_functiondef('public.duty_thursday_closing_local()'::regprocedure)),
  'sends', case when has_function_privilege('public.duty_push_due(timestamptz)', 'EXECUTE') then
           (select json_agg(to_char(t at time zone 'Asia/Famagusta', 'Dy DD Mon HH24:MI') || ' TRNC = '
                            || to_char(t at time zone 'UTC', 'HH24:MI') || 'Z' order by t)
              from generate_series(timestamptz '2026-10-12 00:00+00', timestamptz '2026-11-01 23:30+00', interval '30 minutes') t
             where public.duty_push_due(t)) end
) as duty_push;
