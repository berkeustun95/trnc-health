-- Live definitions the Araçlar migrations (shared adult age, vehicles, vehicle moderation, cars notify) build on,
-- read before they are written against them (2026-11-07). A migration file is intent; the catalogs are the authority.
-- Catalog reads only: no user rows, no counts of user data.
SELECT 'version' AS item, version() AS value
UNION ALL SELECT 'fn:' || n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')',
       'md5(prosrc)=' || md5(p.prosrc) || ' secdef=' || p.prosecdef || ' config=' || coalesce(p.proconfig::text, '') || ' acl=' || coalesce(p.proacl::text, '<default>') || E'\n' || p.prosrc
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE (n.nspname = 'public' AND p.proname IN ('auto_hide_reported_content', 'guard_moderation_columns', 'may_initiate_by_age',
          'is_previewer', 'is_admin', 'get_my_role', 'is_anonymous_session', 'contains_blocked_term', 'contains_payment_solicitation'))
    OR n.nspname = 'private'
UNION ALL SELECT 'fndef:' || p.proname, 'md5(def)=' || md5(pg_get_functiondef(p.oid)) || E'\n' || pg_get_functiondef(p.oid)
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.proname IN ('notify_module_waitlist', 'module_notif_text')
UNION ALL SELECT 'check:' || c.conrelid::regclass || '.' || c.conname, pg_get_constraintdef(c.oid)
  FROM pg_constraint c
 WHERE c.conname IN ('content_reports_content_type_check', 'contact_events_module_check', 'module_waitlist_module_check')
UNION ALL SELECT 'trigger:' || tgrelid::regclass || '.' || tgname, pg_get_triggerdef(oid)
  FROM pg_trigger WHERE tgrelid = to_regclass('public.content_reports') AND NOT tgisinternal
UNION ALL SELECT 'storage.objects policies', count(*)::text || ': ' || string_agg(policyname, ', ' ORDER BY policyname)
  FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects'
UNION ALL SELECT 'bucket:' || id, 'public=' || public || ' limit=' || coalesce(file_size_limit::text, 'none')
  FROM storage.buckets WHERE id IN ('vehicle-images', 'property-images')
UNION ALL SELECT 'table exists:' || t, coalesce(to_regclass('public.' || t)::text, 'no')
  FROM unnest(ARRAY['vehicles', 'dealers', 'vehicle_images', 'vehicle_sources']) t
UNION ALL SELECT 'column:profiles.' || column_name, data_type
  FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name IN ('date_of_birth', 'ugc_banned_until', 'role')
UNION ALL SELECT 'schema private', CASE WHEN to_regnamespace('private') IS NULL THEN 'missing' ELSE 'exists' END
UNION ALL SELECT 'cron job:' || jobname, schedule FROM cron.job WHERE jobname LIKE '%vehicle%'
ORDER BY 1;
