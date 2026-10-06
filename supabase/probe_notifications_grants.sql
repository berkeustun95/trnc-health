-- 20261088 pre-flight (read-only): who holds what on notifications, by named role (has_*_privilege
-- resolves inherited grants; information_schema only shows the reader's own).
select json_build_object(
  'table', (select json_object_agg(r || ':' || p, has_table_privilege(r, 'public.notifications', p))
              from unnest(array['anon','authenticated','service_role']) r,
                   unnest(array['SELECT','INSERT','UPDATE','DELETE']) p),
  'columns_update', (select json_object_agg(r || ':' || a.attname, has_column_privilege(r, 'public.notifications', a.attname, 'UPDATE'))
              from unnest(array['anon','authenticated']) r, pg_attribute a
             where a.attrelid = 'public.notifications'::regclass and a.attnum > 0 and not a.attisdropped),
  'columns_insert', (select json_object_agg(r || ':' || a.attname, has_column_privilege(r, 'public.notifications', a.attname, 'INSERT'))
              from unnest(array['anon','authenticated']) r, pg_attribute a
             where a.attrelid = 'public.notifications'::regclass and a.attnum > 0 and not a.attisdropped),
  'relacl', (select relacl::text from pg_class where oid = 'public.notifications'::regclass),
  'column_acls', (select json_object_agg(attname, attacl::text) from pg_attribute
                   where attrelid = 'public.notifications'::regclass and attnum > 0 and attacl is not null),
  'policies', (select json_agg(policyname || ' ' || permissive || ' ' || cmd) from pg_policies
                where schemaname = 'public' and tablename = 'notifications'),
  'owner', (select pg_get_userbyid(relowner) from pg_class where oid = 'public.notifications'::regclass),
  'notify_new_message_owner', (select pg_get_userbyid(proowner) from pg_proc where oid = 'public.notify_new_message(uuid)'::regprocedure),
  'definer_writers', (select json_agg(p.proname || ' owner=' || pg_get_userbyid(p.proowner) || ' definer=' || p.prosecdef)
                       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                      where n.nspname = 'public' and p.prokind = 'f' and p.prosrc ~* '(insert\s+into|update)\s+(public\.)?notifications\M'),
  'triggers', (select count(*) from pg_trigger where tgrelid = 'public.notifications'::regclass and not tgisinternal)
) as notifications_grants;
