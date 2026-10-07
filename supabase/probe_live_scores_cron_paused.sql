-- Live Scores cron jobs after 20261090 (expect 6 rows, all active = false). Read-only.
SELECT json_agg(json_build_object('job', jobname, 'active', active) ORDER BY jobname) AS jobs, now() AS read_at
  FROM cron.job WHERE jobname LIKE 'live-scores-%';
