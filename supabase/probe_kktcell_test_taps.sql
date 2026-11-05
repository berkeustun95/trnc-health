-- Read-only. Berke 2026-11-05: connectivity taps around the device tests (16:41-17:50 UTC = 18:41-19:50 EET) and the normal
-- daily rate, so test rows are not confused with real users' taps (rows carry no identifier by design).
SELECT 'row' AS part, to_char(ce.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS') AS at, ce.id::text AS a, l.slug AS b, ce.action || ' / ' || coalesce(ce.region, '-') || ' / ' || coalesce(ce.lang, '-') AS c
  FROM public.contact_events ce LEFT JOIN public.connectivity_links l ON l.id = ce.entity_id
 WHERE ce.module = 'connectivity' AND ce.created_at >= '2026-11-05 16:00:00+00' AND ce.created_at < '2026-11-05 18:30:00+00'
UNION ALL
SELECT 'day', to_char(date_trunc('day', created_at), 'YYYY-MM-DD'), count(*)::text, NULL, NULL FROM public.contact_events
 WHERE module = 'connectivity' AND created_at >= now() - interval '30 days' GROUP BY date_trunc('day', created_at)
ORDER BY 1 DESC, 2;
