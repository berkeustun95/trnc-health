-- Every hotels-module contact event since 2026-10-04 with its exact time (Europe/Istanbul) and
-- hotel: which taps reached the table during the 2026-10-05 preview test and demo (read-only).
select json_agg(json_build_object(
  'at', to_char(c.created_at at time zone 'Europe/Istanbul', 'YYYY-MM-DD HH24:MI:SS'),
  'action', c.action, 'hotel', h.name, 'region', c.region) order by c.created_at) as hotel_taps
from public.contact_events c left join public.hotels h on h.id = c.entity_id
where c.module = 'hotels' and c.created_at >= timestamptz '2026-10-04 00:00+03';
