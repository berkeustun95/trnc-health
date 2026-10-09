-- Baseline before 20261095-98 (institutions outside the TRNC): the live shape of everything
-- the migrations touch. Read-only; the live catalogs are the authority, not the files.
select json_build_object(
  'pg_version', version(),
  'columns', (select json_agg(json_build_object('col', column_name, 'type', data_type, 'null', is_nullable, 'def', column_default) order by ordinal_position)
                from information_schema.columns where table_schema = 'public' and table_name = 'institutions'),
  'constraints', (select json_agg(json_build_object('name', conname, 'def', pg_get_constraintdef(oid)) order by conname)
                    from pg_constraint where conrelid = 'public.institutions'::regclass),
  'indexes', (select json_agg(indexdef order by indexname) from pg_indexes where schemaname = 'public' and tablename = 'institutions'),
  'policies', (select json_agg(json_build_object('name', policyname, 'cmd', cmd, 'roles', roles, 'qual', qual)) from pg_policies
                 where schemaname = 'public' and tablename = 'institutions'),
  'rows', (select json_agg(json_build_object('id', id, 'name', name, 'short', short_name, 'city', city, 'active', is_active,
                                             'sort', sort_order, 'web', website_url) order by sort_order, name) from public.institutions),
  'fk_in', (select json_agg(json_build_object('table', conrelid::regclass::text, 'def', pg_get_constraintdef(oid)))
              from pg_constraint where confrelid = 'public.institutions'::regclass),
  'functions_reading_institutions', (select json_agg(p.oid::regprocedure::text order by 1) from pg_proc p
              join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public' and p.prokind = 'f' and pg_get_functiondef(p.oid) ~* '\minstitutions\M'),
  'functions_calling_is_listed_student', (select json_agg(p.oid::regprocedure::text order by 1) from pg_proc p
              join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public' and p.prokind = 'f' and p.proname <> 'is_listed_student'
               and pg_get_functiondef(p.oid) ~* 'is_listed_student|can_see_student_lists'),
  'views_reading_institutions', (select json_agg(table_name) from information_schema.view_table_usage
              where table_schema = 'public' and table_name = 'institutions'),
  'def_is_listed_student', (select pg_get_functiondef(to_regprocedure('public.is_listed_student(uuid)'))),
  'def_can_see_student_lists', (select pg_get_functiondef(to_regprocedure('public.can_see_student_lists()'))),
  'def_get_student_list', (select pg_get_functiondef(to_regprocedure('public.get_student_list(uuid,text,integer)'))),
  'enrolments_per_institution', (select json_agg(json_build_object('id', institution_id, 'n', n, 'opted_in', o))
              from (select institution_id, count(*) n, count(*) filter (where listing_opt_in) o
                      from public.student_education group by 1) s),
  'opted_in_at_inactive_or_other', (select count(*) from public.student_education e join public.institutions i on i.id = e.institution_id
              where e.listing_opt_in and (not i.is_active or i.id = '00000000-0000-4000-b000-0000000000ff'))
) as institutions_baseline;
