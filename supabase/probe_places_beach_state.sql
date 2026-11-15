-- Explore beach state: are there beach rows the public cannot see (pending / rejected / hidden / no coordinates)?
-- READ-ONLY: one SELECT. Results are sealed. Reads public.places (directory CONTENT rows, not users), the legacy
-- public.beaches row count, the places RLS policies and the status check. Prints NO ids, NO submitted_by / provider_id,
-- NO timestamps, NO contact fields, NO descriptions: only names (user submissions, i.e. pending/rejected rows with no source, are masked as '(submission)'), regions, statuses, flags and the language keys present.
-- public.beaches predates the repo migrations (20260822 backfills from it), so it is counted through to_regclass +
-- query_to_xml: a missing table gives null instead of failing the statement (the count is exact, not reltuples).
select json_build_object(
  'places_by_category', (select coalesce(json_agg(x order by x.category, x.status, x.source), '[]'::json) from (
      select p.category, p.status, (p.hidden_at is null) as visible_not_hidden,
             (p.latitude is not null and p.longitude is not null) as has_coords,
             coalesce(p.source, '(none)') as source, count(*) as n
        from public.places p group by 1, 2, 3, 4, 5) x),
  'beaches_legacy', case when to_regclass('public.beaches') is null then null
      else (xpath('/row/n/text()', query_to_xml('select count(*) as n from public.beaches', false, true, '')))[1]::text::bigint end,
  'beach_rows', (select coalesce(json_agg(b order by b.region, b.status, b.name), '[]'::json) from (
      select case when p.status in ('active','staged') or p.source is not null then p.name else '(submission)' end as name,
             p.region, p.status, (p.hidden_at is not null) as hidden,
             (p.latitude is not null and p.longitude is not null) as has_coords,
             (p.cover_image_url is not null) as has_cover, p.source,
             case when jsonb_typeof(p.name_i18n) = 'object' then (select coalesce(json_agg(k order by k), '[]'::json) from jsonb_object_keys(p.name_i18n) k) end as name_i18n_keys,
             case when jsonb_typeof(p.description_i18n) = 'object' then (select coalesce(json_agg(k order by k), '[]'::json) from jsonb_object_keys(p.description_i18n) k) end as description_i18n_keys
        from public.places p where p.category = 'beach') b),
  'places_policies', (select coalesce(json_agg(json_build_object('policyname', pol.policyname, 'cmd', pol.cmd,
        'permissive', pol.permissive, 'roles', pol.roles::text, 'qual', pol.qual, 'with_check', pol.with_check)
        order by pol.policyname), '[]'::json) from pg_policies pol where pol.schemaname = 'public' and pol.tablename = 'places'),
  'rls_enabled', (select c.relrowsecurity from pg_class c where c.oid = 'public.places'::regclass),
  'rls_forced', (select c.relforcerowsecurity from pg_class c where c.oid = 'public.places'::regclass),
  'places_status_check', (select pg_get_constraintdef(k.oid) from pg_constraint k
        where k.conrelid = 'public.places'::regclass and k.conname = 'places_status_check')
) as places_beach_state;
