-- ─── Fix: report rate limit never fired ──────────────────────────────────────
-- check_report_rate_limit() was created without SECURITY DEFINER, so it ran as
-- the calling `authenticated` role and its count(*) over content_reports was
-- subject to that table's own RLS — which is admin-only-read. A non-admin's
-- count therefore always came back 0 and the 20/24h limit was unreachable, so
-- any user could flood the moderation queue.
--
-- The sibling triggers in 20260701_rate_limits.sql get away with no
-- SECURITY DEFINER only because a user CAN read their own appointments and
-- questions. content_reports is the first table where the actor is deliberately
-- blind to their own rows, which is exactly what broke the count.
--
-- Verified failing before this fix (22 reports filed with a 20 limit) and
-- passing after, against production with a throwaway account.

CREATE OR REPLACE FUNCTION check_report_rate_limit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF (
    SELECT count(*) FROM content_reports
    WHERE reporter_id = NEW.reporter_id
      AND created_at > now() - interval '24 hours'
  ) >= 20 THEN
    RAISE EXCEPTION 'REPORT_RATE_LIMIT';
  END IF;
  RETURN NEW;
END;
$$;
