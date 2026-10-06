-- 20261087 pre-flight (read-only): what an ON DELETE SET NULL FK notifications.conversation_id →
-- conversations would run into, and the exact-match backfill counts.
select json_build_object(
  'pg_version', version(),
  'migration_1087_applied', exists (select 1 from public.schema_migrations_applied where filename like '20261087%'),
  'notif_columns', (select json_agg(column_name order by ordinal_position) from information_schema.columns
                     where table_schema = 'public' and table_name = 'notifications'),
  'notif_triggers', (select coalesce(json_agg(pg_get_triggerdef(t.oid)), '[]') from pg_trigger t
                      where t.tgrelid = 'public.notifications'::regclass and not t.tgisinternal),
  'notif_constraints', (select json_agg(conname || ': ' || pg_get_constraintdef(oid)) from pg_constraint
                         where conrelid = 'public.notifications'::regclass),
  'notif_policies', (select json_agg(policyname || ' ' || cmd || ' ' || array_to_string(roles, ',') || ' USING ' || coalesce(qual, '-') || ' CHECK ' || coalesce(with_check, '-'))
                      from pg_policies where schemaname = 'public' and tablename = 'notifications'),
  'notif_update_grants', (select json_agg(distinct grantee || ':' || privilege_type) from information_schema.role_table_grants
                           where table_schema = 'public' and table_name = 'notifications' and privilege_type in ('UPDATE', 'INSERT')),
  'notif_col_update_grants', (select coalesce(json_agg(grantee || ':' || column_name), '[]') from information_schema.column_privileges
                               where table_schema = 'public' and table_name = 'notifications' and privilege_type = 'UPDATE'
                                 and grantee in ('authenticated', 'anon')),
  'fks_into_conversations', (select json_agg(conrelid::regclass || '.' || conname || ': ' || pg_get_constraintdef(oid)) from pg_constraint
                              where contype = 'f' and confrelid = 'public.conversations'::regclass),
  'fks_out_of_conversations', (select json_agg(conname || ': ' || pg_get_constraintdef(oid)) from pg_constraint
                                where contype = 'f' and conrelid = 'public.conversations'::regclass),
  'conversation_delete_paths', (select coalesce(json_agg(p.proname), '[]') from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                                 where n.nspname = 'public' and p.prokind in ('f', 'p') and pg_get_functiondef(p.oid) ~* 'DELETE\s+FROM\s+(public\.)?conversations'),
  'delete_own_account_live', (select pg_get_functiondef('public.delete_own_account()'::regprocedure)),
  'notify_new_message_inserts', (select substring(pg_get_functiondef('public.notify_new_message(uuid)'::regprocedure)
                                   from 'INSERT INTO notifications[^;]*;')),
  'backfill', (
    with msg_notifs as (select n.id, n.user_id, n.created_at from public.notifications n where n.type = 'message')
    select json_build_object(
      'message_rows', (select count(*) from msg_notifs),
      'matched_exactly_one', (select count(*) from msg_notifs mn where (select count(*) from public.messages m
                                join public.conversations c on c.id = m.conversation_id
                               where m.created_at = mn.created_at
                                 and mn.user_id = case when m.sender_id = c.initiator_id then c.recipient_id else c.initiator_id end) = 1),
      'matched_more_than_one', (select count(*) from msg_notifs mn where (select count(*) from public.messages m
                                join public.conversations c on c.id = m.conversation_id
                               where m.created_at = mn.created_at
                                 and mn.user_id = case when m.sender_id = c.initiator_id then c.recipient_id else c.initiator_id end) > 1),
      'unmatched', (select count(*) from msg_notifs mn where not exists (select 1 from public.messages m
                                join public.conversations c on c.id = m.conversation_id
                               where m.created_at = mn.created_at
                                 and mn.user_id = case when m.sender_id = c.initiator_id then c.recipient_id else c.initiator_id end)),
      'unmatched_rows', (select coalesce(json_agg(mn.created_at), '[]') from msg_notifs mn
                          where not exists (select 1 from public.messages m join public.conversations c on c.id = m.conversation_id
                                             where m.created_at = mn.created_at
                                               and mn.user_id = case when m.sender_id = c.initiator_id then c.recipient_id else c.initiator_id end)),
      'messages_total', (select count(*) from public.messages),
      'conversations_total', (select count(*) from public.conversations))
  )
) as message_deeplink_preflight;
