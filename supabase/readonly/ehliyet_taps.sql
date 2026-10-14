-- Ehliyet contact taps (contact_events module 'ehliyet', 20261109): every tap with its time
-- (Europe/Istanbul), action and school, plus counts per action. Taps from ADA Preview before the
-- production OTA (2026-10-14) are TEST taps.
select json_build_object(
  -- positive control: the read sees the table at all (a 0 below means no taps, not a blind read)
  'all_contact_events', (select count(*) from public.contact_events),
  'ehliyet_by_action', (select coalesce(json_object_agg(action, n), '{}'::json)
                          from (select action, count(*) n from public.contact_events
                                 where module = 'ehliyet' group by action) a),
  'taps', (select coalesce(json_agg(json_build_object(
              'at_istanbul', to_char(c.created_at at time zone 'Europe/Istanbul', 'YYYY-MM-DD HH24:MI:SS'),
              'action', c.action, 'school', s.name) order by c.created_at), '[]'::json)
           from public.contact_events c left join public.driving_schools s on s.id = c.entity_id
           where c.module = 'ehliyet')
) as ehliyet_taps;
