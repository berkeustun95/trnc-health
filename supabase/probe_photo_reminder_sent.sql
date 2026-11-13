-- Read-only probe (2026-11-13): did the Bandabuliya photo reminder (20261196) send after the QA photo
-- posted 13:12:49 UTC? Timestamps and job statuses only; no user data, no IDs, no counts.
SELECT last_sent_at FROM public.marketplace_photo_reminder_state;

SELECT d.start_time, d.end_time, d.status, left(d.return_message, 80) AS return_message
FROM cron.job_run_details d JOIN cron.job j ON j.jobid = d.jobid
WHERE j.jobname = 'marketplace-photo-review-reminder'
ORDER BY d.start_time DESC
LIMIT 6;
