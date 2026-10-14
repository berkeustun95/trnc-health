-- KKTCELL handoff taps per month (contact_events module 'connectivity', 20261112): ADA's own lead
-- count. Month in Europe/Istanbul, by operator, package and app language. `taps` is every tap;
-- `tap_minutes` collapses repeat taps on the same package within one minute (the dedup
-- contact_events_monthly uses; there is no per-person dedup, by design). Needs 20261112 applied.
--   gh workflow run supabase-readonly -f file=supabase/readonly/connectivity_taps_monthly.sql
select json_build_object(
  -- positive control: the read sees the table at all (an empty list below means no taps, not a blind read)
  'all_contact_events', (select count(*) from public.contact_events),
  'connectivity_taps', (select count(*) from public.contact_events where module = 'connectivity'),
  'by_month', (select coalesce(json_agg(r order by r.month desc, r.taps desc), '[]'::json) from (
      select to_char(date_trunc('month', c.created_at at time zone 'Europe/Istanbul'), 'YYYY-MM') as month,
             coalesce(o.name, o2.name, '(removed)') as operator,
             coalesce(p.name, case when o2.id is not null then '(operator, no package)' else '(removed)' end) as package,
             coalesce(c.lang, '(unknown)') as lang,
             count(*) as taps,
             count(distinct (c.entity_id, date_trunc('minute', c.created_at))) as tap_minutes
        from public.contact_events c
        left join public.connectivity_packages  p  on p.id  = c.entity_id
        left join public.connectivity_operators o  on o.id  = p.operator_id
        left join public.connectivity_operators o2 on o2.id = c.entity_id
       where c.module = 'connectivity'
       group by 1, 2, 3, 4) r)
) as connectivity_taps_monthly;
