-- Live baseline for the marketplace migrations (vault 2026-11-07_marketplace-plan.md): the bodies
-- they redefine (md5 = the drift guard each migration asserts), the constraints/indexes/policies
-- they touch, bucket settings, and the triggers on storage.objects. Schema only:
-- no user rows, no counts of users (public Actions logs).
select json_build_object(
  'version', version(),
  'functions', (select json_agg(json_build_object('sig', p.oid::regprocedure::text, 'md5', md5(p.prosrc),
                  'secdef', p.prosecdef, 'def', pg_get_functiondef(p.oid)) order by p.proname)
                from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                where n.nspname = 'public' and p.proname in (
                  'start_conversation','send_message','list_conversations','notify_new_message',
                  'may_initiate_by_age','is_listed_student','block_user','list_my_blocks',
                  'accept_conversation','decline_conversation','leave_conversation','delete_message',
                  'auto_hide_reported_content','purge_soft_deleted_ugc','guard_moderation_columns',
                  'check_ugc_on_insert','check_report_rate_limit','is_anonymous_session','is_admin',
                  'accept_checkin_notice','guard_checkin_notice_columns','delete_own_account',
                  'can_see_student_lists','stamp_message_sender','enforce_message_age_rule')),
  'age_interval_homes', (select json_agg(p.oid::regprocedure::text) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                where n.nspname = 'public' and p.prosrc like '%interval ''18 years''%'),
  'constraints', (select json_agg(json_build_object('t', conrelid::regclass::text, 'n', conname, 'd', pg_get_constraintdef(oid)) order by conname)
                from pg_constraint where conrelid in (to_regclass('public.content_reports'), to_regclass('public.conversations'),
                  to_regclass('public.messages'), to_regclass('public.notifications'), to_regclass('public.blocks'))),
  'indexes', (select json_agg(indexdef order by indexname) from pg_indexes where schemaname = 'public' and tablename in ('conversations','content_reports')),
  'triggers', (select json_agg(tgrelid::regclass::text || ': ' || pg_get_triggerdef(oid) order by tgrelid::regclass::text, tgname)
                from pg_trigger where not tgisinternal and tgrelid in (to_regclass('public.conversations'), to_regclass('public.messages'),
                  to_regclass('public.content_reports'), to_regclass('public.profiles'), to_regclass('storage.objects'))),
  'policies', (select json_agg(json_build_object('t', tablename, 'n', policyname, 'perm', permissive, 'cmd', cmd, 'roles', roles, 'qual', qual, 'chk', with_check) order by tablename, policyname)
                from pg_policies where (schemaname = 'public' and tablename in ('conversations','messages','content_reports','blocks','notifications'))),
  'storage_policy_names', (select json_agg(policyname order by policyname) from pg_policies where schemaname = 'storage' and tablename = 'objects'),
  'buckets', (select json_agg(json_build_object('id', id, 'public', public, 'limit', file_size_limit, 'mimes', allowed_mime_types) order by id) from storage.buckets),
  'profile_cols', (select json_agg(column_name || ' ' || data_type order by ordinal_position) from information_schema.columns
                where table_schema = 'public' and table_name = 'profiles'),
  'conversation_cols', (select json_agg(column_name || ' ' || data_type order by ordinal_position) from information_schema.columns
                where table_schema = 'public' and table_name = 'conversations'),
  'cron_jobs', (select json_agg(jobname || ' ' || schedule order by jobname) from cron.job)
) as marketplace_baseline;
