-- Read-only. Berke 2026-11-05: which connectivity taps fall in the device-test window (16:41-17:25 UTC = 18:41-19:25 EET),
-- and the normal rate around it, so test rows are not confused with real users' taps (rows carry no identifier by design).
SELECT 'window' AS part, ce.created_at, ce.id, ce.entity_id, ce.action, ce.region, ce.lang
FROM public.contact_events ce
WHERE ce.module = 'connectivity' AND ce.created_at >= '2026-11-05 16:30:00+00' AND ce.created_at < '2026-11-05 18:30:00+00'
ORDER BY ce.created_at;
SELECT date_trunc('day', created_at)::date AS day, count(*) AS taps FROM public.contact_events
WHERE module = 'connectivity' AND created_at >= now() - interval '30 days' GROUP BY 1 ORDER BY 1;
SELECT l.id, l.slug, l.url FROM public.connectivity_links l ORDER BY l.slug;
