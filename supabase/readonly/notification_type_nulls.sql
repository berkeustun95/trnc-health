-- After 20261066: every notification row has a type. RLS-protected table — read the role line
-- above (bypasses RLS) before trusting a 0.
select json_build_object(
  'has_type_column', exists (select 1 from information_schema.columns
                              where table_schema = 'public' and table_name = 'notifications' and column_name = 'type'),
  'rows', (select count(*) from public.notifications),
  'by_type', (select coalesce(json_object_agg(coalesce(t, '(null)'), n), '{}'::json)
                from (select to_jsonb(x) ->> 'type' as t, count(*) as n from public.notifications x group by 1) s)
) as notification_types;
