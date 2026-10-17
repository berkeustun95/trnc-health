-- Duty swap 2026-10-17 Lefkoşa: İsmet → Hüseyin (Kerim) Sakallı (read-only), 2026-10-17.
-- Run before AND after 20261114: gh workflow run supabase-readonly -f file=supabase/probe_duty_2026_10_17_sakalli.sql
-- KTEB's roster spells him 'HÜSEYİN SAKALLI ECZANESİ'; facilities/pharmacy_coords say 'HÜSEYİN KERİM SAKALLI'
-- (alias in utils/dutyFacilityMatch.js), so both spellings are matched here.
select json_build_object(
  'lefkosa_today', (select json_agg(to_jsonb(d) order by d.name) from public.duty_list d
                     where d.duty_date = '2026-10-17' and d.region = 'Lefkoşa'),
  'rows_today_by_region', (select json_agg(x order by x.region) from (select region, count(*) n
                     from public.duty_list where duty_date = '2026-10-17' group by 1) x),
  'ismet_any', (select json_agg(x) from (select name, region, count(*) n, min(duty_date) first, max(duty_date) last,
                 array_agg(distinct phone) phones, array_agg(distinct address) addrs
                 from public.duty_list where name ~* 'İSMET' group by 1, 2) x),
  'sakalli_any', (select json_agg(x) from (select name, region, count(*) n, min(duty_date) first, max(duty_date) last,
                 array_agg(distinct phone) phones, array_agg(distinct address) addrs,
                 array_agg(distinct open_from::text || '-' || open_until::text) hours
                 from public.duty_list where name ~* 'SAKALLI' group by 1, 2) x),
  'sakalli_coords', (select json_agg(to_jsonb(c)) from public.pharmacy_coords c where c.name ~* 'SAKALLI'),
  'sakalli_facilities', (select json_agg(json_build_object('id', id, 'name', name, 'city', city, 'phone', phone,
                          'address', address, 'lat', latitude, 'lng', longitude))
                           from public.facilities f where type = 'pharmacy' and name ~* 'SAKALLI'),
  'ledger_20261114', (select json_agg(to_jsonb(l)) from public.schema_migrations_applied l
                       where l.filename = '20261114_duty_2026_10_17_lefkosa_sakalli.sql')
) as report;
