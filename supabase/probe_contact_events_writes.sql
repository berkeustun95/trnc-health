-- Why do hotel call/website/maps taps not reach contact_events while 'book' does (2026-10-05)?
-- Read-only: the live INSERT path (policies, triggers, column grants, CHECKs) and what actually
-- arrives per module/action/day for the last 21 days (Europe/Istanbul).
select json_build_object(
  'policies', (select json_agg(json_build_object('name', policyname, 'cmd', cmd, 'permissive', permissive,
                 'roles', roles, 'using', qual, 'check', with_check)) from pg_policies
               where schemaname = 'public' and tablename = 'contact_events'),
  'triggers', (select json_agg(pg_get_triggerdef(t.oid)) from pg_trigger t
               where t.tgrelid = 'public.contact_events'::regclass and not t.tgisinternal),
  'checks',   (select json_agg(json_build_object('name', conname, 'def', pg_get_constraintdef(oid))) from pg_constraint
               where conrelid = 'public.contact_events'::regclass and contype = 'c'),
  'anon_insert_cols', (select json_agg(column_name order by column_name) from information_schema.columns c
               where table_schema = 'public' and table_name = 'contact_events'
                 and has_column_privilege('anon', 'public.contact_events', c.column_name, 'INSERT')),
  'auth_insert_cols', (select json_agg(column_name order by column_name) from information_schema.columns c
               where table_schema = 'public' and table_name = 'contact_events'
                 and has_column_privilege('authenticated', 'public.contact_events', c.column_name, 'INSERT')),
  'by_day', (select json_agg(x order by x->>'day' desc, x->>'module', x->>'action') from (
               select json_build_object('day', to_char(created_at at time zone 'Europe/Istanbul', 'YYYY-MM-DD'),
                      'module', module, 'action', action, 'n', count(*)) x
               from public.contact_events where created_at > now() - interval '21 days'
               group by 1, module, action) s),
  'total', (select count(*) from public.contact_events)
) as contact_events_probe;
