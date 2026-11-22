-- Read-only, catalog only: state of 20261225 (contact_events module 'news') after apply run 45066684322.
-- No user rows, no ids, no counts.
select json_build_object(
  'module_check', (select pg_get_constraintdef(oid) from pg_constraint
                    where conrelid = to_regclass('public.contact_events') and conname = 'contact_events_module_check'),
  'action_check', (select pg_get_constraintdef(oid) from pg_constraint
                    where conrelid = to_regclass('public.contact_events') and conname = 'contact_events_action_check'),
  'ledger_20261225', exists(select 1 from public.schema_migrations_applied where filename = '20261225_contact_events_news.sql'),
  'anon_can_insert', has_table_privilege('anon', 'public.contact_events', 'INSERT'),
  'authenticated_can_insert', has_table_privilege('authenticated', 'public.contact_events', 'INSERT')
) as veles_news_state;
