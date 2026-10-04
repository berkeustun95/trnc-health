-- Read-only probe for the pharmacy_coords Mesarya split (2026-10-04).
-- gh workflow run supabase-readonly -f file=supabase/probe_mesarya_regions.sql --ref db/mesarya-regions
-- For every pharmacy_coords row with region 'Mesarya': which Mesarya sub-regions its name
-- carries anywhere in duty_list (all dates), and every region it appears under at all.
select json_build_object(
  'mesarya_rows', (select json_agg(x order by x.name) from (
     select c.name,
            (select array_agg(distinct d.region order by d.region) from public.duty_list d
              where public.pharmacy_name_key(d.name) = c.name_key
                and d.region in ('Üst Mesarya', 'Alt Mesarya')) as sub_regions,
            (select array_agg(distinct d.region order by d.region) from public.duty_list d
              where public.pharmacy_name_key(d.name) = c.name_key) as all_regions,
            (select count(*) from public.duty_list d where public.pharmacy_name_key(d.name) = c.name_key) as duty_rows
       from public.pharmacy_coords c where c.region = 'Mesarya') x),
  'region_counts', (select json_object_agg(coalesce(region, 'NULL'), n) from
     (select region, count(*) n from public.pharmacy_coords group by region) y),
  'duty_list_bare_mesarya_rows', (select count(*) from public.duty_list where region = 'Mesarya')
) as report;
