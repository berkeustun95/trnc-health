-- The leagues-lookup response (20261075). Read-only.
SELECT (SELECT substring(r.content from 1 for 60000) FROM net._http_response r
         WHERE r.content LIKE '%current World competitions%' ORDER BY r.created DESC LIMIT 1) AS lookup,
       now() AS read_at;
