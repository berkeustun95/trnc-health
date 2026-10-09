-- Read-only (2026-10-09): did Expo accept the check-ins waitlist pushes (20261100, 10:16 UTC)?
-- notify_module_waitlist POSTs one push per waitlisted user with a push token (pg_net, after COMMIT).
-- Counts only — no tokens, no user ids.
SELECT 'waitlist in-app notifications' AS what,
       format('%s rows of type waitlist since 10:15 UTC', count(*)) AS detail
  FROM notifications WHERE type = 'waitlist' AND created_at >= '2026-10-09 10:15+00'
UNION ALL
SELECT 'expo push replies', format('HTTP %s · %s replies · ok %s · errors %s', r.status_code, count(*),
       count(*) FILTER (WHERE r.content::text ILIKE '%"status":"ok"%'),
       count(*) FILTER (WHERE r.content::text ILIKE '%"status":"error"%'))
  FROM net._http_response r
 WHERE r.created >= '2026-10-09 10:15+00' AND r.created < '2026-10-09 10:20+00'
   AND r.content::text ILIKE '%"data"%' AND (r.content::text ILIKE '%"status":"ok"%' OR r.content::text ILIKE '%"status":"error"%')
 GROUP BY r.status_code;
