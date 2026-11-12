-- Student Hub go-live SOP step 6: how many accounts accepted terms older than 2026-09-20.
-- Counts only (no ids — personal data stays in the database).
select json_build_object(
  'profiles', (select count(*) from public.profiles),
  'terms_null', (select count(*) from public.profiles where terms_version is null),
  'terms_older', (select count(*) from public.profiles where terms_version < '2026-09-20'),
  'terms_current', (select count(*) from public.profiles where terms_version >= '2026-09-20'),
  'versions', (select coalesce(json_object_agg(coalesce(terms_version, '(null)'), n), '{}'::json)
                 from (select terms_version, count(*) as n from public.profiles group by 1) s),
  -- 20261191's pre-flight refuses a terms_locale outside the nine full English language names: shown here before its go.
  'locales', (select coalesce(json_object_agg(coalesce(terms_locale, '(null)'), n), '{}'::json)
                from (select terms_locale, count(*) as n from public.profiles group by 1) s),
  -- 20261191 guards UPDATE only, on the repo-file finding that no client can INSERT into profiles (only the RESTRICTIVE no_anon_insert
  -- and handle_new_user). Names only: any PERMISSIVE INSERT / ALL policy listed here means that finding is wrong; tell the engineer before the go.
  'profiles_insert_policies', (select coalesce(json_agg(policyname || ':' || cmd order by policyname), '[]'::json)
                                 from pg_policies where schemaname = 'public' and tablename = 'profiles' and permissive = 'PERMISSIVE' and cmd in ('INSERT', 'ALL'))
) as terms_scope;
