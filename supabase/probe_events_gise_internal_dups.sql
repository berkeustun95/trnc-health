-- Duplicates inside the Gişe Kıbrıs feed, 2026-11-14. READ-ONLY, one SELECT, sealed. Follow-up to
-- probe_events_gise_vs_manual.sql (run 43640416608: no non-Gişe events exist; 5 same-title-same-day groups inside Gişe).
-- Prints EVENT CONTENT only: title, venue, start time, status, Gişe's own external_id, last_seen_at, ticket and image
-- presence. Never organizer_id / organizer_name or any user column.
WITH g AS (
  SELECT id, external_id, title, location, status, start_date, end_date, last_seen_at, ticket_url, price_text,
         (start_date AT TIME ZONE 'Europe/Nicosia')::date AS day,
         regexp_replace(lower(translate(coalesce(title, ''), 'İIÇĞÖŞÜçğıöşüÂâÎîÛû', 'iicgosucgiosuaaiiuu')), '[^a-z0-9]+', '', 'g') AS nt
    FROM public.events WHERE source = 'gisekibris'),
grp AS (SELECT nt, day FROM g WHERE nt <> '' GROUP BY nt, day HAVING count(DISTINCT external_id) > 1)
SELECT json_build_object(
  'groups', (SELECT count(*) FROM grp),
  'groups_upcoming', (SELECT count(*) FROM grp WHERE day >= (now() AT TIME ZONE 'Europe/Nicosia')::date),
  'rows', (SELECT json_agg(x ORDER BY x.day DESC, x.title, x.starts) FROM (
     SELECT g.day, g.title, g.location, g.status, g.external_id,
            to_char(g.start_date AT TIME ZONE 'Europe/Nicosia', 'HH24:MI') AS starts,
            to_char(g.end_date AT TIME ZONE 'Europe/Nicosia', 'HH24:MI') AS ends,
            to_char(g.last_seen_at AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') AS last_seen_utc,
            g.ticket_url IS NOT NULL AS has_ticket, g.price_text,
            g.ticket_url = lag(g.ticket_url) OVER (PARTITION BY g.nt, g.day ORDER BY g.start_date) AS same_ticket_as_previous
       FROM g JOIN grp USING (nt, day)) x)
) AS result;
