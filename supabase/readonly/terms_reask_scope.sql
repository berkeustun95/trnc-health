-- Student Hub go-live SOP step 6: how many accounts accepted terms older than 2026-09-20.
-- Counts only (no ids — personal data stays in the database).
select json_build_object(
  'profiles', (select count(*) from public.profiles),
  'terms_null', (select count(*) from public.profiles where terms_version is null),
  'terms_older', (select count(*) from public.profiles where terms_version < '2026-09-20'),
  'terms_current', (select count(*) from public.profiles where terms_version >= '2026-09-20'),
  'versions', (select coalesce(json_object_agg(coalesce(terms_version, '(null)'), n), '{}'::json)
                 from (select terms_version, count(*) as n from public.profiles group by 1) s)
) as terms_scope;
