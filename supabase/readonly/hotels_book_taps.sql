-- HotelRunner "Rezervasyon Yap" taps (contact_events action 'book', module 'hotels', 20261083):
-- every tap with its time (Europe/Istanbul) and hotel, plus the total. Rows before a test window
-- are the baseline; rows inside one are TEST taps (vault: 2026-10-04_hotelrunner-partner).
select json_build_object(
  'total_book_taps', (select count(*) from public.contact_events where module = 'hotels' and action = 'book'),
  'taps', (select coalesce(json_agg(json_build_object(
              'at_istanbul', to_char(c.created_at at time zone 'Europe/Istanbul', 'YYYY-MM-DD HH24:MI:SS'),
              'hotel', h.name, 'region', c.region) order by c.created_at), '[]'::json)
           from public.contact_events c left join public.hotels h on h.id = c.entity_id
           where c.module = 'hotels' and c.action = 'book')
) as hotels_book_taps;
