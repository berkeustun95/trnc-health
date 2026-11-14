-- Gişe Kıbrıs vs manually added events, 2026-11-14. READ-ONLY, one SELECT, sealed (results go to the vault only).
-- Approved by Berke 2026-11-14. Prints EVENT CONTENT only (title, date, venue, source, status, ticket host): never
-- organizer_id, organizer_name or any user column. Counts are of events, not of people.
-- A non-Gişe event (source IS DISTINCT FROM 'gisekibris') "looks like" a Gişe event when either:
--   title  = same normalised title (Turkish letters folded, punctuation dropped) and the same day in Nicosia time
--   venue  = same day, same normalised venue, and the first 10 normalised title characters agree
--   ticket = its ticket_url points at gisekibris.com and a Gişe event exists that day with the same title prefix
-- Also: duplicates inside the Gişe feed (same title + day, different external_id) and inside the non-Gişe rows.
-- "upcoming" = start_date today or later (Nicosia). Visible to users = status 'approved'.
-- Control: events rows are visible to this role (without it every count reads 0).
WITH e AS (
  SELECT id, source, status, external_id, title, location, ticket_url, start_date,
         (start_date AT TIME ZONE 'Europe/Nicosia')::date AS day,
         regexp_replace(lower(translate(coalesce(title, ''), 'İIÇĞÖŞÜçğıöşüÂâÎîÛû', 'iicgosucgiosuaaiiuu')), '[^a-z0-9]+', '', 'g') AS nt,
         regexp_replace(lower(translate(coalesce(location, ''), 'İIÇĞÖŞÜçğıöşüÂâÎîÛû', 'iicgosucgiosuaaiiuu')), '[^a-z0-9]+', '', 'g') AS nv
    FROM public.events),
g AS (SELECT * FROM e WHERE source = 'gisekibris'),
m AS (SELECT * FROM e WHERE source IS DISTINCT FROM 'gisekibris'),
pairs AS (
  SELECT m.id AS m_id, g.id AS g_id, m.title AS m_title, g.title AS g_title, m.day, m.location AS m_loc, g.location AS g_loc,
         m.source AS m_source, m.status AS m_status, g.status AS g_status,
         (m.nt <> '' AND m.nt = g.nt)                                                  AS by_title,
         (m.nv <> '' AND m.nv = g.nv AND left(m.nt, 10) = left(g.nt, 10) AND m.nt <> '') AS by_venue,
         (m.ticket_url ILIKE '%gisekibris.com%' AND left(m.nt, 10) = left(g.nt, 10))  AS by_ticket
    FROM m JOIN g ON g.day = m.day
   WHERE (m.nt <> '' AND m.nt = g.nt)
      OR (m.nv <> '' AND m.nv = g.nv AND left(m.nt, 10) = left(g.nt, 10) AND m.nt <> '')
      OR (m.ticket_url ILIKE '%gisekibris.com%' AND left(m.nt, 10) = left(g.nt, 10))),
today AS (SELECT (now() AT TIME ZONE 'Europe/Nicosia')::date AS d)
SELECT json_build_object(
  'control_events_visible', EXISTS (SELECT 1 FROM public.events),
  'gise_events',            (SELECT count(*) FROM g),
  'gise_upcoming_approved', (SELECT count(*) FROM g, today WHERE g.day >= today.d AND g.status = 'approved'),
  'non_gise_events',        (SELECT count(*) FROM m),
  'non_gise_by_source',     (SELECT json_object_agg(coalesce(source, '(null)'), n) FROM (SELECT source, count(*) n FROM m GROUP BY source) s),
  'non_gise_upcoming_approved', (SELECT count(*) FROM m, today WHERE m.day >= today.d AND m.status = 'approved'),
  'non_gise_with_a_gise_twin',  (SELECT count(DISTINCT m_id) FROM pairs),
  'twins_upcoming_both_approved', (SELECT count(DISTINCT m_id) FROM pairs, today WHERE day >= today.d AND m_status = 'approved' AND g_status = 'approved'),
  'twins_by_rule', json_build_object(
     'title',  (SELECT count(DISTINCT m_id) FROM pairs WHERE by_title),
     'venue',  (SELECT count(DISTINCT m_id) FROM pairs WHERE by_venue AND NOT by_title),
     'ticket_only', (SELECT count(DISTINCT m_id) FROM pairs WHERE by_ticket AND NOT by_title AND NOT by_venue)),
  'manual_rows_with_gise_ticket_url', (SELECT count(*) FROM m WHERE ticket_url ILIKE '%gisekibris.com%'),
  'dups_inside_gise',      (SELECT count(*) FROM (SELECT nt, day FROM g WHERE nt <> '' GROUP BY nt, day HAVING count(DISTINCT external_id) > 1) x),
  'dups_inside_non_gise',  (SELECT count(*) FROM (SELECT nt, day FROM m WHERE nt <> '' GROUP BY nt, day HAVING count(*) > 1) x),
  'examples', (SELECT json_agg(x) FROM (
      SELECT day, m_source, m_status, m_title, m_loc, g_status, g_title, g_loc,
             CASE WHEN by_title THEN 'title' WHEN by_venue THEN 'venue' ELSE 'ticket' END AS rule
        FROM pairs, today ORDER BY (day >= today.d) DESC, day DESC LIMIT 8) x),
  'examples_inside_non_gise', (SELECT json_agg(x) FROM (
      SELECT day, min(title) AS title, count(*) AS copies, string_agg(DISTINCT coalesce(source, '(null)'), ',') AS sources
        FROM m WHERE nt <> '' GROUP BY nt, day HAVING count(*) > 1 ORDER BY day DESC LIMIT 5) x)
) AS result;
