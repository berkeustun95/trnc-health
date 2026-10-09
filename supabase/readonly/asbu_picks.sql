-- Who points at either "Ankara Sosyal Bilimler Üniversitesi" row (TRNC campus …0017 and the YÖK
-- Ankara row), before renaming …0017 to its campus name. Read-only. FKs into institutions are
-- printed from pg_constraint so a third referencing table cannot hide. User ids are truncated.
select json_build_object(
  'asbu_rows', (select json_agg(json_build_object('id', id, 'country', country, 'city', city, 'city_name', city_name, 'active', is_active) order by country)
                  from public.institutions where name = 'Ankara Sosyal Bilimler Üniversitesi'),
  'fk_into_institutions', (select json_agg(json_build_object('table', conrelid::regclass::text, 'def', pg_get_constraintdef(oid)) order by 1)
                  from pg_constraint where confrelid = 'public.institutions'::regclass and contype = 'f'),
  'student_education', (select coalesce(json_agg(json_build_object('inst', i.country, 'user', left(e.user_id::text, 8),
                  'created', to_jsonb(e)->>'created_at', 'updated', to_jsonb(e)->>'updated_at', 'opt_in', e.listing_opt_in, 'level', e.level)
                  order by i.country), '[]'::json)
                  from public.student_education e join public.institutions i on i.id = e.institution_id
                 where i.name = 'Ankara Sosyal Bilimler Üniversitesi'),
  'profiles', (select coalesce(json_agg(json_build_object('inst', i.country, 'user', left(p.id::text, 8),
                  'updated', to_jsonb(p)->>'updated_at') order by i.country), '[]'::json)
                  from public.profiles p join public.institutions i on i.id = p.institution_id
                 where i.name = 'Ankara Sosyal Bilimler Üniversitesi'),
  'context_any_non_trnc_pick', json_build_object(
                  'student_education', (select count(*) from public.student_education e join public.institutions i on i.id = e.institution_id where i.country is distinct from 'XN' and i.id <> '00000000-0000-4000-b000-0000000000ff'),
                  'profiles', (select count(*) from public.profiles p join public.institutions i on i.id = p.institution_id where i.country is distinct from 'XN' and i.id <> '00000000-0000-4000-b000-0000000000ff'))
) as asbu_picks;
