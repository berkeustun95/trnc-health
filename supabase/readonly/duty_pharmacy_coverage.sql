-- Duty pharmacy coverage inputs + the 4 rows 20261085 pins (read-only), 2026-10-06.
-- gh workflow run supabase-readonly -f file=supabase/readonly/duty_pharmacy_coverage.sql --ref <branch>
-- 'roster' = distinct (name, region) from today on (Europe/Istanbul), the 334 the 309/21/4 figure
-- was computed over. 'coords' and 'facilities' are exactly what DutyListScreen fetches; the count
-- is run offline through utils/dutyFacilityMatch.js (no SQL copy of the matcher).
select json_build_object(
  'targets', (select json_agg(to_jsonb(c) order by c.name) from public.pharmacy_coords c
               where c.name_key in (select public.pharmacy_name_key(n) from unnest(array[
                 'GİZEM KARAHASAN ECZANESİ', 'NERİMAN KARATAÇ ECZANESİ',
                 'SERVET GÖKŞİN ECZANESİ', 'VADİLİ ECZANESİ']) n)),
  'targets_duty', (select json_agg(x order by x.name) from (
                     select name, region, count(*) n, min(duty_date) first, max(duty_date) last, max(address) address
                       from public.duty_list
                      where name ~* '(GİZEM KARAHASAN|NERİMAN KARATAÇ|SERVET GÖKŞİN|VADİLİ)'
                      group by name, region) x),
  'by_source', (select json_agg(json_build_object('source', source, 'verified', verified, 'rows', n, 'pinned', p))
                  from (select source, verified, count(*) n, count(*) filter (where lat is not null) p
                          from public.pharmacy_coords group by 1, 2) x),
  'coords', (select json_agg(json_build_object('name', name, 'region', region, 'lat', lat, 'lng', lng))
               from public.pharmacy_coords where lat is not null),
  'facilities', (select json_agg(json_build_object('name', name, 'latitude', latitude, 'longitude', longitude))
                   from public.facilities where type = 'pharmacy' and latitude is not null),
  'roster', (select json_agg(json_build_object('name', name, 'region', region)) from (
               select distinct name, region from public.duty_list
                where duty_date >= (now() at time zone 'Europe/Istanbul')::date) x)
) as report;
