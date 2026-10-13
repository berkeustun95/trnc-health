-- Duty swap 2026-10-13 Lefkoşa: Umut Öksüz → Tuna (read-only), 2026-10-13.
-- gh workflow run supabase-readonly -f file=supabase/probe_duty_2026_10_13_tuna.sql --ref fix/duty-2026-10-13-tuna
select json_build_object(
  'today_all', (select json_agg(to_jsonb(d) order by d.region, d.name) from public.duty_list d
                 where d.duty_date = '2026-10-13'),
  'umut_any', (select json_agg(x) from (select name, region, count(*) n, min(duty_date) first, max(duty_date) last,
                 array_agg(distinct phone) phones, array_agg(distinct address) addrs
                 from public.duty_list where name ~* 'UMUT' group by 1, 2) x),
  'tuna_any', (select json_agg(x) from (select name, region, count(*) n, min(duty_date) first, max(duty_date) last,
                 array_agg(distinct phone) phones, array_agg(distinct address) addrs,
                 array_agg(distinct open_from::text || '-' || open_until::text) hours
                 from public.duty_list where name ~* 'TUNA' group by 1, 2) x),
  'tuna_coords', (select json_agg(to_jsonb(c)) from public.pharmacy_coords c where c.name ~* 'TUNA'),
  'tuna_facilities', (select json_agg(json_build_object('id', id, 'name', name, 'city', city, 'phone', phone, 'address', address))
                        from public.facilities f where type = 'pharmacy' and name ~* 'TUNA')
) as report;
