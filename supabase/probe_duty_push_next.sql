-- Read-only, post-20261103: the live duty jobs, and the LIVE schedule functions'
-- definition. supabase_read_only_user cannot EXECUTE duty_push_due (revoked from PUBLIC), so the
-- send-instant proof is 20261103's own in-transaction assertions, which ran on prod at apply.
select json_build_object(
  'jobs', (select json_agg(json_build_object('job', jobname, 'schedule', schedule, 'active', active,
             'vault_keyed', command like '%vault.decrypted_secrets%', 'gated', command like '%duty_push_due()%',
             'inline_jwt', command like '%eyJ%') order by jobname)
           from cron.job where jobname ilike '%duty%' or command ilike '%send-duty-notification%'),
  'thursday_closing', (select pg_get_functiondef('public.duty_thursday_closing_local()'::regprocedure)),
  'due_fn_reads_famagusta', (select pg_get_functiondef('public.duty_push_due(timestamptz)'::regprocedure) like '%Asia/Famagusta%'),
  'famagusta_15oct_1400z', to_char(timestamptz '2026-10-15 14:00+00' at time zone 'Asia/Famagusta', 'Dy DD Mon HH24:MI'),
  'famagusta_29oct_1500z', to_char(timestamptz '2026-10-29 15:00+00' at time zone 'Asia/Famagusta', 'Dy DD Mon HH24:MI'),
  'ledger', (select json_build_object('file', filename, 'at', applied_at) from public.schema_migrations_applied
              where filename = '20261103_duty_push_famagusta.sql')
) as duty_push;
