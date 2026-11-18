-- Read-only probe (Berke, 2026-11-18, Apple 5.1.1(v)): what do the live profile age/nationality
-- constraint, trigger, column and view definitions look like? Prints definitions and names only:
-- no user rows, no counts, no ids.
SELECT item, detail FROM (
  SELECT 1 AS o, '1 completion_check' AS item,
         COALESCE((SELECT pg_get_constraintdef(c.oid) FROM pg_constraint c
                    WHERE c.conrelid = 'public.profiles'::regclass
                      AND c.conname = 'profiles_completion_requires_fields_check'), 'ABSENT') AS detail
  UNION ALL
  SELECT 2, '2 name_content_underage_lines',
         COALESCE((SELECT string_agg(btrim(l), ' || ')
                     FROM regexp_split_to_table(
                            pg_get_functiondef('public.check_profile_name_content()'::regprocedure), E'\n') AS l
                    WHERE l ILIKE '%date_of_birth IS NOT NULL%' OR l ILIKE '%interval ''13 years''%' OR l ILIKE '%UNDERAGE%'),
                  'NO MATCHING LINES')
  UNION ALL
  SELECT 3, '3 column ' || c.column_name, c.data_type || ' nullable=' || c.is_nullable
    FROM information_schema.columns c
   WHERE c.table_schema = 'public' AND c.table_name = 'profiles'
     AND c.column_name IN ('date_of_birth', 'nationality', 'nationality_code', 'age_confirmed_at')
  UNION ALL
  SELECT 3, '3 age_confirmed_at exists',
         (EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_schema = 'public' AND table_name = 'profiles'
                     AND column_name = 'age_confirmed_at'))::text
  UNION ALL
  SELECT 4, '4 trigger ' || t.tgname,
         pg_get_triggerdef(t.oid) || ' | fn=' || p.proname
         || ' | mentions_dob=' || (p.prosrc ILIKE '%date_of_birth%')::text
         || ' | mentions_nationality=' || (p.prosrc ILIKE '%nationality%')::text
    FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid
   WHERE t.tgrelid = 'public.profiles'::regclass AND NOT t.tgisinternal
  UNION ALL
  SELECT 5, '5 is_admin ' || p.oid::regprocedure::text, 'returns ' || pg_get_function_result(p.oid)
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'is_admin'
  UNION ALL
  SELECT 6, '6 view ' || v.schemaname || '.' || v.viewname, 'references dob/nationality'
    FROM pg_views v
   WHERE v.schemaname IN ('public', 'private')
     AND v.definition ~* '(date_of_birth|nationality)'
  UNION ALL
  SELECT 6, '6 matview ' || m.schemaname || '.' || m.matviewname, 'references dob/nationality'
    FROM pg_matviews m
   WHERE m.schemaname IN ('public', 'private')
     AND m.definition ~* '(date_of_birth|nationality)'
) x ORDER BY o, item;
