-- Read-only. Data jobs slice 2: what each registry job's own heartbeat rows say (data_job_runs, 20261205).
-- One row per job_key that has run rows: how many rows (90-day purge), the latest started_at, that run's outcome,
-- error_class and run_ref; then one row per registry key with NO run row at all (a job that never recorded).
-- Job/run metadata only: no user table, no user id, no user count.
WITH latest AS (
  SELECT DISTINCT ON (job_key) job_key, started_at, outcome, error_class, run_ref
    FROM public.data_job_runs
   ORDER BY job_key, started_at DESC, id DESC
), per_job AS (
  SELECT job_key, count(*) AS run_rows FROM public.data_job_runs GROUP BY job_key
)
SELECT p.job_key, p.run_rows::text AS run_rows, l.started_at::text AS latest_started_at,
       l.outcome AS latest_outcome, coalesce(l.error_class, '-') AS latest_error_class,
       coalesce(l.run_ref, '-') AS latest_run_ref
  FROM per_job p JOIN latest l USING (job_key)
UNION ALL
SELECT d.key, '0', 'no run row (runner ' || d.runner || ')', '-', '-', '-'
  FROM public.data_jobs d
 WHERE NOT EXISTS (SELECT 1 FROM public.data_job_runs r WHERE r.job_key = d.key)
UNION ALL
SELECT 'control: role bypasses RLS (false = an empty list may be RLS, not "no runs")',
       (SELECT rolbypassrls FROM pg_catalog.pg_roles WHERE rolname = current_user)::text, '-', '-', '-', '-'
 ORDER BY 1;
