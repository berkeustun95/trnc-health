-- Read-only (2026-10-08): did the first google-places cron runs work? The refresh job POSTs to the
-- function with the Vault key; the function answers 403 unless that JWT's role is service_role.
-- cron.job_run_details only says the POST was queued; net._http_response holds the answer.
SELECT 'cron run' AS what, format('%s · %s · %s · %s', j.jobname, d.status, d.start_time, left(coalesce(d.return_message, ''), 120)) AS detail
  FROM cron.job_run_details d JOIN cron.job j ON j.jobid = d.jobid
 WHERE j.jobname IN ('google-places-refresh', 'purge-google-places-cache')
UNION ALL
SELECT 'http response', format('%s · HTTP %s · %s', r.created, r.status_code, left(coalesce(r.content::text, r.error_msg, ''), 160))
  FROM net._http_response r
 WHERE r.created >= '2026-10-08 03:15+00' AND r.created < '2026-10-08 03:30+00'
   AND (r.content::text ILIKE '%refreshed%' OR r.content::text ILIKE '%forbidden%' OR r.content::text ILIKE '%not_configured%')
ORDER BY 1, 2;
