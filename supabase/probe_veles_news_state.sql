-- Read-only: state of 20261225 (contact_events module 'news') after apply run 45066684322.
-- No ids, no counts: constraint text, ledger presence, and the newest tap time per module (last 3 days).
select json_build_object(
  'module_check', (select pg_get_constraintdef(oid) from pg_constraint
                    where conrelid = to_regclass('public.contact_events') and conname = 'contact_events_module_check'),
  'module_checks_on_table', (select count(*) from pg_constraint
                    where conrelid = to_regclass('public.contact_events') and contype = 'c' and conname like '%module%'),
  'ledger_20261225', exists(select 1 from public.schema_migrations_applied where filename = '20261225_contact_events_news.sql'),
  'table_visible', exists(select 1 from public.contact_events),
  'role_bypasses_rls', (select rolbypassrls from pg_roles where rolname = current_user),
  'newest_tap_per_module_3d', (select json_object_agg(module, newest) from (
      select module, max(created_at) as newest from public.contact_events
       where created_at > now() - interval '3 days' group by module) t)
) as veles_news_state;
