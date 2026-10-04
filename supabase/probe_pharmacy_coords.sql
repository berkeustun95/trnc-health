-- Read-only probe for the duty list's coordinate source (feat/redesign, 2026-10-04).
-- gh workflow run supabase-readonly -f file=supabase/probe_pharmacy_coords.sql --ref feat/redesign
--
-- pharmacy_coords has no CREATE in the repo (dashboard-era). Before the app reads it, this
-- answers: its columns; whether the app's role (authenticated, which includes guests) can SELECT
-- it under RLS; its rows; and today's + the forward roster's names, so the JS matcher can be run
-- against the same data offline and the unmatched list printed.
select json_build_object(
  'columns', (select json_agg(json_build_object('c', column_name, 't', data_type, 'nullable', is_nullable)
                              order by ordinal_position)
                from information_schema.columns
               where table_schema = 'public' and table_name = 'pharmacy_coords'),
  'rls_on', (select relrowsecurity from pg_class where oid = to_regclass('public.pharmacy_coords')),
  'policies', (select json_agg(json_build_object('name', policyname, 'cmd', cmd, 'roles', roles,
                                                 'permissive', permissive, 'qual', qual))
                 from pg_policies where schemaname = 'public' and tablename = 'pharmacy_coords'),
  'anon_select', has_table_privilege('anon', 'public.pharmacy_coords', 'SELECT'),
  'authenticated_select', has_table_privilege('authenticated', 'public.pharmacy_coords', 'SELECT'),
  'n_rows', (select count(*) from public.pharmacy_coords),
  'rows', (select json_agg(to_jsonb(c)) from public.pharmacy_coords c),
  'today', (now() at time zone 'Europe/Istanbul')::date,
  'duty_today', (select json_agg(json_build_object('name', name, 'region', region) order by region, name)
                   from public.duty_list
                  where duty_date = (now() at time zone 'Europe/Istanbul')::date),
  'roster_names', (select json_agg(distinct name) from public.duty_list
                    where duty_date >= (now() at time zone 'Europe/Istanbul')::date),
  'facilities', (select json_agg(json_build_object('name', name, 'latitude', latitude, 'longitude', longitude))
                   from public.facilities where type = 'pharmacy' and latitude is not null)
) as report;
