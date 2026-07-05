-- ─── Job Postings — Auto-expire (Slice 2) ───────────────────────────────────
-- The board reads status='active' AND expires_at > now(), so time-expired jobs
-- already vanish from the public list. But nothing ever wrote status='expired',
-- so rows sat at 'active' forever and the admin "expired" state was empty.
--
-- This flips active→expired once expires_at passes. It COMPLEMENTS the board's
-- read filter (does not replace it). pg_cron is already in production use in
-- this project (see send-duty-notification/schedule.sql), so we schedule there.
--
-- The function is SECURITY DEFINER and runs with no JWT; the guard trigger from
-- Slice 1 explicitly allows the active→expired flip in that system context.

CREATE OR REPLACE FUNCTION expire_job_postings() RETURNS void
  LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE job_postings
     SET status = 'expired', updated_at = now()
   WHERE status = 'active'
     AND expires_at IS NOT NULL
     AND expires_at < now();
$$;

-- Hourly. Re-running is safe (idempotent — only active+past-expiry rows match).
SELECT cron.schedule('expire-job-postings', '0 * * * *', $$ SELECT expire_job_postings(); $$);
