-- Araçlar S3 preflight (20261181 admin_content_author gains a 'vehicle' branch). Catalog and cron-job reads only:
-- no user rows, no counts of user data.
SELECT 'admin_content_author prosrc md5 (want f56c16c6f66adc78f46ff695dca1aec7)' AS item,
       coalesce((SELECT md5(prosrc) FROM pg_proc WHERE oid = to_regprocedure('public.admin_content_author(text,uuid)')), 'MISSING') AS value
UNION ALL
SELECT 'admin_content_author definer / config / acl',
       (SELECT prosecdef::text || ' / ' || coalesce(array_to_string(proconfig, ','), '-') || ' / ' || coalesce(proacl::text, '-')
          FROM pg_proc WHERE oid = to_regprocedure('public.admin_content_author(text,uuid)'))
UNION ALL
SELECT 'admin_content_author overloads',
       (SELECT string_agg(oid::regprocedure::text, ', ') FROM pg_proc WHERE proname = 'admin_content_author')
UNION ALL
SELECT 'DEFINER functions touching vehicles',
       (SELECT string_agg(n.nspname || '.' || p.proname, ', ' ORDER BY n.nspname, p.proname)
          FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE p.prosecdef AND n.nspname IN ('public', 'private') AND p.prosrc ~* '\mvehicles\M')
UNION ALL
SELECT 'vehicle-images bucket',
       (SELECT public::text || ' / ' || coalesce(file_size_limit::text, '-') || ' / ' || coalesce(array_to_string(allowed_mime_types, ','), '-')
          FROM storage.buckets WHERE id = 'vehicle-images')
UNION ALL
SELECT 'storage.objects triggers',
       (SELECT string_agg(tgname, ', ' ORDER BY tgname) FROM pg_trigger WHERE tgrelid = 'storage.objects'::regclass AND NOT tgisinternal)
UNION ALL
SELECT 'expire-vehicles cron: schedule / last run status',
       (SELECT j.schedule || ' / ' || coalesce((SELECT d.status || ' ' || d.start_time::date::text FROM cron.job_run_details d
                                                  WHERE d.jobid = j.jobid ORDER BY d.start_time DESC LIMIT 1), 'no run yet')
          FROM cron.job j WHERE j.jobname = 'expire-vehicles')
UNION ALL
SELECT 'ledger 20261181', coalesce((SELECT filename FROM public.schema_migrations_applied WHERE filename LIKE '20261181%'), 'not applied');
